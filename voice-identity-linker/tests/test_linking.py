# SPDX-License-Identifier: AGPL-3.0-only
from __future__ import annotations

import unittest
from datetime import datetime
from unittest.mock import patch

import numpy as np
from core import linking
from core.models import Embedding


def emb(
    embedding_id: int,
    steamid: str,
    demo_id: int,
    vector: list[float],
    preprocessing: str = "silero-vad",
) -> Embedding:
    return Embedding(
        id=embedding_id,
        steamid=steamid,
        demo_id=demo_id,
        vector=np.asarray(vector, dtype=np.float32),
        clip_count=1,
        audio_sec=10.0,
        created_at=datetime.now(),
        preprocessing=preprocessing,
        raw_audio_sec=12.0,
        speech_ratio=0.83,
    )


class VerificationDistributionTests(unittest.TestCase):
    def result(self, a: list[Embedding], b: list[Embedding]):
        def embeddings_for(steamid: str):
            return a if steamid == "a" else b if steamid == "b" else []

        with (
            patch.object(linking.store, "embeddings_for", side_effect=embeddings_for),
            patch.object(
                linking.store,
                "demo_evidence_key",
                side_effect=lambda demo_id: f"demo:{demo_id}",
            ),
            patch.object(linking.config, "MIN_VERIFY_CLIPS", 2),
            patch.object(linking.config, "MIN_VERIFY_DEMOS", 2),
            patch.object(linking.config, "MIN_PAIR_AGREEMENT", 0.75),
            patch.object(linking.config, "VERDICT_MARGIN", 0.05),
        ):
            return linking.is_same_person("a", "b", threshold=0.5)

    def test_single_demo_is_inconclusive_even_with_high_score(self):
        result = self.result(
            [emb(1, "a", 1, [1, 0])],
            [emb(2, "b", 2, [1, 0])],
        )
        self.assertEqual(result.verdict, "inconclusive")
        self.assertIsNone(result.same_speaker)
        self.assertTrue(any("distinct demos" in reason for reason in result.reasons))

    def test_repeated_high_agreement_is_same(self):
        result = self.result(
            [emb(1, "a", 1, [1, 0]), emb(2, "a", 2, [0.99, 0.01])],
            [emb(3, "b", 3, [1, 0]), emb(4, "b", 4, [0.98, 0.02])],
        )
        self.assertEqual(result.verdict, "same")
        self.assertTrue(result.same_speaker)
        self.assertEqual(result.pair_count, 4)
        self.assertEqual(result.window_pair_count, 4)
        self.assertEqual(result.agreement, 1.0)

    def test_long_demo_does_not_dominate_demo_pair_evidence(self):
        result = self.result(
            [
                emb(1, "a", 1, [1, 0]),
                emb(2, "a", 1, [1, 0]),
                emb(3, "a", 1, [1, 0]),
                emb(4, "a", 1, [1, 0]),
                emb(5, "a", 1, [1, 0]),
                emb(6, "a", 2, [0, 1]),
            ],
            [emb(7, "b", 3, [1, 0]), emb(8, "b", 4, [1, 0])],
        )

        # Pooling all 12 window comparisons would produce a same-speaker
        # verdict.  Equal demo-pair weighting produces two high and two low
        # scores, leaving the evidence correctly inconclusive.
        self.assertEqual(result.window_pair_count, 12)
        self.assertEqual(result.pair_count, 4)
        self.assertEqual(sorted(result.pair_scores), [0.0, 0.0, 1.0, 1.0])
        self.assertEqual(result.same_pair_fraction, 0.5)
        self.assertEqual(result.verdict, "inconclusive")

    def test_multiple_windows_from_one_demo_do_not_count_as_repeated_demos(self):
        result = self.result(
            [emb(1, "a", 1, [1, 0]), emb(2, "a", 1, [0.99, 0.01])],
            [emb(3, "b", 2, [1, 0]), emb(4, "b", 2, [0.98, 0.02])],
        )
        self.assertEqual(result.clip_count_a, 2)
        self.assertEqual(result.demo_count_a, 1)
        self.assertEqual(result.verdict, "inconclusive")

    def test_mixed_preprocessing_is_inconclusive(self):
        result = self.result(
            [emb(1, "a", 1, [1, 0]), emb(2, "a", 2, [0.99, 0.01])],
            [
                emb(3, "b", 3, [1, 0], preprocessing="none"),
                emb(4, "b", 4, [0.98, 0.02], preprocessing="silero-vad"),
            ],
        )
        self.assertEqual(result.verdict, "inconclusive")
        self.assertTrue(any("preprocessing" in reason for reason in result.reasons))

    def test_repeated_low_agreement_is_different(self):
        result = self.result(
            [emb(1, "a", 1, [1, 0]), emb(2, "a", 2, [0.99, 0.01])],
            [emb(3, "b", 3, [0, 1]), emb(4, "b", 4, [0.01, 0.99])],
        )
        self.assertEqual(result.verdict, "different")
        self.assertFalse(result.same_speaker)
        self.assertEqual(result.agreement, 1.0)
        self.assertEqual(result.same_pair_fraction, 0.0)


if __name__ == "__main__":
    unittest.main()
