// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  fetchEvents,
  fetchFriendsConfig,
  fetchFriendsStatus,
  fetchOverlapDetail,
  fetchOverlapList,
  fetchSnapshots,
  resolveAccount,
  runFriendsCheck,
  saveFriendsConfig,
  saveScheduler,
} from "@/api/friends";
import { useToast } from "@/components/common/Toast";
import { queryKeys } from "@/api/keys";
import type {
  CheckResponse,
  FriendsAccount,
  FriendsConfig,
  ResolveResult,
  SchedulerSettings,
} from "@/api/types";

/** Silent refresh cadence for status and events. */
const AUTO_REFRESH_MS = 45_000;

/** POST /api/friends/check — a full blocking scan (can take a minute). */
export type CheckMutation = UseMutationResult<CheckResponse, Error, void>;

export function useFriendsStatus() {
  return useQuery({
    queryKey: queryKeys.friends.status,
    queryFn: ({ signal }) => fetchFriendsStatus(signal),
    refetchInterval: AUTO_REFRESH_MS,
    staleTime: 15_000,
  });
}

export function useFriendsConfig() {
  return useQuery({
    queryKey: queryKeys.friends.config,
    queryFn: ({ signal }) => fetchFriendsConfig(signal),
    // Falls back to config.example.json server-side; keep showing whatever
    // we last had if a reload hiccups.
    retry: 0,
  });
}

export function useEvents() {
  return useQuery({
    queryKey: queryKeys.friends.events,
    queryFn: ({ signal }) => fetchEvents({ limit: 500 }, signal),
    refetchInterval: AUTO_REFRESH_MS,
    staleTime: 15_000,
  });
}

export function useSnapshots() {
  return useQuery({
    queryKey: queryKeys.friends.snapshots,
    queryFn: ({ signal }) => fetchSnapshots(signal),
  });
}

export function useOverlapList() {
  return useQuery({
    queryKey: queryKeys.friends.overlapList,
    queryFn: ({ signal }) => fetchOverlapList(signal),
  });
}

export function useOverlapDetail(a: string | null, b: string | null) {
  return useQuery({
    queryKey: queryKeys.friends.overlapDetail(a ?? "", b ?? ""),
    queryFn: ({ signal }) =>
      fetchOverlapDetail(a as string, b as string, signal),
    enabled: Boolean(a && b),
    retry: 0,
  });
}

/** guid → human label from the saved configuration. */
export function useAccountLabels(): (guid: string) => string {
  const config = useFriendsConfig();
  const accounts = config.data?.accounts ?? [];
  const map = new Map<string, string>();
  for (const account of accounts) {
    if (account.guid) {
      map.set(account.guid, account.label || account.faceit || account.guid);
    }
  }
  return (guid: string) => map.get(guid) ?? guid;
}

function useInvalidateFriendsData() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.status }),
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.events }),
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.snapshots }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.friends.overlapList,
      }),
      queryClient.invalidateQueries({
        queryKey: ["friends", "overlap-detail"],
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.config }),
    ]);
}

/** Toast summary of a manual check — shared by the overview and friends views. */
export function useFriendsCheckToasts(check: CheckMutation): void {
  const toast = useToast();
  const { isSuccess, isError, data, error } = check;
  useEffect(() => {
    if (isSuccess && data) {
      const bad = data.results.filter((r) => !r.ok);
      if (bad.length) {
        toast(
          `${bad.length} account check(s) failed — see results`,
          "bad",
          6000,
        );
      } else {
        toast(`Check done · ${data.results.length} account(s) scanned`, "good");
      }
    } else if (isError && error) {
      toast(`Check failed: ${error.message}`, "bad", 6000);
    }
  }, [isSuccess, isError, data, error, toast]);
}

export function useRunFriendsCheck(): CheckMutation {
  const invalidate = useInvalidateFriendsData();
  return useMutation({
    mutationFn: () => runFriendsCheck(),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

export function useSaveConfig(): UseMutationResult<
  unknown,
  Error,
  Pick<FriendsConfig, "discord_webhook" | "discord_ping" | "accounts">
> {
  const invalidate = useInvalidateFriendsData();
  return useMutation({
    mutationFn: (
      config: Pick<
        FriendsConfig,
        "discord_webhook" | "discord_ping" | "accounts"
      >,
    ) => saveFriendsConfig(config),
    onSuccess: invalidate,
  });
}

export function useSaveScheduler(): UseMutationResult<
  { ok: boolean; scheduler: SchedulerSettings },
  Error,
  SchedulerSettings
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: SchedulerSettings) => saveScheduler(settings),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.friends.status,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.friends.config,
      });
    },
  });
}

export function useResolveAccount(): UseMutationResult<
  ResolveResult,
  Error,
  string
> {
  return useMutation({
    mutationFn: (q: string) => resolveAccount(q),
  });
}

/** Rows kept by the config editor; empty rows are dropped before saving. */
export interface AccountDraft {
  guid: string;
  label: string;
  faceit: string;
}

export function toDrafts(
  accounts: FriendsAccount[] | undefined,
): AccountDraft[] {
  return (accounts ?? []).map((a) => ({
    guid: a.guid ?? "",
    label: a.label ?? "",
    faceit: a.faceit ?? "",
  }));
}

export function draftsToAccounts(drafts: AccountDraft[]): FriendsAccount[] {
  return drafts
    .map((d) => ({
      guid: d.guid.trim(),
      label: d.label.trim(),
      faceit: d.faceit.trim(),
    }))
    .filter((a) => a.guid || a.faceit || a.label);
}
