# SPDX-License-Identifier: AGPL-3.0-only
#!/usr/bin/env python3
"""
FACEIT friends monitor.

Polls each configured account's public friends list, diffs against the last
snapshot stored in SQLite, and alerts on Discord (+ log file) when a friend is
added or removed.

Run model: one-shot. Invoke it once per check; an OS scheduler (Windows Task
Scheduler / cron) calls it on an interval. The script does not loop.

API (verified, no auth required):
    GET https://www.faceit.com/api/friends/v1/users/{user_id}/friends?limit=100
    Cursor-paginated via ?cursor=<next_cursor>; has_more flags more pages.
    limit max is 100 (101-127 -> 400 err_br0).
    404 err_nf0 -> user not found.

    GET https://www.faceit.com/api/users/v1/nicknames/{nickname}
    Resolves a nickname to the user GUID (payload.id). Case-sensitive;
    unknown nickname -> 404 err_nf0. Note the plural "nicknames" — the
    singular /nickname/{x} path from older docs is dead.

Usage:
    python faceit_friends.py            # check all accounts, one-shot
    python faceit_friends.py --once     # same, explicit
    python faceit_friends.py --reseed   # drop snapshots, re-seed (no alerts)
    python faceit_friends.py --force-alerts  # alert even on the seed run
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
CONFIG_EXAMPLE_PATH = BASE_DIR / "config.example.json"
DB_PATH = BASE_DIR / "faceit.db"
LOG_PATH = BASE_DIR / "events.log"

API_BASE = "https://www.faceit.com/api/friends/v1/users"
NICKNAME_API = "https://www.faceit.com/api/users/v1/nicknames"
PAGE_LIMIT = 100  # API rejects >100
MAX_PAGES = 50  # safety cap (5000 friends)
PER_ACCOUNT_DELAY_S = 1.0  # be nice to the endpoint
REQUEST_TIMEOUT_S = 15
HTTP_RETRY_DELAYS = [2, 5, 12]  # backoff seconds for transient errors

# Cloudflare blocks the default "Python-urllib/x.y" User-Agent (Error 1010).
# Send browser-like headers so requests are treated as a normal browser client.
BROWSER_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.faceit.com/",
}

# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #

log = logging.getLogger("faceit")
log.setLevel(logging.INFO)
_log_fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
_sh = logging.StreamHandler(sys.stdout)
_sh.setFormatter(_log_fmt)
log.addHandler(_sh)
_fh = logging.FileHandler(LOG_PATH, encoding="utf-8")
_fh.setFormatter(_log_fmt)
log.addHandler(_fh)


# --------------------------------------------------------------------------- #
# HTTP helpers (stdlib only — no requests/httpx dependency)
# --------------------------------------------------------------------------- #


class ApiError(Exception):
    """Raised for non-2xx FACEIT responses."""

    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body[:200]}")
        self.status = status
        self.body = body


def _http_get_json(url: str) -> dict:
    """GET url, return parsed JSON. Retries transient errors with backoff."""
    last_err: ApiError | None = None
    for attempt, delay in enumerate([0, *HTTP_RETRY_DELAYS]):
        if delay:
            time.sleep(delay)
        req = urllib.request.Request(url, headers=BROWSER_HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
                raw = resp.read().decode("utf-8", "replace")
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            err = ApiError(e.code, body)
            # 404 is terminal (bad user id); 400 is terminal (bad params).
            if e.code in (404, 400):
                raise err
            last_err = err  # 403/429/5xx -> retry
            log.warning(
                "Transient HTTP %s on %s (attempt %d)", e.code, url, attempt + 1
            )
            continue
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last_err = ApiError(0, str(e))
            log.warning("Network error on %s: %s (attempt %d)", url, e, attempt + 1)
            continue
    raise last_err if last_err else ApiError(0, "unknown")


def fetch_all_friends(user_id: str) -> list[dict]:
    """Follow cursor pagination, return the full friend list for one account."""
    friends: list[dict] = []
    cursor = None
    for _ in range(MAX_PAGES):
        params = {"limit": str(PAGE_LIMIT)}
        if cursor:
            params["cursor"] = cursor
        url = f"{API_BASE}/{urllib.parse.quote(user_id)}/friends?{urllib.parse.urlencode(params)}"
        data = _http_get_json(url)
        payload = data.get("payload") or {}
        friends.extend(payload.get("friends") or [])
        if not payload.get("has_more"):
            break
        cursor = payload.get("next_cursor")
        if not cursor:
            break
    # de-dup by id (defensive)
    seen = set()
    unique = []
    for f in friends:
        if f.get("id") and f["id"] not in seen:
            seen.add(f["id"])
            unique.append(f)
    return unique


# --------------------------------------------------------------------------- #
# Nickname / profile URL -> GUID resolution
# --------------------------------------------------------------------------- #

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)
PROFILE_URL_RE = re.compile(
    r"faceit\.com/(?:[a-z]{2}(?:-[a-z]{2})?/)?players/([^/?#]+)", re.I
)


def parse_player_input(raw: str | None) -> tuple[str, str] | None:
    """Classify user input as ('guid', uuid) or ('nickname', nick).

    Accepts a bare GUID, a profile URL (nickname or GUID in the path), or a
    bare nickname. Returns None for empty input.
    """
    raw = (raw or "").strip()
    if not raw:
        return None
    if UUID_RE.match(raw):
        return ("guid", raw.lower())
    m = PROFILE_URL_RE.search(raw)
    if m:
        slug = urllib.parse.unquote(m.group(1))
        if UUID_RE.match(slug):
            return ("guid", slug.lower())
        return ("nickname", slug)
    return ("nickname", raw)


def resolve_payload(nickname: str) -> dict:
    """Look up one exact nickname, return the FACEIT user payload."""
    url = f"{NICKNAME_API}/{urllib.parse.quote(nickname)}"
    try:
        data = _http_get_json(url)
    except ApiError as e:
        if e.status == 404:
            raise ApiError(
                404,
                f"FACEIT user '{nickname}' not found — nicknames are "
                f"case-sensitive, check exact spelling",
            ) from e
        raise
    payload = data.get("payload") or {}
    if not payload.get("id"):
        raise ApiError(502, f"unexpected response resolving '{nickname}'")
    # Real accounts report registration_status='active'; reject anything else
    # rather than monitor a pending/deleted record.
    status = (payload.get("registration_status") or "").lower()
    if status and status != "active":
        raise ApiError(
            404,
            f"FACEIT user '{nickname}' has no active account "
            f"(registration_status={status})",
        )
    return payload


def account_guid(account: dict) -> tuple[str | None, dict | None, str | None]:
    """Resolve a config account entry to (guid, payload, error).

    Tries the account's guid and faceit fields in that order; each may be a
    GUID, profile URL or nickname. The free-form label field is deliberately
    NOT used — display names can accidentally match a real player's nickname.
    Only hits the network when no field already holds a valid GUID (payload
    is None in that case).
    """
    tried: list[str] = []
    last_err: ApiError | None = None
    for field in ("guid", "faceit"):
        parsed = parse_player_input(account.get(field))
        if not parsed:
            continue
        kind, value = parsed
        if kind == "guid":
            return value, None, None
        tried.append(f"{field}='{value}'")
        try:
            payload = resolve_payload(value)
            return payload["id"], payload, None
        except ApiError as e:
            last_err = e
    if last_err:
        return None, None, str(last_err)
    return (
        None,
        None,
        (
            f"no identifier in account entry (set 'faceit' to the exact nickname; "
            f"tried: {tried or 'nothing'})"
        ),
    )


def send_discord(webhook_url: str, content: str, username: str | None = None) -> bool:
    """POST to a Discord webhook (form-encoded; JSON content got 400 in tests)."""
    if not webhook_url:
        return False
    form = {"content": content[:1900]}  # Discord hard cap 2000
    if username:
        form["username"] = username[:80]
    data = urllib.parse.urlencode(form).encode("utf-8")
    # Discord's API is behind Cloudflare, which blocks the default
    # "Python-urllib/x.y" User-Agent (Error 1010). Send a browser UA.
    req = urllib.request.Request(
        webhook_url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": BROWSER_HEADERS["User-Agent"],
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            return 200 <= resp.status < 300
    except Exception as e:
        log.error("Discord webhook failed: %s", e)
        return False


# --------------------------------------------------------------------------- #
# Storage (SQLite snapshot store)
# --------------------------------------------------------------------------- #


def db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    # account_state was added after the original snapshot-only schema.  A
    # separate state row is necessary because an empty snapshot can mean
    # either "successfully seeded with zero friends" or "never checked".
    schema_version = conn.execute("PRAGMA user_version").fetchone()[0]
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS snapshot (
            account_id  TEXT NOT NULL,
            friend_id   TEXT NOT NULL,
            nickname    TEXT,
            first_seen  TEXT NOT NULL,
            last_seen   TEXT NOT NULL,
            PRIMARY KEY (account_id, friend_id)
        );
        CREATE TABLE IF NOT EXISTS event (
            ts          TEXT NOT NULL,
            account_id  TEXT NOT NULL,
            account_lbl TEXT,
            kind        TEXT NOT NULL,   -- 'added' | 'removed'
            friend_id   TEXT,
            nickname    TEXT
        );
        CREATE TABLE IF NOT EXISTS account_state (
            account_id  TEXT PRIMARY KEY,
            seeded_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_event_ts ON event(ts);
        """
    )
    if schema_version < 1:
        # Existing databases have already completed their seed even though
        # the old schema could not represent that explicitly.  Recover the
        # oldest known first_seen value from event history where possible;
        # repeated DELETE + INSERT refreshes may have overwritten the value
        # currently stored in snapshot.
        conn.execute(
            """
            UPDATE snapshot
               SET first_seen = COALESCE(
                   (SELECT MIN(event.ts)
                      FROM event
                     WHERE event.account_id = snapshot.account_id
                       AND event.friend_id = snapshot.friend_id
                       AND event.kind = 'added'),
                   snapshot.first_seen
               )
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO account_state (account_id, seeded_at)
            SELECT snapshot.account_id,
                   COALESCE(
                       (SELECT MIN(event.ts)
                          FROM event
                         WHERE event.account_id = snapshot.account_id),
                       MIN(snapshot.first_seen)
                   )
              FROM snapshot
             GROUP BY snapshot.account_id
            """
        )
        # The legacy implementation wrote every initial friend as an "added"
        # event.  Capture that seed set, then discard its additions until the
        # first corresponding removal.  This also removes duplicate seed runs
        # caused by overlapping legacy checks while preserving a later,
        # legitimate re-add after a removal.
        conn.executescript(
            """
            DROP TABLE IF EXISTS temp.legacy_seed_friend;
            CREATE TEMP TABLE legacy_seed_friend (
                account_id TEXT NOT NULL,
                friend_id TEXT NOT NULL,
                PRIMARY KEY (account_id, friend_id)
            );
            INSERT OR IGNORE INTO legacy_seed_friend (account_id, friend_id)
            SELECT event.account_id, event.friend_id
              FROM event
              JOIN account_state
                ON account_state.account_id = event.account_id
               AND account_state.seeded_at = event.ts
             WHERE event.kind = 'added';

            DELETE FROM event
             WHERE event.kind = 'added'
               AND EXISTS (
                   SELECT 1
                     FROM legacy_seed_friend
                    WHERE legacy_seed_friend.account_id = event.account_id
                      AND legacy_seed_friend.friend_id = event.friend_id
               )
               AND NOT EXISTS (
                   SELECT 1
                     FROM event AS removed
                    WHERE removed.account_id = event.account_id
                      AND removed.friend_id = event.friend_id
                      AND removed.kind = 'removed'
                      AND removed.ts < event.ts
               );
            DROP TABLE legacy_seed_friend;
            """
        )
        conn.execute("PRAGMA user_version = 1")
        conn.commit()
    return conn


