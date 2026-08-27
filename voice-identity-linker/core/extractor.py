# SPDX-License-Identifier: AGPL-3.0-only
r"""Wraps the `csgove` binary to extract per-player voice WAVs from a .dem.

Empirically verified output format (csgove v3.1.6, split-compact mode):

    {demo_basename}_{nickname}_{steamid64}.wav

e.g. 1-eabec0c3-...-1-1_Player_One__<steamid64>.wav
         └─ basename ─┘ └nick┘ └── steamid64 ──┘

The Steam ID64 is always the trailing `7656...` token, so we parse by taking
the last `.`-free token split on `_` whose body matches /^\d{17}$/, and treat
everything between the basename and it as the nickname. Robust to nicknames
that themselves contain underscores (e.g. "Player_One").

WAVs come out as 48 kHz mono 32-bit float; core.audio handles resampling.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import wave
from pathlib import Path

import config

from core.models import Clip, ExtractionResult

log = logging.getLogger(__name__)

# Steam ID64 is always 17 digits starting with 7656 (7656 + 13 more digits).
_STEAMID_RE = re.compile(r"7656\d{13}$")


def _ensure_binary() -> Path:
    if not config.CSGOVE_BIN.exists():
        raise FileNotFoundError(
            f"csgove binary not found at {config.CSGOVE_BIN}. "
            "Download it: see README 'Setup'."
        )
    return config.CSGOVE_BIN


def _ld_library_path() -> str:
    """csgove ships libopus/libtier0/vaudio_celt .so files next to the binary.

    NOTE: csgove (mis)uses the *whole* LD_LIBRARY_PATH value as a single
    directory path internally, so it must be exactly one directory — do NOT
    colon-join with the existing env, or it errors with
    "Library folder doesn't exists".
    """
    return str(config.CSGOVE_BIN.parent)


def _parse_clip_filename(path: Path, demo_stem: str) -> tuple[str, str] | None:
    """Return (steamid, nickname) from a csgove output filename, or None."""
    name = path.stem  # filename without extension
    if not name.startswith(demo_stem):
        return None
    rest = name[len(demo_stem) :].lstrip("_")
    # rest looks like "<nickname>_<steamid64>"
    m = _STEAMID_RE.search(rest)
    if not m:
        return None
    steamid = m.group(0)
    nickname = rest[: m.start()].rstrip("_")
    return steamid, nickname


def _wav_duration(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as w:
            return w.getnframes() / w.getframerate()
    except Exception as e:
        log.warning("could not read wav duration %s: %s", path, e)
        return 0.0


def extract(
    demo_path: str | Path,
    output_dir: str | Path | None = None,
    demo_id: int | None = None,
) -> ExtractionResult:
    """Run csgove on a single .dem and return parsed per-player clips.

    Args:
        demo_path: path to the .dem file.
        output_dir: where WAVs go. Defaults to data/wav/<demo_basename>.
        demo_id: optional DB id to attach to the result.
    """
    demo_path = Path(demo_path).resolve()
    if not demo_path.exists():
        raise FileNotFoundError(demo_path)

    demo_stem = demo_path.stem
    if output_dir is None:
        output_dir = config.WAV_DIR / demo_stem
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    bin_path = _ensure_binary()
    env = {**os.environ, "LD_LIBRARY_PATH": _ld_library_path()}

    cmd = [
        str(bin_path),
        "-mode",
        "split-compact",
        "-output",
        str(output_dir),
        str(demo_path),
    ]
    log.info("running csgove on %s", demo_path.name)
    proc = subprocess.run(
        cmd,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"csgove failed (exit {proc.returncode}):\n{proc.stderr.strip()}"
        )
    log.debug("csgove stdout: %s", proc.stdout.strip())

    clips: list[Clip] = []
    for wav in sorted(output_dir.glob("*.wav")):
        parsed = _parse_clip_filename(wav, demo_stem)
        if parsed is None:
            log.warning("could not parse steamid from %s; skipping", wav.name)
            continue
        steamid, nickname = parsed
        dur = _wav_duration(wav)
        if dur < 0.05:
            log.info("skip near-empty clip for %s (%.2fs)", steamid, dur)
            continue
        clips.append(
            Clip(
                steamid=steamid,
                path=str(wav),
                duration_sec=round(dur, 2),
                nickname=nickname,
            )
        )

    log.info("extracted %d player clips from %s", len(clips), demo_path.name)
    return ExtractionResult(
        demo_id=demo_id,
        wav_dir=str(output_dir),
        clips=clips,
    )
