# SPDX-License-Identifier: AGPL-3.0-only
"""Measure how Silero VAD changes scores on the labeled path-pair set."""

from __future__ import annotations

import csv
import logging
from pathlib import Path

import numpy as np
from core import embedder

from eval.tune_threshold import _load_pairs

log = logging.getLogger(__name__)


def compare(pairs_dir: Path, output: Path | None = None) -> list[dict]:
    labeled = [
        (label, a, b)
        for label, filename in (("same", "same.txt"), ("different", "different.txt"))
        for a, b in _load_pairs(pairs_dir / filename)
    ]
    if not labeled:
        raise ValueError(f"no pairs found under {pairs_dir}")

    cache: dict[tuple[str, bool], embedder.EmbeddingOutput] = {}

    def embedded(path: str, use_vad: bool) -> embedder.EmbeddingOutput:
        key = (path, use_vad)
        if key not in cache:
            log.info(
                "embedding %s (%s)", Path(path).name, "silero-vad" if use_vad else "raw"
            )
            cache[key] = embedder.embed_file_detailed(path, use_vad=use_vad)
        return cache[key]

    rows: list[dict] = []
    for label, path_a, path_b in labeled:
        raw_a, raw_b = embedded(path_a, False), embedded(path_b, False)
        vad_a, vad_b = embedded(path_a, True), embedded(path_b, True)
        raw_score = embedder.cosine(raw_a.vector, raw_b.vector)
        vad_score = embedder.cosine(vad_a.vector, vad_b.vector)
        rows.append(
            {
                "label": label,
                "path_a": path_a,
                "path_b": path_b,
                "raw_score": raw_score,
                "vad_score": vad_score,
                "delta": vad_score - raw_score,
                "speech_ratio_a": vad_a.speech_ratio,
                "speech_ratio_b": vad_b.speech_ratio,
            }
        )

    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

    for label in ("same", "different"):
        subset = [row for row in rows if row["label"] == label]
        if not subset:
            continue
        raw = np.asarray([row["raw_score"] for row in subset])
        vad = np.asarray([row["vad_score"] for row in subset])
        print(
            f"{label:9s}: n={len(subset)} raw_mean={raw.mean():.3f} "
            f"vad_mean={vad.mean():.3f} mean_delta={(vad - raw).mean():+.3f}"
        )
    ratios = [item.speech_ratio for (path, use_vad), item in cache.items() if use_vad]
    print(
        f"speech retained: mean={np.mean(ratios):.1%} "
        f"min={np.min(ratios):.1%} max={np.max(ratios):.1%}"
    )
    print(
        "This comparison is descriptive; retune on a larger speaker-disjoint set before adopting VAD scores."
    )
    return rows
