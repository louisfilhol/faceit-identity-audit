# SPDX-License-Identifier: AGPL-3.0-only
import asyncio

import httpx

from web.main import app


def test_health_and_ui_are_reachable() -> None:
    async def request(path: str) -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await client.get(path)

    health = asyncio.run(request("/api/health"))
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    index = asyncio.run(request("/"))
    assert index.status_code == 200
    assert "FACEIT" in index.text
