// SPDX-License-Identifier: AGPL-3.0-only
import { NavLink } from "react-router";
import type { HealthSummary } from "@/hooks/useHealth";

const NAV_ITEMS = [
  {
    to: "/overview",
    label: "Overview",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    to: "/friends",
    label: "Friends Monitor",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    to: "/voice",
    label: "Voice Identity",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    ),
  },
];

export function Sidebar({
  health,
  open,
  onNavigate,
}: {
  health: HealthSummary;
  open: boolean;
  onNavigate: () => void;
}) {
  return (
    <aside className={`sidebar${open ? " open" : ""}`} id="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 3h12l4 6-10 13L2 9z" />
            <path d="M2 9h20M12 22 8 9l4-6 4 6-4 13" />
          </svg>
        </div>
        <div className="brand-text">
          <strong>FACEIT</strong>
          <span>Multi-Account Detection</span>
        </div>
      </div>

      <nav className="nav" aria-label="Primary" onClick={onNavigate}>
        <span className="nav-label">Workspace</span>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className="nav-item">
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {/* role="status" lets assistive tech announce health changes. */}
        <div className="health" data-state={health.badgeState} role="status">
          <span className="health-dot" aria-hidden="true" />
          <span className="health-text">{health.badgeText}</span>
        </div>
      </div>
    </aside>
  );
}
