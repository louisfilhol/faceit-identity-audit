# SPDX-License-Identifier: AGPL-3.0-only
"""Generate a reviewable verification-pair manifest from voiceprints.db.

The database knows accounts, not real-world identities. Accordingly, account
IDs are emitted as *suggested* labels and the ground-truth `label` column is
`review` by default. A human must change it to `same` or `different` before the
pair is included in threshold tuning. `--assume-account-labels` is available
for benign datasets where each account is known to have one owner, but is a
dangerous assumption for a multi-account investigation.
"""

from __future__ import annotations

import argparse
import csv
import itertools
import random
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class Row:
    embedding_id: int
    steamid: str
    demo_id: int
    nickname: str
    vector: np.ndarray
    evidence_key: str
    preprocessing: str
    speech_ratio: float


FIELDS = [
    "label",
    "subject_id_a",
    "subject_id_b",
    "split",
    "suggested_label",
    "source",
    "embedding_id_a",
    "embedding_id_b",
    "steamid_a",
    "steamid_b",
    "demo_id_a",
    "demo_id_b",
    "nickname_a",
    "nickname_b",
    "preprocessing_a",
    "preprocessing_b",
    "speech_ratio_a",
    "speech_ratio_b",
    "score",
    "notes",
]


def _load(db_path: Path) -> list[Row]:
    if not db_path.exists():
        raise FileNotFoundError(db_path)
    conn = sqlite3.connect(f"file:{db_path.resolve()}?mode=ro", uri=True)
    try:
        demo_columns = {
            item[1] for item in conn.execute("PRAGMA table_info(demos)").fetchall()
        }
        embedding_columns = {
            item[1] for item in conn.execute("PRAGMA table_info(embeddings)").fetchall()
        }
        evidence_expr = (
            "COALESCE(d.fingerprint, d.path, CAST(e.demo_id AS TEXT))"
            if "fingerprint" in demo_columns
            else "COALESCE(d.path, CAST(e.demo_id AS TEXT))"
        )
        preprocessing_expr = (
            "COALESCE(e.preprocessing, 'none')"
            if "preprocessing" in embedding_columns
            else "'none'"
        )
        speech_ratio_expr = (
            "COALESCE(e.speech_ratio, 1.0)"
            if "speech_ratio" in embedding_columns
            else "1.0"
        )
        rows = conn.execute(
            "SELECT e.id, e.steamid, e.demo_id, COALESCE(p.nickname, ''), "
            f"e.vector, {evidence_expr}, {preprocessing_expr}, {speech_ratio_expr} "
            "FROM embeddings e LEFT JOIN players p ON p.steamid = e.steamid "
            "LEFT JOIN demos d ON d.id = e.demo_id "
            "ORDER BY e.steamid, e.demo_id, e.id"
        ).fetchall()
    finally:
        conn.close()
    return [
        Row(
            embedding_id=item[0],
            steamid=item[1],
            demo_id=item[2],
            nickname=item[3],
            vector=np.frombuffer(item[4], dtype=np.float32).copy(),
            evidence_key=item[5],
            preprocessing=item[6],
            speech_ratio=float(item[7]),
        )
        for item in rows
    ]


def _score(a: Row, b: Row) -> float:
    denom = float(np.linalg.norm(a.vector) * np.linalg.norm(b.vector)) + 1e-8
    return float(np.dot(a.vector, b.vector) / denom)


def _manifest_row(
    a: Row,
    b: Row,
    suggested: str,
    source: str,
    assume_account_labels: bool,
) -> dict:
    return {
        "label": suggested if assume_account_labels else "review",
        "subject_id_a": "",
        "subject_id_b": "",
        "split": "unassigned",
        "suggested_label": suggested,
        "source": source,
        "embedding_id_a": a.embedding_id,
        "embedding_id_b": b.embedding_id,
        "steamid_a": a.steamid,
        "steamid_b": b.steamid,
        "demo_id_a": a.demo_id,
        "demo_id_b": b.demo_id,
        "nickname_a": a.nickname,
        "nickname_b": b.nickname,
        "preprocessing_a": a.preprocessing,
        "preprocessing_b": b.preprocessing,
        "speech_ratio_a": f"{a.speech_ratio:.6f}",
        "speech_ratio_b": f"{b.speech_ratio:.6f}",
        "score": f"{_score(a, b):.8f}",
        "notes": "",
    }


def generate(
    db_path: Path,
    output: Path,
    *,
    max_different: int = 500,
    seed: int = 42,
    assume_account_labels: bool = False,
) -> dict:
    embeddings = _load(db_path)
    by_player: dict[str, list[Row]] = {}
    for item in embeddings:
        by_player.setdefault(item.steamid, []).append(item)

    rows: list[dict] = []
    same_candidates = []
    for player_embeddings in by_player.values():
        same_candidates.extend(
            (a, b)
            for a, b in itertools.combinations(player_embeddings, 2)
            if a.evidence_key != b.evidence_key
        )
    for a, b in same_candidates:
        rows.append(
            _manifest_row(
                a, b, "same", "same-account/different-demo", assume_account_labels
            )
        )

    rng = random.Random(seed)
    player_pairs = list(itertools.combinations(sorted(by_player), 2))
    rng.shuffle(player_pairs)
    for steamid_a, steamid_b in player_pairs[: max(0, max_different)]:
        a = rng.choice(by_player[steamid_a])
        b = rng.choice(by_player[steamid_b])
        rows.append(
            _manifest_row(a, b, "different", "different-account", assume_account_labels)
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    return {
        "embeddings": len(embeddings),
        "players": len(by_player),
        "same_candidates": len(same_candidates),
        "different_candidates": min(len(player_pairs), max(0, max_different)),
        "output": str(output),
        "auto_labeled": assume_account_labels,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True, help="path to voiceprints.db")
    parser.add_argument(
        "--output", type=Path, required=True, help="output CSV manifest"
    )
    parser.add_argument("--max-different", type=int, default=500)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--assume-account-labels",
        action="store_true",
        help="label same SteamID as same and different SteamIDs as different without review",
    )
    args = parser.parse_args()
    result = generate(
        args.db,
        args.output,
        max_different=args.max_different,
        seed=args.seed,
        assume_account_labels=args.assume_account_labels,
    )
    print(
        f"wrote {result['same_candidates']} same-account and "
        f"{result['different_candidates']} cross-account candidates to "
        f"{result['output']}"
    )
    if not result["auto_labeled"]:
        print(
            "labels are 'review'; change each reviewed row to 'same' or 'different' before tuning"
        )


if __name__ == "__main__":
    main()