def get_snapshot(conn: sqlite3.Connection, account_id: str) -> dict[str, dict]:
    rows = conn.execute(
        "SELECT friend_id, nickname FROM snapshot WHERE account_id = ?",
        (account_id,),
    ).fetchall()
    return {fid: {"nickname": nick} for fid, nick in rows}


def get_seeded_at(conn: sqlite3.Connection, account_id: str) -> str | None:
    row = conn.execute(
        "SELECT seeded_at FROM account_state WHERE account_id = ?", (account_id,)
    ).fetchone()
    return row[0] if row else None


def replace_snapshot(
    conn: sqlite3.Connection, account_id: str, friends: list[dict]
) -> None:
    """Synchronize one current snapshot without resetting first_seen."""
    now = _now_iso()
    current_ids = {friend["id"] for friend in friends}
    stored_ids = {
        row[0]
        for row in conn.execute(
            "SELECT friend_id FROM snapshot WHERE account_id = ?", (account_id,)
        )
    }
    conn.executemany(
        "DELETE FROM snapshot WHERE account_id = ? AND friend_id = ?",
        [(account_id, friend_id) for friend_id in stored_ids - current_ids],
    )
    conn.executemany(
        "INSERT INTO snapshot (account_id, friend_id, nickname, first_seen, last_seen) "
        "VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(account_id, friend_id) DO UPDATE SET "
        "nickname = COALESCE(excluded.nickname, snapshot.nickname), "
        "last_seen = excluded.last_seen",
        [(account_id, f["id"], f.get("nickname"), now, now) for f in friends],
    )


