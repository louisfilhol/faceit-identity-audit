# SPDX-License-Identifier: AGPL-3.0-only
from __future__ import annotations

import csv
import sqlite3
import tempfile
import unittest
from pathlib import Path

import numpy as np
from eval.generate_db_pairs import generate
from eval.tune_threshold import _manifest_scores


class EvalManifestTests(unittest.TestCase):
    def test_generator_supports_legacy_database_and_defaults_to_review(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = root / "legacy.db"
            conn = sqlite3.connect(db)
            conn.executescript(
                """
                CREATE TABLE demos (id INTEGER PRIMARY KEY, path TEXT);
                CREATE TABLE players (steamid TEXT PRIMARY KEY, nickname TEXT);
                CREATE TABLE embeddings (
                    id INTEGER PRIMARY KEY,
                    steamid TEXT,
                    demo_id INTEGER,
                    vector BLOB
                );
                """
            )
            conn.executemany(
                "INSERT INTO demos (id, path) VALUES (?, ?)",
                [(1, "one.dem"), (2, "two.dem"), (3, "three.dem")],
            )
            conn.executemany(
                "INSERT INTO players (steamid, nickname) VALUES (?, ?)",
                [("a", "A"), ("b", "B")],
            )
            vector = np.asarray([1.0, 0.0], dtype=np.float32).tobytes()
            conn.executemany(
                "INSERT INTO embeddings (id, steamid, demo_id, vector) VALUES (?, ?, ?, ?)",
                [(1, "a", 1, vector), (2, "a", 2, vector), (3, "b", 3, vector)],
            )
            conn.commit()
            conn.close()

            output = root / "pairs.csv"
            result = generate(db, output, max_different=10)
            with output.open(encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))

            self.assertEqual(result["same_candidates"], 1)
            self.assertTrue(rows)
            self.assertTrue(all(row["label"] == "review" for row in rows))
            self.assertTrue(all(row["split"] == "unassigned" for row in rows))
            self.assertIn("subject_id_a", rows[0])
            self.assertEqual(rows[0]["preprocessing_a"], "none")

    def test_manifest_filter_requires_consistent_subject_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pairs.csv"
            fields = [
                "label",
                "subject_id_a",
                "subject_id_b",
                "split",
                "score",
                "steamid_a",
                "steamid_b",
                "preprocessing_a",
                "preprocessing_b",
            ]
            rows = [
                {
                    "label": "same",
                    "subject_id_a": "s1",
                    "subject_id_b": "s1",
                    "split": "development",
                    "score": "0.9",
                    "steamid_a": "a",
                    "steamid_b": "b",
                    "preprocessing_a": "silero-vad",
                    "preprocessing_b": "silero-vad",
                },
                {
                    "label": "different",
                    "subject_id_a": "s2",
                    "subject_id_b": "s3",
                    "split": "test",
                    "score": "0.1",
                    "steamid_a": "c",
                    "steamid_b": "d",
                    "preprocessing_a": "silero-vad",
                    "preprocessing_b": "silero-vad",
                },
                {
                    "label": "same",
                    "subject_id_a": "s4",
                    "subject_id_b": "s5",
                    "split": "development",
                    "score": "0.8",
                    "steamid_a": "e",
                    "steamid_b": "f",
                    "preprocessing_a": "silero-vad",
                    "preprocessing_b": "silero-vad",
                },
            ]
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)

            same, different, metadata = _manifest_scores(path, split="development")

            self.assertEqual(same, [0.9])
            self.assertEqual(different, [])
            self.assertEqual(metadata["subjects"], 1)
            self.assertEqual(metadata["ignored_split"], 1)
            self.assertEqual(metadata["ignored"], 1)


if __name__ == "__main__":
    unittest.main()
