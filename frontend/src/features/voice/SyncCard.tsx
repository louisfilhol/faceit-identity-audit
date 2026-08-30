// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Pill, Tag } from "@/components/common/Pill";
import { ResultNote } from "@/components/common/ResultNote";
import { Spinner } from "@/components/common/Spinner";
import { useToast } from "@/components/common/Toast";
import {
  faceitLogin,
  fetchFaceitStatus,
  fetchSyncStatus,
  startFaceitSync,
} from "@/api/faceit";
import { queryKeys } from "@/api/keys";
import type { FaceitStatus, SyncMatch, SyncMatchStatus } from "@/api/types";
import { shortId, shortMatchId } from "@/lib/format";

const SYNC_POLL_MS = 2000;

const SYNC_TAG: Record<
  SyncMatchStatus,
  { tone: "ok" | "skip" | "err"; label: string }
> = {
  ingested: { tone: "ok", label: "ingested" },
  downloaded: { tone: "ok", label: "downloaded" },
  skipped_existing: { tone: "skip", label: "already local" },
  no_demo: { tone: "skip", label: "no demo" },
  failed: { tone: "err", label: "failed" },
};

function sessionPill(s: FaceitStatus): {
  text: string;
  tone: "subtle" | "red" | "green";
} {
  if (!s.playwright_installed)
    return { text: "session: playwright missing", tone: "red" };
  if (s.cdp_configured) return { text: "session: CDP browser", tone: "green" };
  if (s.profile_exists) return { text: "session: saved", tone: "green" };
  return { text: "session: login needed", tone: "subtle" };
}

function VoiceMatchTags({ match }: { match: SyncMatch }) {
  const pairs = match.voice_matches ?? [];
  if (!pairs.length) return <span className="sub">—</span>;
  return (
    <>
      {pairs.flatMap((v, vi) =>
        v.matches.map((hit, hi) => {
          const verdict = hit.verdict || "inconclusive";
          const tone =
            verdict === "same"
              ? "red"
              : verdict === "different"
                ? "green"
                : "warn";
          const relation = verdict === "same" ? "≈" : "↔";
          const label = verdict === "same" ? "SAME" : verdict.toUpperCase();
          return (
            <Tag
              key={`${vi}-${hi}`}
              tone={tone}
              title={(hit.reasons ?? []).join("; ")}
            >
              {v.nickname || shortId(v.steamid)} {relation}{" "}
              {hit.nickname || shortId(hit.steamid)} · {hit.score.toFixed(2)} ·{" "}
              {label}
            </Tag>
          );
        }),
      )}
    </>
  );
}

