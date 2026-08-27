# SPDX-License-Identifier: AGPL-3.0-only
"""Threshold tuning over labeled same/different voice pairs.

Pair file format (simple, human-editable):
    eval/pairs/same.txt      one pair per line: <pathA> <pathB> [# note]
    eval/pairs/different.txt same format.

Alternatively, pass a reviewed CSV produced by `eval/generate_db_pairs.py`.
We report pair-level EER and operating-point error rates, while warning when
the dataset is too small or too dependent to support validation claims.
"""

from __future__ import annotations

import csv
import logging
import math
from pathlib import Path

import config
import numpy as np
from core import embedder

log = logging.getLogger(__name__)


def _load_pairs(path: Path) -> list[tuple[str, str]]:
    """Load pairs, tolerating spaces in file paths.

    Each non-comment line holds exactly two absolute paths (both starting with
    '/'). We split at the start of the SECOND path — the last occurrence of
    ' /' in the line — so a first path like '/tmp/faceit-report/a.wav'
    (which contains a space) isn't broken up.
    """
    pairs = []
    if not path.exists():
        return pairs
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        idx = line.rfind(" /")
        if idx == -1:
            parts = line.split()
            if len(parts) >= 2:
                pairs.append((parts[0], parts[1]))
            continue
        a = line[:idx].strip()
        b = line[idx + 1 :].strip()
        if a and b:
            pairs.append((a, b))
    return pairs


def _scores(pairs: list[tuple[str, str]]) -> list[float]:
    out = []
    for i, (a, b) in enumerate(pairs, 1):
        log.info(
            "scoring pair %d/%d: %s ⟷ %s", i, len(pairs), Path(a).name, Path(b).name
        )
        try:
            va, _ = embedder.embed_file(a)
            vb, _ = embedder.embed_file(b)
            score = embedder.cosine(va, vb)
            out.append(score)
            log.info("  → %.4f", score)
        except Exception as e:
            log.warning("skip pair (%s, %s): %s", a, b, e)
    return out


def eer(same_scores: list[float], diff_scores: list[float]) -> tuple[float, float]:
    """Return (eer_rate, threshold_at_eer).

    Sweeps τ and returns the point minimizing max(false-reject, false-accept),
    which is the standard EER operating point.
    """
    if not same_scores or not diff_scores:
        log.warning("missing one or both pair sets; cannot compute EER")
        return float("nan"), float("nan")
    lo = min(min(same_scores), min(diff_scores))
    hi = max(max(same_scores), max(diff_scores))
    best_err = 1.0
    best_tau = 0.5 * (lo + hi)
    for tau in np.linspace(lo, hi, 200):
        fr = np.mean([s < tau for s in same_scores])  # false reject
        fa = np.mean([s >= tau for s in diff_scores])  # false accept
        err = max(fr, fa)
        if err < best_err:
            best_err = float(err)
            best_tau = float(tau)
    return best_err, best_tau


def _manifest_scores(
    path: Path,
    split: str | None = None,
) -> tuple[list[float], list[float], dict]:
    same: list[float] = []
    different: list[float] = []
    subjects: set[str] = set()
    accounts: set[str] = set()
    available_splits: set[str] = set()
    reviewed = ignored = ignored_split = 0
    missing_subject_ids = preprocessing_mismatches = 0
    split = split.strip().lower() if split else None
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            label = (row.get("label") or "").strip().lower()
            if label not in {"same", "different"}:
                ignored += 1
                continue
            row_split = (row.get("split") or "unassigned").strip().lower()
            available_splits.add(row_split)
            if split is not None and row_split != split:
                ignored_split += 1
                continue
            try:
                score = float(row["score"])
            except (KeyError, TypeError, ValueError):
                log.warning("skip manifest row with invalid score: %s", row)
                continue
            subject_a = (row.get("subject_id_a") or "").strip()
            subject_b = (row.get("subject_id_b") or "").strip()
            if subject_a and subject_b:
                if (label == "same") != (subject_a == subject_b):
                    log.warning(
                        "skip inconsistent row: label=%s but subject IDs are %r and %r",
                        label,
                        subject_a,
                        subject_b,
                    )
                    ignored += 1
                    continue
                subjects.update((subject_a, subject_b))
            else:
                missing_subject_ids += 1
            preprocessing_a = (row.get("preprocessing_a") or "").strip()
            preprocessing_b = (row.get("preprocessing_b") or "").strip()
            if (
                preprocessing_a
                and preprocessing_b
                and preprocessing_a != preprocessing_b
            ):
                preprocessing_mismatches += 1
            (same if label == "same" else different).append(score)
            accounts.update(filter(None, (row.get("steamid_a"), row.get("steamid_b"))))
            reviewed += 1
    return (
        same,
        different,
        {
            "reviewed": reviewed,
            "ignored": ignored,
            "ignored_split": ignored_split,
            "subjects": len(subjects),
            "accounts": len(accounts),
            "missing_subject_ids": missing_subject_ids,
            "preprocessing_mismatches": preprocessing_mismatches,
            "available_splits": sorted(available_splits),
            "selected_split": split,
        },
    )


