# SPDX-License-Identifier: AGPL-3.0-only
"""Small, dependency-free helpers for bounded runtime storage."""

from __future__ import annotations

import os
import shutil
from pathlib import Path


class InsufficientStorageError(RuntimeError):
    """Raised when an operation would cross the configured free-space floor."""


def free_bytes(path: str | Path) -> int:
    """Return free bytes on the filesystem containing *path*."""
    target = Path(path)
    target.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(target).free


def require_free_space(
    path: str | Path,
    minimum_free_bytes: int,
    incoming_bytes: int = 0,
) -> int:
    """Ensure an incoming write leaves the configured safety reserve intact."""
    free = free_bytes(path)
    required = max(0, int(minimum_free_bytes)) + max(0, int(incoming_bytes))
    if free < required:
        raise InsufficientStorageError(
            f"only {free} bytes free; {required} bytes required "
            f"({minimum_free_bytes} byte reserve)"
        )
    return free


def demo_extension(filename: str) -> str:
    """Return the supported compound demo extension for a safe upload name."""
    lower = filename.lower()
    for suffix in (".dem.zst", ".dem.gz", ".dem"):
        if lower.endswith(suffix):
            return suffix
    raise ValueError("expected a .dem, .dem.zst or .dem.gz file")


def commit_content_addressed_upload(
    temporary_path: str | Path,
    demos_dir: str | Path,
    digest: str,
    original_filename: str,
) -> tuple[Path, bool]:
    """Atomically retain one physical copy of an upload.

    The complete temporary file is hard-linked to its SHA-256-based canonical
    name.  Competing/equivalent uploads converge on the same path without an
    overwrite window. Returns ``(path, deduplicated)``.
    """
    temporary = Path(temporary_path)
    destination = Path(demos_dir) / f"{digest}{demo_extension(original_filename)}"
    try:
        os.link(temporary, destination)
        deduplicated = False
    except FileExistsError:
        if destination.stat().st_size != temporary.stat().st_size:
            raise RuntimeError(
                f"content-address collision at {destination}; refusing overwrite"
            )
        deduplicated = True
    temporary.unlink(missing_ok=True)
    return destination, deduplicated


def remove_tree(path: str | Path) -> None:
    """Remove a known artifact directory if it exists."""
    target = Path(path)
    if target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()
