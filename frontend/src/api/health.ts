// SPDX-License-Identifier: AGPL-3.0-only
/** Typed wrappers for the app-wide /api/health endpoint. */

import { requestJson } from "./client";
import type { Health } from "./types";

export function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return requestJson<Health>("/api/health", { signal });
}
