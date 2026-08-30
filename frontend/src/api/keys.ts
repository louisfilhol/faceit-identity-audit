// SPDX-License-Identifier: AGPL-3.0-only
/** Central query-key registry so invalidation stays precise. */

import type { IngestJobStatus } from "./types";

export const queryKeys = {
  health: ["health"] as const,
  friends: {
    status: ["friends", "status"] as const,
    config: ["friends", "config"] as const,
    events: ["friends", "events"] as const,
    snapshots: ["friends", "snapshots"] as const,
    overlapList: ["friends", "overlap"] as const,
    overlapDetail: (a: string, b: string) =>
      ["friends", "overlap-detail", a, b] as const,
  },
  voice: {
    players: ["voice", "players"] as const,
    /** undefined = no job being watched. */
    ingestJob: (jobId: string | undefined) =>
      ["voice", "ingest-job", jobId ?? "none"] as const,
    cluster: (demoId: number) => ["voice", "cluster", demoId] as const,
  },
  faceit: {
    status: ["faceit", "status"] as const,
    syncStatus: ["faceit", "sync-status"] as const,
  },
} as const;

/** Terminal ingest statuses — polling must stop once reached. */
export const TERMINAL_INGEST_STATUSES: readonly IngestJobStatus[] = [
  "completed",
  "failed",
];
