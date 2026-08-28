# SPDX-License-Identifier: AGPL-3.0-only
from __future__ import annotations

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
import friends_overlap as fo  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from web.routers import friends as friends_router  # noqa: E402

ACCOUNT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
ACCOUNT_B = "bbbbbbbb-bbbbb-bbbb-bbbb-bbbbbbbbbbbb"
T1 = "2026-08-01T10:00:00+00:00"
T2 = "2026-08-01T10:05:00+00:00"
T3 = "2026-08-01T10:10:00+00:00"
T4 = "2026-08-01T10:15:00+00:00"
T5 = "2026-08-01T10:20:00+00:00"
NOW = "2026-08-01T11:00:00+00:00"


def friend(fid: str, nickname: str | None = None) -> dict:
    return {"id": fid, "nickname": nickname}


class OverlapTestCase(unittest.TestCase):
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

    def run_account(
        self, guid: str, label: str, friends: list[dict], timestamp: str
    ) -> None:
        with (
            patch.object(fm, "fetch_all_friends", return_value=friends),
            patch.object(fm, "_now_iso", return_value=timestamp),
            patch.object(fm, "send_discord", return_value=True),
        ):
            fm.process_account(
                self.conn, {"guid": guid, "label": label}, "", "", alert_on_seed=False
            )
        # The endpoint and timeline helpers may read through a second
        # connection; uncommitted state must not leak into those reads.
        self.conn.commit()

    def timeline(self, guid_a: str = ACCOUNT_A, guid_b: str = ACCOUNT_B) -> list[dict]:
        with patch.object(fm, "_now_iso", return_value=NOW):
            return fo.overlap_timeline(self.conn, guid_a, guid_b)


class CurrentOverlapTests(OverlapTestCase):
    def test_common_friends_join_with_nickname_fallback(self) -> None:
        self.run_account(
            ACCOUNT_A, "alpha", [friend("f-x", "Xena"), friend("f-y", "Yuri")], T1
        )
        self.run_account(ACCOUNT_B, "bravo", [friend("f-x"), friend("f-z", "Zoe")], T2)

        common = fo.current_common_friends(self.conn, ACCOUNT_A, ACCOUNT_B)
        self.assertEqual(
            common,
            [
                {
                    "friend_id": "f-x",
                    "nickname": "Xena",
                    "first_seen_a": T1,
                    "first_seen_b": T2,
                }
            ],
        )

    def test_account_overviews_counts_seeded_accounts(self) -> None:
        self.run_account(ACCOUNT_A, "alpha", [friend("f-x"), friend("f-y")], T1)
        self.run_account(ACCOUNT_B, "bravo", [friend("f-x")], T2)

        accounts = fo.account_overviews(self.conn)
        self.assertEqual(
            accounts,
            [
                {"guid": ACCOUNT_A, "seeded_at": T1, "friend_count": 2},
                {"guid": ACCOUNT_B, "seeded_at": T2, "friend_count": 1},
            ],
        )

        pairs = fo.overlap_pairs(self.conn, accounts)
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0]["common"], 1)
        self.assertEqual(pairs[0]["jaccard"], 1 / 2)


