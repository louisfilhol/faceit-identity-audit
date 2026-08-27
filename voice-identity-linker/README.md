# CS2 Voice Identity Linker

> **Biometric-data warning:** Voice embeddings can identify people. Use only
> with consent or another valid legal basis, follow FACEIT's Terms of Service,
> keep demos/voiceprints private, and treat every score as fallible supporting
> evidence—not proof or grounds for public accusation.

This optional component extracts per-player voice audio from Counter-Strike 2
demos, creates speaker embeddings, and compares score distributions across
independent demos. It powers the repository's web Voice workspace and also
provides a Typer CLI.

```text
.dem → csgove → per-player WAV → Silero VAD → SpeechBrain ECAPA embedding
                                                         ↓
                              local SQLite ← similarity/evidence aggregation
```

## Evidence policy

The verifier returns `same`, `different`, or `inconclusive`. A definitive
result requires multiple distinct demos for both players, compatible
preprocessing, a score outside the uncertainty band, and sufficient demo-pair
agreement. Long recordings do not receive extra voting weight simply because
they produce more windows.

There is no bundled validation dataset and no universal threshold claim. The
files in `eval/pairs/` are empty templates by design: real voices, player names,
and local paths must never be committed. `DEFAULT_THRESHOLD=0.5` is only a
starting point; tune it on consented, speaker-disjoint development data and
report final performance on held-out speakers.

## Requirements and installation

- Linux x86_64.
- Python 3.10–3.12.
- `curl`, `unzip`, and `ffmpeg`/`ffprobe` on `PATH`.
- About 2–3 GB free for the CPU environment, Chromium, extractor, and model;
  keep at least 5 GiB free for demo extraction.
- 4 GiB RAM minimum; 8 GiB recommended for long recordings.

From the repository root:

```bash
./setup.sh                    # pinned CPU dependencies + csgove + Chromium
# or omit optional browser automation:
./setup.sh --skip-browser
```

Setup uses the root `.venv`, verifies the `csgove` v3.1.6 archive checksum, and
creates this directory's ignored `.env` from `.env.example`. The SpeechBrain
model (~85 MB, plus cache metadata) downloads on the first voice operation.
Pre-cache it with `PREDOWNLOAD_MODEL=1 ./setup.sh`.

Set `HF_HUB_OFFLINE=1` only after the model is cached. With offline mode enabled
too early, model loading fails. A first setup usually takes 5–20 minutes,
depending on bandwidth and the local Python wheel cache.

## CLI

Run commands from this directory with the root interpreter:

```bash
../.venv/bin/python cli.py --help

# Ingest one demo, or every supported demo in a directory
../.venv/bin/python cli.py ingest path/to/match.dem.zst
../.venv/bin/python cli.py ingest path/to/demos/

# Limit embedding work to known player IDs
../.venv/bin/python cli.py ingest path/to/match.dem --only <steamid_a>,<steamid_b>

# Compare repeated evidence already in the local DB
../.venv/bin/python cli.py verify <steamid_a> <steamid_b>

# Target one player in a new demo against an embedded reference
../.venv/bin/python cli.py scan path/to/match.dem <steamid> --ref <reference_steamid>

# Search, cluster, and inspect local embeddings
../.venv/bin/python cli.py match <steamid> --k 10
../.venv/bin/python cli.py cluster <demo_id>
../.venv/bin/python cli.py players

# Record consent before cross-account search
../.venv/bin/python cli.py consent <steamid> --grant
```

The privacy-preserving default is `INVESTIGATIVE_MODE=0`, so non-consented
players are excluded from cross-account search results. Explicit pair
verification remains available for controlled review. Set investigative mode
only after documenting a lawful basis and safeguards.

## Web UI and demo auto-sync

