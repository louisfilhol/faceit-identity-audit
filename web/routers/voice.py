# SPDX-License-Identifier: AGPL-3.0-only
"""REST API for voice-identity-linker (link accounts by voice).

The heavy ML imports (torch / speechbrain) are loaded lazily so the friends
part of the UI still works even if the voice dependencies are not installed.
"""

from __future__ import annotations

import copy
import hashlib
import logging
import queue
import threading
import time
import uuid
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()

log = logging.getLogger(__name__)

_state = {"loaded": False, "error": None, "ns": None}


# Ingest is intentionally serialized: the speech model is CPU/RAM-heavy and
# SQLite is shared by the web process. The queue keeps the HTTP request short
# while later uploads wait their turn.
_ingest_jobs: dict[str, dict] = {}
_ingest_queue: queue.Queue[tuple[str, Path]] = queue.Queue()
_ingest_lock = threading.Lock()
_MAX_JOB_HISTORY = 100
_JOB_RETENTION_HOURS = 24.0


def _job_snapshot(job_id: str) -> dict | None:
    with _ingest_lock:
        _prune_jobs_locked()
        job = _ingest_jobs.get(job_id)
        return copy.deepcopy(job) if job else None


def _set_job_progress(job_id: str, event: dict) -> None:
    with _ingest_lock:
        job = _ingest_jobs.get(job_id)
        if job is None:
            return
        progress = job["progress"]
        for key in ("phase", "current", "total", "percent", "players", "message"):
            if key in event:
                progress[key] = copy.deepcopy(event[key])
        if event.get("demo_id") is not None:
            job["demo_id"] = event["demo_id"]


def _prune_jobs_locked() -> None:
    """Discard expired terminal metadata and enforce the history cap."""
    now = time.time()
    cutoff = now - max(0.0, _JOB_RETENTION_HOURS) * 3600
    for old_id, job in list(_ingest_jobs.items()):
        finished = job.get("finished")
        if job["status"] in {"completed", "failed"} and finished and finished < cutoff:
            del _ingest_jobs[old_id]

    terminal = sorted(
        (
            (job.get("finished") or job["created"], old_id)
            for old_id, job in _ingest_jobs.items()
            if job["status"] in {"completed", "failed"}
        ),
        reverse=True,
    )
    for _finished, old_id in terminal[max(0, _MAX_JOB_HISTORY) :]:
        del _ingest_jobs[old_id]


def _run_ingest_job(job_id: str, demo_path: Path) -> None:
    with _ingest_lock:
        job = _ingest_jobs.get(job_id)
        if job is None:
            return
        job["status"] = "running"
        job["started"] = time.time()

    ns = None
    try:
        ns = _load()
        demo_id, _result, stats = ns["ingest_demo"](
            demo_path,
            source="upload",
            progress_fn=lambda event: _set_job_progress(job_id, event),
        )
        with _ingest_lock:
            job = _ingest_jobs[job_id]
            job["status"] = "completed"
            job["finished"] = time.time()
            job["demo_id"] = demo_id
            job["result"] = {"demo_id": demo_id, "players": stats}
            job["progress"].update(
                {
                    "phase": "completed",
                    "current": job["progress"]["total"],
                    "percent": 100,
                    "message": "Ingest complete",
                }
            )
            _prune_jobs_locked()
    except Exception as e:  # noqa: BLE001
        log.exception("ingest job %s failed", job_id)
        with _ingest_lock:
            job = _ingest_jobs.get(job_id)
            if job is not None:
                job["status"] = "failed"
                job["finished"] = time.time()
                job["error"] = str(e)
                job["progress"].update(
                    {
                        "phase": "failed",
                        "message": f"Ingest failed: {e}",
                    }
                )
                owns_upload = job.get("owns_upload", False)
                _prune_jobs_locked()
            else:
                owns_upload = False
        if owns_upload:
            try:
                if ns is not None and ns["config"].DELETE_FAILED_UPLOADS:
                    ns["store"].delete_empty_demos_for_path(str(demo_path.resolve()))
                    ns["cleanup_ingest_artifacts"](
                        demo_path,
                        delete_source=True,
                        force=True,
                    )
            except Exception:  # noqa: BLE001
                log.exception("failed to clean artifacts for ingest job %s", job_id)


def _ingest_worker() -> None:
    while True:
        job_id, demo_path = _ingest_queue.get()
        try:
            _run_ingest_job(job_id, demo_path)
        finally:
            _ingest_queue.task_done()


threading.Thread(target=_ingest_worker, name="voice-ingest-worker", daemon=True).start()


def is_available() -> bool:
    """True if the voice core can actually be imported.

    Performs the load (cached) so the health check reflects reality instead of
    the lazy-load flag, which stays False until a voice endpoint is hit.
    """
    if _state["ns"] is not None:
        return True
    if _state["error"]:
        return False
    try:
        _load()
    except HTTPException:
        return False
    return True


