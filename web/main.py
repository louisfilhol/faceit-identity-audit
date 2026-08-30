# SPDX-License-Identifier: AGPL-3.0-only
"""Unified web UI for the FACEIT Multi-Account Detection toolkit.

Runs from the repo root and exposes a single browser interface that drives
both sub-projects:

  * friends-monitor          -> /api/friends/*
  * voice-identity-linker    -> /api/voice/*
  * faceit demo sync         -> /api/faceit/*

The two sub-projects are imported directly (their source dirs are added to
sys.path) so we reuse their logic instead of shelling out.

The browser app is the React build in frontend/dist (see frontend/). Hash
routing means only `/` needs to serve the app; asset files live under
/assets.
"""

from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

WEB_DIR = Path(__file__).resolve().parent
ROOT_DIR = WEB_DIR.parent
FRONTEND_DIR = ROOT_DIR / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"
FRONTEND_INDEX = FRONTEND_DIST / "index.html"
VOICE_DIR = ROOT_DIR / "voice-identity-linker"
FRIENDS_DIR = ROOT_DIR / "friends-monitor"

# Voice core expects its .env / data dir relative to its own project folder.
load_dotenv(VOICE_DIR / ".env")

for _d in (VOICE_DIR, FRIENDS_DIR):
    if str(_d) not in sys.path:
        sys.path.insert(0, str(_d))

from web import __version__  # noqa: E402
from web.routers import faceit, friends, voice  # noqa: E402


@asynccontextmanager
async def lifespan(_app: FastAPI):
    voice.cleanup_orphaned_uploads()
    friends.start_scheduler()
    try:
        yield
    finally:
        await friends.stop_scheduler()


app = FastAPI(
    title="FACEIT Multi-Account Detection",
    version=__version__,
    lifespan=lifespan,
)

# React production build. The /assets mount is only registered when the build
# already exists at startup; otherwise a lazy fallback serves the same files so
# a dashboard built while the server runs starts working without a restart.
if (FRONTEND_DIST / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIST / "assets")),
        name="assets",
    )
else:

    @app.get("/assets/{asset_path:path}", include_in_schema=False)
    def lazy_assets(asset_path: str) -> FileResponse:
        target = (FRONTEND_DIST / "assets" / asset_path).resolve()
        if not target.is_relative_to(FRONTEND_DIST / "assets"):
            raise HTTPException(status_code=404)
        if not target.is_file():
            raise HTTPException(
                status_code=404,
                detail="frontend asset not found — run "
                "`cd frontend && npm run build`, then reload",
            )
        return FileResponse(str(target))


app.include_router(friends.router, prefix="/api/friends")
app.include_router(voice.router, prefix="/api/voice")
app.include_router(faceit.router, prefix="/api/faceit")


@app.get("/")
def index():
    if FRONTEND_INDEX.exists():
        return FileResponse(str(FRONTEND_INDEX))
    return HTMLResponse(status_code=503, content=_missing_frontend_html())


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "friends_configured": friends.is_configured(),
        "voice_available": voice.is_available(),
    }


def _missing_frontend_html() -> str:
    hint = (
        "cd frontend && npm ci && npm run build"
        if not (FRONTEND_DIR / "node_modules").exists()
        else "cd frontend && npm run build"
    )
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<title>Frontend build missing</title>"
        "<style>body{background:#0b0d12;color:#e9edf5;font-family:system-ui,"
        "sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}"
        "div{max-width:34rem;padding:2rem;border:1px solid #232b3b;"
        "border-radius:14px;background:#141821}code{color:#ff7a2e}"
        "</style></head><body><div>"
        "<h1>Frontend build not found</h1>"
        "<p>The React dashboard has not been built yet. Run:</p>"
        f"<p><code>{hint}</code></p>"
        "<p>or run <code>./setup.sh</code> from the repository root, then "
        "reload this page.</p>"
        "</div></body></html>"
    )
