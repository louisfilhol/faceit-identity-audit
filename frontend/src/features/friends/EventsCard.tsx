// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Pill } from "@/components/common/Pill";
import { fmtNum } from "@/lib/format";
import { queryKeys } from "@/api/keys";
import type { FriendsEvent } from "@/api/types";
import { EVENTS_TABLE_HEAD, EventRows } from "./EventsTable";

export function EventsCard({
  events,
  overlapIds,
}: {
  events: FriendsEvent[];
  /** Friends seen on 2+ accounts — rendered as an amber dot on their rows. */
  overlapIds?: Set<string>;
}) {
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
            <Search size={15} aria-hidden="true" />
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
              <EventRows events={rows} overlapIds={overlapIds} />
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
