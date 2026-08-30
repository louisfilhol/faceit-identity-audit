// SPDX-License-Identifier: AGPL-3.0-only
import { fmtClock } from "@/lib/format";

export function Topbar({
  title,
  lastUpdatedAt,
  navOpen,
  onToggleNav,
  onRefresh,
}: {
  title: string;
  /** Epoch ms of the most recent successful data load ("updated HH:MM"). */
  lastUpdatedAt: number | null;
  /** Whether the mobile navigation drawer is open. */
  navOpen: boolean;
  onToggleNav: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn nav-toggle"
        aria-label="Toggle navigation"
        aria-expanded={navOpen}
        aria-controls="sidebar"
        onClick={onToggleNav}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <h1 className="page-title">{title}</h1>
      <div className="topbar-actions">
        {lastUpdatedAt ? (
          <span className="last-updated">{fmtClock(lastUpdatedAt)}</span>
        ) : null}
        <button
          type="button"
          className="btn ghost icon-only"
          title="Refresh all data"
          aria-label="Refresh all data"
          onClick={onRefresh}
        >
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>
    </header>
  );
}