def _wilson(errors: int, total: int, z: float = 1.96) -> tuple[float, float]:
    if total == 0:
        return float("nan"), float("nan")
    p = errors / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    radius = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denom
    return max(0.0, centre - radius), min(1.0, centre + radius)


def _print_operating_point(
    same: list[float],
    diff: list[float],
    threshold: float,
) -> None:
    false_rejects = sum(score < threshold for score in same)
    false_accepts = sum(score >= threshold for score in diff)
    frr = false_rejects / len(same) if same else float("nan")
    far = false_accepts / len(diff) if diff else float("nan")
    frr_ci = _wilson(false_rejects, len(same))
    far_ci = _wilson(false_accepts, len(diff))
    print(f"\nAt DEFAULT_THRESHOLD={threshold:.3f}:")
    if same:
        print(
            f"  false-reject rate: {frr * 100:.1f}% "
            f"(95% Wilson {frr_ci[0] * 100:.1f}–{frr_ci[1] * 100:.1f}%)"
        )
    if diff:
        print(
            f"  false-accept rate: {far * 100:.1f}% "
            f"(95% Wilson {far_ci[0] * 100:.1f}–{far_ci[1] * 100:.1f}%)"
        )


def sweep(
    pairs_dir: Path | None = None,
    *,
    manifest: Path | None = None,
    operating_threshold: float | None = None,
    split: str | None = None,
) -> None:
    metadata = None
    if manifest is not None:
        same, diff, metadata = _manifest_scores(manifest, split=split)
    else:
        pairs_dir = pairs_dir or Path("eval/pairs")
        same = _scores(_load_pairs(pairs_dir / "same.txt"))
        diff = _scores(_load_pairs(pairs_dir / "different.txt"))

    if not same and not diff:
        print(
            "No pairs found. Create eval/pairs/same.txt and "
            "eval/pairs/different.txt (one pair per line: pathA pathB)."
        )
        return

    if metadata:
        print(
            f"reviewed manifest rows      : {metadata['reviewed']} "
            f"({metadata['ignored']} unreviewed/ignored)"
        )
        if metadata["selected_split"]:
            print(
                f"selected split              : {metadata['selected_split']} "
                f"({metadata['ignored_split']} other-split rows ignored)"
            )
        elif len(metadata["available_splits"]) > 1:
            print(
                "available splits            : "
                + ", ".join(metadata["available_splits"])
            )
        print(f"unique labeled subjects    : {metadata['subjects']}")
        print(f"unique account IDs         : {metadata['accounts']}")

    print(f"\nsame-speaker pairs scored : {len(same)}", flush=True)
    print(f"diff-speaker pairs scored : {len(diff)}", flush=True)
    if same:
        print(
            f"  same scores  : min={min(same):.3f} mean={np.mean(same):.3f} max={max(same):.3f}",
            flush=True,
        )
    if diff:
        print(
            f"  diff scores  : min={min(diff):.3f} mean={np.mean(diff):.3f} max={max(diff):.3f}",
            flush=True,
        )

    rate, tau = eer(same, diff)
    if not np.isnan(rate):
        print(f"\nApparent pair-level EER ≈ {rate * 100:.1f}% at τ ≈ {tau:.3f}")
        print(f"→ candidate DEFAULT_THRESHOLD={tau:.3f}; validate on held-out speakers")
    else:
        print("\nCould not compute EER (need both same and different pairs).")

    _print_operating_point(
        same,
        diff,
        config.DEFAULT_THRESHOLD
        if operating_threshold is None
        else operating_threshold,
    )
    subject_count = metadata["subjects"] if metadata else 0
    if len(same) < 30 or len(diff) < 30 or (metadata and subject_count < 20):
        print(
            "\nWARNING: this is a small development set, not validation. "
            "Collect at least dozens of speakers with multiple demos, reserve "
            "held-out speakers, and report uncertainty before changing product defaults."
        )
    if metadata and metadata["missing_subject_ids"]:
        print(
            f"WARNING: {metadata['missing_subject_ids']} reviewed row(s) lack "
            "subject IDs, so speaker-disjoint evaluation cannot be verified."
        )
    if metadata and metadata["preprocessing_mismatches"]:
        print(
            f"WARNING: {metadata['preprocessing_mismatches']} reviewed row(s) mix "
            "preprocessing policies; re-embed them consistently."
        )
    if (
        metadata
        and not metadata["selected_split"]
        and len(metadata["available_splits"]) > 1
    ):
        print(
            "WARNING: multiple splits were pooled. Pass --split development for "
            "threshold selection and --split test for the held-out report."
        )
    print(
        "Pair scores that share clips/speakers are correlated; Wilson intervals "
        "above are descriptive and do not replace speaker-disjoint evaluation."
    )