def mark_seeded(conn: sqlite3.Connection, account_id: str) -> str:
    seeded_at = _now_iso()
    conn.execute(
        "INSERT OR IGNORE INTO account_state (account_id, seeded_at) VALUES (?, ?)",
        (account_id, seeded_at),
    )
    return seeded_at


def record_event(
    conn: sqlite3.Connection,
    account_id: str,
    account_lbl: str,
    kind: str,
    friend_id: str,
    nickname: str | None,
) -> None:
    conn.execute(
        "INSERT INTO event (ts, account_id, account_lbl, kind, friend_id, nickname) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (_now_iso(), account_id, account_lbl, kind, friend_id, nickname),
    )


# --------------------------------------------------------------------------- #
# Core logic
# --------------------------------------------------------------------------- #


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _nick(current: dict, prev: dict, fid: str) -> str:
    return (current.get(fid) or prev.get(fid) or {}).get("nickname") or fid


def _friend_profile_url(fid: str) -> str:
    return f"https://www.faceit.com/en/players/{fid}"


def process_account(
    conn: sqlite3.Connection,
    account: dict,
    webhook: str,
    ping: str,
    *,
    alert_on_seed: bool,
) -> tuple[int, int]:
    """Return (added_count, removed_count). Records + alerts as needed."""
    guid = account["guid"]
    label = account.get("label") or guid
    prev = get_snapshot(conn, guid)
    seeded_at = get_seeded_at(conn, guid)

    try:
        current_list = fetch_all_friends(guid)
    except ApiError as e:
        msg = f"⚠️ **{label}** fetch failed: {e}"
        log.error("[%s] fetch failed: %s", label, e)
        send_discord(webhook, f"{ping} {msg}" if ping else msg)
        raise

    current: dict[str, dict] = {f["id"]: f for f in current_list}

    # Seed state is explicit, so a successfully fetched empty friend list is
    # still seeded and the next real addition will be detected correctly.
    if seeded_at is None:
        replace_snapshot(conn, guid, current_list)
        mark_seeded(conn, guid)
        log.info("[%s] seeded with %d friend(s)", label, len(current))
        if alert_on_seed and current:
            names = ", ".join(f"`{_nick(current, {}, fid)}`" for fid in current)
            body = f"📌 **{label}** seeded with {len(current)} friend(s): {names}"
            send_discord(webhook, f"{ping} {body}" if ping else body)
        # Seed rows establish the baseline; they are not add/remove events.
        return (0, 0)

    added_ids = [fid for fid in current if fid not in prev]
    removed_ids = [fid for fid in prev if fid not in current]

    replace_snapshot(conn, guid, current_list)

    # Build a readable, clickable list: `nickname` per friend.
    def fmt_list(ids: list[str]) -> str:
        return ", ".join(f"`{_nick(current, prev, fid)}`" for fid in ids)

    if added_ids:
        log.info("[%s] +%d friend(s): %s", label, len(added_ids), fmt_list(added_ids))
        for fid in added_ids:
            record_event(conn, guid, label, "added", fid, _nick(current, prev, fid))
        body = f"🆕 **{label}** added {len(added_ids)} friend(s): {fmt_list(added_ids)}"
        send_discord(webhook, f"{ping} {body}" if ping else body)
    if removed_ids:
        log.info(
            "[%s] -%d friend(s): %s", label, len(removed_ids), fmt_list(removed_ids)
        )
        for fid in removed_ids:
            record_event(conn, guid, label, "removed", fid, _nick(current, prev, fid))
        body = f"➖ **{label}** removed {len(removed_ids)} friend(s): {fmt_list(removed_ids)}"
        send_discord(webhook, f"{ping} {body}" if ping else body)

    if not added_ids and not removed_ids:
        log.info("[%s] no change (%d friends)", label, len(current))

    return (len(added_ids), len(removed_ids))


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def load_config() -> tuple[dict, Path]:
    path = CONFIG_PATH if CONFIG_PATH.exists() else CONFIG_EXAMPLE_PATH
    with path.open("r", encoding="utf-8") as f:
        cfg = json.load(f)
    if not cfg.get("accounts"):
        raise SystemExit(f"{path.name} has no accounts")
    return cfg, path


