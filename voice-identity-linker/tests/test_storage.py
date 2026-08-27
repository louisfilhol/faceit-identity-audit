# SPDX-License-Identifier: AGPL-3.0-only
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import pipeline, storage


class StorageHelpersTest(unittest.TestCase):
    def test_content_addressed_upload_deduplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "first.part"
            second = root / "second.part"
            first.write_bytes(b"same demo")
            second.write_bytes(b"same demo")

            one, one_deduplicated = storage.commit_content_addressed_upload(
                first, root, "a" * 64, "match.dem.zst"
            )
            two, two_deduplicated = storage.commit_content_addressed_upload(
                second, root, "a" * 64, "renamed.dem.zst"
            )

            self.assertEqual(one, two)
            self.assertFalse(one_deduplicated)
            self.assertTrue(two_deduplicated)
            self.assertEqual(one.read_bytes(), b"same demo")
            self.assertFalse(first.exists())
            self.assertFalse(second.exists())

    def test_free_space_reserves_incoming_write(self):
        with patch.object(storage, "free_bytes", return_value=100):
            self.assertEqual(storage.require_free_space(".", 60, 40), 100)
            with self.assertRaises(storage.InsufficientStorageError):
                storage.require_free_space(".", 60, 41)


class PipelineRetentionTest(unittest.TestCase):
    def _artifacts(self, root: Path):
        source = root / "match.dem.zst"
        working = root / "match.dem"
        wav_dir = root / "wav" / "match"
        source.write_bytes(b"compressed")
        working.write_bytes(b"raw")
        wav_dir.mkdir(parents=True)
        (wav_dir / "player.wav").write_bytes(b"audio")
        return source, working, wav_dir

    def test_success_removes_wavs_and_decompressed_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, working, wav_dir = self._artifacts(root)
            response = (1, object(), [])
            with (
                patch.object(pipeline.config, "WAV_DIR", root / "wav"),
                patch.object(pipeline.config, "DELETE_WAV_AFTER_EMBEDDING", True),
                patch.object(pipeline.config, "RETAIN_COMPRESSED_DEMO_ONLY", True),
                patch.object(pipeline, "ensure_dem", return_value=working),
                patch.object(pipeline, "_ingest_demo", return_value=response),
            ):
                self.assertEqual(pipeline.ingest_demo(source), response)

            self.assertTrue(source.exists())
            self.assertFalse(working.exists())
            self.assertFalse(wav_dir.exists())

    def test_failure_forces_cleanup_even_when_retention_is_disabled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, working, wav_dir = self._artifacts(root)
            with (
                patch.object(pipeline.config, "WAV_DIR", root / "wav"),
                patch.object(pipeline.config, "DELETE_WAV_AFTER_EMBEDDING", False),
                patch.object(pipeline.config, "RETAIN_COMPRESSED_DEMO_ONLY", False),
                patch.object(pipeline, "ensure_dem", return_value=working),
                patch.object(
                    pipeline,
                    "_ingest_demo",
                    side_effect=RuntimeError("failed"),
                ),
                patch.object(pipeline.store, "delete_empty_demos_for_path"),
            ):
                with self.assertRaisesRegex(RuntimeError, "failed"):
                    pipeline.ingest_demo(source)

            self.assertTrue(source.exists())
            self.assertFalse(working.exists())
            self.assertFalse(wav_dir.exists())


if __name__ == "__main__":
    unittest.main()