Start the root web app with `./run.sh` and use the Voice Identity Linker tab.
Uploads are streamed, content-addressed, deduplicated, and processed in a
background job. The default 1 GiB upload limit and 5 GiB free-space floor can be
adjusted in `.env.example`. Successful compressed ingests remove the generated
raw demo and reproducible WAVs; failed jobs clean partial artifacts.

Optional auto-sync uses Playwright and unofficial FACEIT endpoints. Downloading
a signed demo URL requires a local logged-in browser session:

1. In the Voice tab, choose **Log in** and complete FACEIT login in Chromium.
2. Choose **Sync recent matches**.

The private Chromium profile lives under ignored `data/faceit-browser/`. On a
headless server, set `FACEIT_SYNC_HEADLESS=1` or attach an existing logged-in
Chrome with `FACEIT_CDP_ENDPOINT=http://127.0.0.1:9222`. Cloudflare may block
automation, and these endpoints can change without notice.

## Local data and retention

Everything below `data/` is private runtime state and ignored:

```text
data/
├── demos/            retained input demos
├── wav/              transient extracted audio
├── models/           local model files
├── faceit-browser/   cookies and browser session
└── voiceprints.db    embeddings, player metadata, and consent log
```

Do not copy this directory into an issue, test fixture, release archive, or Git
commit. Delete data when the purpose and retention period end. Voice embeddings
are not anonymous merely because the source WAV was removed.

## Threshold evaluation

Use review-first manifests rather than assuming account IDs equal real-world
identity:

```bash
../.venv/bin/python cli.py generate-pairs --output eval/pairs/local.csv
# Review labels/subject IDs/splits outside Git, then:
../.venv/bin/python cli.py tune --manifest eval/pairs/local.csv --split development
../.venv/bin/python cli.py tune --manifest eval/pairs/local.csv \
  --split test --operating-threshold <locked_threshold>
```

Read [eval/DATASET.md](eval/DATASET.md) before collecting data. Keep speakers
disjoint between tuning and test sets; correlated clips can make apparent error
rates look unrealistically good. `vad-impact` can compare raw and Silero-VAD
scores on an authorized local pair set.

## Architecture

| Path | Purpose |
|---|---|
| `cli.py` | Typer entry point |
| `config.py` | Environment parsing, paths, thresholds, retention, privacy defaults |
| `core/extractor.py` | Verified `csgove` wrapper and filename parsing |
| `core/audio.py` | Decode, mono/16 kHz conversion, and optional VAD |
| `core/embedder.py` | Lazy CPU ECAPA loading and bounded windows |
| `core/store.py` | SQLite schema, migrations, consent log, and vector index |
| `core/linking.py` | Evidence aggregation, matching, clustering, and consent gate |
| `core/pipeline.py` | Extraction/embedding/storage orchestration and cleanup |
| `core/faceit_sync.py` | Optional browser-assisted recent-demo sync |
| `eval/` | Reviewable manifests and local threshold analysis |

## Troubleshooting

- **Model unavailable/offline error:** run once with `HF_HUB_OFFLINE=0` or use
  `PREDOWNLOAD_MODEL=1 ./setup.sh` at the repository root.
- **No matches:** grant consent for relevant players, or review the documented
  `INVESTIGATIVE_MODE` override. Also confirm embeddings exist with `players`.
- **`csgove` fails:** confirm Linux x86_64, re-run root setup, and check that the
  downloaded binary and neighboring shared libraries exist in `bin/`.
- **Audio decode fails:** install `ffmpeg` and ensure the demo actually contains
  voice data; Valve matchmaking demos may omit it.
- **Browser login/sync fails:** install Chromium with
  `../.venv/bin/playwright install chromium`, prefer headful mode, or attach an
  existing Chrome debugging endpoint.
- **Verdict stays inconclusive:** this is expected for thin or conflicting
  evidence. Add independent demos; do not weaken safeguards to force a result.

Project code is AGPL-3.0-only. The separately downloaded `csgove` executable is
MIT-licensed and is not committed to this repository.