class SeedInferenceTests(OverlapTestCase):
    def test_removal_without_prior_add_implies_seed_member(self) -> None:
        # Seed with x and y, then remove x. History must still show x as a
        # member between the seed and the removal.
        self.run_account(ACCOUNT_A, "alpha", [friend("f-x"), friend("f-y")], T1)
        self.run_account(ACCOUNT_B, "bravo", [friend("f-x")], T2)
        self.run_account(ACCOUNT_A, "alpha", [friend("f-y")], T3)

        timeline = self.timeline()
        self.assertEqual(
            [(point["ts"], point["overlap"]) for point in timeline],
            [(T2, 1), (T3, 0), (NOW, 0)],
        )

    def test_removal_after_post_seed_add_is_not_seed_membership(self) -> None:
        # x arrives and leaves after the seed. If the removal were mistaken
        # for seed membership, the overlap at T2 would already include x.
        self.run_account(ACCOUNT_A, "alpha", [friend("f-y")], T1)
        self.run_account(ACCOUNT_B, "bravo", [friend("f-x"), friend("f-y")], T2)
        self.run_account(ACCOUNT_A, "alpha", [friend("f-y"), friend("f-x")], T3)
        self.run_account(ACCOUNT_A, "alpha", [friend("f-y")], T4)

        timeline = self.timeline()
        self.assertEqual(
            [(point["ts"], point["overlap"]) for point in timeline],
            [(T2, 1), (T3, 2), (T4, 1), (NOW, 1)],
        )

    def test_seed_member_removed_then_readded_is_recognized(self) -> None:
        # x is a seed member, removed, then re-added. The re-add must not
        # hide that x was already a member at seed time.
        self.run_account(ACCOUNT_A, "alpha", [friend("f-x"), friend("f-y")], T1)
        self.run_account(ACCOUNT_B, "bravo", [friend("f-x")], T2)
        self.run_account(ACCOUNT_A, "alpha", [friend("f-y")], T3)
        self.run_account(ACCOUNT_A, "alpha", [friend("f-y"), friend("f-x")], T4)

        timeline = self.timeline()
        self.assertEqual(
            [(point["ts"], point["overlap"]) for point in timeline],
            [(T2, 1), (T3, 0), (T4, 1), (NOW, 1)],
        )


class TimelineTests(OverlapTestCase):
    def test_overlap_timeline_tracks_shared_friends(self) -> None:
        self.run_account(
            ACCOUNT_A, "alpha", [friend("f-x", "X"), friend("f-y", "Y")], T1
        )
        self.run_account(ACCOUNT_B, "bravo", [friend("f-x")], T2)
        # A grows but the overlap is unchanged.
        self.run_account(
            ACCOUNT_A, "alpha", [friend("f-x"), friend("f-y"), friend("f-z")], T3
        )
        # B picks up y: overlap doubles.
        self.run_account(ACCOUNT_B, "bravo", [friend("f-x"), friend("f-y")], T4)
        # A drops x: overlap back to one.
        self.run_account(ACCOUNT_A, "alpha", [friend("f-y"), friend("f-z")], T5)

        timeline = self.timeline()
        self.assertEqual(
            [(point["ts"], point["overlap"]) for point in timeline],
            [(T2, 1), (T3, 1), (T4, 2), (T5, 1), (NOW, 1)],
        )

    def test_same_second_transitions_collapse_to_final_value(self) -> None:
        self.run_account(ACCOUNT_A, "alpha", [friend("f-x")], T1)
        self.run_account(ACCOUNT_B, "bravo", [], T2)
        # Both accounts change in the same second: one point, final state.
        self.run_account(ACCOUNT_A, "alpha", [friend("f-x"), friend("f-y")], T3)
        self.run_account(ACCOUNT_B, "bravo", [friend("f-x"), friend("f-y")], T3)

        timeline = self.timeline()
        self.assertEqual(
            [(point["ts"], point["overlap"]) for point in timeline],
            [(T2, 0), (T3, 2), (NOW, 2)],
        )

    def reseed(self, seeded: dict[str, list[dict]], timestamp: str) -> None:
        """Simulate --reseed: wipe state, then re-seed every account."""
        self.conn.execute("DELETE FROM snapshot")
        self.conn.execute("DELETE FROM account_state")
        self.conn.commit()
        for guid, friends in seeded.items():
            self.run_account(guid, guid[:5], friends, timestamp)

    def test_stale_add_before_reseed_does_not_create_phantom_member(self) -> None:
        # z is added after the seed, then a --reseed wipes the snapshots and
        # the next check re-seeds without z. The stale add event predates the
        # new seed era and must not resurrect z as a member.
        self.run_account(ACCOUNT_A, "alpha", [friend("f-x"), friend("f-y")], T1)
        self.run_account(
            ACCOUNT_A, "alpha", [friend("f-x"), friend("f-y"), friend("f-z")], T2
        )
        self.run_account(ACCOUNT_B, "bravo", [friend("f-y")], T1)
        self.reseed({ACCOUNT_A: [friend("f-y")], ACCOUNT_B: [friend("f-y")]}, T3)

        timeline = self.timeline()
        self.assertEqual(
            [(point["ts"], point["overlap"]) for point in timeline],
            [(T3, 1), (NOW, 1)],
        )

    def test_stale_removal_before_reseed_does_not_resurrect_member(self) -> None:
        # x is a seed member removed before a --reseed. If the stale removal
        # were read as seed membership of the new era, x would reappear.
        self.run_account(ACCOUNT_A, "alpha", [friend("f-x"), friend("f-y")], T1)
        self.run_account(ACCOUNT_A, "alpha", [friend("f-y")], T2)
        self.run_account(ACCOUNT_B, "bravo", [friend("f-x"), friend("f-y")], T1)
        self.reseed(
            {ACCOUNT_A: [friend("f-y")], ACCOUNT_B: [friend("f-x"), friend("f-y")]}, T3
        )

        timeline = self.timeline()
        self.assertEqual(
            [(point["ts"], point["overlap"]) for point in timeline],
            [(T3, 1), (NOW, 1)],
        )

    def test_unseeded_account_yields_no_timeline(self) -> None:
        self.run_account(ACCOUNT_A, "alpha", [friend("f-x")], T1)
        self.assertEqual(self.timeline(), [])


