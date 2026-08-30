// SPDX-License-Identifier: AGPL-3.0-only
import { Menu, RefreshCw } from "lucide-react";
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
        <Menu size={20} aria-hidden="true" />
      </button>
      <div className="page-title" aria-label={`Current page: ${title}`}>
        <span>Signals</span>
        <span className="page-title-separator">/</span>
        <strong>{title}</strong>
      </div>
      <div className="topbar-actions">
        {lastUpdatedAt ? (
          <span className="last-updated">
            Updated {fmtClock(lastUpdatedAt).replace(/^updated\s+/i, "")}
          </span>
        ) : null}
        <button
          type="button"
          className="btn ghost topbar-refresh"
          title="Refresh all data"
          aria-label="Refresh all data"
          onClick={onRefresh}
        >
          <RefreshCw size={17} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>
    </header>
  );
}
