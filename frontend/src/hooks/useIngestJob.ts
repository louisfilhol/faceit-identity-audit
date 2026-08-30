// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys, TERMINAL_INGEST_STATUSES } from "@/api/keys";
import { fetchIngestJob } from "@/api/voice";

// sessionStorage keeps the job id across a reload so an in-flight ingest
// resumes being watched instead of silently disappearing.
const JOB_STORAGE_KEY = "dsh.ingestJobId";
const POLL_INTERVAL_MS = 1000;

function readStoredJobId(): string | null {
  try {
    return sessionStorage.getItem(JOB_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeJobId(jobId: string | null): void {
  try {
    if (jobId) sessionStorage.setItem(JOB_STORAGE_KEY, jobId);
    else sessionStorage.removeItem(JOB_STORAGE_KEY);
  } catch {
    // sessionStorage unavailable — polling still works for this mount.
  }
}

/**
 * Watch one background ingest job.
 *
 * Polling stops automatically at a terminal status and the whole subscription
 * is torn down when the last observer unmounts (TanStack Query owns the
 * single timer, so there are never duplicate polls).
 */
export function useIngestJob() {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(readStoredJobId);

  const query = useQuery({
    queryKey: queryKeys.voice.ingestJob(jobId ?? undefined),
    queryFn: ({ signal }) => fetchIngestJob(jobId as string, signal),
    enabled: jobId !== null,
    retry: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL_INGEST_STATUSES.includes(status)) return false;
      return POLL_INTERVAL_MS;
    },
  });

  // Stop persisting the job once it reaches a terminal state; the UI keeps
  // showing the final snapshot until the next upload starts.
  useEffect(() => {
    if (query.data && TERMINAL_INGEST_STATUSES.includes(query.data.status)) {
      storeJobId(null);
    }
  }, [query.data]);

  const watch = (nextJobId: string) => {
    storeJobId(nextJobId);
    queryClient.removeQueries({
      queryKey: queryKeys.voice.ingestJob(nextJobId),
    });
    setJobId(nextJobId);
  };

  const clear = () => {
    storeJobId(null);
    setJobId(null);
  };

  return {
    jobId,
    job: query.data,
    error: query.error,
    watch,
    clear,
  };
}
