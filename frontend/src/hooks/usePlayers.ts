// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/api/keys";
import { fetchPlayers } from "@/api/voice";

/** Voice players list — only fetched while the voice module is available. */
export function usePlayers(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.voice.players,
    queryFn: ({ signal }) => fetchPlayers(signal),
    enabled,
    retry: 0,
  });
}
