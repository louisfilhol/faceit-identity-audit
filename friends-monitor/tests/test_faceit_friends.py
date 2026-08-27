# SPDX-License-Identifier: AGPL-3.0-only
from __future__ import annotations

import logging
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[2]
FRIENDS_DIR = REPO_ROOT / "friends-monitor"
sys.path.insert(0, str(FRIENDS_DIR))
sys.path.insert(0, str(REPO_ROOT))

import faceit_friends as fm  # noqa: E402

from web.routers import friends as friends_router  # noqa: E402

logging.disable(logging.CRITICAL)


ACCOUNT_ID = "11111111-1111-1111-1111-111111111111"
T1 = "2026-08-01T10:00:00+00:00"
T2 = "2026-08-01T10:05:00+00:00"
T3 = "2026-08-01T10:10:00+00:00"


class FriendsMonitorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "faceit.db"
        self.db_patch = patch.object(fm, "DB_PATH", self.db_path)
        self.db_patch.start()
        self.conn = fm.db_connect()

    def tearDown(self) -> None:
        self.conn.close()
        self.db_patch.stop()
        self.temp_dir.cleanup()

    def run_check(self, friends: list[dict], timestamp: str) -> tuple[int, int]:
        with (
            patch.object(fm, "fetch_all_friends", return_value=friends),
            patch.object(fm, "_now_iso", return_value=timestamp),
            patch.object(fm, "send_discord", return_value=True),
        ):
            return fm.process_account(
                self.conn,
                {"guid": ACCOUNT_ID, "label": "test"},
                "",
                "",
                alert_on_seed=False,
            )

    def test_seed_is_not_an_event_and_first_seen_survives_refreshes(self) -> None:
        first = [
            {"id": "friend-a", "nickname": "Alpha"},
            {"id": "friend-b", "nickname": "Bravo"},
        ]
        self.assertEqual(self.run_check(first, T1), (0, 0))
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM event").fetchone()[0], 0
        )
        self.assertEqual(fm.get_seeded_at(self.conn, ACCOUNT_ID), T1)

        second = [
            {"id": "friend-a", "nickname": "Alpha renamed"},
            {"id": "friend-c", "nickname": "Charlie"},
        ]
        self.assertEqual(self.run_check(second, T2), (1, 1))

        rows = self.conn.execute(
            "SELECT friend_id, nickname, first_seen, last_seen FROM snapshot "
            "WHERE account_id = ? ORDER BY friend_id",
            (ACCOUNT_ID,),
        ).fetchall()
        self.assertEqual(
            rows,
            [
                ("friend-a", "Alpha renamed", T1, T2),
                ("friend-c", "Charlie", T2, T2),
            ],
        )
        self.assertEqual(
            self.conn.execute(
                "SELECT kind, friend_id FROM event ORDER BY kind, friend_id"
            ).fetchall(),
            [("added", "friend-c"), ("removed", "friend-b")],
        )

        self.assertEqual(self.run_check(second, T3), (0, 0))
        timestamps = self.conn.execute(
            "SELECT friend_id, first_seen, last_seen FROM snapshot "
            "WHERE account_id = ? ORDER BY friend_id",
            (ACCOUNT_ID,),
        ).fetchall()
        self.assertEqual(
            timestamps,
            [("friend-a", T1, T3), ("friend-c", T2, T3)],
        )
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM event").fetchone()[0], 2
        )

    def test_empty_seed_is_distinct_from_never_checked(self) -> None:
        self.assertEqual(self.run_check([], T1), (0, 0))
        self.assertEqual(fm.get_seeded_at(self.conn, ACCOUNT_ID), T1)

        self.assertEqual(
            self.run_check([{"id": "friend-a", "nickname": "Alpha"}], T2),
            (1, 0),
        )
        self.assertEqual(
            self.conn.execute("SELECT kind, friend_id FROM event").fetchall(),
            [("added", "friend-a")],
        )

    def test_fetch_failure_propagates_without_seeding(self) -> None:
        with (
            patch.object(
                fm, "fetch_all_friends", side_effect=fm.ApiError(503, "unavailable")
            ),
            patch.object(fm, "send_discord", return_value=True),
            self.assertRaises(fm.ApiError),
        ):
            fm.process_account(
                self.conn,
                {"guid": ACCOUNT_ID, "label": "test"},
                "",
                "",
                alert_on_seed=False,
            )

        self.assertIsNone(fm.get_seeded_at(self.conn, ACCOUNT_ID))
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM snapshot").fetchone()[0], 0
        )