def _load():
    if _state["ns"] is not None:
        return _state["ns"]
    if _state["error"]:
        raise HTTPException(500, f"voice module unavailable: {_state['error']}")
    try:
        import config  # noqa: F401
        from core import linking, storage, store  # noqa: F401
        from core.pipeline import cleanup_ingest_artifacts, ingest_demo  # noqa: F401
    except Exception as e:  # noqa: BLE001
        _state["error"] = str(e)
        log.exception("failed to load voice module")
        raise HTTPException(500, f"voice module unavailable: {e}")
    _state["loaded"] = True
    _state["ns"] = {
        "config": config,
        "linking": linking,
        "store": store,
        "storage": storage,
        "ingest_demo": ingest_demo,
        "cleanup_ingest_artifacts": cleanup_ingest_artifacts,
    }
    return _state["ns"]


# --- request models ---------------------------------------------------------


class VerifyReq(BaseModel):
    steamid_a: str
    steamid_b: str
    threshold: float | None = None


class MatchReq(BaseModel):
    steamid: str
    k: int = 10
    threshold: float | None = None


class ClusterReq(BaseModel):
    threshold: float | None = None


# --- ingest -----------------------------------------------------------------


def _cleanup_stale_upload_parts(config) -> None:
    # Never treat a concurrent/in-progress upload as stale, even if terminal
    # metadata retention is configured to zero.
    cutoff = time.time() - max(1.0, config.INGEST_JOB_RETENTION_HOURS) * 3600
    for part in config.DEMOS_DIR.glob(".upload-*.part"):
        try:
            if part.stat().st_mtime < cutoff:
                part.unlink(missing_ok=True)
        except OSError:
            log.warning("could not inspect/remove stale upload %s", part)


def cleanup_orphaned_uploads() -> None:
    """Remove crash-left upload parts at process startup, before requests run."""
    try:
        import config

        config.ensure_dirs()
        for part in config.DEMOS_DIR.glob(".upload-*.part"):
            part.unlink(missing_ok=True)
        for part in config.DEMOS_DIR.glob(".*.decompressing"):
            part.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        log.exception("failed to clean orphaned upload parts")


def _capacity_error(ns, incoming_bytes: int = 0) -> None:
    try:
        ns["storage"].require_free_space(
            ns["config"].DEMOS_DIR,
            ns["config"].MIN_FREE_DISK_BYTES,
            incoming_bytes,
        )
    except ns["storage"].InsufficientStorageError as e:
        raise HTTPException(507, f"insufficient storage: {e}") from e


async def _save_upload(
    file: UploadFile,
    name: str,
    job_id: str,
    ns: dict,
) -> tuple[Path, int, bool]:
    """Stream, bound, hash, and atomically deduplicate one uploaded demo."""
    temporary = ns["config"].DEMOS_DIR / f".upload-{job_id}.part"
    digest = hashlib.sha256()
    written = 0
    try:
        with temporary.open("xb") as handle:
            while chunk := await file.read(1 << 20):
                written += len(chunk)
                if written > ns["config"].MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        413,
                        f"upload exceeds {ns['config'].MAX_UPLOAD_BYTES} byte limit",
                    )
                _capacity_error(ns, len(chunk))
                handle.write(chunk)
                digest.update(chunk)
        if written == 0:
            raise HTTPException(400, "uploaded demo is empty")
        destination, deduplicated = ns["storage"].commit_content_addressed_upload(
            temporary,
            ns["config"].DEMOS_DIR,
            digest.hexdigest(),
            name,
        )
        return destination, written, deduplicated
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


