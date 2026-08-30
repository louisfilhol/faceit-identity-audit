// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from "react";
import { Link } from "react-router";
import { ArrowRight, TriangleAlert } from "lucide-react";
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

function Kpi({
  label,
  value,
  foot,
  accent,
}: {
  label: string;
  value: string;
  foot: string;
  accent?: boolean;
}) {
  return (
    <div className={`kpi${accent ? " accent" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">{foot}</div>
    </div>
  );
}

function OverlapList({ overlaps }: { overlaps: FriendOverlap[] }) {
  return (
    <>
      {overlaps.slice(0, 8).map((o) => (
        <div className="overlap-item" key={o.friend_id}>
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
        </div>
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

  const adds = events.filter((e) => e.kind === "added").length;
  const removes = events.filter((e) => e.kind === "removed").length;
  const friendIds = new Set(snapshots.map((s) => s.friend_id));
  const clipCount = players.reduce((sum, p) => sum + (p.clip_count || 0), 0);
  const audioSec = players.reduce((sum, p) => sum + (p.audio_sec || 0), 0);

  const runCheck = () => check.mutate();

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
          onClick={runCheck}
          disabled={check.isPending}
        >
          {check.isPending ? <Spinner /> : null}
          {check.isPending ? "Scanning…" : "Run friends check"}
        </button>
      </div>

      <div className="kpi-grid">
        <Kpi
          label="Friends accounts"
          value={fs ? fmtNum(fs.accounts) : "—"}
          foot={
            fs
              ? fs.db_exists
                ? "monitored accounts"
                : "no config"
              : "loading…"
          }
        />
        <Kpi
          label="Events recorded"
          value={fs && fs.event_count ? fmtNum(fs.event_count) : "—"}
          foot={
            events.length
              ? `last ${events.length}: ${adds} adds · ${removes} removes`
              : "adds / removes"
          }
        />
        <Kpi
          label="Friends watched"
          value={friendIds.size ? fmtNum(friendIds.size) : "—"}
          foot={snapshots.length ? "across all accounts" : "no snapshots yet"}
        />
        <Kpi
          label="Voice players"
          value={players.length ? fmtNum(players.length) : "—"}
          foot={health.voiceAvailable ? "embedded in DB" : "voice off"}
        />
        <Kpi
          label="Voice clips"
          value={clipCount ? fmtNum(clipCount) : "—"}
          foot="extracted segments"
        />
        <Kpi
          label="Audio processed"
          value={audioSec ? fmtDur(audioSec) : "—"}
          foot="total speech time"
          accent
        />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3 className="card-title warn">
              <TriangleAlert size={16} strokeWidth={2.2} aria-hidden="true" />
              Suspicious overlaps
            </h3>
            <span className="pill">{overlaps.length}</span>
          </div>
          <p className="card-hint">
            Friends who appear on <strong>2+ monitored accounts</strong> — the
            classic multi-accounting signal.
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
              <OverlapList overlaps={overlaps} />
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Recent events</h3>
            <Link className="link" to="/friends">
              View all
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              {EVENTS_TABLE_HEAD}
              <tbody>
                {events.length ? (
                  <EventRows events={events.slice(0, 10)} />
                ) : (
                  <tr>
                    <td colSpan={4} className="empty">
                      No events yet. Run a check to seed.
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