class MigrationTests(unittest.TestCase):
    def test_legacy_snapshot_gets_state_and_recovers_first_seen(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "legacy.db"
            legacy = sqlite3.connect(db_path)
            legacy.executescript(
                """
                CREATE TABLE snapshot (
                    account_id TEXT NOT NULL,
                    friend_id TEXT NOT NULL,
                    nickname TEXT,
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    PRIMARY KEY (account_id, friend_id)
                );
                CREATE TABLE event (
                    ts TEXT NOT NULL,
                    account_id TEXT NOT NULL,
                    account_lbl TEXT,
                    kind TEXT NOT NULL,
                    friend_id TEXT,
                    nickname TEXT
                );
                """
            )
            legacy.execute(
                "INSERT INTO snapshot VALUES (?, ?, ?, ?, ?)",
                (ACCOUNT_ID, "friend-a", "Alpha", T3, T3),
            )
            legacy.execute(
                "INSERT INTO event VALUES (?, ?, ?, ?, ?, ?)",
                (T1, ACCOUNT_ID, "test", "added", "friend-a", "Alpha"),
            )
            # A repeated legacy seed addition is invalid, but a later add for
            # a friend outside the seed set is a real event and must survive.
            legacy.execute(
                "INSERT INTO event VALUES (?, ?, ?, ?, ?, ?)",
                (T2, ACCOUNT_ID, "test", "added", "friend-a", "Alpha"),
            )
            legacy.execute(
                "INSERT INTO event VALUES (?, ?, ?, ?, ?, ?)",
                (T2, ACCOUNT_ID, "test", "added", "friend-b", "Bravo"),
            )
            legacy.commit()
            legacy.close()

            with patch.object(fm, "DB_PATH", db_path):
                conn = fm.db_connect()
                self.assertEqual(fm.get_seeded_at(conn, ACCOUNT_ID), T1)
                self.assertEqual(
                    conn.execute(
                        "SELECT first_seen, last_seen FROM snapshot"
                    ).fetchone(),
                    (T1, T3),
                )
                self.assertEqual(
                    conn.execute(
                        "SELECT kind, friend_id FROM event ORDER BY friend_id"
                    ).fetchall(),
                    [("added", "friend-b")],
                )
                conn.close()

                # Reopening is idempotent and does not rewrite explicit state.
                conn = fm.db_connect()
                self.assertEqual(fm.get_seeded_at(conn, ACCOUNT_ID), T1)
                conn.close()


class WebCheckTests(unittest.TestCase):
    def test_fetch_failure_is_reported_as_failed_account(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "web.db"
            cfg = {
                "discord_webhook": "",
                "discord_ping": "",
                "accounts": [{"guid": ACCOUNT_ID, "label": "test"}],
            }
            with (
                patch.object(fm, "DB_PATH", db_path),
                patch.object(friends_router, "_read_config", return_value=cfg),
                patch.object(
                    fm,
                    "fetch_all_friends",
                    side_effect=fm.ApiError(503, "unavailable"),
                ),
                patch.object(fm, "send_discord", return_value=True),
            ):
                payload = friends_router._perform_check()

        self.assertEqual(len(payload["results"]), 1)
        self.assertFalse(payload["results"][0]["ok"])
        self.assertIn("HTTP 503", payload["results"][0]["error"])
        self.assertNotIn("added", payload["results"][0])


if __name__ == "__main__":
    unittest.main()
