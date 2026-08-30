// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "@/api/health";
import { queryKeys } from "@/api/keys";
import type { Health } from "@/api/types";

export type HealthBadgeState = "unknown" | "ok" | "warn" | "err";

export interface HealthSummary {
  health: Health | undefined;
  badgeState: HealthBadgeState;
  badgeText: string;
  reachable: boolean;
  voiceAvailable: boolean;
}

const BADGE_UNKNOWN: HealthSummary = {
  health: undefined,
  badgeState: "unknown",
  badgeText: "Checking…",
  reachable: false,
  voiceAvailable: false,
};

export function summarizeHealth(
  health: Health | undefined,
  failed: boolean,
): HealthSummary {
  if (failed) {
    return {
      health: undefined,
      badgeState: "err",
      badgeText: "API unreachable",
      reachable: false,
      voiceAvailable: false,
    };
  }
  if (!health) return BADGE_UNKNOWN;
  const friendsReady = health.friends_configured;
  const voiceReady = health.voice_available;
  if (friendsReady && voiceReady) {
    return {
      health,
      badgeState: "ok",
      badgeText: "All systems ready",
      reachable: true,
      voiceAvailable: true,
    };
  }
  if (friendsReady) {
    return {
      health,
      badgeState: "warn",
      badgeText: "Friends ready · voice off",
      reachable: true,
      voiceAvailable: false,
    };
  }
  if (voiceReady) {
    return {
      health,
      badgeState: "warn",
      badgeText: "Voice ready · friends off",
      reachable: true,
      voiceAvailable: true,
    };
  }
  return {
    health,
    badgeState: "err",
    badgeText: "Not configured",
    reachable: true,
    voiceAvailable: false,
  };
}

/** Shared health query — every view reads the same cached copy. */
export function useHealth(): HealthSummary {
  const query = useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    // Silent background refresh keeps the sidebar badge current.
    refetchInterval: 45_000,
    staleTime: 10_000,
    retry: 1,
  });
  return summarizeHealth(query.data, query.isError);
}
