#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_DIR="$(pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
PYTHON_BIN="${PYTHON:-python3}"
VOICE_DIR="$PROJECT_DIR/voice-identity-linker"
CSGOVE_VERSION="${CSGOVE_VERSION:-v3.1.6}"
CSGOVE_SHA256="${CSGOVE_SHA256:-cc66839c54154d8f0cd361b2510603c22dc18e9ab037a634e6e1bdc15c606a6e}"
INSTALL_DEV=0
INSTALL_BROWSER=1

usage() {
  echo "Usage: ./setup.sh [--dev] [--skip-browser]"
  echo "  --dev           install pytest, ruff, and pre-commit"
  echo "  --skip-browser  skip the optional Playwright Chromium download"
}

while (($#)); do
  case "$1" in
    --dev) INSTALL_DEV=1 ;;
    --skip-browser) INSTALL_BROWSER=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

echo "==> FACEIT Multi-Account Detection setup"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "ERROR: $PYTHON_BIN not found. Install Python 3.10, 3.11, or 3.12." >&2
  exit 1
fi

"$PYTHON_BIN" -c 'import sys; raise SystemExit(not ((3, 10) <= sys.version_info[:2] < (3, 13)))' \
  || { echo "ERROR: Python 3.10-3.12 is required." >&2; exit 1; }

if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
  echo "ERROR: voice extraction currently supports Linux x86_64 only." >&2
  exit 1
fi

for required_command in curl unzip sha256sum; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "ERROR: missing required command: $required_command" >&2
    exit 1
  fi
done

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "WARNING: ffmpeg is not installed; some audio formats cannot be decoded." >&2
fi

echo "==> Python $($PYTHON_BIN --version | awk '{print $2}')"
if [ ! -d "$VENV_DIR" ]; then
  echo "==> Creating .venv"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip
if [ "$INSTALL_DEV" -eq 1 ]; then
  echo "==> Installing pinned runtime and development dependencies"
  "$VENV_DIR/bin/python" -m pip install -r requirements-dev.txt
else
  echo "==> Installing pinned runtime dependencies (CPU-only voice stack)"
  "$VENV_DIR/bin/python" -m pip install -r requirements.txt
fi
"$VENV_DIR/bin/python" -m pip check

if [ "$INSTALL_BROWSER" -eq 1 ]; then
  echo "==> Installing Playwright Chromium (~200 MB)"
  "$VENV_DIR/bin/playwright" install chromium \
    || echo "WARNING: Chromium failed to install; run .venv/bin/playwright install chromium later." >&2
else
  echo "==> Skipping Playwright Chromium"
fi

if [ ! -x "$VOICE_DIR/bin/csgove" ]; then
  echo "==> Downloading csgove $CSGOVE_VERSION"
  DOWNLOAD_DIR="$(mktemp -d)"
  trap 'rm -rf -- "$DOWNLOAD_DIR"' EXIT
  curl --fail --location --show-error \
    --output "$DOWNLOAD_DIR/csgove.zip" \
    "https://github.com/akiver/csgo-voice-extractor/releases/download/${CSGOVE_VERSION}/linux-x64.zip"
  printf '%s  %s\n' "$CSGOVE_SHA256" "$DOWNLOAD_DIR/csgove.zip" | sha256sum --check --status \
    || { echo "ERROR: csgove checksum verification failed." >&2; exit 1; }
  unzip -q "$DOWNLOAD_DIR/csgove.zip" -d "$DOWNLOAD_DIR/extract"
  mkdir -p "$VOICE_DIR/bin"
  cp "$DOWNLOAD_DIR"/extract/linux-x64/* "$VOICE_DIR/bin/"
  chmod +x "$VOICE_DIR/bin/csgove"
fi

if [ ! -f "$VOICE_DIR/.env" ]; then
  cp "$VOICE_DIR/.env.example" "$VOICE_DIR/.env"
  echo "==> Created voice-identity-linker/.env"
fi
if [ ! -f "$PROJECT_DIR/friends-monitor/config.json" ]; then
  cp "$PROJECT_DIR/friends-monitor/config.example.json" \
    "$PROJECT_DIR/friends-monitor/config.json"
  echo "==> Created friends-monitor/config.json (scheduler disabled until edited)"
fi

if [ "${PREDOWNLOAD_MODEL:-0}" = "1" ]; then
  echo "==> Pre-downloading the SpeechBrain speaker model"
  "$VENV_DIR/bin/python" -c \
    'from speechbrain.inference.speaker import SpeakerRecognition; SpeakerRecognition.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb")'
fi

echo
echo "Setup complete. Edit local configuration, then run: ./run.sh"
