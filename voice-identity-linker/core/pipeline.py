# SPDX-License-Identifier: AGPL-3.0-only
"""High-level orchestration: ingest a demo end-to-end.

Used by both the CLI and the web layer so the flow is defined once:
    register demo  ->  extract WAVs  ->  embed each player  ->  store
"""

from __future__ import annotations

import gzip
import hashlib
import logging
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

import config

from core import embedder, extractor, storage, store
from core.models import ExtractionResult

log = logging.getLogger(__name__)


def demo_fingerprint(path: str | Path) -> str:
    """Return a content hash so duplicate ingests do not multiply evidence."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        while chunk := handle.read(4 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_dem(demo_path: str | Path) -> Path:
    """Return a usable .dem path, decompressing .dem.zst / .dem.gz in place.

    FACEIT serves demos compressed as `.dem.zst`; the extractor (csgove) needs
    the raw `.dem`. Uses the `zstd` CLI (like csgove) or gzip, avoiding a heavy
    Python dependency. Returns the decompressed `.dem` path (cached).
    """
    path = Path(demo_path).resolve()
    supported = {".zst": _decompress_zstd, ".gz": gzip_decompress}
    if path.suffix not in supported or path.suffix == ".dem":
        return path
    out = path.with_suffix("")
    if out.exists() and out.stat().st_size > 0:
        return out
    storage.require_free_space(out.parent, config.MIN_FREE_DISK_BYTES)
    temporary = out.with_name(f".{out.name}.decompressing")
    temporary.unlink(missing_ok=True)
    try:
        supported[path.suffix](path, temporary)
        temporary.replace(out)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    log.info("decompressed %s -> %s", path.name, out.name)
    return out


def _decompress_zstd(src: Path, dst: Path) -> None:
    zstd = shutil.which("zstd")
    if zstd is None:
        try:
            import zstandard  # type: ignore

            with zstandard.open(str(src), "rb") as fi, open(dst, "wb") as fo:
                _copy_with_disk_guard(fi, fo, dst.parent)
            return
        except ImportError:
            raise RuntimeError(
                "cannot decompress .zst demo: neither the `zstd` CLI nor the "
                "`zstandard` Python package is installed."
            )
    proc = subprocess.Popen(
        [zstd, "-d", "-c", str(src)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        assert proc.stdout is not None
        with open(dst, "wb") as fo:
            _copy_with_disk_guard(proc.stdout, fo, dst.parent)
        stderr = proc.stderr.read().decode(errors="replace") if proc.stderr else ""
        returncode = proc.wait()
    except Exception:
        proc.kill()
        proc.wait()
        raise
    if returncode != 0:
        raise RuntimeError(f"zstd failed: {stderr.strip()}")


def gzip_decompress(src: Path, dst: Path) -> None:
    with gzip.open(str(src), "rb") as fi, open(dst, "wb") as fo:
        _copy_with_disk_guard(fi, fo, dst.parent)


def _copy_with_disk_guard(source, destination, filesystem_path: Path) -> None:
    """Copy a decompression stream without crossing the free-space floor."""
    while chunk := source.read(4 << 20):
        storage.require_free_space(
            filesystem_path,
            config.MIN_FREE_DISK_BYTES,
            len(chunk),
        )
        destination.write(chunk)


def cleanup_ingest_artifacts(
    source_path: str | Path,
    *,
    delete_source: bool = False,
    force: bool = False,
) -> None:
    """Apply retention policy to the reproducible artifacts for one ingest."""
    source = Path(source_path).resolve()
    working = source.with_suffix("") if source.suffix in {".zst", ".gz"} else source
    wav_dir = config.WAV_DIR / working.stem
    if force or config.DELETE_WAV_AFTER_EMBEDDING:
        storage.remove_tree(wav_dir)
    if working != source and (force or config.RETAIN_COMPRESSED_DEMO_ONLY):
        working.unlink(missing_ok=True)
        working.with_name(f".{working.name}.decompressing").unlink(missing_ok=True)
    if delete_source:
        source.unlink(missing_ok=True)


def ingest_demo(
    demo_path: str | Path,
    source: str = "local",
    skip_existing: bool = True,
    only_steamids: set[str] | None = None,
    progress_fn: Callable[[dict], None] | None = None,
) -> tuple[int, ExtractionResult, list[dict]]:
    """Ingest a demo and always apply success/failure retention rules."""
    source_path = Path(demo_path).resolve()
    working_path = ensure_dem(source_path)
    succeeded = False
    try:
        response = _ingest_demo(
            working_path,
            stored_path=source_path,
            source=source,
            skip_existing=skip_existing,
            only_steamids=only_steamids,
            progress_fn=progress_fn,
        )
        # The raw-demo fingerprint may match a differently named or differently
        # compressed upload. Keep the registered canonical copy and remove this
        # second physical upload only after processing succeeds.
        if source == "upload":
            registered = store.get_demo(response[0])
            if registered is not None:
                registered_path = Path(registered.path).resolve()
                if registered_path != source_path:
                    demos_dir = config.DEMOS_DIR.resolve()
                    registered_is_managed = registered_path.parent == demos_dir
                    current_is_compressed = source_path.suffix in {".zst", ".gz"}
                    registered_is_compressed = registered_path.suffix in {".zst", ".gz"}
                    if not registered_is_managed or (
                        current_is_compressed and not registered_is_compressed
                    ):
                        store.update_demo_path(response[0], source, str(source_path))
                        if registered_is_managed:
                            registered_path.unlink(missing_ok=True)
                    elif registered_path.exists():
                        source_path.unlink(missing_ok=True)
        succeeded = True
        return response
    except Exception:
        store.delete_empty_demos_for_path(str(source_path))
        raise
    finally:
        cleanup_ingest_artifacts(source_path, force=not succeeded)


def _ingest_demo(
    demo_path: str | Path,
    stored_path: str | Path,
    source: str = "local",
    skip_existing: bool = True,
    only_steamids: set[str] | None = None,
    progress_fn: Callable[[dict], None] | None = None,
) -> tuple[int, ExtractionResult, list[dict]]:
    """Full pipeline for one .dem. Returns (demo_id, extraction, per-player stats).

    Embeds every player whose clip is long enough — or only the players in
    `only_steamids` if given (the others are extracted to WAV but not embedded,
    which is the fast path for "check this one SteamID against a known voice").
    Short clips are skipped with a logged reason. Players are upserted with
    their observed nickname.
    """
    demo_path = Path(demo_path).resolve()
    demo_id = store.add_demo(
        source,
        str(Path(stored_path).resolve()),
        fingerprint=demo_fingerprint(demo_path),
    )

    def report(
        phase: str,
        current: int = 0,
        total: int = 0,
        players: list[dict] | None = None,
        message: str = "",
    ) -> None:
        if progress_fn is None:
            return
        progress_fn(
            {
                "phase": phase,
                "current": current,
                "total": total,
                "percent": 5
                if phase == "extracting"
                else (10 + round(90 * current / total) if total else 100),
                "players": players or [],
                "message": message,
                "demo_id": demo_id,
            }
        )

    report("extracting", message=f"Extracting audio from {demo_path.name}…")

    storage.require_free_space(
        config.WAV_DIR,
        config.MIN_FREE_DISK_BYTES,
        int(demo_path.stat().st_size * config.EXTRACTION_HEADROOM_FACTOR),
    )

    result = extractor.extract(demo_path, demo_id=demo_id)

    stats: list[dict] = []
    player_progress = [
        {
            "steamid": clip.steamid,
            "nickname": clip.nickname,
            "audio_sec": clip.duration_sec,
            "status": "queued",
        }
        for clip in result.clips
    ]
    total = len(result.clips)
    report(
        "embedding",
        total=total,
        players=player_progress,
        message=f"Embedding {total} player clip{'s' if total != 1 else ''}…",
    )

    for index, clip in enumerate(result.clips):
        player_progress[index]["status"] = "running"
        report(
            "embedding",
            current=index,
            total=total,
            players=player_progress,
            message=f"Embedding {clip.nickname or clip.steamid}…",
        )

        def finish(stat: dict, *, progress_index: int = index) -> None:
            stats.append(stat)
            player_progress[progress_index].update(
                {
                    key: value
                    for key, value in stat.items()
                    if key
                    in {
                        "status",
                        "audio_sec",
                        "raw_audio_sec",
                        "speech_ratio",
                        "preprocessing",
                        "clip_count",
                        "reason",
                    }
                }
            )
            report(
                "embedding",
                current=progress_index + 1,
                total=total,
                players=player_progress,
                message=f"Processed {progress_index + 1} of {total} players",
            )

        if only_steamids is not None and clip.steamid not in only_steamids:
            finish(
                {
                    "steamid": clip.steamid,
                    "nickname": clip.nickname,
                    "status": "skipped_other",
                    "audio_sec": clip.duration_sec,
                }
            )
            continue
        store.upsert_player(
            steamid=clip.steamid,
            nickname=clip.nickname,
        )
        # Skip embedding if this player already has a voiceprint from this demo.
        if skip_existing:
            existing = [
                e for e in store.embeddings_for(clip.steamid) if e.demo_id == demo_id
            ]
            if existing:
                finish(
                    {
                        "steamid": clip.steamid,
                        "nickname": clip.nickname,
                        "status": "skipped",
                        "audio_sec": clip.duration_sec,
                    }
                )
                continue

        ok, reason = embedder_ok(clip.duration_sec)
        if not ok:
            log.info(
                "skip %s (%s): %s",
                clip.nickname or clip.steamid,
                f"{clip.duration_sec:.1f}s",
                reason,
            )
            finish(
                {
                    "steamid": clip.steamid,
                    "nickname": clip.nickname,
                    "status": "skipped_short",
                    "audio_sec": clip.duration_sec,
                    "reason": reason,
                }
            )
            continue

        try:
            embedded = embedder.embed_file_detailed(clip.path)
            for vector, chunk_sec in zip(
                embedded.chunk_vectors, embedded.chunk_seconds, strict=True
            ):
                raw_chunk_sec = (
                    embedded.raw_seconds * chunk_sec / embedded.speech_seconds
                    if embedded.speech_seconds
                    else 0.0
                )
                store.add_embedding(
                    steamid=clip.steamid,
                    demo_id=demo_id,
                    vector=vector,
                    clip_count=1,
                    audio_sec=chunk_sec,
                    preprocessing=embedded.preprocessing,
                    raw_audio_sec=raw_chunk_sec,
                    speech_ratio=embedded.speech_ratio,
                )
            log.info(
                "embedded %s (%.1fs speech, %.0f%% retained by %s)",
                clip.nickname or clip.steamid,
                embedded.speech_seconds,
                embedded.speech_ratio * 100,
                embedded.preprocessing,
            )
            finish(
                {
                    "steamid": clip.steamid,
                    "nickname": clip.nickname,
                    "status": "embedded",
                    "audio_sec": embedded.speech_seconds,
                    "raw_audio_sec": embedded.raw_seconds,
                    "speech_ratio": embedded.speech_ratio,
                    "preprocessing": embedded.preprocessing,
                    "clip_count": len(embedded.chunk_vectors),
                }
            )
        except Exception as e:
            log.exception("failed to embed %s", clip.path)
            finish(
                {
                    "steamid": clip.steamid,
                    "nickname": clip.nickname,
                    "status": "error",
                    "audio_sec": clip.duration_sec,
                    "reason": str(e),
                }
            )

    return demo_id, result, stats


def embedder_ok(seconds: float) -> tuple[bool, str]:
    """Re-export the audio duration gate for convenience."""
    from core.audio import enough_speech

    return enough_speech(seconds)
