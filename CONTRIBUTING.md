# Contributing

Thank you for helping improve FACEIT Multi-Account Detection. By participating,
you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening a change

- Use only synthetic or consented test data. Never attach demos, voiceprints,
  browser profiles, webhooks, account exports, or other personal data.
- Report security and privacy issues through [SECURITY.md](SECURITY.md), not a
  public issue.
- Keep changes focused and preserve the consent, retention, upload-size, and
  free-disk safeguards.

## Development workflow

```bash
./setup.sh --dev --skip-browser
./.venv/bin/ruff check .
./.venv/bin/ruff format --check .
./.venv/bin/pytest
```

Create a branch, add or update tests, and open a pull request using the
repository template. Explain privacy implications and any network behavior.
Small, reviewable pull requests are preferred.

Contributions are licensed under the repository's AGPL-3.0-only license.
