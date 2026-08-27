# FACEIT Friends Monitor

> Use only for lawful, authorized monitoring. Friendship data can identify or
> profile people; minimize retention and do not publish automated accusations.

Polls the public friends list of one or more FACEIT accounts and alerts on
Discord (+ log file) whenever a friend is **added or removed**.

No login, no API key, no browser automation. FACEIT's friends endpoint is
public per profile — we just hit it and diff against the last snapshot.

## How it works

- **Endpoint:** `GET https://www.faceit.com/api/friends/v1/users/{USER_ID}/friends?limit=100`
  - Cursor-paginated (`?cursor=<next_cursor>` while `has_more` is true).
  - `limit` max is 100.
  - No auth. Cloudflare blocks the default Python User-Agent, so the script
    sends browser-like headers.
- **Nickname → GUID:** `GET https://www.faceit.com/api/users/v1/nicknames/{nickname}`
  (no auth, case-sensitive) resolves whatever identifier you put in config —
  no DevTools needed.
- **Run model:** the standalone script is one-shot. The unified web app embeds
  its own scheduler (five minutes by default); the CLI can still be invoked by
  cron or Task Scheduler when used on its own.
- **Storage:** SQLite (`faceit.db`) holds explicit per-account seed state, the
  last friend snapshot (with stable `first_seen` timestamps), and an `event`
  log of every real add/remove detected after seeding.
  Existing databases are migrated automatically: seed additions are removed
  from event history and recoverable original `first_seen` values are restored.
- **Alerts:** Discord webhook + `events.log`.

## Files

| File | Purpose |
|---|---|
| `faceit_friends.py` | The script |
| `config.example.json` | Template config (committed) |
| `config.json` | Your accounts, webhook, settings (auto-fallback; gitignored) |
| `faceit.db` | SQLite snapshots + event history (auto-created) |
| `events.log` | Append-only human-readable log (auto-created) |

## Quick start

```bash
# 1. Copy the template and set your accounts + webhook + discord_ping:
cp config.example.json config.json
# 2. Run it once to seed (no alerts on first run):
python faceit_friends.py
```

The script auto-falls back to `config.example.json` if `config.json` is missing, so
it works out of the box even before you configure anything (logs only, no alerts).

No dependencies — pure Python standard library. Python 3.10+ (uses `X | Y` type hints).

## Usage

```bash
python faceit_friends.py             # check all accounts (one-shot)
python faceit_friends.py --force-alerts   # also alert on the seed run
python faceit_friends.py --reseed    # wipe all snapshots, re-seed (no alerts)
```

## config.json

```json
{
  "discord_webhook": "https://discord.com/api/webhooks/.../...",
  "discord_ping": "<@123456789>",
  "accounts": [
    { "faceit": "ExamplePlayer", "label": "primary_account" },
    { "guid": "00000000-0000-4000-8000-000000000000", "label": "secondary_account" }
  ]
}
```

- **Identifying an account** — put the **exact FACEIT nickname** (case-sensitive),
  a **profile URL** (`https://www.faceit.com/en/players/<nickname>`), or a
  **GUID** in the `faceit` or `guid` field. The script resolves it to the GUID
  automatically (via
  `GET https://www.faceit.com/api/users/v1/nicknames/<nickname>`, no auth) and
  writes the resolved GUID back to `config.json`. Skip that write-back with
  `--no-save`. The free-form `label` is display-only and never used for
  resolution (a label like "broken" could match a real player's nickname).
  - Nickname lookup is **case-sensitive**: `ExamplePlayer` and `exampleplayer`
    may resolve differently.
    does not. Copy the name exactly as it appears on the profile.
  - Unknown nickname → `404 err_nf0`; the account is skipped with a ⚠️ alert
    while the rest keep running.
- **`label`** — friendly name shown in alerts/logs.
- **`discord_ping`** — a Discord mention. **Discord pings by numeric user ID,
  not username**, so `<@your_username>` won't actually ping. To get your real ID:
  Discord Settings → Advanced → enable **Developer Mode**, then right-click
  your own name → **Copy User ID**. Use `<@your_id_here>`. Leave empty for no ping.

## Schedule it (recommended: every 5 minutes)

### Windows — Task Scheduler

1. Open **Task Scheduler** → **Create Task**.
2. **General:** name it `FACEIT Friends Monitor`, check **Run whether user is
   logged on or not**.
3. **Triggers → New:** Begin **On a schedule**, **Daily**, repeat every
   `5 minutes` for **Indefinitely**.
4. **Actions → New:**
   - Program: `python` (or full path, e.g. `C:\Python312\python.exe`)
   - Arguments: `faceit_friends.py`
   - Start in: `C:\path\to\repo\friends-monitor`
5. **Conditions:** uncheck "Start only if on AC power".
6. **Settings:** check "Run as soon as possible after a missed start" (so a
   missed tick still fires).

### Linux/macOS — cron

```cron
*/5 * * * * cd /path/to/dir && /usr/bin/python3 faceit_friends.py >> events.log 2>&1
```

## Querying history

```bash
# All add/remove events for an account
sqlite3 faceit.db "SELECT ts, kind, nickname FROM event WHERE account_lbl='primary_account' ORDER BY ts DESC LIMIT 20"

# Everyone currently friends with an account
sqlite3 faceit.db "SELECT nickname FROM snapshot WHERE account_id='4fc8e5bb-968c-4264-b00b-c1476e36ae29' ORDER BY nickname"
```

## Troubleshooting

- **`HTTP 403 ... Error 1010`**: Cloudflare bot block. The script already sends
  a browser User-Agent to avoid this; if it returns, the UA string in
  `faceit_friends.py` (`BROWSER_HEADERS`) may need updating to a newer Chrome.
- **`HTTP 404 err_nf0`**: an account identifier is wrong (unknown nickname or
  deleted account) — nicknames are case-sensitive, so check exact spelling.
  The script skips that account with a ⚠️ alert and keeps monitoring the rest.
- **No Discord ping but message arrives**: your `discord_ping` is a username,
  not a `<@numeric_id>`. See config section above.
- **First run sends no alerts or add events**: by design — the first successful
  run seeds the snapshot baseline. Use `--force-alerts` to send a seed summary,
  or just wait for real changes. A failed fetch does not seed the account.
