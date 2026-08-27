#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

cd "$(dirname "$0")/.."

forbidden_paths='(^|/)(\.env($|\.)|config\.json$|.*\.db([.-].*)?$|.*\.log$|.*\.dem(\..*)?$|backups/|data/|bin/|\.zcode/|\.venv/)'
allowed_examples='(^|/)(\.env\.example|config\.example\.json)$'

path_failure=0
while IFS= read -r path; do
  if [[ "$path" =~ $forbidden_paths ]] && [[ ! "$path" =~ $allowed_examples ]]; then
    echo "ERROR: private/generated path is tracked: $path" >&2
    path_failure=1
  fi
done < <(git ls-files)

secret_files="$(
  git grep --cached -I -l -E \
    '(/home/[A-Za-z0-9._-]+/|/Users/[A-Za-z0-9._-]+/|(hf|faceit)_[A-Za-z0-9]{16,}|discord(app)?\.com/api/webhooks/[0-9]{6,}/[A-Za-z0-9_-]{20,})' \
    -- . ':!scripts/check-public-tree.sh' || true
)"
if [ -n "$secret_files" ]; then
  echo "ERROR: possible personal path or credential in tracked files:" >&2
  printf '  %s\n' "$secret_files" >&2
  path_failure=1
fi

exit "$path_failure"
