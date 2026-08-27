# SPDX-License-Identifier: AGPL-3.0-only
"""REST API for FACEIT demo auto-sync.

The sync runs in a background thread (downloads + ingestion take minutes) and
reports progress through /sync/status polling. Discovery endpoints are cheap
and blocking; /login blocks while the user signs in inside the automation
browser window.
"""

from __future__ import annotations

import logging
import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

log = logging.getLogger(__name__)


# --- accounts ----------------------------------------------------------------


def _load_accounts() -> list[dict]:
    try:
        import faceit_friends as fm
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"friends-monitor unavailable: {e}")
    cfg, _path = fm.load_config()
    return [
        {
            "label": a.get("label"),
            "faceit": a.get("faceit"),
            "guid": a.get("guid"),
        }
        for a in cfg.get("accounts", [])
        if a.get("faceit") or a.get("guid")
    ]


def _resolved_accounts() -> list[dict]:
    """Accounts with GUIDs filled in (network only for unresolved ones)."""
    import faceit_friends as fm

    accounts = _load_accounts()
    for a in accounts:
        if not a["guid"]:
            try:
                guid, _payload, err = fm.account_guid(a)
                a["guid"] = guid
                if err:
                    a["error"] = err
            except Exception as e:  # noqa: BLE001
                a["error"] = str(e)
    return accounts


@router.get("/status")
def status():
    ns = _voice_ns()
    st = {
        "accounts": _load_accounts(),
        "cdp_configured": bool(ns["config"].FACEIT_CDP_ENDPOINT),
        "headless_default": ns["config"].FACEIT_SYNC_HEADLESS,
        "profile_exists": ns["config"].BROWSER_PROFILE_DIR.exists(),
        "demos_dir": str(ns["config"].DEMOS_DIR),
        "playwright_installed": False,
        "job": _job_snapshot(),
    }
    try:
        import playwright  # noqa: F401

        st["playwright_installed"] = True
    except ImportError:
        pass
    return st


@router.get("/recent")
def recent(limit: int = 10):
    from core import faceit_sync

    accounts = _resolved_accounts()
    if not accounts:
        raise HTTPException(
            400, "no accounts configured in friends-monitor/config.json"
        )
    matches = faceit_sync.list_recent_matches(accounts, limit=limit)
    return {"matches": matches}


@router.post("/login")
def login():
    """Open a browser window for the one-time FACEIT login (blocks until done)."""
    from core import faceit_sync

    try:
        browser = faceit_sync.BrowserSession(headless=False)
    except faceit_sync.FaceitError as e:
        raise HTTPException(500, str(e))
    try:
        ok = browser.login(timeout_s=300)
        if not ok:
            raise HTTPException(408, "login window timed out after 5 minutes")
        return {"ok": True, "detail": "login window closed — session saved"}
    except faceit_sync.FaceitError as e:
        raise HTTPException(500, str(e))
    finally:
        browser.close()


# --- background sync job -----------------------------------------------------


class SyncReq(BaseModel):
    limit: int = 10
    headless: bool | None = None


_job = {
    "running": False,
    "started": None,
    "finished": None,
    "log": [],
    "result": None,
    "error": None,
}
_job_lock = threading.Lock()


def _job_snapshot() -> dict:
    with _job_lock:
        return {k: (list(v) if isinstance(v, list) else v) for k, v in _job.items()}


def _job_log(msg: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    with _job_lock:
        _job["log"].append(f"[{stamp}] {msg}")
        del _job["log"][:-400]


def _run_job(limit: int, headless: bool | None) -> None:
    try:
        from core import faceit_sync

        accounts = _resolved_accounts()
        result = faceit_sync.sync_new_demos(
            accounts, limit=limit, log_fn=_job_log, headless=headless
        )
        with _job_lock:
            _job["result"] = result
            _job["error"] = None
    except Exception as e:  # noqa: BLE001
        log.exception("sync job failed")
        _job_log(f"✗ sync failed: {e}")
        with _job_lock:
            _job["error"] = str(e)
    finally:
        with _job_lock:
            _job["running"] = False
            _job["finished"] = time.time()


@router.post("/sync")
def start_sync(req: SyncReq):
    with _job_lock:
        if _job["running"]:
            raise HTTPException(409, "a sync is already running")
        _job.update(
            {
                "running": True,
                "started": time.time(),
                "finished": None,
                "log": [],
                "result": None,
                "error": None,
            }
        )
    threading.Thread(
        target=_run_job,
        args=(max(1, min(req.limit, 100)), req.headless),
        name="faceit-sync",
        daemon=True,
    ).start()
    return {"started": True}


@router.get("/sync/status")
def sync_status():
    return _job_snapshot()


def _voice_ns() -> dict:
    """Lazy access to the voice config (paths/settings) without heavy imports."""
    try:
        import config

        return {"config": config}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"voice module unavailable: {e}")
