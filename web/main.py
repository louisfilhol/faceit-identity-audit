# SPDX-License-Identifier: AGPL-3.0-only
"""Unified web UI for the FACEIT Multi-Account Detection toolkit.

Runs from the repo root and exposes a single browser interface that drives
both sub-projects:

  * friends-monitor          -> /api/friends/*
  * voice-identity-linker    -> /api/voice/*

The two sub-projects are imported directly (their source dirs are added to
sys.path) so we reuse their logic instead of shelling out.
"""

from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

WEB_DIR = Path(__file__).resolve().parent
ROOT_DIR = WEB_DIR.parent
VOICE_DIR = ROOT_DIR / "voice-identity-linker"
FRIENDS_DIR = ROOT_DIR / "friends-monitor"

# Voice core expects its .env / data dir relative to its own project folder.
load_dotenv(VOICE_DIR / ".env")

for _d in (VOICE_DIR, FRIENDS_DIR):
    if str(_d) not in sys.path:
        sys.path.insert(0, str(_d))

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
    version="1.0.0",
    lifespan=lifespan,
)

static_dir = WEB_DIR / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

app.include_router(friends.router, prefix="/api/friends")
app.include_router(voice.router, prefix="/api/voice")
app.include_router(faceit.router, prefix="/api/faceit")


@app.get("/")
def index():
    return FileResponse(str(static_dir / "index.html"))


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "friends_configured": friends.is_configured(),
        "voice_available": voice.is_available(),
    }