class OverlapEndpointTests(OverlapTestCase):
    def setUp(self) -> None:
        super().setUp()
        config = {
            "accounts": [
                {"guid": ACCOUNT_A, "label": "alpha"},
                {"guid": ACCOUNT_B, "label": "bravo"},
            ]
        }
        self.config_patch = patch.object(
            friends_router, "_read_config", return_value=config
        )
        self.config_patch.start()

    def tearDown(self) -> None:
        self.config_patch.stop()
        super().tearDown()

    def test_summary_includes_labels_and_sorted_pairs(self) -> None:
        self.run_account(ACCOUNT_A, "alpha", [friend("f-x"), friend("f-y")], T1)
        self.run_account(ACCOUNT_B, "bravo", [friend("f-x")], T2)

        payload = friends_router.overlap()
        self.assertEqual(
            payload["accounts"],
            [
                {
                    "guid": ACCOUNT_A,
                    "label": "alpha",
                    "seeded_at": T1,
                    "friend_count": 2,
                },
                {
                    "guid": ACCOUNT_B,
                    "label": "bravo",
                    "seeded_at": T2,
                    "friend_count": 1,
                },
            ],
        )
        self.assertEqual(len(payload["pairs"]), 1)
        self.assertEqual(payload["pairs"][0]["common"], 1)
        self.assertEqual(payload["pairs"][0]["label_a"], "alpha")
        self.assertEqual(payload["pairs"][0]["label_b"], "bravo")

    def test_summary_without_database_is_empty(self) -> None:
        missing = Path(self.temp_dir.name) / "absent.db"
        with patch.object(fm, "DB_PATH", missing):
            self.assertFalse(fm.DB_PATH.exists())
            self.assertEqual(friends_router.overlap(), {"accounts": [], "pairs": []})

    def test_detail_requires_two_different_seeded_accounts(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            friends_router.overlap_detail(ACCOUNT_A, ACCOUNT_A)
        self.assertEqual(raised.exception.status_code, 400)

        with self.assertRaises(HTTPException) as raised:
            friends_router.overlap_detail(ACCOUNT_A, ACCOUNT_B)
        self.assertEqual(raised.exception.status_code, 404)

    def test_detail_returns_common_friends_and_timeline(self) -> None:
        self.run_account(ACCOUNT_A, "alpha", [friend("f-x", "Xena"), friend("f-y")], T1)
        self.run_account(ACCOUNT_B, "bravo", [friend("f-x")], T2)

        with patch.object(fm, "_now_iso", return_value=NOW):
            payload = friends_router.overlap_detail(ACCOUNT_A, ACCOUNT_B)

        self.assertEqual(payload["a"]["label"], "alpha")
        self.assertEqual(payload["b"]["friend_count"], 1)
        self.assertEqual(payload["common_count"], 1)
        self.assertEqual(payload["common_friends"][0]["nickname"], "Xena")
        self.assertEqual(
            [(point["ts"], point["overlap"]) for point in payload["timeline"]],
            [(T2, 1), (NOW, 1)],
        )
        self.assertEqual(payload["generated_at"], NOW)


if __name__ == "__main__":
    unittest.main()