@router.post("/ingest")
async def ingest(request: Request, file: UploadFile = File(...)):
    ns = _load()
    name = Path(file.filename or "").name
    name_lower = name.lower()
    # FACEIT serves demos compressed (.dem.zst / .dem.gz); ensure_dem
    # decompresses them during ingest.
    if not (
        name_lower.endswith(".dem")
        or name_lower.endswith(".dem.zst")
        or name_lower.endswith(".dem.gz")
    ):
        raise HTTPException(400, "expected a .dem, .dem.zst or .dem.gz file")
    ns["config"].ensure_dirs()
    global _MAX_JOB_HISTORY, _JOB_RETENTION_HOURS
    _MAX_JOB_HISTORY = ns["config"].INGEST_JOB_HISTORY_LIMIT
    _JOB_RETENTION_HOURS = ns["config"].INGEST_JOB_RETENTION_HOURS
    _cleanup_stale_upload_parts(ns["config"])

    declared_size = request.headers.get("content-length")
    if declared_size:
        try:
            request_bytes = int(declared_size)
        except ValueError:
            raise HTTPException(400, "invalid Content-Length header")
        # Multipart framing is not part of the file. Leave a small allowance;
        # the exact file limit is always enforced while streaming below.
        if request_bytes > ns["config"].MAX_UPLOAD_BYTES + (2 << 20):
            raise HTTPException(
                413,
                f"upload exceeds {ns['config'].MAX_UPLOAD_BYTES} byte limit",
            )
        _capacity_error(ns, min(request_bytes, ns["config"].MAX_UPLOAD_BYTES))
    else:
        _capacity_error(ns)

    job_id = uuid.uuid4().hex
    try:
        dest, upload_bytes, deduplicated = await _save_upload(
            file,
            name,
            job_id,
            ns,
        )
    finally:
        await file.close()

    with _ingest_lock:
        _prune_jobs_locked()
        if deduplicated:
            for existing_id, existing in _ingest_jobs.items():
                if existing.get("demo_path") == str(dest) and existing["status"] in {
                    "queued",
                    "running",
                    "completed",
                }:
                    return JSONResponse(
                        status_code=202 if existing["status"] != "completed" else 200,
                        content={
                            "job_id": existing_id,
                            "status": existing["status"],
                            "deduplicated": True,
                            "status_url": f"/api/voice/ingest/{existing_id}",
                        },
                    )
        _ingest_jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "filename": name,
            "demo_path": str(dest),
            "upload_bytes": upload_bytes,
            "deduplicated": deduplicated,
            "owns_upload": not deduplicated,
            "created": time.time(),
            "started": None,
            "finished": None,
            "demo_id": None,
            "result": None,
            "error": None,
            "progress": {
                "phase": "queued",
                "current": 0,
                "total": 0,
                "percent": 0,
                "players": [],
                "message": "Waiting for the ingest worker…",
            },
        }

    _ingest_queue.put((job_id, dest))
    return JSONResponse(
        status_code=202,
        content={
            "job_id": job_id,
            "status": "queued",
            "deduplicated": deduplicated,
            "status_url": f"/api/voice/ingest/{job_id}",
        },
    )


@router.get("/ingest/{job_id}")
def ingest_status(job_id: str):
    job = _job_snapshot(job_id)
    if job is None:
        raise HTTPException(404, "ingest job not found")
    return job


# --- players ----------------------------------------------------------------


@router.get("/players")
def players():
    ns = _load()
    out = []
    for p in ns["store"].all_players():
        embs = ns["store"].embeddings_for(p.steamid)
        out.append(
            {
                "steamid": p.steamid,
                "nickname": p.nickname,
                "consent": p.consent,
                "clip_count": len(embs),
                "audio_sec": sum(e.audio_sec for e in embs),
            }
        )
    return out


# --- linking ----------------------------------------------------------------


@router.post("/verify")
def verify(req: VerifyReq):
    ns = _load()
    res = ns["linking"].is_same_person(
        req.steamid_a, req.steamid_b, threshold=req.threshold
    )
    if res is None:
        raise HTTPException(404, "one or both players have no embedding")
    pa = ns["store"].get_player(req.steamid_a)
    pb = ns["store"].get_player(req.steamid_b)
    evidence = asdict(res)
    evidence.pop("a_steamid", None)
    evidence.pop("b_steamid", None)
    return {
        "a": {"steamid": req.steamid_a, "nickname": pa.nickname if pa else None},
        "b": {"steamid": req.steamid_b, "nickname": pb.nickname if pb else None},
        **evidence,
    }


@router.post("/match")
def match(req: MatchReq):
    ns = _load()
    results = ns["linking"].find_matches_for_player(
        req.steamid, k=req.k, threshold=req.threshold
    )
    threshold = (
        ns["config"].DEFAULT_THRESHOLD if req.threshold is None else req.threshold
    )
    matches = []
    for result in results:
        evidence = ns["linking"].is_same_person(
            req.steamid, result.steamid, threshold=threshold
        )
        matches.append(
            {
                "steamid": result.steamid,
                "nickname": result.nickname,
                "score": result.score,
                "clip_count": result.clip_count,
                "audio_sec": result.audio_sec,
                "consent": result.consent,
                "verdict": evidence.verdict if evidence else "inconclusive",
                "median_score": evidence.score if evidence else None,
                "agreement": evidence.agreement if evidence else None,
                "same_pair_fraction": (
                    evidence.same_pair_fraction if evidence else None
                ),
                "evidence_quality": evidence.evidence_quality if evidence else "low",
                "reasons": evidence.reasons
                if evidence
                else ["missing comparison evidence"],
            }
        )
    return {
        "threshold": threshold,
        "matches": matches,
    }


@router.get("/demo/{demo_id}/cluster")
def demo_cluster(demo_id: int, threshold: float | None = None):
    ns = _load()
    groups = ns["linking"].cluster_demo(demo_id, threshold=threshold)
    named = []
    for g in groups:
        row = []
        for sid in g:
            p = ns["store"].get_player(sid)
            row.append({"steamid": sid, "nickname": p.nickname if p else None})
        named.append(row)
    return {"demo_id": demo_id, "groups": named}
