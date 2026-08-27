#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d ".venv" ]; then
  echo "No .venv found. Run ./setup.sh first." >&2
  exit 1
fi
export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-0}"
exec .venv/bin/python -m uvicorn web.main:app --port "${PORT:-8000}" "$@"
