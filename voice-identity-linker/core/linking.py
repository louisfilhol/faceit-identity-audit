# SPDX-License-Identifier: AGPL-3.0-only
"""Identity-linking queries over the embedding store.

This is the product layer from the spec:
- is_same_person(A, B)         → demo-pair distribution + ternary verdict
- find_matches(voice_or_steam) → nearest neighbors in the DB
- cluster_demo(demo_id)        → group voices by similarity, ignore Steam IDs

Consent gating: by default, non-consented embeddings are excluded from
cross-account search results. INVESTIGATIVE_MODE explicitly overrides that
privacy-preserving default for legally reviewed internal use.
"""

from __future__ import annotations

import logging

import config
import numpy as np

from core import embedder, store
from core.models import MatchResult, VerifyResult

log = logging.getLogger(__name__)


def _gate(steamid: str, consent: bool) -> bool:
    """Should this player's embedding appear in results?"""
    if config.INVESTIGATIVE_MODE:
        return True
    return consent


def is_same_person(
    steamid_a: str, steamid_b: str, threshold: float | None = None
) -> VerifyResult | None:
    """Aggregate stored windows per demo pair and return a ternary verdict.

    A definitive verdict requires repeated windows from multiple demos for
    both players, compatible preprocessing, a central score outside the
    uncertainty band, and enough demo-pair agreement. A single demo can still
    be inspected, but it can never produce a definitive speaker verdict.
    """
    threshold = config.DEFAULT_THRESHOLD if threshold is None else threshold
    embs_a = store.embeddings_for(steamid_a)
    embs_b = store.embeddings_for(steamid_b)
    if not embs_a or not embs_b:
        missing = steamid_a if not embs_a else steamid_b
        log.warning("no embedding for %s", missing)
        return None

    # Treat each distinct demo pair as one evidence unit.  A long demo can
    # produce many more embedding windows than a short one; pooling every
    # window pair would therefore let that single recording dominate the
    # median and agreement checks.  The median within each demo pair is
    # robust to an odd window, and the verifier then weights demo pairs
    # equally when combining the evidence.
    demos_a: dict[str, list] = {}
    demos_b: dict[str, list] = {}
    for emb in embs_a:
        demos_a.setdefault(store.demo_evidence_key(emb.demo_id), []).append(emb)
    for emb in embs_b:
        demos_b.setdefault(store.demo_evidence_key(emb.demo_id), []).append(emb)

    pair_scores = []
    for demo_embs_a in demos_a.values():
        for demo_embs_b in demos_b.values():
            window_scores = [
                embedder.cosine(a.vector, b.vector)
                for a in demo_embs_a
                for b in demo_embs_b
            ]
            pair_scores.append(float(np.median(window_scores)))
    scores = np.asarray(pair_scores, dtype=np.float64)
    score = float(np.median(scores))
    mean_a = np.average(
        [emb.vector for emb in embs_a],
        axis=0,
        weights=[max(emb.audio_sec, 0.001) for emb in embs_a],
    )
    mean_b = np.average(
        [emb.vector for emb in embs_b],
        axis=0,
        weights=[max(emb.audio_sec, 0.001) for emb in embs_b],
    )
    mean_score = embedder.cosine(mean_a, mean_b)
    margin = max(0.0, config.VERDICT_MARGIN)
    band_low = max(-1.0, threshold - margin)
    band_high = min(1.0, threshold + margin)
    same_pair_fraction = float(np.mean(scores >= threshold))
    required_agreement = min(1.0, max(0.5, config.MIN_PAIR_AGREEMENT))
    min_clips = max(2, config.MIN_VERIFY_CLIPS)
    min_demos = max(2, config.MIN_VERIFY_DEMOS)
    demo_count_a = len(demos_a)
    demo_count_b = len(demos_b)
    preprocessing_a = sorted({emb.preprocessing or "none" for emb in embs_a})
    preprocessing_b = sorted({emb.preprocessing or "none" for emb in embs_b})

    reasons: list[str] = []
    repeated = len(embs_a) >= min_clips and len(embs_b) >= min_clips
    independent_demos = demo_count_a >= min_demos and demo_count_b >= min_demos
    compatible = len(preprocessing_a) == 1 and preprocessing_a == preprocessing_b
    if not repeated:
        reasons.append(
            f"need at least {min_clips} clips for each player "
            f"(have {len(embs_a)} and {len(embs_b)})"
        )
    if not independent_demos:
        reasons.append(
            f"need at least {min_demos} distinct demos for each player "
            f"(have {demo_count_a} and {demo_count_b})"
        )
    if not compatible:
        reasons.append(
            "evidence mixes preprocessing policies; re-embed both players with one VAD policy"
        )

    spread = float(np.percentile(scores, 90) - np.percentile(scores, 10))
    if spread >= 0.15:
        reasons.append(f"demo-pair scores vary widely (P90−P10={spread:.3f})")

    verdict = "inconclusive"
    same_support = score >= band_high and same_pair_fraction >= required_agreement
    different_support = score < band_low and same_pair_fraction <= (
        1.0 - required_agreement
    )
    if repeated and independent_demos and compatible and same_support:
        verdict = "same"
    elif repeated and independent_demos and compatible and different_support:
        verdict = "different"
    else:
        if band_low <= score < band_high:
            reasons.append(
                f"median score is inside the uncertainty band "
                f"[{band_low:.3f}, {band_high:.3f})"
            )
        elif score >= band_high and same_pair_fraction < required_agreement:
            reasons.append(
                f"only {same_pair_fraction:.0%} of demo pairs exceed the threshold; "
                f"need {required_agreement:.0%}"
            )
        elif score < band_low and same_pair_fraction > (1.0 - required_agreement):
            reasons.append("demo pairs disagree on a different-speaker verdict")

    agreement = (
        same_pair_fraction
        if verdict == "same"
        else 1.0 - same_pair_fraction
        if verdict == "different"
        else max(same_pair_fraction, 1.0 - same_pair_fraction)
    )

    if verdict == "inconclusive":
        evidence_quality = "low"
    elif min(demo_count_a, demo_count_b) >= 3 and len(pair_scores) >= 9:
        evidence_quality = "high"
    else:
        evidence_quality = "medium"
    if not reasons:
        reasons.append("repeated demo-pair scores agree outside the uncertainty band")

    return VerifyResult(
        a_steamid=steamid_a,
        b_steamid=steamid_b,
        score=score,
        mean_score=mean_score,
        threshold=threshold,
        same_speaker=True
        if verdict == "same"
        else False
        if verdict == "different"
        else None,
        verdict=verdict,
        band_low=band_low,
        band_high=band_high,
        clip_count_a=len(embs_a),
        clip_count_b=len(embs_b),
        demo_count_a=demo_count_a,
        demo_count_b=demo_count_b,
        pair_count=len(pair_scores),
        window_pair_count=len(embs_a) * len(embs_b),
        pair_scores=[float(item) for item in pair_scores],
        score_min=float(np.min(scores)),
        score_max=float(np.max(scores)),
        score_mean=float(np.mean(scores)),
        score_std=float(np.std(scores)),
        score_p10=float(np.percentile(scores, 10)),
        score_p90=float(np.percentile(scores, 90)),
        agreement=agreement,
        same_pair_fraction=same_pair_fraction,
        evidence_quality=evidence_quality,
        reasons=reasons,
        preprocessing_a=preprocessing_a,
        preprocessing_b=preprocessing_b,
    )


