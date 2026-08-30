// SPDX-License-Identifier: AGPL-3.0-only
/** Typed wrappers for /api/faceit/* demo-sync endpoints. */

import { requestJson } from "./client";
import type { FaceitStatus, SyncJobState } from "./types";

export function fetchFaceitStatus(signal?: AbortSignal): Promise<FaceitStatus> {
  return requestJson<FaceitStatus>("/api/faceit/status", { signal });
}

/** Blocks server-side until the user finishes the browser login flow. */
export function faceitLogin(
  signal?: AbortSignal,
): Promise<{ ok: boolean; detail: string }> {
  return requestJson<{ ok: boolean; detail: string }>("/api/faceit/login", {
    method: "POST",
    signal,
  });
}

export function startFaceitSync(
  limit: number,
  headless?: boolean | null,
  signal?: AbortSignal,
): Promise<{ started: boolean }> {
  return requestJson<{ started: boolean }>("/api/faceit/sync", {
    method: "POST",
    json: {
      limit,
      ...(headless === null || headless === undefined ? {} : { headless }),
    },
    signal,
  });
}

export function fetchSyncStatus(signal?: AbortSignal): Promise<SyncJobState> {
  return requestJson<SyncJobState>("/api/faceit/sync/status", { signal });
}
