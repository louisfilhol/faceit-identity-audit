// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, ArrowUpRight, TriangleAlert } from "lucide-react";
import { Pill } from "@/components/common/Pill";
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
type Range = "24h" | "7d" | "30d";

const RANGES: Record<Range, { ms: number; label: string; long: string }> = {
  "24h": { ms: 24 * 3600_000, label: "last 24h", long: "in the last 24h" },
  "7d": { ms: 7 * 24 * 3600_000, label: "last 7d", long: "in the last 7d" },
  "30d": { ms: 30 * 24 * 3600_000, label: "last 30d", long: "in the last 30d" },
};
const RANGE_ORDER: Range[] = ["24h", "7d", "30d"];

const OVERLAP_PREVIEW = 8;

/** Events whose timestamp falls inside the selected window. Module-level so
 * the render body stays free of impure clock reads. */
function eventsInRange(events: FriendsEvent[], range: Range): FriendsEvent[] {
  const minTs = Date.now() - RANGES[range].ms;
  return events.filter((e) => new Date(e.ts).getTime() >= minTs);
}

/** Adds / removes caption for the events KPI, scoped to the window. */
function rangeDeltaFoot(inRange: FriendsEvent[], range: Range): string {
  const adds = inRange.filter((e) => e.kind === "added").length;
  const removes = inRange.filter((e) => e.kind === "removed").length;
  const parts: string[] = [];
  if (adds) parts.push(`+${fmtNum(adds)} adds`);
  if (removes) parts.push(`−${fmtNum(removes)} removes`);
  return parts.length
    ? `${parts.join(" · ")} · ${RANGES[range].label}`
    : `no changes ${RANGES[range].label}`;
}

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
  tone?: "warn" | "good" | "cta";
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
  const [range, setRange] = useState<Range>("7d");

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

  const inRange = useMemo(() => eventsInRange(events, range), [events, range]);
  const shownEvents = useMemo(
    () =>
      kindFilter === "all"
        ? inRange
        : inRange.filter((e) => e.kind === kindFilter),
    [inRange, kindFilter],
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

  // One consistent page name + a summary that earns the header's place.
  const summary = loadErrors.length
    ? "Some data is unavailable — retry from the banner."
    : statusQuery.isLoading || snapshotsQuery.isLoading
      ? "Loading your workspace…"
      : `${fmtNum(fs?.accounts ?? 0)} accounts watched · ${
          overlaps.length
        } potential link${overlaps.length === 1 ? "" : "s"} · ${fmtNum(
          fs?.event_count ?? 0,
        )} changes found`;

  const openOverlap = (nickname: string) =>
    navigate(`/friends?friend=${encodeURIComponent(nickname)}`);

  return (
    <section className="view active">
      <div className="view-head">
        <div>
          <h2>Overview</h2>
          <p className="sub">{summary}</p>
        </div>
        <div className="table-tools">
          <div className="seg" role="group" aria-label="Time range">
            {RANGE_ORDER.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                className={range === r ? "active" : undefined}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={() => check.mutate()}
            disabled={check.isPending}
          >
            {check.isPending ? <Spinner /> : null}
            {check.isPending ? "Checking…" : "Check accounts"}
          </button>
        </div>
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
          label="Potential links"
          value={
            snapshotsQuery.isLoading ? <KpiSkel /> : fmtNum(overlaps.length)
          }
          foot={
            snapshotsQuery.isError
              ? loadFail
              : !snapshots.length
                ? "no snapshots yet"
                : overlaps.length
                  ? "connections worth reviewing"
                  : "nothing needs review"
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
          label="Known connections"
          value={
            snapshotsQuery.isLoading ? <KpiSkel /> : fmtNum(friendIds.size)
          }
          foot={
            snapshotsQuery.isError
              ? loadFail
              : friendIds.size
                ? "across watched accounts"
                : "run your first check"
          }
          to="/friends"
        />
        <Kpi
          label="Activity"
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
                : rangeDeltaFoot(inRange, range)
          }
          to="/friends"
        />
        <Kpi
          label="Accounts"
          value={
            statusQuery.isLoading ? <KpiSkel /> : fs ? fmtNum(fs.accounts) : "—"
          }
          foot={
            statusQuery.isError
              ? loadFail
              : fs
                ? fs.accounts
                  ? "actively watched"
                  : "add your first account"
                : "loading…"
          }
          to="/friends"
        />
        {health.badgeState === "unknown" ? (
          <Kpi label="Voice comparison" value={<KpiSkel />} foot="loading…" />
        ) : health.voiceAvailable ? (
          <Kpi
            label="Voice library"
            value={
              playersQuery.isLoading ? <KpiSkel /> : fmtNum(players.length)
            }
            foot={
              playersQuery.isError
                ? loadFail
                : playersQuery.isLoading
                  ? "loading…"
                  : `${fmtNum(clipCount)} clips · ${fmtDur(audioSec)} speech`
            }
            to="/voice"
          />
        ) : (
          <Kpi
            label="Voice comparison"
            tone="cta"
            to="/voice"
            value="Not set up"
            foot={
              <>
                Set up comparisons
                <ArrowRight size={12} aria-hidden="true" />
              </>
            }
          />
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3 className="card-title warn">
              <TriangleAlert size={16} strokeWidth={2.2} aria-hidden="true" />
              Potential links
            </h3>
            <div className="table-tools">
              <span className="pill">{overlaps.length}</span>
              <Link className="link" to="/friends">
                Review all
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <p className="card-hint">
            Connections appearing on <strong>more than one account</strong>.
            Open one to see where the pattern comes from.
          </p>
          <div className="overlap-list">
            {!snapshots.length ? (
              <div className="empty">
                No activity yet — check your accounts to get started.
              </div>
            ) : !overlaps.length ? (
              <div className="empty">
                Nothing to review. Connections are unique to one account so far.
              </div>
            ) : (
              <>
                <OverlapList overlaps={overlaps} onOpen={openOverlap} />
                {overlaps.length > OVERLAP_PREVIEW ? (
                  <Link className="link overlap-more" to="/friends">
                    +{overlaps.length - OVERLAP_PREVIEW} more — review activity
                    <ArrowRight size={13} aria-hidden="true" />
                  </Link>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Recent activity</h3>
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
              <Pill tone="subtle">{fmtNum(shownEvents.length)}</Pill>
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
                        ? kindFilter !== "all"
                          ? `No ${kindFilter} events ${RANGES[range].long}.`
                          : `No events ${RANGES[range].long}.`
                        : "No activity yet — check your accounts to begin."}
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
              Checking FACEIT accounts — this can take a moment…
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
