#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> This project uses the single root virtualenv: $ROOT_DIR/.venv"
echo "==> Forwarding to the unified setup..."
exec "$ROOT_DIR/setup.sh" "$@"
