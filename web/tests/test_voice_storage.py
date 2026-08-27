# SPDX-License-Identifier: AGPL-3.0-only
import asyncio
import io
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException, UploadFile

VOICE_DIR = Path(__file__).resolve().parents[2] / "voice-identity-linker"
if str(VOICE_DIR) not in sys.path:
    sys.path.insert(0, str(VOICE_DIR))

from core import storage  # noqa: E402

from web.routers import voice  # noqa: E402


class UploadStorageTest(unittest.TestCase):
    def _ns(self, root: Path, limit: int) -> dict:
        return {
            "config": SimpleNamespace(
                DEMOS_DIR=root,
                MAX_UPLOAD_BYTES=limit,
                MIN_FREE_DISK_BYTES=0,
            ),
            "storage": storage,
        }

    def _upload(self, payload: bytes, name: str = "match.dem.zst") -> UploadFile:
        return UploadFile(file=io.BytesIO(payload), filename=name)

    def test_stream_limit_removes_partial_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(
                    voice._save_upload(
                        self._upload(b"too large"),
                        "match.dem.zst",
                        "oversize",
                        self._ns(root, limit=3),
                    )
                )
            self.assertEqual(raised.exception.status_code, 413)
            self.assertEqual(list(root.iterdir()), [])

    def test_equal_uploads_share_one_canonical_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ns = self._ns(root, limit=1024)
            first = asyncio.run(
                voice._save_upload(self._upload(b"demo bytes"), "a.dem.gz", "one", ns)
            )
            second = asyncio.run(
                voice._save_upload(self._upload(b"demo bytes"), "b.dem.gz", "two", ns)
            )
            self.assertEqual(first[0], second[0])
            self.assertFalse(first[2])
            self.assertTrue(second[2])
            self.assertEqual(len(list(root.iterdir())), 1)


if __name__ == "__main__":
    unittest.main()
