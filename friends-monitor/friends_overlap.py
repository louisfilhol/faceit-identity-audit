# SPDX-License-Identifier: AGPL-3.0-only
"""Common-friend queries over the local snapshot store."""

from __future__ import annotations

import sqlite3
from itertools import combinations

import faceit_friends as fm


def current_common_friends(
    conn: sqlite3.Connection, account_id_a: str, account_id_b: str
) -> list[dict]:
    """Friends present in both accounts' current snapshots."""
    rows = conn.execute(
        """
        SELECT sa.friend_id,
               COALESCE(NULLIF(sa.nickname, ''), NULLIF(sb.nickname, '')) AS nickname,
               sa.first_seen,
               sb.first_seen
          FROM snapshot AS sa
          JOIN snapshot AS sb ON sb.friend_id = sa.friend_id
         WHERE sa.account_id = ? AND sb.account_id = ?
         ORDER BY nickname, sa.friend_id
        """,
        (account_id_a, account_id_b),
    ).fetchall()
    return [
        {
            "friend_id": row[0],
            "nickname": row[1],
            "first_seen_a": row[2],
            "first_seen_b": row[3],
        }
        for row in rows
    ]


def account_overviews(conn: sqlite3.Connection) -> list[dict]:
    """Seeded accounts with their current friend counts, oldest seed first."""
    rows = conn.execute(
        """
        SELECT st.account_id, st.seeded_at, COUNT(s.friend_id)
          FROM account_state AS st
          LEFT JOIN snapshot AS s ON s.account_id = st.account_id
         GROUP BY st.account_id, st.seeded_at
         ORDER BY st.seeded_at, st.account_id
        """
    ).fetchall()
    return [
        {"guid": row[0], "seeded_at": row[1], "friend_count": row[2]} for row in rows
    ]


def overlap_pairs(conn: sqlite3.Connection, accounts: list[dict]) -> list[dict]:
    """Current-overlap summary for every pair of the given accounts."""
    pairs = []
    for a, b in combinations(accounts, 2):
        common = current_common_friends(conn, a["guid"], b["guid"])
        union = a["friend_count"] + b["friend_count"] - len(common)
        pairs.append(
            {
                "guid_a": a["guid"],
                "guid_b": b["guid"],
                "friend_count_a": a["friend_count"],
                "friend_count_b": b["friend_count"],
                "common": len(common),
                "jaccard": (len(common) / union) if union else 0.0,
            }
        )
    return sorted(pairs, key=lambda p: (-p["common"], -p["jaccard"], p["guid_a"]))


def _seed_member_ids(
    conn: sqlite3.Connection,
    account_id: str,
    seeded_at: str,
    events: list[tuple[str, str, str]],
) -> set[str]:
    """Rebuild the account's friend ids at seed time."""
    seed = {
        friend_id
        for friend_id, first_seen in conn.execute(
            "SELECT friend_id, first_seen FROM snapshot WHERE account_id = ?",
            (account_id,),
        )
        if first_seen <= seeded_at
    }
    seen_adds: set[str] = set()
    for _ts, kind, friend_id in events:
        if kind == "added":
            seen_adds.add(friend_id)
        elif friend_id not in seen_adds:
            seed.add(friend_id)
    return seed


def _reconstruct_membership(
    conn: sqlite3.Connection, account_id: str
) -> tuple[str, set[str], list[tuple[str, str, str]]] | None:
    """Return the current seed and the events recorded after it."""
    seeded_at = fm.get_seeded_at(conn, account_id)
    if not seeded_at:
        return None
    events = conn.execute(
        "SELECT ts, kind, friend_id FROM event "
        "WHERE account_id = ? AND friend_id IS NOT NULL AND ts >= ? "
        "ORDER BY ts, rowid",
        (account_id, seeded_at),
    ).fetchall()
    return seeded_at, _seed_member_ids(conn, account_id, seeded_at, events), events


def overlap_timeline(
    conn: sqlite3.Connection, account_id_a: str, account_id_b: str
) -> list[dict]:
    """Return the shared-friend count after each recorded change."""
    history_a = _reconstruct_membership(conn, account_id_a)
    history_b = _reconstruct_membership(conn, account_id_b)
    if history_a is None or history_b is None:
        return []

    stream: list[tuple[str, int, str, str, str | set[str]]] = []
    for account_id, (seeded_at, seed, events) in (
        (account_id_a, history_a),
        (account_id_b, history_b),
    ):
        stream.append((seeded_at, 0, account_id, "seed", seed))
        stream.extend(
            (ts, 1, account_id, kind, friend_id) for ts, kind, friend_id in events
        )
    stream.sort(key=lambda item: item[:2])

    states: dict[str, set[str] | None] = {
        account_id_a: None,
        account_id_b: None,
    }
    points: dict[str, int] = {}
    for ts, _rank, account_id, kind, payload in stream:
        if kind == "seed":
            states[account_id] = set(payload)
        elif states[account_id] is None:
            continue
        elif kind == "added":
            states[account_id].add(payload)
        else:
            states[account_id].discard(payload)
        if all(state is not None for state in states.values()):
            points[ts] = len(states[account_id_a] & states[account_id_b])

    now = fm._now_iso()
    points.pop(now, None)
    points[now] = len(current_common_friends(conn, account_id_a, account_id_b))
    return [{"ts": ts, "overlap": overlap} for ts, overlap in sorted(points.items())]