export function SyncCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: queryKeys.faceit.status,
    queryFn: ({ signal }) => fetchFaceitStatus(signal),
  });
  const syncQuery = useQuery({
    queryKey: queryKeys.faceit.syncStatus,
    queryFn: ({ signal }) => fetchSyncStatus(signal),
    // Poll only while a sync job is actually running.
    refetchInterval: (query) =>
      query.state.data?.running ? SYNC_POLL_MS : false,
  });
  const [limit, setLimit] = useState("10");
  const [userNote, setUserNote] = useState<{
    text: string;
    cls: string;
  } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const lastFinishedRef = useRef<number | null>(null);

  const login = useMutation({
    mutationFn: () => faceitLogin(),
    onMutate: () => {
      setStartedAt(null);
      setUserNote({
        text: "opening a browser window — log in to FACEIT there…",
        cls: "result-note busy",
      });
    },
    onSuccess: (r) => {
      setUserNote({ text: r.detail || "logged in", cls: "result-note good" });
      toast("FACEIT session saved", "good");
    },
    onError: (e) => {
      setUserNote({ text: e.message, cls: "result-note bad" });
      toast(`Login failed: ${e.message}`, "bad", 6000);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.faceit.status });
    },
  });

  // Completion note for a sync started from this page — derived, so a page
  // reload that finds an already-finished job shows no stale message.
  const syncData = syncQuery.data;
  const completionNote = useMemo(() => {
    if (startedAt === null || !syncData || syncData.running) return null;
    if (!syncData.finished || syncData.finished < startedAt) return null;
    if (syncData.error) {
      return { text: syncData.error, cls: "result-note bad" };
    }
    const r = syncData.result ?? {};
    return {
      text: `done · ${r.downloaded ?? 0} downloaded · ${r.failed ?? 0} failed`,
      cls: "result-note good",
    };
  }, [startedAt, syncData]);

  // One-shot completion side effects (toasts + cache refresh only).
  useEffect(() => {
    if (startedAt === null || !syncData || syncData.running) return;
    const finishedAt = syncData.finished ?? 0;
    if (!finishedAt || finishedAt < startedAt) return;
    if (lastFinishedRef.current === finishedAt) return;
    lastFinishedRef.current = finishedAt;
    if (syncData.error) {
      toast(`Sync failed: ${syncData.error}`, "bad", 7000);
    } else {
      const r = syncData.result ?? {};
      toast(
        `Sync done · ${r.downloaded ?? 0} demo(s) downloaded`,
        "good",
        6000,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.voice.players });
      void queryClient.invalidateQueries({ queryKey: queryKeys.faceit.status });
    }
  }, [startedAt, syncData, toast, queryClient]);

  const status = statusQuery.data;
  const session = status ? sessionPill(status) : null;
  const matches = syncData?.result?.matches ?? [];
  const note = completionNote ?? userNote;

  const onStart = async () => {
    setStarting(true);
    try {
      await startFaceitSync(Math.max(1, Math.min(100, Number(limit) || 10)));
      setUserNote({ text: "sync running…", cls: "result-note busy" });
      lastFinishedRef.current = null;
      const now = Date.now() / 1000;
      setStartedAt(now);
      await syncQuery.refetch();
    } catch (e) {
      setUserNote({ text: (e as Error).message, cls: "result-note bad" });
      setStartedAt(null);
    } finally {
      setStarting(false);
    }
  };

  const syncRunning = syncData?.running ?? false;

  return (
    <div className="card">
      <div className="card-head">
        <h3>Auto-sync FACEIT demos</h3>
        {session ? <Pill tone={session.tone}>{session.text}</Pill> : null}
      </div>
      <p className="card-hint">
        Pulls recent matches for every monitored account, downloads demos that
        aren't on disk yet and ingests them into the voice DB. Downloads go
        through a one-time FACEIT login inside an automation-browser window this
        server opens.
      </p>
      <div className="field-row">
        <label htmlFor="sync-limit">Matches / account</label>
        <input
          id="sync-limit"
          type="number"
          value={limit}
          min={1}
          max={100}
          style={{ maxWidth: 90 }}
          onChange={(e) => setLimit(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          onClick={() => login.mutate()}
          disabled={
            login.isPending || (status ? !status.playwright_installed : false)
          }
        >
          {login.isPending ? <Spinner /> : null} Log in…
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void onStart()}
          disabled={
            starting ||
            syncRunning ||
            (status ? !status.playwright_installed : false)
          }
        >
          {starting || syncRunning ? <Spinner /> : null}
          <Download size={16} strokeWidth={2.2} aria-hidden="true" />
          Sync recent matches
        </button>
        {note ? <ResultNote note={note} /> : null}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Account</th>
              <th>Match</th>
              <th>Status</th>
              <th>Voice matches</th>
            </tr>
          </thead>
          <tbody>
            {!matches.length ? (
              <tr>
                <td colSpan={5} className="empty">
                  Nothing synced yet.
                </td>
              </tr>
            ) : (
              matches.map((m, i) => {
                const tag =
                  (m.status && SYNC_TAG[m.status]) ||
                  ({ tone: "skip", label: m.status || "—" } as const);
                return (
                  <tr key={`${m.match_id}-${i}`}>
                    <td className="sub">{m.date || "—"}</td>
                    <td>{m.account || "—"}</td>
                    <td className="mono sub" style={{ fontSize: "11.5px" }}>
                      {shortMatchId(m.match_id)}
                    </td>
                    <td>
                      <Tag tone={tag.tone}>{tag.label}</Tag>
                    </td>
                    <td>
                      {m.error ? (
                        <span className="sub">{m.error}</span>
                      ) : (
                        <VoiceMatchTags match={m} />
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {syncData && (syncData.log.length > 0 || syncRunning) ? (
        <pre className="sync-log">{syncData.log.join("\n")}</pre>
      ) : null}
    </div>
  );
}
