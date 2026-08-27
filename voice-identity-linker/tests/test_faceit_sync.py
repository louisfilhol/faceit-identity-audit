# SPDX-License-Identifier: AGPL-3.0-only
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from core import faceit_sync


class AutoSyncVoiceVerificationTests(unittest.TestCase):
    def test_raw_candidate_is_inconclusive_until_verifier_says_same(self):
        linking = SimpleNamespace(
            find_matches_for_player=Mock(
                return_value=[
                    SimpleNamespace(
                        steamid="candidate", nickname="Candidate", score=0.91
                    )
                ]
            ),
            is_same_person=Mock(
                return_value=SimpleNamespace(
                    verdict="inconclusive",
                    score=0.84,
                    evidence_quality="low",
                    reasons=["need at least 2 distinct demos for each player"],
                )
            ),
        )

        result = faceit_sync._voice_matches(
            7,
            [{"steamid": "fresh", "nickname": "Fresh", "status": "embedded"}],
            linking,
            0.5,
        )

        hit = result[0]["matches"][0]
        self.assertEqual(hit["verdict"], "inconclusive")
        self.assertEqual(hit["score"], 0.84)
        self.assertEqual(hit["candidate_score"], 0.91)
        linking.is_same_person.assert_called_once_with(
            "fresh", "candidate", threshold=0.5
        )

    def test_verified_same_candidate_is_marked_same(self):
        linking = SimpleNamespace(
            find_matches_for_player=Mock(
                return_value=[
                    SimpleNamespace(steamid="candidate", nickname=None, score=0.91)
                ]
            ),
            is_same_person=Mock(
                return_value=SimpleNamespace(
                    verdict="same",
                    score=0.88,
                    evidence_quality="medium",
                    reasons=[
                        "repeated demo-pair scores agree outside the uncertainty band"
                    ],
                )
            ),
        )

        result = faceit_sync._voice_matches(
            7,
            [{"steamid": "fresh", "status": "embedded"}],
            linking,
            0.5,
        )

        self.assertEqual(result[0]["matches"][0]["verdict"], "same")


if __name__ == "__main__":
    unittest.main()
