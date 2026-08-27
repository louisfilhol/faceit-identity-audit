# SPDX-License-Identifier: AGPL-3.0-only
"""Plain dataclasses used across the codebase.

Keeping them here (rather than depending on ORM objects everywhere) means the
CLI, the linking logic, and the web layer all speak the same vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np


@dataclass
class Demo:
    id: int
    source: str
    path: str
    created_at: datetime
    fingerprint: str | None = None


@dataclass
class Player:
    steamid: str
    nickname: str | None = None
    consent: bool = False
    notes: str | None = None


@dataclass
class Embedding:
    id: int
    steamid: str
    demo_id: int
    vector: np.ndarray  # float32, shape (192,)
    clip_count: int
    audio_sec: float
    created_at: datetime
    preprocessing: str = "none"
    raw_audio_sec: float = 0.0
    speech_ratio: float = 1.0

    @property
    def dim(self) -> int:
        return int(self.vector.shape[0])


@dataclass
class MatchResult:
    steamid: str
    nickname: str | None
    score: float  # cosine similarity in [-1, 1]
    clip_count: int
    audio_sec: float
    consent: bool


@dataclass
class VerifyResult:
    a_steamid: str
    b_steamid: str
    score: float
    mean_score: float
    threshold: float
    same_speaker: bool | None
    verdict: str
    band_low: float
    band_high: float
    clip_count_a: int
    clip_count_b: int
    demo_count_a: int
    demo_count_b: int
    pair_count: int  # equally weighted, per-demo-pair aggregate scores
    window_pair_count: int
    pair_scores: list[float]
    score_min: float
    score_max: float
    score_mean: float
    score_std: float
    score_p10: float
    score_p90: float
    agreement: float
    same_pair_fraction: float
    evidence_quality: str
    reasons: list[str]
    preprocessing_a: list[str]
    preprocessing_b: list[str]


@dataclass
class ExtractionResult:
    """Returned by core.extractor.extract()."""

    demo_id: int | None
    wav_dir: str
    clips: list[Clip] = field(default_factory=list)


@dataclass
class Clip:
    steamid: str
    path: str
    duration_sec: float
    nickname: str | None = None
