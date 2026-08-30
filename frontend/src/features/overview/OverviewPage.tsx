// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, ArrowUpRight, TriangleAlert } from "lucide-react";
import { Spinner } from "@/components/common/Spinner";
import { useHealth } from "@/hooks/useHealth";
import { usePlayers } from "@/hooks/usePlayers";
import { fmtDur, fmtNum, fmtTs } from "@/lib/format";
import {
  computeOverlaps,
  type FriendOverlap,
} from "@/features/overview/overlap";
import {
  useAccountLabels,
  useEvents,
  useFriendsCheckToasts,
  useFriendsStatus,
  useRunFriendsCheck,
  useSnapshots,
} from "@/features/friends/queries";
import { CheckResultPills } from "@/features/friends/CheckResultArea";
import { EVENTS_TABLE_HEAD, EventRows } from "@/features/friends/EventsTable";
import type { FriendsEvent } from "@/api/types";

type KindFilter = "all" | "added" | "removed";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const OVERLAP_PREVIEW = 8;

function KpiSkel() {
  return <span className="skeleton kpi-skel" aria-hidden="true" />;
}

function Kpi({
  label,
  value,
  foot,
  tone,
  to,
}: {
  label: string;
  value: ReactNode;
  foot: ReactNode;
  tone?: "warn" | "good";
  /** When set the whole tile links to that route. */
  to?: string;
}) {
  const cls = `kpi${tone ? ` ${tone}` : ""}${to ? " is-link" : ""}`;
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">{foot}</div>
      {to ? (
        <ArrowUpRight size={14} aria-hidden="true" className="kpi-jump" />
      ) : null}
    </>
  );
  return to ? (
    <Link className={cls} to={to}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A friend seen on several accounts; clicking opens the watch list filtered
 * to that friend. */
function OverlapList({
  overlaps,
  onOpen,
}: {
  overlaps: FriendOverlap[];
  onOpen: (nickname: string) => void;
}) {
  return (
    <>
      {overlaps.slice(0, OVERLAP_PREVIEW).map((o) => (
        <button
          type="button"
          className="overlap-item is-link"
          key={o.friend_id}
          onClick={() => onOpen(o.nickname)}
          title="Inspect this friend in the watch list"
        >
          <div className="overlap-avatar">
            {(o.nickname[0] || "?").toUpperCase()}
          </div>
          <div className="overlap-main">
            <div className="overlap-name">
              {o.nickname}{" "}
              <span className="pill amber">{o.count} accounts</span>
            </div>
            <div className="overlap-meta">
              seen {fmtTs(o.first_seen)} → {fmtTs(o.last_seen)}
            </div>
            <div className="overlap-accounts">
              {o.accounts.map((a) => (
                <span className="overlap-account" key={a.id}>
                  {a.label || a.id}
                </span>
              ))}
            </div>
          </div>
        </button>
      ))}
    </>
  );
}

/** Adds / removes within the trailing seven-day window, for the events KPI
 * delta. Module-level so the render body stays free of impure clock reads. */
function weekDelta(events: FriendsEvent[]): string {
  const weekAgo = Date.now() - WEEK_MS;
  const adds = events.filter(
    (e) => e.kind === "added" && new Date(e.ts).getTime() >= weekAgo,
  ).length;
  const removes = events.filter(
    (e) => e.kind === "removed" && new Date(e.ts).getTime() >= weekAgo,
  ).length;
  const parts: string[] = [];
  if (adds) parts.push(`+${fmtNum(adds)} adds`);
  if (removes) parts.push(`−${fmtNum(removes)} removes`);
  return parts.length
    ? `${parts.join(" · ")} this week`
    : "no changes this week";
}

export function OverviewPage() {
  const health = useHealth();
  const statusQuery = useFriendsStatus();
  const eventsQuery = useEvents();
  const snapshotsQuery = useSnapshots();
  const playersQuery = usePlayers(health.voiceAvailable);
  const labelAccount = useAccountLabels();
  const check = useRunFriendsCheck();
  useFriendsCheckToasts(check);
  const navigate = useNavigate();
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const fs = statusQuery.data;
  const events = useMemo(
    () => eventsQuery.data?.events ?? [],
    [eventsQuery.data],
  );
  const snapshots = useMemo(
    () => snapshotsQuery.data?.snapshots ?? [],
    [snapshotsQuery.data],
  );
  const players = playersQuery.data ?? [];
  const overlaps = useMemo(
    () => computeOverlaps(snapshots, labelAccount),
    [snapshots, labelAccount],
  );
  const overlapIds = useMemo(
    () => new Set(overlaps.map((o) => o.friend_id)),
    [overlaps],
  );

  const friendIds = new Set(snapshots.map((s) => s.friend_id));
  const clipCount = players.reduce((sum, p) => sum + (p.clip_count || 0), 0);
  const audioSec = players.reduce((sum, p) => sum + (p.audio_sec || 0), 0);
  const weekFoot = weekDelta(events);

  const shownEvents = useMemo(
    () =>
      kindFilter === "all"
        ? events
        : events.filter((e) => e.kind === kindFilter),
    [events, kindFilter],
  );

  // Surface query failures instead of showing an eternal "loading…" dashboard.
  const loadErrors = [
    { name: "monitor status", query: statusQuery },
    { name: "recent events", query: eventsQuery },
    { name: "watch list", query: snapshotsQuery },
    ...(health.voiceAvailable
      ? [{ name: "voice profiles", query: playersQuery }]
      : []),
  ].filter((entry) => entry.query.isError);
  const retryFailed = () => {
    for (const entry of loadErrors) void entry.query.refetch();
  };
  const loadFail = <span className="result-note bad">failed to load</span>;

  const openOverlap = (nickname: string) =>
    navigate(`/friends?friend=${encodeURIComponent(nickname)}`);

  return (
    <section className="view active">
      <div className="view-head">
        <div>
          <h2>Dashboard</h2>
          <p className="sub">Live snapshot of both detection tools.</p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => check.mutate()}
          disabled={check.isPending}
        >
          {check.isPending ? <Spinner /> : null}
          {check.isPending ? "Scanning…" : "Run friends check"}
        </button>
      </div>

      {loadErrors.length ? (
        <div className="banner err" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div className="banner-msg">
            <strong>Some data failed to load</strong> —{" "}
            {loadErrors.map((e) => e.name).join(", ")} unavailable. Numbers
            below may be incomplete.
          </div>
          <button type="button" className="btn sm" onClick={retryFailed}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="kpi-grid">
        <Kpi
          label="Suspicious overlaps"
          value={
            snapshotsQuery.isLoading ? <KpiSkel /> : fmtNum(overlaps.length)
          }
          foot={
            snapshotsQuery.isError
              ? loadFail
              : !snapshots.length
                ? "no snapshots yet"
                : overlaps.length
                  ? "friends on 2+ accounts"
                  : "all clear"
          }
          tone={
            !snapshotsQuery.isError && snapshots.length
              ? overlaps.length
                ? "warn"
                : "good"
              : undefined
          }
          to="/friends"
        />
        <Kpi
          label="Friends watched"
          value={
            snapshotsQuery.isLoading ? <KpiSkel /> : fmtNum(friendIds.size)
          }
          foot={
            snapshotsQuery.isError
              ? loadFail
              : friendIds.size
                ? "across all accounts"
                : "no snapshots yet"
          }
          to="/friends"
        />
        <Kpi
          label="Events recorded"
          value={
            statusQuery.isLoading ? (
              <KpiSkel />
            ) : fs ? (
              fmtNum(fs.event_count)
            ) : (
              "—"
            )
          }
          foot={
            eventsQuery.isError
              ? loadFail
              : eventsQuery.isLoading
                ? "loading…"
                : weekFoot
          }
          to="/friends"
        />
        <Kpi
          label="Monitored accounts"
          value={
            statusQuery.isLoading ? <KpiSkel /> : fs ? fmtNum(fs.accounts) : "—"
          }
          foot={
            statusQuery.isError
              ? loadFail
              : fs
                ? fs.db_exists
                  ? `from ${fs.used_file}`
                  : "no config — add accounts"
                : "loading…"
          }
          to="/friends"
        />
        <Kpi
          label="Voice profiles"
          value={
            !health.voiceAvailable ? (
              "—"
            ) : playersQuery.isLoading ? (
              <KpiSkel />
            ) : (
              fmtNum(players.length)
            )
          }
          foot={
            !health.voiceAvailable
              ? "voice off — set up in Voice Identity"
              : playersQuery.isError
                ? loadFail
                : playersQuery.isLoading
                  ? "loading…"
                  : `${fmtNum(clipCount)} clips · ${fmtDur(audioSec)} speech`
          }
          to="/voice"
        />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3 className="card-title warn">
              <TriangleAlert size={16} strokeWidth={2.2} aria-hidden="true" />
              Suspicious overlaps
            </h3>
            <div className="table-tools">
              <span className="pill">{overlaps.length}</span>
              <Link className="link" to="/friends">
                All overlaps
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <p className="card-hint">
            Friends who appear on <strong>2+ monitored accounts</strong> — the
            classic multi-accounting signal. Click one to inspect it on the
            watch list.
          </p>
          <div className="overlap-list">
            {!snapshots.length ? (
              <div className="empty">
                No snapshots yet — run a friends check to start watching.
              </div>
            ) : !overlaps.length ? (
              <div className="empty">
                No overlaps detected. Every friend is unique to one account so
                far.
              </div>
            ) : (
              <>
                <OverlapList overlaps={overlaps} onOpen={openOverlap} />
                {overlaps.length > OVERLAP_PREVIEW ? (
                  <Link className="link overlap-more" to="/friends">
                    +{overlaps.length - OVERLAP_PREVIEW} more — open Friends
                    Monitor
                    <ArrowRight size={13} aria-hidden="true" />
                  </Link>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Recent events</h3>
            <div className="table-tools">
              <div className="seg" role="group" aria-label="Filter by kind">
                {(["all", "added", "removed"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kindFilter === k}
                    className={kindFilter === k ? "active" : undefined}
                    onClick={() => setKindFilter(k)}
                  >
                    {k === "all" ? "All" : k === "added" ? "Added" : "Removed"}
                  </button>
                ))}
              </div>
              <Link className="link" to="/friends">
                View all
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              {EVENTS_TABLE_HEAD}
              <tbody>
                {shownEvents.length ? (
                  <EventRows
                    events={shownEvents.slice(0, 10)}
                    overlapIds={overlapIds}
                  />
                ) : (
                  <tr>
                    <td colSpan={4} className="empty">
                      {events.length
                        ? `No ${kindFilter} events in recent history.`
                        : "No events recorded yet — run a friends check to start tracking."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {check.isPending || check.isSuccess || check.isError ? (
        <div className="quick-result" id="quick-check-result">
          {check.isPending ? (
            <span className="result-note busy">
              Running checks against FACEIT — this can take a minute…
            </span>
          ) : check.isError ? (
            <span className="result-note bad">{check.error.message}</span>
          ) : (
            <CheckResultPills results={check.data.results} />
          )}
        </div>
      ) : null}
    </section>
  );
}
