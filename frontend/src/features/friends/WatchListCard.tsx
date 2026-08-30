// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Pill, Tag } from "@/components/common/Pill";
import { fmtNum, fmtTs } from "@/lib/format";
import type { FriendsSnapshot } from "@/api/types";
import type { AccountLabeler } from "@/features/overview/overlap";
import { overlapFriendIds } from "@/features/overview/overlap";

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZES = [20, 50, 100] as const;

export function WatchListCard({
  snapshots,
  label,
}: {
  snapshots: FriendsSnapshot[];
  label: AccountLabeler;
}) {
  // /friends?friend=<nickname> deep link (used by the overview overlap rows)
  // seeds the search box.
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("friend") ?? "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

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

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleRows = rows.slice(pageStart, pageStart + pageSize);
  const rangeStart = rows.length ? pageStart + 1 : 0;
  const rangeEnd = Math.min(pageStart + pageSize, rows.length);

  return (
    <div className="card">
      <div className="card-head">
        <h3>Known connections</h3>
        <div className="table-tools">
          <div className="search-box">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search friend…"
              aria-label="Search watched friends"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Pill tone="subtle">{fmtNum(rows.length)}</Pill>
        </div>
      </div>
      <p className="card-hint">
        Everyone currently connected to a monitored account. An{" "}
        <span className="tag warn">overlap</span> appears on more than one.
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
            {!visibleRows.length ? (
              <tr>
                <td colSpan={4} className="empty">
                  {snapshots.length
                    ? "No matching friends."
                    : "No connections yet — run a check to get started."}
                </td>
              </tr>
            ) : (
              visibleRows.map((s) => (
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
      {rows.length > 0 ? (
        <div className="pagination">
          <span className="pagination-range">
            {fmtNum(rangeStart)}–{fmtNum(rangeEnd)} of {fmtNum(rows.length)}
          </span>
          <div className="pagination-controls">
            <label className="pagination-size">
              <span>Rows</span>
              <select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <nav className="pagination-nav" aria-label="Connections pages">
              <button
                type="button"
                className="btn ghost pagination-button"
                aria-label="Previous page"
                disabled={currentPage === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              <span className="pagination-page" aria-live="polite">
                Page {fmtNum(currentPage)} of {fmtNum(totalPages)}
              </span>
              <button
                type="button"
                className="btn ghost pagination-button"
                aria-label="Next page"
                disabled={currentPage === totalPages}
                onClick={() =>
                  setPage((value) => Math.min(totalPages, value + 1))
                }
              >
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
