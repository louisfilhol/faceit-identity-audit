#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d ".venv" ]; then
  echo "No .venv found. Run ./setup.sh first." >&2
  exit 1
fi
if [ ! -f "frontend/dist/index.html" ]; then
  echo "WARNING: frontend/dist not found — the dashboard will show a" >&2
  echo "         'Frontend build not found' page. Build it with:" >&2
  echo "           cd frontend && npm ci && npm run build" >&2
  echo "         (or re-run ./setup.sh). The API under /api/* still works." >&2
fi
export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-0}"
exec .venv/bin/python -m uvicorn web.main:app --port "${PORT:-8000}" "$@"
