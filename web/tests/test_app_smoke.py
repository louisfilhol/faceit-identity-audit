# SPDX-License-Identifier: AGPL-3.0-only
import asyncio
from pathlib import Path

import httpx

from web.main import FRONTEND_INDEX, app


def _get(path: str) -> httpx.Response:
    async def request() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await client.get(path)

    return asyncio.run(request())


def test_health_and_assets_are_reachable() -> None:
    health = _get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"


def test_root_serves_built_react_app() -> None:
    index = _get("/")
    if FRONTEND_INDEX.exists():
        assert index.status_code == 200
        assert 'id="root"' in index.text
        assert "FACEIT" in index.text
        # The bundled entry point must be referenced by the built page.
        assets_dir = Path(FRONTEND_INDEX.parent / "assets")
        scripts = [
            part.split('"')[0]
            for part in index.text.split('src="')[1:]
            if part.startswith("/assets/")
        ]
        assert scripts, "index.html does not reference any bundled script"
        for script in scripts:
            assert (assets_dir / Path(script).name).is_file(), script
            asset = _get(script)
            assert asset.status_code == 200
    else:
        # No build present: fail loudly with actionable instructions.
        assert index.status_code == 503
        assert "npm run build" in index.text
