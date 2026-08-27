# SPDX-License-Identifier: AGPL-3.0-only
"""REST API for friends-monitor (watch FACEIT friends lists).

Uses the sub-project's own functions directly. Config is stored as JSON in
friends-monitor/config.json (gitignored); a copy is never written back to
config.example.json.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

FRIENDS_DIR = Path(__file__).resolve().parents[2] / "friends-monitor"
CONFIG_PATH = FRIENDS_DIR / "config.json"
DEFAULT_INTERVAL_MINUTES = 5
MAX_INTERVAL_MINUTES = 24 * 60

import faceit_friends as fm  # noqa: E402

_check_lock = threading.Lock()
_scheduler_lock = threading.Lock()
_scheduler_task: asyncio.Task | None = None
_scheduler_event: asyncio.Event | None = None
_scheduler_loop: asyncio.AbstractEventLoop | None = None
_scheduler_runtime = {
    "running": False,
    "last_started": None,
    "last_finished": None,
    "last_result": None,
    "last_error": None,
    "next_run": None,
}


def is_configured() -> bool:
    return CONFIG_PATH.exists()


def _read_config() -> dict:
    path = CONFIG_PATH if CONFIG_PATH.exists() else fm.CONFIG_EXAMPLE_PATH
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def _scheduler_settings(raw: object, *, strict: bool = False) -> dict:
    """Normalize scheduler settings stored in config.json."""
    raw = raw if isinstance(raw, dict) else {}
    enabled = raw.get("enabled", True)
    interval = raw.get("interval_minutes", DEFAULT_INTERVAL_MINUTES)
    try:
        interval = int(interval)
    except (TypeError, ValueError):
        if strict:
            raise ValueError("interval_minutes must be an integer")
        interval = DEFAULT_INTERVAL_MINUTES
    if not 1 <= interval <= MAX_INTERVAL_MINUTES:
        if strict:
            raise ValueError(
                f"interval_minutes must be between 1 and {MAX_INTERVAL_MINUTES}"
            )
        interval = DEFAULT_INTERVAL_MINUTES
    if not isinstance(enabled, bool):
        if strict:
            raise ValueError("enabled must be a boolean")
        enabled = str(enabled).strip().lower() in {"1", "true", "yes", "on"}
    return {"enabled": enabled, "interval_minutes": interval}


def _wake_scheduler() -> None:
    """Wake the async scheduler safely when called from a sync API thread."""
    with _scheduler_lock:
        loop, event = _scheduler_loop, _scheduler_event
    if loop and event and loop.is_running():
        loop.call_soon_threadsafe(event.set)


def _set_runtime(**updates: object) -> None:
    with _scheduler_lock:
        _scheduler_runtime.update(updates)


def _scheduler_snapshot(cfg: dict | None = None) -> dict:
    if cfg is None:
        cfg = _read_config()
    settings = _scheduler_settings(cfg.get("scheduler"))
    with _scheduler_lock:
        runtime = dict(_scheduler_runtime)
        task = _scheduler_task
    return {
        **settings,
        "configured": CONFIG_PATH.exists(),
        "accounts": len(cfg.get("accounts", [])) if CONFIG_PATH.exists() else 0,
        "active": bool(task and not task.done()),
        **runtime,
    }


@router.get("/config")
def get_config():
    cfg = _read_config()
    cfg["scheduler"] = _scheduler_settings(cfg.get("scheduler"))
    cfg["_used_file"] = "config.json" if CONFIG_PATH.exists() else "config.example.json"
    return cfg


@router.put("/config")
def update_config(cfg: dict):
    if not isinstance(cfg, dict) or "accounts" not in cfg:
        raise HTTPException(400, "config must contain an 'accounts' list")
    cfg.setdefault("discord_webhook", "")
    cfg.setdefault("discord_ping", "")
    try:
        existing = _read_config()
        cfg["scheduler"] = _scheduler_settings(
            cfg.get("scheduler", existing.get("scheduler")), strict=True
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    # Resolve nicknames / profile URLs to GUIDs before saving, so the file on
    # disk always holds runnable entries. Any row we cannot resolve fails the
    # whole save with a per-row message.
    accounts, errors = [], []
    for i, raw in enumerate(cfg.get("accounts", [])):
        acc = dict(raw or {})
        if not any(acc.get(f) for f in ("guid", "faceit", "label")):
            continue  # empty row from the UI
        guid, payload, err = fm.account_guid(acc)
        if err:
            name = acc.get("label") or acc.get("faceit") or acc.get("guid") or "?"
            errors.append(f"account #{i + 1} ({name}): {err}")
            continue
        acc["guid"] = guid
        if payload and payload.get("nickname"):
            nick = payload["nickname"]
            acc["faceit"] = nick  # canonicalize (replaces URL / casing)
            if not (acc.get("label") or "").strip():
                acc["label"] = nick
        accounts.append(acc)
    if errors:
        raise HTTPException(400, "Could not resolve: " + "; ".join(errors))

    cfg["accounts"] = accounts
    _write_config(cfg)
    _wake_scheduler()
    return {"ok": True, "used_file": "config.json", "accounts": len(accounts)}


class SchedulerReq(BaseModel):
    enabled: bool = True
    interval_minutes: int = Field(
        DEFAULT_INTERVAL_MINUTES,
        ge=1,
        le=MAX_INTERVAL_MINUTES,
    )


@router.put("/scheduler")
def update_scheduler(req: SchedulerReq):
    if not CONFIG_PATH.exists():
        raise HTTPException(
            400, "save a friends configuration before enabling the scheduler"
        )
    cfg = _read_config()
    cfg["scheduler"] = {
        "enabled": req.enabled,
        "interval_minutes": req.interval_minutes,
    }
    _write_config(cfg)
    _wake_scheduler()
    return {"ok": True, "scheduler": _scheduler_snapshot(cfg)}


@router.get("/resolve")
def resolve(q: str):
    """Resolve a nickname, profile URL or GUID to (guid, nickname, ...)."""
    parsed = fm.parse_player_input(q)
    if not parsed:
        raise HTTPException(400, "empty input")
    kind, value = parsed
    if kind == "guid":
        return {
            "guid": value,
            "nickname": None,
            "country": None,
            "avatar": None,
            "resolved": False,
        }
    try:
        payload = fm.resolve_payload(value)
    except fm.ApiError as e:
        status = e.status if e.status in (400, 404) else 502
        raise HTTPException(status, str(e))
    return {
        "guid": payload["id"],
        "nickname": payload.get("nickname"),
        "country": payload.get("country"),
        "avatar": payload.get("avatar"),
        "resolved": True,
    }


@router.get("/status")
def status():
    cfg = _read_config()
    db_exists = fm.DB_PATH.exists()
    conn = fm.db_connect() if db_exists else None
    event_count = snapshots = 0
    if conn:
        event_count = conn.execute("SELECT COUNT(*) FROM event").fetchone()[0]
        snapshots = conn.execute("SELECT COUNT(*) FROM account_state").fetchone()[0]
        conn.close()
    return {
        "used_file": "config.json" if CONFIG_PATH.exists() else "config.example.json",
        "has_webhook": bool(cfg.get("discord_webhook")),
        "accounts": len(cfg.get("accounts", [])),
        "db_exists": db_exists,
        "event_count": event_count,
        "snapshot_accounts": snapshots,
        "scheduler": _scheduler_snapshot(cfg),
    }


def _perform_check(force_alerts: bool = False) -> dict:
    """Run one full scan of every configured account."""
    cfg = _read_config()
    webhook = cfg.get("discord_webhook", "")
    ping = cfg.get("discord_ping", "").strip()

    if not cfg.get("accounts"):
        return {"results": []}

    conn = fm.db_connect()
    results = []
    try:
        for account in cfg.get("accounts", []):
            label = account.get("label") or account.get("faceit") or account.get("guid")
            # hand-edited configs may still hold a nickname/URL instead of a GUID
            guid, _payload, err = fm.account_guid(account)
            if err:
                results.append({"label": label, "ok": False, "error": err})
                continue
            account = {**account, "guid": guid}
            try:
                added, removed = fm.process_account(
                    conn, account, webhook, ping, alert_on_seed=force_alerts
                )
                results.append(
                    {"label": label, "ok": True, "added": added, "removed": removed}
                )
            except Exception as e:  # noqa: BLE001
                results.append({"label": label, "ok": False, "error": str(e)})
        conn.commit()
    finally:
        conn.close()
    return {"results": results}


@router.post("/check")
def run_check(force_alerts: bool = False):
    """Run one full scan of every configured account (blocking)."""
    if not _check_lock.acquire(blocking=False):
        raise HTTPException(409, "a friends check is already running")
    try:
        return _perform_check(force_alerts)
    finally:
        _check_lock.release()


def _scheduled_check() -> None:
    """Run a scheduled check in a worker thread without overlapping manual checks."""
    if not _check_lock.acquire(blocking=False):
        _set_runtime(
            next_run=None, last_error="Skipped: another check is already running"
        )
        return
    started = time.time()
    _set_runtime(running=True, last_started=started, next_run=None, last_error=None)
    try:
        payload = _perform_check(False)
        results = payload["results"]
        _set_runtime(
            last_finished=time.time(),
            last_result={
                "accounts": len(results),
                "ok": sum(1 for result in results if result["ok"]),
                "failed": sum(1 for result in results if not result["ok"]),
                "added": sum(result.get("added", 0) for result in results),
                "removed": sum(result.get("removed", 0) for result in results),
            },
            last_error=None,
        )
    except Exception as e:  # noqa: BLE001
        _set_runtime(last_finished=time.time(), last_result=None, last_error=str(e))
    finally:
        _check_lock.release()
        _set_runtime(running=False)


async def _wait_for_scheduler_event(timeout: float | None) -> None:
    with _scheduler_lock:
        event = _scheduler_event
    if event is None:
        return
    try:
        if timeout is None:
            await event.wait()
        else:
            await asyncio.wait_for(event.wait(), timeout=timeout)
    except TimeoutError:
        pass
    finally:
        event.clear()


async def _scheduler_worker() -> None:
    while True:
        try:
            cfg = _read_config()
            settings = _scheduler_settings(cfg.get("scheduler"))
            has_accounts = CONFIG_PATH.exists() and bool(cfg.get("accounts"))
        except Exception as e:  # noqa: BLE001
            _set_runtime(last_error=f"Could not read scheduler config: {e}")
            await _wait_for_scheduler_event(60)
            continue

        if not settings["enabled"] or not has_accounts:
            _set_runtime(next_run=None)
            await _wait_for_scheduler_event(None)
            continue

        # Run once at application startup, then wait for the configured interval.
        await asyncio.to_thread(_scheduled_check)
        try:
            cfg = _read_config()
            settings = _scheduler_settings(cfg.get("scheduler"))
        except Exception:
            settings = {"enabled": False, "interval_minutes": DEFAULT_INTERVAL_MINUTES}
        if settings["enabled"]:
            _set_runtime(next_run=time.time() + settings["interval_minutes"] * 60)
            await _wait_for_scheduler_event(settings["interval_minutes"] * 60)


def start_scheduler() -> None:
    """Start the app-owned scheduler during FastAPI startup."""
    global _scheduler_event, _scheduler_loop, _scheduler_task
    with _scheduler_lock:
        if _scheduler_task and not _scheduler_task.done():
            return
        _scheduler_loop = asyncio.get_running_loop()
        _scheduler_event = asyncio.Event()
        _scheduler_task = asyncio.create_task(
            _scheduler_worker(), name="friends-monitor-scheduler"
        )


async def stop_scheduler() -> None:
    """Cancel the scheduler task during FastAPI shutdown."""
    global _scheduler_event, _scheduler_loop, _scheduler_task
    with _scheduler_lock:
        task = _scheduler_task
        event = _scheduler_event
    if not task:
        return
    if event:
        event.set()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    with _scheduler_lock:
        _scheduler_task = None
        _scheduler_event = None
        _scheduler_loop = None


@router.get("/events")
def events(limit: int = 100, account_lbl: str | None = None):
    if not fm.DB_PATH.exists():
        return {"events": []}
    conn = fm.db_connect()
    if account_lbl:
        rows = conn.execute(
            "SELECT ts, account_lbl, kind, friend_id, nickname FROM event "
            "WHERE account_lbl = ? ORDER BY ts DESC LIMIT ?",
            (account_lbl, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT ts, account_lbl, kind, friend_id, nickname FROM event "
            "ORDER BY ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
    conn.close()
    return {
        "events": [
            {
                "ts": r[0],
                "account_lbl": r[1],
                "kind": r[2],
                "friend_id": r[3],
                "nickname": r[4],
            }
            for r in rows
        ]
    }


@router.get("/snapshots")
def snapshots(account_id: str | None = None):
    if not fm.DB_PATH.exists():
        return {"snapshots": []}
    conn = fm.db_connect()
    if account_id:
        rows = conn.execute(
            "SELECT account_id, friend_id, nickname, first_seen, last_seen "
            "FROM snapshot WHERE account_id = ? ORDER BY nickname",
            (account_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT account_id, friend_id, nickname, first_seen, last_seen "
            "FROM snapshot ORDER BY account_id, nickname"
        ).fetchall()
    conn.close()
    return {
        "snapshots": [
            {
                "account_id": r[0],
                "friend_id": r[1],
                "nickname": r[2],
                "first_seen": r[3],
                "last_seen": r[4],
            }
            for r in rows
        ]
    }
