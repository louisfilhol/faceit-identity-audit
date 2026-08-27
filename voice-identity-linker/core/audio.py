# SPDX-License-Identifier: AGPL-3.0-only
"""Audio loading + resampling to the model's required 16 kHz mono.

csgove outputs 48 kHz mono 32-bit float WAVs. ECAPA-TDNN wants 16 kHz mono.
We prefer soundfile (libsndfile) for loading — it's fast (~0.1s) and handles
float WAV natively. torchaudio 2.11+ requires torchcodec for its own loader,
which is heavy and often missing, so we keep it as a secondary path only for
resampling. ffmpeg is a last-resort fallback.
"""

from __future__ import annotations

import logging
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path

import config
import numpy as np

log = logging.getLogger(__name__)

_vad_lock = threading.Lock()
_vad_model = None


@dataclass(frozen=True)
class SpeechAudio:
    wav: np.ndarray
    sample_rate: int
    preprocessing: str
    raw_seconds: float
    speech_seconds: float
    speech_ratio: float
    segment_count: int


def _resample_linear(wav: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    """Linear resample (good enough for speech; torch not required)."""
    if sr_in == sr_out:
        return wav
    n_out = int(round(len(wav) * sr_out / sr_in))
    idx = np.linspace(0, len(wav) - 1, n_out)
    return np.interp(idx, np.arange(len(wav)), wav).astype(np.float32)


def load_mono_16k(path: str | Path) -> tuple[np.ndarray, int]:
    """Load any audio file as a mono 16 kHz float32 numpy array.

    Primary loader: soundfile (fast, float-WAV native).
    Fallback: ffmpeg → f32le.
    """
    path = Path(path)

    # --- Primary: soundfile ---
    try:
        import soundfile as sf

        data, sr = sf.read(str(path), always_2d=False, dtype="float32")
        if data.ndim > 1:  # multi-channel → mono
            data = data.mean(axis=1)
        data = data.astype(np.float32)
        if sr != config.TARGET_SR:
            # Use torchaudio's resampler if available (kaiser-window FFT),
            # else linear interpolation.
            try:
                import torch
                import torchaudio

                t = torch.from_numpy(data).unsqueeze(0)
                t = torchaudio.functional.resample(t, sr, config.TARGET_SR)
                data = t.squeeze(0).numpy().astype(np.float32)
            except Exception:
                data = _resample_linear(data, sr, config.TARGET_SR)
        return data, config.TARGET_SR
    except Exception as e:
        log.debug("soundfile load failed (%s); falling back to ffmpeg", e)

    # --- Fallback: ffmpeg → raw f32le ---
    return _ffmpeg_resample(path, config.TARGET_SR)


def _load_vad_model():
    global _vad_model
    if _vad_model is not None:
        return _vad_model
    try:
        from silero_vad import load_silero_vad
    except ImportError as e:
        raise RuntimeError(
            "VAD_ENABLED=1 but silero-vad is not installed; reinstall "
            "voice-identity-linker/requirements.txt or set VAD_ENABLED=0"
        ) from e
    _vad_model = load_silero_vad()
    return _vad_model


def prepare_speech(
    path: str | Path,
    *,
    use_vad: bool | None = None,
) -> SpeechAudio:
    """Load 16 kHz audio and optionally retain only Silero speech regions."""
    import torch

    wav, sr = load_mono_16k(path)
    raw_seconds = float(wav.shape[0] / sr)
    use_vad = config.VAD_ENABLED if use_vad is None else use_vad
    if not use_vad:
        return SpeechAudio(
            wav=wav,
            sample_rate=sr,
            preprocessing="none",
            raw_seconds=raw_seconds,
            speech_seconds=raw_seconds,
            speech_ratio=1.0 if raw_seconds else 0.0,
            segment_count=1 if wav.size else 0,
        )

    try:
        from silero_vad import get_speech_timestamps
    except ImportError as e:
        raise RuntimeError(
            "VAD_ENABLED=1 but silero-vad is not installed; reinstall "
            "voice-identity-linker/requirements.txt or set VAD_ENABLED=0"
        ) from e

    with _vad_lock:
        model = _load_vad_model()
        timestamps = get_speech_timestamps(
            torch.from_numpy(wav),
            model,
            sampling_rate=sr,
            threshold=config.VAD_THRESHOLD,
            min_speech_duration_ms=config.VAD_MIN_SPEECH_MS,
            min_silence_duration_ms=config.VAD_MIN_SILENCE_MS,
            speech_pad_ms=config.VAD_SPEECH_PAD_MS,
        )
    chunks = [wav[item["start"] : item["end"]] for item in timestamps]
    speech = (
        np.concatenate(chunks).astype(np.float32)
        if chunks
        else np.empty(0, dtype=np.float32)
    )
    speech_seconds = float(speech.shape[0] / sr)
    ratio = speech_seconds / raw_seconds if raw_seconds else 0.0
    return SpeechAudio(
        wav=speech,
        sample_rate=sr,
        preprocessing="silero-vad",
        raw_seconds=raw_seconds,
        speech_seconds=speech_seconds,
        speech_ratio=float(ratio),
        segment_count=len(chunks),
    )


def _ffmpeg_resample(path: str | Path, sr: int) -> tuple[np.ndarray, int]:
    """Resample to mono wav at `sr` via ffmpeg. Returns (float32 [-1,1], sr).

    Has a hard timeout so a malformed input can never leave an orphan ffmpeg
    spinning forever (which starves the whole machine).
    """
    tmp = Path(tempfile.mkstemp(suffix=".wav")[1])
    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(path),
            "-ac",
            "1",
            "-ar",
            str(sr),
            "-f",
            "f32le",
            str(tmp),
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                timeout=120,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("ffmpeg timed out after 120s (malformed input?)")
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {proc.stderr.strip()}")
        raw = np.fromfile(tmp, dtype=np.float32)
        if raw.size == 0:
            raise RuntimeError("ffmpeg produced empty output")
        return raw, sr
    finally:
        tmp.unlink(missing_ok=True)


def duration(path: str | Path) -> float:
    """Duration in seconds via torchaudio, falling back to wave/ffmpeg."""
    path = Path(path)
    try:
        import wave

        with wave.open(str(path), "rb") as w:
            return w.getnframes() / w.getframerate()
    except Exception:
        pass
    arr, sr = _ffmpeg_resample(path, config.TARGET_SR)
    return arr.shape[0] / sr


def enough_speech(seconds: float) -> tuple[bool, str]:
    """Decide whether a clip is long enough to embed reliably.

    Returns (ok, reason). Under MIN_CLIP_SEC accuracy collapses; we skip.
    Between MIN and WARN we keep but warn.
    """
    if seconds < config.MIN_CLIP_SEC:
        return False, f"too short ({seconds:.1f}s < {config.MIN_CLIP_SEC}s)"
    if seconds < config.WARN_CLIP_SEC:
        return True, f"short ({seconds:.1f}s < {config.WARN_CLIP_SEC}s warn)"
    return True, "ok"
