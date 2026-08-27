# SPDX-License-Identifier: AGPL-3.0-only
"""Central configuration loaded from environment / .env.

All paths and tunables live here so the rest of the codebase imports a single
`settings` object instead of re-reading os.environ everywhere.
"""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent

try:
    from dotenv import load_dotenv

    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    # python-dotenv is optional; we tolerate its absence.
    pass


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw else default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


# --- Paths ------------------------------------------------------------------
def _data_dir() -> Path:
    raw = _env("DATA_DIR", "").strip()
    if not raw:
        return PROJECT_ROOT / "data"
    path = Path(raw).expanduser()
    # Resolve relative DATA_DIR against the project, not the CWD, so the tool
    # works regardless of where it is launched from.
    return path.resolve() if path.is_absolute() else (PROJECT_ROOT / path).resolve()


DATA_DIR = _data_dir()
DEMOS_DIR = DATA_DIR / "demos"
WAV_DIR = DATA_DIR / "wav"
DB_PATH = DATA_DIR / "voiceprints.db"

# --- Storage guardrails ----------------------------------------------------
# Uploads are streamed, so MAX_UPLOAD_BYTES is enforced even when a client
# omits or lies about Content-Length.  MIN_FREE_DISK_BYTES is a hard safety
# floor checked before and during writes/decompression.
MAX_UPLOAD_BYTES = _env_int("MAX_UPLOAD_BYTES", 1 * 1024**3)
MIN_FREE_DISK_BYTES = _env_int("MIN_FREE_DISK_BYTES", 5 * 1024**3)
# Reserve room for csgove output in addition to the absolute free-space floor.
# Extracted voice WAVs are normally smaller than the raw demo; 2x leaves a
# conservative buffer for unusually voice-heavy matches.
EXTRACTION_HEADROOM_FACTOR = _env_float("EXTRACTION_HEADROOM_FACTOR", 2.0)

# Extracted WAVs are reproducible from a retained demo and are by far the
# largest transient artifact.  Compressed uploads remain the canonical demo;
# their temporary decompressed .dem copy is removed after every ingest.
DELETE_WAV_AFTER_EMBEDDING = _env_bool("DELETE_WAV_AFTER_EMBEDDING", True)
RETAIN_COMPRESSED_DEMO_ONLY = _env_bool("RETAIN_COMPRESSED_DEMO_ONLY", True)
DELETE_FAILED_UPLOADS = _env_bool("DELETE_FAILED_UPLOADS", True)

# Terminal job metadata is useful briefly for the UI, but must not grow
# without bound. Stale .part uploads use the same retention window.
INGEST_JOB_RETENTION_HOURS = _env_float("INGEST_JOB_RETENTION_HOURS", 24.0)
INGEST_JOB_HISTORY_LIMIT = _env_int("INGEST_JOB_HISTORY_LIMIT", 100)

# Binary
CSGOVE_BIN = PROJECT_ROOT / "bin" / "csgove"

# --- Model ------------------------------------------------------------------
MODEL_NAME = _env("MODEL_NAME", "speechbrain/spkrec-ecapa-voxceleb")
TARGET_SR = 16000  # ECAPA-TDNN wants 16 kHz mono

# --- Thresholds -------------------------------------------------------------
DEFAULT_THRESHOLD = _env_float("DEFAULT_THRESHOLD", 0.5)
MIN_CLIP_SEC = _env_float("MIN_CLIP_SEC", 2.0)
WARN_CLIP_SEC = _env_float("WARN_CLIP_SEC", 3.0)

# Verification is deliberately ternary. Scores inside the threshold margin,
# or comparisons without repeated clips and demos on both sides, are
# inconclusive. Agreement is measured across equally weighted demo pairs.
VERDICT_MARGIN = _env_float("VERDICT_MARGIN", 0.05)
MIN_VERIFY_CLIPS = _env_int("MIN_VERIFY_CLIPS", 2)
MIN_VERIFY_DEMOS = _env_int("MIN_VERIFY_DEMOS", 2)
MIN_PAIR_AGREEMENT = _env_float("MIN_PAIR_AGREEMENT", 0.75)
EMBED_CHUNK_SEC = _env_float("EMBED_CHUNK_SEC", 30.0)

# Silero VAD runs after 16 kHz resampling and before speaker embedding. Fresh
# installs include the tiny model through the silero-vad package. Existing
# embeddings retain their recorded preprocessing metadata.
VAD_ENABLED = _env_bool("VAD_ENABLED", True)
VAD_THRESHOLD = _env_float("VAD_THRESHOLD", 0.5)
VAD_MIN_SPEECH_MS = _env_int("VAD_MIN_SPEECH_MS", 250)
VAD_MIN_SILENCE_MS = _env_int("VAD_MIN_SILENCE_MS", 100)
VAD_SPEECH_PAD_MS = _env_int("VAD_SPEECH_PAD_MS", 30)

# Default reference voiceprint for `scan` (the known reference player).
REF_STEAMID = os.environ.get("REF_STEAMID", "")

# --- Privacy / consent ------------------------------------------------------
INVESTIGATIVE_MODE = _env_bool("INVESTIGATIVE_MODE", False)

# --- FACEIT demo sync ---------------------------------------------------------
# Game id for the unofficial match endpoints ("cs2", not "csgo").
FACEIT_SYNC_GAME = _env("FACEIT_SYNC_GAME", "cs2")
# Signing runs in a real browser (Cloudflare Turnstile). Headful is more
# reliable; headless works without a display but Turnstile may reject it.
FACEIT_SYNC_HEADLESS = _env_bool("FACEIT_SYNC_HEADLESS", False)
# Optional: attach to an already-running Chrome started with
# --remote-debugging-port=9222 instead of a bundled browser.
FACEIT_CDP_ENDPOINT = _env("FACEIT_CDP_ENDPOINT", "").strip()
BROWSER_PROFILE_DIR = DATA_DIR / "faceit-browser"


def ensure_dirs() -> None:
    """Create the runtime data directories if they don't exist."""
    for d in (DATA_DIR, DEMOS_DIR, WAV_DIR):
        d.mkdir(parents=True, exist_ok=True)
