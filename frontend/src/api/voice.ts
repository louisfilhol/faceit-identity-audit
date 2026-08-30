// SPDX-License-Identifier: AGPL-3.0-only
/** Typed wrappers for /api/voice/* endpoints. */

import { requestJson, withQuery } from "./client";
import type {
  ClusterResponse,
  IngestAccepted,
  IngestJob,
  MatchResponse,
  VerifyEvidence,
  VoicePlayer,
} from "./types";

export function fetchPlayers(signal?: AbortSignal): Promise<VoicePlayer[]> {
  return requestJson<VoicePlayer[]>("/api/voice/players", { signal });
}

/** Multipart upload; resolves with 202 Accepted for a queued background job. */
export function uploadDemo(
  file: File,
  signal?: AbortSignal,
): Promise<IngestAccepted> {
  const form = new FormData();
  form.append("file", file);
  return requestJson<IngestAccepted>("/api/voice/ingest", {
    method: "POST",
    body: form,
    signal,
  });
}

export function fetchIngestJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<IngestJob> {
  return requestJson<IngestJob>(
    `/api/voice/ingest/${encodeURIComponent(jobId)}`,
    { signal },
  );
}

export function verifyPair(
  steamidA: string,
  steamidB: string,
  signal?: AbortSignal,
): Promise<VerifyEvidence> {
  return requestJson<VerifyEvidence>("/api/voice/verify", {
    method: "POST",
    json: { steamid_a: steamidA, steamid_b: steamidB },
    signal,
  });
}

export function matchVoice(
  steamid: string,
  k: number,
  signal?: AbortSignal,
): Promise<MatchResponse> {
  return requestJson<MatchResponse>("/api/voice/match", {
    method: "POST",
    json: { steamid, k },
    signal,
  });
}

export function fetchCluster(
  demoId: number,
  threshold?: number,
  signal?: AbortSignal,
): Promise<ClusterResponse> {
  return requestJson<ClusterResponse>(
    withQuery(`/api/voice/demo/${demoId}/cluster`, { threshold }),
    { signal },
  );
}
