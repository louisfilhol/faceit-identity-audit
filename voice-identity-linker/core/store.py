# SPDX-License-Identifier: AGPL-3.0-only
"""SQLite-backed store for demos, players, and voiceprint embeddings.

Embeddings are stored as raw float32 BLOBs (192 * 4 = 768 bytes each) and
decoded back to numpy on read. For <10k embeddings, in-memory numpy cosine
search is fast enough that we don't need FAISS/sqlite-vec — and it keeps the
install light (important given disk constraints).

A single in-memory index of all embeddings is built lazily so the linking
queries run without re-decoding every row.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

import config
import numpy as np

from core.models import Demo, Embedding, Player

log = logging.getLogger(__name__)

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None
_index_cache: dict[str, np.ndarray] | None = None  # steamid -> mean vec


SCHEMA = """
CREATE TABLE IF NOT EXISTS demos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source          TEXT NOT NULL,
    path            TEXT NOT NULL,
    fingerprint     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS players (
    steamid   TEXT PRIMARY KEY,
    nickname  TEXT,
    consent   INTEGER NOT NULL DEFAULT 0,
    notes     TEXT,
    first_seen TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS embeddings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    steamid    TEXT NOT NULL,
    demo_id    INTEGER NOT NULL,
    vector     BLOB NOT NULL,
    clip_count INTEGER NOT NULL DEFAULT 1,
    audio_sec  REAL NOT NULL DEFAULT 0,
    preprocessing TEXT NOT NULL DEFAULT 'none',
    raw_audio_sec REAL NOT NULL DEFAULT 0,
    speech_ratio REAL NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (demo_id) REFERENCES demos(id),
    FOREIGN KEY (steamid) REFERENCES players(steamid)
);
CREATE TABLE IF NOT EXISTS consent_log (
    steamid    TEXT NOT NULL,
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    basis      TEXT,
    note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_emb_steamid ON embeddings(steamid);
CREATE INDEX IF NOT EXISTS idx_emb_demo ON embeddings(demo_id);
"""

_EMBEDDING_MIGRATIONS = {
    "preprocessing": "TEXT NOT NULL DEFAULT 'none'",
    "raw_audio_sec": "REAL NOT NULL DEFAULT 0",
    "speech_ratio": "REAL NOT NULL DEFAULT 1",
}


def _migrate_schema(c: sqlite3.Connection) -> None:
    """Add metadata columns to databases created by older releases."""
    demo_columns = {row[1] for row in c.execute("PRAGMA table_info(demos)").fetchall()}
    if "fingerprint" not in demo_columns:
        c.execute("ALTER TABLE demos ADD COLUMN fingerprint TEXT")
    c.execute("CREATE INDEX IF NOT EXISTS idx_demo_fingerprint ON demos(fingerprint)")
    columns = {row[1] for row in c.execute("PRAGMA table_info(embeddings)").fetchall()}
    for name, declaration in _EMBEDDING_MIGRATIONS.items():
        if name not in columns:
            c.execute(f"ALTER TABLE embeddings ADD COLUMN {name} {declaration}")


def get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    with _lock:
        if _conn is None:
            config.ensure_dirs()
            c = sqlite3.connect(str(config.DB_PATH), check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.executescript(SCHEMA)
            _migrate_schema(c)
            c.commit()
            _conn = c
    return _conn


def _invalidate_index() -> None:
    global _index_cache
    _index_cache = None


# --- Demos ------------------------------------------------------------------


def add_demo(source: str, path: str, fingerprint: str | None = None) -> int:
    c = get_conn()
    if fingerprint:
        existing = c.execute(
            "SELECT id, path FROM demos WHERE fingerprint = ? ORDER BY id LIMIT 1",
            (fingerprint,),
        ).fetchone()
        if existing:
            # Retention may have removed an older generated/raw path. Point the
            # canonical DB record at the live copy without creating duplicate
            # evidence rows for the same raw demo fingerprint.
            if not Path(existing["path"]).exists() and Path(path).exists():
                c.execute(
                    "UPDATE demos SET source = ?, path = ? WHERE id = ?",
                    (source, str(path), existing["id"]),
                )
                c.commit()
            return int(existing["id"])
    existing = c.execute(
        "SELECT id, fingerprint FROM demos WHERE path = ? ORDER BY id LIMIT 1",
        (str(path),),
    ).fetchone()
    if existing:
        if fingerprint and not existing["fingerprint"]:
            c.execute(
                "UPDATE demos SET fingerprint = ? WHERE id = ?",
                (fingerprint, existing["id"]),
            )
            c.commit()
        return int(existing["id"])
    cur = c.execute(
        "INSERT INTO demos (source, path, fingerprint) VALUES (?, ?, ?)",
        (source, str(path), fingerprint),
    )
    c.commit()
    return int(cur.lastrowid)


def get_demo(demo_id: int) -> Demo | None:
    row = get_conn().execute("SELECT * FROM demos WHERE id = ?", (demo_id,)).fetchone()
    if not row:
        return None
    return Demo(
        id=row["id"],
        source=row["source"],
        path=row["path"],
        created_at=datetime.fromisoformat(row["created_at"]),
        fingerprint=row["fingerprint"],
    )


def demo_evidence_key(demo_id: int) -> str:
    """Stable key used to avoid counting duplicate demo evidence twice."""
    row = (
        get_conn()
        .execute("SELECT fingerprint, path FROM demos WHERE id = ?", (demo_id,))
        .fetchone()
    )
    if not row:
        return f"missing:{demo_id}"
    return row["fingerprint"] or row["path"] or f"demo:{demo_id}"


def delete_empty_demos_for_path(path: str) -> int:
    """Remove failed-ingest records only when they own no embedding evidence."""
    c = get_conn()
    cursor = c.execute(
        "DELETE FROM demos WHERE path = ? AND NOT EXISTS "
        "(SELECT 1 FROM embeddings WHERE embeddings.demo_id = demos.id)",
        (str(path),),
    )
    c.commit()
    return cursor.rowcount


def update_demo_path(demo_id: int, source: str, path: str) -> None:
    """Move a demo record to the preferred live/canonical retained artifact."""
    c = get_conn()
    c.execute(
        "UPDATE demos SET source = ?, path = ? WHERE id = ?",
        (source, str(path), demo_id),
    )
    c.commit()


# --- Players ----------------------------------------------------------------


def upsert_player(
    steamid: str,
    nickname: str | None = None,
    consent: bool | None = None,
    notes: str | None = None,
) -> None:
    c = get_conn()
    # Preserve existing fields when not provided.
    existing = c.execute(
        "SELECT nickname, consent, notes FROM players WHERE steamid = ?",
        (steamid,),
    ).fetchone()
    if existing:
        nick = nickname if nickname is not None else existing["nickname"]
        cons = int(consent) if consent is not None else existing["consent"]
        nt = notes if notes is not None else existing["notes"]
        c.execute(
            "UPDATE players SET nickname=?, consent=?, notes=? WHERE steamid=?",
            (nick, cons, nt, steamid),
        )
    else:
        c.execute(
            "INSERT INTO players (steamid, nickname, consent, notes) "
            "VALUES (?, ?, ?, ?)",
            (
                steamid,
                nickname,
                int(consent) if consent is not None else 0,
                notes,
            ),
        )
    c.commit()


def set_consent(steamid: str, granted: bool, basis: str = "", note: str = "") -> None:
    upsert_player(steamid, consent=granted)
    if granted:
        get_conn().execute(
            "INSERT INTO consent_log (steamid, basis, note) VALUES (?, ?, ?)",
            (steamid, basis, note),
        )
        get_conn().commit()
    _invalidate_index()


def get_player(steamid: str) -> Player | None:
    row = (
        get_conn()
        .execute("SELECT * FROM players WHERE steamid = ?", (steamid,))
        .fetchone()
    )
    if not row:
        return None
    return Player(
        steamid=row["steamid"],
        nickname=row["nickname"],
        consent=bool(row["consent"]),
        notes=row["notes"],
    )


def all_players() -> list[Player]:
    rows = get_conn().execute("SELECT * FROM players ORDER BY nickname").fetchall()
    return [
        Player(
            steamid=r["steamid"],
            nickname=r["nickname"],
            consent=bool(r["consent"]),
            notes=r["notes"],
        )
        for r in rows
    ]


# --- Embeddings -------------------------------------------------------------


def add_embedding(
    steamid: str,
    demo_id: int,
    vector: np.ndarray,
    clip_count: int = 1,
    audio_sec: float = 0.0,
    preprocessing: str = "none",
    raw_audio_sec: float = 0.0,
    speech_ratio: float = 1.0,
) -> int:
    blob = vector.astype(np.float32).tobytes()
    c = get_conn()
    cur = c.execute(
        "INSERT INTO embeddings "
        "(steamid, demo_id, vector, clip_count, audio_sec, preprocessing, "
        "raw_audio_sec, speech_ratio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            steamid,
            demo_id,
            blob,
            clip_count,
            audio_sec,
            preprocessing,
            raw_audio_sec,
            speech_ratio,
        ),
    )
    c.commit()
    _invalidate_index()
    return int(cur.lastrowid)


def _row_to_emb(row: sqlite3.Row) -> Embedding:
    vec = np.frombuffer(row["vector"], dtype=np.float32).copy()
    return Embedding(
        id=row["id"],
        steamid=row["steamid"],
        demo_id=row["demo_id"],
        vector=vec,
        clip_count=row["clip_count"],
        audio_sec=row["audio_sec"],
        created_at=datetime.fromisoformat(row["created_at"]),
        preprocessing=row["preprocessing"],
        raw_audio_sec=row["raw_audio_sec"],
        speech_ratio=row["speech_ratio"],
    )


def embeddings_for(steamid: str) -> list[Embedding]:
    rows = (
        get_conn()
        .execute(
            "SELECT * FROM embeddings WHERE steamid = ? ORDER BY created_at",
            (steamid,),
        )
        .fetchall()
    )
    return [_row_to_emb(r) for r in rows]


def embeddings_for_demo(demo_id: int) -> list[Embedding]:
    rows = (
        get_conn()
        .execute("SELECT * FROM embeddings WHERE demo_id = ?", (demo_id,))
        .fetchall()
    )
    return [_row_to_emb(r) for r in rows]


def all_embeddings() -> list[Embedding]:
    rows = get_conn().execute("SELECT * FROM embeddings ORDER BY created_at").fetchall()
    return [_row_to_emb(r) for r in rows]


# --- In-memory index --------------------------------------------------------


def _build_index() -> dict[str, np.ndarray]:
    """Return {steamid: duration-weighted mean embedding}."""
    global _index_cache
    if _index_cache is not None:
        return _index_cache
    sums: dict[str, np.ndarray] = {}
    weights: dict[str, float] = {}
    for emb in all_embeddings():
        weight = max(emb.audio_sec, 0.001)
        if emb.steamid in sums:
            sums[emb.steamid] += emb.vector * weight
            weights[emb.steamid] += weight
        else:
            sums[emb.steamid] = emb.vector.copy() * weight
            weights[emb.steamid] = weight
    _index_cache = {sid: sums[sid] / weights[sid] for sid in sums}
    return _index_cache


def mean_vector(steamid: str) -> np.ndarray | None:
    return _build_index().get(steamid)


def reset_index() -> None:
    _invalidate_index()
