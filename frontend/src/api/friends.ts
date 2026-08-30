// SPDX-License-Identifier: AGPL-3.0-only
/** Typed wrappers for /api/friends/* endpoints. */

import { requestJson, withQuery } from "./client";
import type {
  CheckResponse,
  EventKind,
  FriendsConfig,
  FriendsEvent,
  FriendsSnapshot,
  FriendsStatus,
  OverlapDetailResponse,
  OverlapListResponse,
  ResolveResult,
  SaveConfigResult,
  SchedulerSettings,
  SchedulerSnapshot,
} from "./types";

export function fetchFriendsStatus(
  signal?: AbortSignal,
): Promise<FriendsStatus> {
  return requestJson<FriendsStatus>("/api/friends/status", { signal });
}

export function fetchFriendsConfig(
  signal?: AbortSignal,
): Promise<FriendsConfig> {
  return requestJson<FriendsConfig>("/api/friends/config", { signal });
}

export function saveFriendsConfig(
  config: Pick<FriendsConfig, "discord_webhook" | "discord_ping" | "accounts">,
  signal?: AbortSignal,
): Promise<SaveConfigResult> {
  return requestJson<SaveConfigResult>("/api/friends/config", {
    method: "PUT",
    json: config,
    signal,
  });
}

export function saveScheduler(
  settings: SchedulerSettings,
  signal?: AbortSignal,
): Promise<{ ok: boolean; scheduler: SchedulerSnapshot }> {
  return requestJson<{ ok: boolean; scheduler: SchedulerSnapshot }>(
    "/api/friends/scheduler",
    { method: "PUT", json: settings, signal },
  );
}

export function resolveAccount(
  q: string,
  signal?: AbortSignal,
): Promise<ResolveResult> {
  return requestJson<ResolveResult>(withQuery("/api/friends/resolve", { q }), {
    signal,
  });
}

export function runFriendsCheck(signal?: AbortSignal): Promise<CheckResponse> {
  return requestJson<CheckResponse>("/api/friends/check", {
    method: "POST",
    signal,
  });
}

export function fetchEvents(
  opts: { limit?: number; accountLbl?: string } = {},
  signal?: AbortSignal,
): Promise<{ events: FriendsEvent[] }> {
  return requestJson<{ events: FriendsEvent[] }>(
    withQuery("/api/friends/events", {
      limit: opts.limit,
      account_lbl: opts.accountLbl,
    }),
    { signal },
  );
}

export function fetchSnapshots(
  signal?: AbortSignal,
): Promise<{ snapshots: FriendsSnapshot[] }> {
  return requestJson<{ snapshots: FriendsSnapshot[] }>(
    "/api/friends/snapshots",
    {
      signal,
    },
  );
}

export function fetchOverlapList(
  signal?: AbortSignal,
): Promise<OverlapListResponse> {
  return requestJson<OverlapListResponse>("/api/friends/overlap", { signal });
}

export function fetchOverlapDetail(
  a: string,
  b: string,
  signal?: AbortSignal,
): Promise<OverlapDetailResponse> {
  return requestJson<OverlapDetailResponse>(
    `/api/friends/overlap/${encodeURIComponent(a)}/${encodeURIComponent(b)}`,
    { signal },
  );
}

/** Narrow an arbitrary event kind string for tag rendering. */
export function isEventKind(kind: string): kind is EventKind {
  return kind === "added" || kind === "removed";
}
