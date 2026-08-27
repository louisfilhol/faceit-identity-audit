# FACEIT Multi-Account Detection

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)
[![Python 3.11–3.12](https://img.shields.io/badge/python-3.11%E2%80%933.12-3776AB.svg)](pyproject.toml)

> **Responsible-use notice:** This project is for education and authorized,
> lawful investigations. Comply with FACEIT's Terms of Service and applicable
> privacy/biometric laws, obtain consent or another valid legal basis, minimize
> retained data, and never use results to harass, dox, or publicly accuse a
> player. Voice similarity and friendship overlap are supporting signals—not
> proof of identity. The software is provided without warranty.

Privacy-conscious tools for monitoring public FACEIT friendship changes and,
optionally, comparing speaker evidence from CS2 demos. A FastAPI dashboard ties
the two standalone CLIs together.

**Suggested GitHub About text:** Privacy-conscious FACEIT friends-list monitoring
and optional voice-evidence analysis for authorized multi-account investigations.

## Features

| Component | What it does | Data and network behavior |
|---|---|---|
| Web UI | Dashboard, configuration, scheduled checks, history, demo ingestion, and voice comparison | Binds to `127.0.0.1` by default; stores data locally |
| Friends monitor | Diffs public friends lists and optionally posts Discord alerts | Calls public FACEIT endpoints; stores SQLite snapshots and a local log |
| Voice identity linker | Extracts per-player audio, creates speaker embeddings, and returns `same`, `different`, or `inconclusive` evidence | Downloads a model on first use; voiceprints and demos stay in ignored local storage |
| FACEIT demo sync | Uses a logged-in local browser session to retrieve recent demos | Optional Playwright Chromium profile; unofficial endpoints may change |

### UI at a glance

The single-page UI has an overview with KPI cards and recent events, a Friends
Monitor workspace for accounts/webhooks/scheduling, and a Voice Identity Linker
workspace for uploads, background progress, player lists, comparisons, and demo
sync. Status and errors are shown inline; voice dependencies load lazily so the
friends tools remain usable independently.

## Quickstart

Linux x86_64 and Python 3.11 or 3.12 are required for the complete voice
workflow. Install `curl`, `unzip`, and `ffmpeg` first.

```bash
git clone <repository-url>
cd faceit-multi-account-detection
./setup.sh
./run.sh
```

Open <http://127.0.0.1:8000>. Setup creates ignored local copies of
`friends-monitor/config.json` and `voice-identity-linker/.env`; edit them in the
UI or with a text editor. The friends scheduler starts disabled.

The default setup installs the fully resolved `requirements.lock`, then downloads
`csgove` and Playwright Chromium. Expect roughly **5–20 minutes**, **2–3 GB of
disk**, and another
~85 MB model download on the first voice operation. Demo files and transient WAVs
need additional space; the app reserves 5 GiB free by default. Use
`./setup.sh --skip-browser` if demo auto-sync is not needed.

## Configuration

Friends-monitor settings live in ignored `friends-monitor/config.json`; start
from [config.example.json](friends-monitor/config.example.json). It accepts a
Discord webhook, optional numeric Discord mention, scheduler settings, and an
array of exact FACEIT nicknames/profile URLs/GUIDs. See the
[friends-monitor guide](friends-monitor/README.md).

Voice settings live in ignored `voice-identity-linker/.env`; the complete
template is [.env.example](voice-identity-linker/.env.example).

| Variable | Default | Purpose |
|---|---:|---|
| `DATA_DIR` | `voice-identity-linker/data` | Private demos, browser profile, models, WAVs, and SQLite DB |
| `MAX_UPLOAD_BYTES` | 1 GiB | Maximum streamed upload size |
| `MIN_FREE_DISK_BYTES` | 5 GiB | Free-space floor maintained during upload/extraction |
| `DELETE_WAV_AFTER_EMBEDDING` | `1` | Remove reproducible WAVs after embedding |
| `RETAIN_COMPRESSED_DEMO_ONLY` | `1` | Remove decompressed copies of compressed demos |
| `MODEL_NAME` | SpeechBrain ECAPA | Hugging Face speaker model identifier |
| `DEFAULT_THRESHOLD` | `0.5` | Local starting threshold; tune on consented held-out data |
| `VAD_ENABLED` | `1` | Strip non-speech with Silero VAD |
| `INVESTIGATIVE_MODE` | `0` | When `1`, include non-consented players in cross-account search |
| `FACEIT_SYNC_HEADLESS` | `0` | Run optional login/sync browser headlessly |
| `FACEIT_CDP_ENDPOINT` | unset | Attach to an existing Chrome debugging endpoint |
| `HF_HUB_OFFLINE` | `0` in `run.sh` | Set to `1` only after the model is cached |
| `PORT` | `8000` | Web server port |

To cache the model during setup, run `PREDOWNLOAD_MODEL=1 ./setup.sh`. After a
successful download, `HF_HUB_OFFLINE=1 ./run.sh` prevents Hugging Face network
checks. Offline mode before the first download makes voice operations fail.

## Command-line tools

The friends monitor uses only Python's standard library:

```bash
cd friends-monitor
python3 faceit_friends.py --help
```

The voice CLI uses the root environment:

```bash
cd voice-identity-linker
../.venv/bin/python cli.py --help
```

Detailed commands and privacy controls are in the
[voice identity linker guide](voice-identity-linker/README.md).

## Project structure

```text
.
├── web/                     FastAPI app, routers, static UI, and tests
├── friends-monitor/         Standard-library CLI and tests
├── voice-identity-linker/   Voice CLI, pipeline, evaluation tools, and tests
├── scripts/                 Release-safety checks
├── setup.sh                 Pinned unified installer
├── run.sh                   Local web launcher
├── pyproject.toml           Python, pytest, formatter, and lint configuration
└── requirements.lock        Fully resolved Linux x86_64 runtime environment
```

All runtime databases, logs, demos, browser profiles, downloaded binaries,
models, caches, and local configuration are ignored by Git.

## Development and tests

```bash
./setup.sh --dev --skip-browser
.venv/bin/pytest
.venv/bin/ruff check .
.venv/bin/ruff format --check .
```

`pytest` at the repository root discovers all three test suites. Tests marked
`slow` are excluded by default and from CI so no secret, browser login, external
service, demo, or model download is required. Optional hooks are installed with
`.venv/bin/pre-commit install`.

## FAQ and troubleshooting

**The UI starts but voice operations say the model is unavailable.**  Run once
with `HF_HUB_OFFLINE=0`, or pre-download with
`PREDOWNLOAD_MODEL=1 ./setup.sh`. Then offline mode is safe.

**Playwright login does not open or Cloudflare rejects it.**  Re-run
`.venv/bin/playwright install chromium`, use headful mode, or attach a logged-in
Chrome through `FACEIT_CDP_ENDPOINT`. Browser automation and unofficial FACEIT
endpoints can break without notice.

**`csgove` or audio extraction fails.**  The complete voice workflow supports
Linux x86_64. Confirm `voice-identity-linker/bin/csgove` is executable and
`ffmpeg -version` succeeds, then re-run `./setup.sh`.

**Friends checks return 403/404.**  Nicknames are case-sensitive. A 404 usually
means the account identifier is invalid; a 403 can indicate a changed FACEIT or
Cloudflare policy. See the [friends troubleshooting section](friends-monitor/README.md#troubleshooting).

**Can results prove multi-accounting?**  No. Friendship overlap and speaker
similarity can be wrong or misleading. Require repeated independent evidence,
respect consent, and never publish an automated accusation.

## License and third-party software

Project code is licensed under [AGPL-3.0-only](LICENSE). The installer downloads
the separate [`csgove` voice extractor](https://github.com/akiver/csgo-voice-extractor),
which is MIT-licensed; it is not stored in this repository. See
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the
[Code of Conduct](CODE_OF_CONDUCT.md) before participating.

FACEIT and Counter-Strike are trademarks of their respective owners. This
project is unaffiliated with and not endorsed by FACEIT or Valve.