def resolve_accounts(cfg: dict, webhook: str, ping: str) -> tuple[list[dict], bool]:
    """Fill in each account's guid from its identifier fields.

    Returns (usable_accounts, any_guid_changed). Accounts that cannot be
    resolved are skipped with a log entry + Discord warning instead of
    aborting the whole run.
    """
    usable: list[dict] = []
    changed = False
    for i, account in enumerate(cfg["accounts"]):
        label = account.get("label") or account.get("faceit") or f"account #{i + 1}"
        original = account.get("guid")
        guid, _payload, err = account_guid(account)
        if not guid:
            log.error("Skipping %s — %s", label, err)
            msg = f"⚠️ **{label}** skipped: {err}"
            send_discord(webhook, f"{ping} {msg}" if ping else msg)
            continue
        if guid != original:
            log.info("Resolved %s -> %s", label, guid)
            account["guid"] = guid
            changed = True
            time.sleep(0.4)  # nickname lookups share the API rate budget
        usable.append(account)
    return usable, changed


def main() -> int:
    ap = argparse.ArgumentParser(description="FACEIT friends monitor (one-shot)")
    ap.add_argument(
        "--once", action="store_true", help="explicit one-shot (default behavior)"
    )
    ap.add_argument(
        "--reseed",
        action="store_true",
        help="wipe snapshots and re-seed; no alerts sent",
    )
    ap.add_argument(
        "--force-alerts",
        action="store_true",
        help="also alert on the very first (seed) run for an account",
    )
    ap.add_argument(
        "--no-save",
        action="store_true",
        help="do not write resolved GUIDs back to config.json",
    )
    args = ap.parse_args()

    cfg, cfg_path = load_config()
    webhook = cfg.get("discord_webhook", "")
    ping = cfg.get("discord_ping", "").strip()
    if not webhook:
        log.warning("No discord_webhook in config — alerts disabled.")

    accounts, resolved_any = resolve_accounts(cfg, webhook, ping)
    if resolved_any and cfg_path == CONFIG_PATH and not args.no_save:
        # account dicts were updated in place; skipped ones stay untouched so
        # the user can fix them in the file
        CONFIG_PATH.write_text(
            json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        log.info("Resolved GUIDs written back to %s", CONFIG_PATH.name)

    if not accounts:
        log.error("No usable accounts — nothing to check.")
        return 1

    conn = db_connect()
    if args.reseed:
        conn.execute("DELETE FROM snapshot")
        conn.execute("DELETE FROM account_state")
        conn.commit()
        log.info("Snapshots cleared — re-seeding.")

    total_added = total_removed = 0
    failed = 0
    for i, account in enumerate(accounts):
        if i > 0:
            time.sleep(PER_ACCOUNT_DELAY_S)
        try:
            a, r = process_account(
                conn,
                account,
                webhook,
                ping,
                alert_on_seed=args.force_alerts,
            )
        except ApiError:
            failed += 1
            continue
        total_added += a
        total_removed += r

    conn.commit()
    conn.close()
    log.info(
        "Done. accounts=%d added=%d removed=%d failed=%d",
        len(cfg["accounts"]),
        total_added,
        total_removed,
        failed,
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
