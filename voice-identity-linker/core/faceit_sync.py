# SPDX-License-Identifier: AGPL-3.0-only
"""Auto-download FACEIT demos for voice ingestion.

Discovery is fully unauthenticated — the same website-backend JSON APIs the
friends monitor uses (browser-like headers required, Cloudflare blocks the
default Python UA):

    GET https://api.faceit.com/users/v1/nicknames/{nick}                -> payload.id (GUID)
    GET https://api.faceit.com/stats/v1/stats/time/users/{guid}/games/{game}?size=N
    GET https://api.faceit.com/match/v2/match/{match_id}                -> payload.demoURLs

The demo files live on FACEIT-internal storage (the *.faceit-cdn.net hosts
have no public DNS), so every download needs a signed URL from an
authenticated exchange:

    POST https://www.faceit.com/api/download/v2/demos/download-url
         body: {"resource_url": <demoURLs entry>}
         headers: session cookies + "faceit-referer: web-next"
                  + "x-faceit-captcha-token: <Cloudflare Turnstile token>"
    -> payload.download_url   (pre-signed; fetch with no auth)

The Turnstile token can only be minted inside a real browser, so the exchange
runs in a Playwright-driven Chrome: either a persistent profile (one-time
login, stored under config.BROWSER_PROFILE_DIR) or an already-running Chrome
via config.FACEIT_CDP_ENDPOINT. The official API key route is dead — FACEIT
closed key registration and hands Downloads-scope keys only to vetted apps.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path

import config

from core import storage

log = logging.getLogger(__name__)

GAME = config.FACEIT_SYNC_GAME
REQUEST_TIMEOUT_S = 20
DOWNLOAD_TIMEOUT_S = 120
HTTP_RETRY_DELAYS = [2, 5, 12]
API_DELAY_S = 0.7  # between discovery calls — same etiquette as friends-monitor
HISTORY_MAX = 100  # stats endpoint cap per request

NICKNAME_API = "https://api.faceit.com/users/v1/nicknames"
HISTORY_API = "https://api.faceit.com/stats/v1/stats/time/users/{guid}/games/{game}"
MATCH_API = "https://api.faceit.com/match/v2/match/{match_id}"
DOWNLOAD_EXCHANGE_PATH = "/api/download/v2/demos/download-url"
ROOM_URL = "https://www.faceit.com/en/cs2/room/{match_id}"

BROWSER_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Origin": "https://www.faceit.com",
    "Referer": "https://www.faceit.com/",
}


class FaceitError(Exception):
    """Any failure during demo discovery / download."""


class LoginRequired(FaceitError):
    """The browser session has no FACEIT login (exchange returned 401/403)."""


class PlaywrightMissing(FaceitError):
    """The playwright package (or its browser) is not installed."""


# --------------------------------------------------------------------------- #
# Discovery (no auth)
# --------------------------------------------------------------------------- #


class ApiError(FaceitError):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body[:200]}")
        self.status = status
        self.body = body


def _get_json(url: str) -> dict | list:
    """GET url and parse JSON, retrying transient failures with backoff."""
    last: Exception | None = None
    for attempt, delay in enumerate([0, *HTTP_RETRY_DELAYS]):
        if delay:
            time.sleep(delay)
        req = urllib.request.Request(url, headers=BROWSER_HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
                return json.loads(resp.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            err = ApiError(e.code, body)
            if e.code in (400, 404):
                raise err
            last = err
            log.warning(
                "transient HTTP %s on %s (attempt %d)", e.code, url, attempt + 1
            )
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = ApiError(0, str(e))
            log.warning("network error on %s: %s (attempt %d)", url, e, attempt + 1)
    raise last if last else ApiError(0, "unknown")


def resolve_guid(nickname: str) -> str:
    data = _get_json(f"{NICKNAME_API}/{urllib.parse.quote(nickname)}")
    guid = (data.get("payload") or {}).get("id")
    if not guid:
        raise FaceitError(f"could not resolve FACEIT nickname '{nickname}'")
    return guid


def match_history(guid: str, limit: int = 20, game: str | None = None) -> list[dict]:
    """Recent matches for one player, newest first.

    Returns [{match_id, date_ts, date, elo_delta}] — the stats endpoint is
    keyed by the numeric user id and uses "cs2" as the game id.
    """
    limit = max(1, min(int(limit), HISTORY_MAX))
    url = f"{HISTORY_API.format(guid=guid, game=game or GAME)}?size={limit}"
    items = _get_json(url)
    if not isinstance(items, list):
        raise FaceitError(f"unexpected match-history response for {guid}")
    out = []
    for it in items:
        mid = it.get("matchId")
        if not mid:
            continue
        ts = it.get("date")
        out.append(
            {
                "match_id": mid,
                "date_ts": ts,
                "date": time.strftime("%Y-%m-%d %H:%M", time.localtime(ts / 1000))
                if isinstance(ts, (int, float))
                else None,
                "elo_delta": it.get("elo_delta"),
            }
        )
    out.sort(key=lambda m: m["date_ts"] or 0, reverse=True)
    return out


def _as_list(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return list(value.values())
    return []


def match_details(match_id: str) -> dict:
    """Demo URLs + roster for one match (unauthenticated)."""
    data = _get_json(MATCH_API.format(match_id=urllib.parse.quote(match_id)))
    payload = data.get("payload") or {}
    teams = []
    for t in _as_list(payload.get("teams")):
        players = []
        for p in _as_list(t.get("rosterWithSubstitutes") or t.get("roster")):
            ent = p.get("entity") if isinstance(p, dict) else None
            ent = ent if isinstance(ent, dict) else p
            if isinstance(ent, dict) and ent.get("id"):
                players.append({"guid": ent["id"], "nickname": ent.get("nickname")})
        teams.append({"name": t.get("name"), "players": players})
    return {
        "match_id": match_id,
        "demo_urls": [u for u in (payload.get("demoURLs") or []) if isinstance(u, str)],
        "teams": teams,
    }


def demo_basename(resource_url: str) -> str:
    return resource_url.rstrip("/").split("/")[-1]


def have_demo(match_id: str) -> bool:
    """True if any demo file for this match already sits in DEMOS_DIR."""
    config.ensure_dirs()
    return bool(list(config.DEMOS_DIR.glob(f"{match_id}*.dem.*")))


# --------------------------------------------------------------------------- #
# Download
# --------------------------------------------------------------------------- #


def download_to(
    resource_url: str,
    signed_url: str,
    progress: Callable[[int, int], None] | None = None,
) -> Path:
    """Stream the pre-signed demo into DEMOS_DIR (atomic via .part rename)."""
    config.ensure_dirs()
    dest = config.DEMOS_DIR / demo_basename(resource_url)
    part = dest.with_name(dest.name + ".part")
    req = urllib.request.Request(
        signed_url,
        headers={
            "User-Agent": BROWSER_HEADERS["User-Agent"],
            "Accept": "*/*",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT_S) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            if total > config.MAX_UPLOAD_BYTES:
                raise FaceitError(
                    f"demo is {total} bytes; limit is {config.MAX_UPLOAD_BYTES} bytes"
                )
            try:
                storage.require_free_space(
                    config.DEMOS_DIR,
                    config.MIN_FREE_DISK_BYTES,
                    total,
                )
            except storage.InsufficientStorageError as e:
                raise FaceitError(f"insufficient storage: {e}") from e
            done = 0
            with open(part, "wb") as f:
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    if done + len(chunk) > config.MAX_UPLOAD_BYTES:
                        raise FaceitError(
                            f"demo exceeds {config.MAX_UPLOAD_BYTES} byte limit"
                        )
                    try:
                        storage.require_free_space(
                            config.DEMOS_DIR,
                            config.MIN_FREE_DISK_BYTES,
                            len(chunk),
                        )
                    except storage.InsufficientStorageError as e:
                        raise FaceitError(f"insufficient storage: {e}") from e
                    f.write(chunk)
                    done += len(chunk)
                    if progress:
                        progress(done, total)
    except Exception:
        part.unlink(missing_ok=True)
        raise
    if part.stat().st_size == 0:
        part.unlink(missing_ok=True)
        raise FaceitError(f"empty download for {dest.name}")
    part.replace(dest)
    return dest


# --------------------------------------------------------------------------- #
# Browser session (signed-URL exchange)
# --------------------------------------------------------------------------- #

# Waits out any Cloudflare interstitial, resets + executes FACEIT's Turnstile
# widget and polls for its token (same approach as FaceitDemoInstaller's page
# bridge). Bounded: ~30s outer + ~20s token wait.
_TURNSTILE_JS = """
async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const challengeShown = () => /just a moment/i.test(document.title || "");
  for (let i = 0; i < 120; i++) {
    if (!challengeShown()) {
      const input = document.querySelector(
        'input[name="cf-turnstile-response"][id^="cf-chl-widget-"]');
      if (input && window.turnstile) {
        const id = input.id.replace("cf-chl-widget-", "");
        try { window.turnstile.reset(id); } catch (e) {}
        try { window.turnstile.execute(id); } catch (e) {}
        for (let j = 0; j < 80; j++) {
          let token = "";
          try { token = window.turnstile.getResponse(id) || ""; } catch (e) {}
          if (!token) token = input.value || "";
          if (token) return token;
          await sleep(250);
        }
      }
    }
    await sleep(250);
  }
  return null;
}
"""

_EXCHANGE_JS = """
async (args) => {
  try {
    const r = await fetch("/api/download/v2/demos/download-url", {
      method: "POST",
      credentials: "include",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "faceit-referer": "web-next",
        "x-faceit-captcha-token": args.token,
      },
      body: JSON.stringify({ resource_url: args.resource_url }),
    });
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    return { status: r.status, data };
  } catch (e) {
    return { status: 0, data: null, error: String(e) };
  }
}
"""


class BrowserSession:
    """A Chrome instance holding the FACEIT login; one page reused per sync."""

    def __init__(
        self, headless: bool | None = None, on_log: Callable[[str], None] | None = None
    ):
        self._headless = config.FACEIT_SYNC_HEADLESS if headless is None else headless
        self._on_log = on_log or (lambda msg: log.info(msg))
        self._pw = None
        self._browser = None
        self._ctx = None
        self._page = None
        self._start()

    def _start(self) -> None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as e:
            raise PlaywrightMissing(
                "playwright is not installed — run "
                "`pip install playwright && playwright install chromium`"
            ) from e
        self._pw = sync_playwright().start()
        try:
            if config.FACEIT_CDP_ENDPOINT:
                self._browser = self._pw.chromium.connect_over_cdp(
                    config.FACEIT_CDP_ENDPOINT
                )
                self._ctx = (
                    self._browser.contexts[0]
                    if self._browser.contexts
                    else self._browser.new_context()
                )
            else:
                config.ensure_dirs()
                try:
                    self._ctx = self._pw.chromium.launch_persistent_context(
                        str(config.BROWSER_PROFILE_DIR),
                        headless=self._headless,
                        viewport={"width": 1400, "height": 900},
                    )
                except Exception as e:
                    if self._headless:
                        raise
                    self._on_log(
                        f"headful browser unavailable ({str(e).splitlines()[0]}) — retrying headless"
                    )
                    self._headless = True
                    self._ctx = self._pw.chromium.launch_persistent_context(
                        str(config.BROWSER_PROFILE_DIR),
                        headless=True,
                        viewport={"width": 1400, "height": 900},
                    )
            self._page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        except PlaywrightMissing:
            raise
        except Exception as e:
            self.close()
            if "Executable doesn't exist" in str(e) or "BrowserType" in str(e):
                raise PlaywrightMissing(
                    "playwright browser not installed — run `playwright install chromium`"
                ) from e
            raise FaceitError(f"failed to start browser: {e}") from e

    @property
    def headless(self) -> bool:
        return self._headless

    def _goto_room(self, match_id: str) -> None:
        self._page.goto(
            ROOM_URL.format(match_id=match_id),
            wait_until="domcontentloaded",
            timeout=60_000,
        )

    def exchange(self, match_id: str, resource_url: str) -> str:
        """Return the pre-signed download URL for one demo resource."""
        self._goto_room(match_id)
        token = self._page.evaluate(_TURNSTILE_JS)
        if not token:
            state = self._page.evaluate(
                """() => ({title: document.title,
                           text: (document.body.innerText || '').slice(0, 300)})"""
            )
            blob = f"{state.get('title', '')} {state.get('text', '')}".lower()
            if "match not found" in blob or "does not exist" in blob:
                raise LoginRequired(
                    "FACEIT shows 'Match Not Found' — match rooms need a "
                    "session, so the automation browser is most likely not "
                    "logged in. Run the login once, then retry the sync."
                )
            raise FaceitError(
                "no Cloudflare Turnstile token on the match page — the page "
                "did not load fully; retry, or log in first"
            )
        res = self._page.evaluate(
            _EXCHANGE_JS, {"token": token, "resource_url": resource_url}
        )
        status = res.get("status")
        data = res.get("data") or {}
        url = ((data.get("payload") or {}) if isinstance(data, dict) else {}).get(
            "download_url"
        )
        if url:
            return url
        if status in (401, 403):
            raise LoginRequired(
                "FACEIT rejected the demo exchange (HTTP "
                f"{status}) — log in via the browser session first"
            )
        detail = (
            json.dumps(data)[:200] if data else (res.get("error") or "empty response")
        )
        raise FaceitError(f"download-url exchange failed (HTTP {status}): {detail}")

    def login(self, timeout_s: int = 300) -> bool:
        """Open the FACEIT login page and wait for the user to sign in.

        Returns True when the tab navigated away from /login; the next
        exchange is the real test of the session.
        """
        self._page.goto(
            "https://www.faceit.com/login",
            wait_until="domcontentloaded",
            timeout=60_000,
        )
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if "/login" not in (self._page.url or ""):
                return True
            time.sleep(1.0)
        return False

    def close(self) -> None:
        for obj in (self._ctx, self._browser):
            try:
                if obj:
                    obj.close()
            except Exception:
                pass
        try:
            if self._pw:
                self._pw.stop()
        except Exception:
            pass
        self._page = self._ctx = self._browser = self._pw = None

    def __enter__(self) -> BrowserSession:
        return self

    def __exit__(self, *exc) -> None:
        self.close()


# --------------------------------------------------------------------------- #
# Sync orchestration
# --------------------------------------------------------------------------- #


def list_recent_matches(accounts: list[dict], limit: int = 10) -> list[dict]:
    """Merged, deduped recent matches across accounts, newest first.

    `accounts` entries: {label, faceit, guid}; a missing GUID is resolved
    from the nickname (counts against the API rate budget).
    """
    seen: set[str] = set()
    out: list[dict] = []
    for acc in accounts:
        guid = acc.get("guid")
        try:
            if not guid:
                guid = resolve_guid(acc["faceit"])
                time.sleep(API_DELAY_S)
            matches = match_history(guid, limit=limit)
        except FaceitError as e:
            out.append(
                {"account": acc.get("label") or acc.get("faceit"), "error": str(e)}
            )
            continue
        time.sleep(API_DELAY_S)
        for m in matches:
            if m["match_id"] in seen:
                continue
            seen.add(m["match_id"])
            m = dict(m, account=acc.get("label") or acc.get("faceit"))
            m["local"] = have_demo(m["match_id"])
            out.append(m)
    return out


def sync_new_demos(
    accounts: list[dict],
    limit: int = 10,
    log_fn: Callable[[str], None] = print,
    ingest: bool = True,
    headless: bool | None = None,
) -> dict:
    """Download demos not yet on disk for the accounts' recent matches.

    Downloads all of them first (one browser session), then ingests each into
    the voice pipeline and collects voice matches above the threshold.
    """
    config.ensure_dirs()
    log_fn(f"fetching recent matches (limit {limit}/account)…")
    recent = list_recent_matches(accounts, limit=limit)
    errors = [r for r in recent if r.get("error")]
    for r in errors:
        log_fn(f"⚠ {r['account']}: {r['error']}")
    todo = [m for m in recent if not m.get("error") and not m.get("local")]
    log_fn(f"{len(recent)} matches found, {len(todo)} without a local demo")

    downloaded: list[Path] = []
    rows: list[dict] = [
        {**m, "status": "skipped_existing"}
        for m in recent
        if not m.get("error") and m.get("local")
    ]
    token_failures = 0

    if todo:
        with BrowserSession(headless=headless, on_log=log_fn) as browser:
            log_fn(
                f"browser ready ({'headless' if browser.headless else 'headful'}"
                f"{' · CDP' if config.FACEIT_CDP_ENDPOINT else ''})"
            )
            for m in todo:
                mid = m["match_id"]
                label = m.get("account") or "—"
                try:
                    details = match_details(mid)
                    time.sleep(API_DELAY_S)
                    urls = details["demo_urls"]
                    if not urls:
                        log_fn(f"· {label} {mid}: no demo available (yet)")
                        rows.append({**m, "status": "no_demo"})
                        continue
                    files = []
                    for u in urls:
                        signed = browser.exchange(mid, u)
                        path = download_to(u, signed)
                        files.append(path.name)
                        log_fn(
                            f"↓ {label} {path.name} ({path.stat().st_size // 1048576} MB)"
                        )
                    downloaded.extend(config.DEMOS_DIR / f for f in files)
                    rows.append({**m, "status": "downloaded", "demos": files})
                    token_failures = 0
                except LoginRequired as e:
                    log_fn(f"✗ not logged in: {e}")
                    rows.append({**m, "status": "failed", "error": str(e)})
                    break
                except FaceitError as e:
                    log_fn(f"✗ {label} {mid}: {e}")
                    rows.append({**m, "status": "failed", "error": str(e)})
                    if "Turnstile token" in str(e):
                        # The browser can't mint tokens right now (usually no
                        # login in the automation profile, or headless mode) —
                        # the rest of the queue would fail identically.
                        token_failures += 1
                        if token_failures >= 2:
                            log_fn(
                                "stopping: the browser cannot obtain Cloudflare "
                                "Turnstile tokens. Run 'Log in…' (a browser window "
                                "opens) and retry the sync."
                            )
                            break
                time.sleep(1.0)

    if ingest and downloaded:
        try:
            from core import linking
            from core.pipeline import ingest_demo
        except Exception as e:  # noqa: BLE001
            log_fn(
                f"⚠ voice module unavailable ({e}) — demos downloaded but not ingested"
            )
            return _summary(rows, downloaded)
        threshold = config.DEFAULT_THRESHOLD
        for path in downloaded:
            log_fn(f"ingesting {path.name}…")
            try:
                demo_id, _result, stats = ingest_demo(path, source="faceit")
            except Exception as e:  # noqa: BLE001
                log_fn(f"✗ ingest failed for {path.name}: {e}")
                _mark(rows, path.name, {"status": "failed", "error": f"ingest: {e}"})
                continue
            log_fn(f"✓ ingested as demo #{demo_id} ({len(stats)} players)")
            voice = _voice_matches(demo_id, stats, linking, threshold)
            _mark(
                rows,
                path.name,
                {"status": "ingested", "demo_id": demo_id, "voice_matches": voice},
            )
            for v in voice:
                for hit in v["matches"]:
                    left = v["nickname"] or v["steamid"]
                    right = hit["nickname"] or hit["steamid"]
                    if hit["verdict"] == "same":
                        log_fn(
                            f"🔊 verified voice match: {left} ≈ {right} "
                            f"({hit['score']:.3f})"
                        )
                    else:
                        log_fn(
                            f"❔ voice candidate: {left} ↔ {right} — "
                            f"{hit['verdict'].upper()} ({hit['score']:.3f})"
                        )
    return _summary(rows, downloaded)


def _voice_matches(
    demo_id: int, stats: list[dict], linking, threshold: float
) -> list[dict]:
    """Shortlist by nearest neighbor, then classify with the strict verifier."""
    out = []
    for s in stats:
        if s.get("status") != "embedded":
            continue
        hits = linking.find_matches_for_player(s["steamid"], k=5, threshold=threshold)
        candidates = [h for h in hits if h.score >= threshold][:3]
        verified = []
        for hit in candidates:
            evidence = linking.is_same_person(
                s["steamid"], hit.steamid, threshold=threshold
            )
            verdict = evidence.verdict if evidence else "inconclusive"
            verified.append(
                {
                    "steamid": hit.steamid,
                    "nickname": hit.nickname,
                    # Alerts show the verifier's equally weighted demo-pair score.
                    # The raw nearest-neighbor score is retained only to explain
                    # why this account was shortlisted as a candidate.
                    "score": round(evidence.score if evidence else hit.score, 3),
                    "candidate_score": round(hit.score, 3),
                    "verdict": verdict,
                    "evidence_quality": evidence.evidence_quality
                    if evidence
                    else "low",
                    "reasons": evidence.reasons
                    if evidence
                    else ["missing comparison evidence"],
                }
            )
        if verified:
            out.append(
                {
                    "steamid": s["steamid"],
                    "nickname": s.get("nickname"),
                    "demo_id": demo_id,
                    "matches": verified,
                }
            )
    return out


def _mark(rows: list[dict], filename: str, patch: dict) -> None:
    for r in rows:
        if filename in (r.get("demos") or []):
            r.update(patch)


def _summary(rows: list[dict], downloaded: list[Path]) -> dict:
    return {
        "matches": rows,
        "downloaded": len(downloaded),
        "failed": sum(1 for r in rows if r.get("status") == "failed"),
    }
