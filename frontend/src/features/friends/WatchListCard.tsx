// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Pill, Tag } from "@/components/common/Pill";
import { fmtNum, fmtTs } from "@/lib/format";
import type { FriendsSnapshot } from "@/api/types";
import type { AccountLabeler } from "@/features/overview/overlap";
import { overlapFriendIds } from "@/features/overview/overlap";

export function WatchListCard({
  snapshots,
  label,
}: {
  snapshots: FriendsSnapshot[];
  label: AccountLabeler;
}) {
  const [search, setSearch] = useState("");

  const overlapIds = useMemo(
    () => overlapFriendIds(snapshots, label),
    [snapshots, label],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshots
      .filter(
        (s) =>
          !q ||
          (s.nickname || "").toLowerCase().includes(q) ||
          (s.friend_id || "").toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          label(a.account_id).localeCompare(label(b.account_id)) ||
          (a.nickname || "").localeCompare(b.nickname || ""),
      );
  }, [snapshots, search, label]);

  return (
    <div className="card">
      <div className="card-head">
        <h3>Friends watch list</h3>
        <div className="table-tools">
          <div className="search-box">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search friend…"
              aria-label="Search watched friends"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Pill tone="subtle">{fmtNum(rows.length)}</Pill>
        </div>
      </div>
      <p className="card-hint">
        Current friends known for each monitored account. Friends marked{" "}
        <span className="tag warn">overlap</span> are on more than one account.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Friend</th>
              <th>First seen</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr>
                <td colSpan={4} className="empty">
                  {snapshots.length
                    ? "No matching friends."
                    : "No snapshots yet — run a check to build the watch list."}
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={`${s.account_id}-${s.friend_id}`}>
                  <td>{label(s.account_id)}</td>
                  <td>
                    {s.nickname || s.friend_id}{" "}
                    {overlapIds.has(s.friend_id) ? (
                      <Tag tone="warn">overlap</Tag>
                    ) : null}
                  </td>
                  <td className="sub">{fmtTs(s.first_seen)}</td>
                  <td className="sub">{fmtTs(s.last_seen)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