def find_matches(
    query_vector: np.ndarray,
    k: int = 10,
    threshold: float | None = None,
    exclude: str | None = None,
) -> list[MatchResult]:
    """Top-k nearest embeddings to `query_vector` by cosine similarity."""
    threshold = config.DEFAULT_THRESHOLD if threshold is None else threshold
    idx = store._build_index()  # steamid -> mean vec
    results: list[MatchResult] = []
    for sid, vec in idx.items():
        if exclude and sid == exclude:
            continue
        score = embedder.cosine(query_vector, vec)
        player = store.get_player(sid)
        consent = bool(player.consent) if player else False
        if not _gate(sid, consent):
            continue
        results.append(
            MatchResult(
                steamid=sid,
                nickname=player.nickname if player else None,
                score=score,
                clip_count=sum(e.clip_count for e in store.embeddings_for(sid)),
                audio_sec=sum(e.audio_sec for e in store.embeddings_for(sid)),
                consent=consent,
            )
        )
    results.sort(key=lambda r: r.score, reverse=True)
    # Always return top-k, but mark the threshold cut in the caller.
    return results[:k]


def find_matches_for_player(
    steamid: str, k: int = 10, threshold: float | None = None
) -> list[MatchResult]:
    v = store.mean_vector(steamid)
    if v is None:
        return []
    return find_matches(v, k=k, threshold=threshold, exclude=steamid)


def cluster_demo(demo_id: int, threshold: float | None = None) -> list[list[str]]:
    """Greedy single-link clustering of a demo's speakers by embedding.

    Returns groups of steamids whose voices are similar — ignoring the
    Steam IDs themselves. Useful when one person uses multiple accounts in
    the same demo, or just to sanity-check distinctness.
    """
    threshold = config.DEFAULT_THRESHOLD if threshold is None else threshold
    embs = store.embeddings_for_demo(demo_id)
    # Long audio produces multiple bounded windows; use the per-player mean so
    # clustering is not determined by whichever window happened to be stored first.
    windows: dict[str, list[np.ndarray]] = {}
    for e in embs:
        windows.setdefault(e.steamid, []).append(e.vector)
    seen = {steamid: np.mean(vectors, axis=0) for steamid, vectors in windows.items()}

    sids = list(seen.keys())
    assigned: dict[str, int] = {}
    groups: list[list[str]] = []
    for i, a in enumerate(sids):
        if a in assigned:
            continue
        gi = len(groups)
        assigned[a] = gi
        groups.append([a])
        for b in sids[i + 1 :]:
            if b in assigned:
                continue
            if embedder.cosine(seen[a], seen[b]) >= threshold:
                assigned[b] = gi
                groups[gi].append(b)
    return groups
