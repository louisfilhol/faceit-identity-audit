# SPDX-License-Identifier: AGPL-3.0-only
"""SpeechBrain ECAPA-TDNN speaker embedding wrapper.

Two responsibilities:
1. Turn a WAV file into a 192-dim float32 embedding.
2. Cosine similarity between two embeddings.

The model is loaded lazily and cached on first use — importing torch /
SpeechBrain is expensive (~3s) and the CLI's lighter commands shouldn't pay
for it.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import config
import numpy as np

from core import audio

log = logging.getLogger(__name__)

_lock = threading.Lock()
_verifier = None  # speechbrain SpeakerRecognition instance
_embedder_fn = None  # underlying encode callable


@dataclass(frozen=True)
class EmbeddingOutput:
    vector: np.ndarray
    chunk_vectors: tuple[np.ndarray, ...]
    chunk_seconds: tuple[float, ...]
    speech_seconds: float
    raw_seconds: float
    speech_ratio: float
    preprocessing: str
    segment_count: int


def _load():
    """Lazily load the ECAPA-TDNN model (thread-safe, once)."""
    global _verifier, _embedder_fn
    if _verifier is not None:
        return _verifier
    with _lock:
        if _verifier is not None:
            return _verifier
        from speechbrain.inference.speaker import SpeakerRecognition

        log.info("loading speaker model %s (CPU)...", config.MODEL_NAME)
        _verifier = SpeakerRecognition.from_hparams(
            source=config.MODEL_NAME,
            savedir=str(config.DATA_DIR / "models" / "ecapa"),
            run_opts={"device": "cpu"},
        )
        _embedder_fn = _verifier.encode_batch
        log.info("model loaded.")
        return _verifier


def embed_file_detailed(
    path: str | Path,
    *,
    use_vad: bool | None = None,
) -> EmbeddingOutput:
    """Embed a file and return auditable preprocessing metadata."""
    import torch

    _load()
    path = Path(path)

    prepared = audio.prepare_speech(path, use_vad=use_vad)
    seconds = prepared.speech_seconds
    ok, reason = audio.enough_speech(seconds)
    if not ok:
        raise ValueError(
            f"{path.name}: {reason} after {prepared.preprocessing} "
            f"({prepared.speech_ratio:.0%} speech retained)"
        )
    if seconds < config.WARN_CLIP_SEC:
        log.warning("embedding short clip %s (%s)", path.name, reason)

    # Bound inference memory on long concatenated demo audio. Each window is a
    # separately useful observation; their mean remains the compatibility
    # vector returned by the legacy API.
    chunk_samples = max(
        int(config.MIN_CLIP_SEC * prepared.sample_rate),
        int(config.EMBED_CHUNK_SEC * prepared.sample_rate),
    )
    chunks = [
        prepared.wav[start : start + chunk_samples]
        for start in range(0, prepared.wav.shape[0], chunk_samples)
    ]
    if (
        len(chunks) > 1
        and chunks[-1].shape[0] < config.MIN_CLIP_SEC * prepared.sample_rate
    ):
        chunks[-2] = np.concatenate((chunks[-2], chunks[-1]))
        chunks.pop()

    vectors: list[np.ndarray] = []
    chunk_seconds: list[float] = []
    for chunk in chunks:
        wav_t = torch.from_numpy(chunk).unsqueeze(0).float()
        with torch.no_grad():
            emb = _embedder_fn(wav_t)
        vectors.append(emb.squeeze().cpu().numpy().astype(np.float32))
        chunk_seconds.append(float(chunk.shape[0] / prepared.sample_rate))
    vec = np.average(vectors, axis=0, weights=chunk_seconds).astype(np.float32)
    return EmbeddingOutput(
        vector=vec,
        chunk_vectors=tuple(vectors),
        chunk_seconds=tuple(chunk_seconds),
        speech_seconds=seconds,
        raw_seconds=prepared.raw_seconds,
        speech_ratio=prepared.speech_ratio,
        preprocessing=prepared.preprocessing,
        segment_count=prepared.segment_count,
    )


def embed_file(path: str | Path) -> tuple[np.ndarray, float]:
    """Backward-compatible `(vector, speech_seconds)` embedding API."""
    result = embed_file_detailed(path)
    return result.vector, result.speech_seconds


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity in [-1, 1] between two embedding vectors."""
    denom = (np.linalg.norm(a) * np.linalg.norm(b)) + 1e-8
    return float(np.dot(a, b) / denom)


def verify_files(
    ref: str | Path, other: str | Path, threshold: float | None = None
) -> tuple[float, bool]:
    """Score two WAV files and return (cosine, same_speaker)."""
    threshold = config.DEFAULT_THRESHOLD if threshold is None else threshold
    a, _ = embed_file(ref)
    b, _ = embed_file(other)
    score = cosine(a, b)
    return score, score >= threshold
