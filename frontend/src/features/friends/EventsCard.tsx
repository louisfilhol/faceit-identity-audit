// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pill } from "@/components/common/Pill";
import { fmtNum } from "@/lib/format";
import { queryKeys } from "@/api/keys";
import type { FriendsEvent } from "@/api/types";
import { EVENTS_TABLE_HEAD, EventRows } from "./EventsTable";

export function EventsCard({ events }: { events: FriendsEvent[] }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(
      (e) =>
        (!kind || e.kind === kind) &&
        (!q ||
          (e.nickname || "").toLowerCase().includes(q) ||
          (e.friend_id || "").toLowerCase().includes(q)),
    );
  }, [events, search, kind]);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.friends.events });

  return (
    <div className="card">
      <div className="card-head">
        <h3>Event history</h3>
        <div className="table-tools">
          <div className="search-box">
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder="Search nickname…"
              aria-label="Search events by nickname"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="select"
            aria-label="Filter by event kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">All kinds</option>
            <option value="added">Added</option>
            <option value="removed">Removed</option>
          </select>
          <Pill tone="subtle">{fmtNum(rows.length)}</Pill>
          <button type="button" className="btn ghost sm" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          {EVENTS_TABLE_HEAD}
          <tbody>
            {rows.length ? (
              <EventRows events={rows} />
            ) : (
              <tr>
                <td colSpan={4} className="empty">
                  No matching events.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
