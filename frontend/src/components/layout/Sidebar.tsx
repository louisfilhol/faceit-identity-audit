// SPDX-License-Identifier: AGPL-3.0-only
import { Activity, AudioLines, LayoutDashboard } from "lucide-react";
import { NavLink } from "react-router";
import type { HealthSummary } from "@/hooks/useHealth";

/** FACEIT brand mark (simpleicons.org), filled from the parent's color. */
function FaceitMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <path d="M23.999 2.705a.167.167 0 00-.312-.1 1141.27 1141.27 0 00-6.053 9.375H.218c-.221 0-.301.282-.11.352 7.227 2.73 17.667 6.836 23.5 9.134.15.06.39-.08.39-.18z" />
    </svg>
  );
}

const NAV_ITEMS = [
  {
    to: "/overview",
    label: "Overview",
    icon: <LayoutDashboard size={18} aria-hidden="true" />,
  },
  {
    to: "/friends",
    label: "Friend activity",
    icon: <Activity size={18} aria-hidden="true" />,
  },
  {
    to: "/voice",
    label: "Voice comparison",
    icon: <AudioLines size={18} aria-hidden="true" />,
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
          <FaceitMark size={20} />
        </div>
        <div className="brand-text">
          <strong>Signals</strong>
          <span>FACEIT account intelligence</span>
        </div>
      </div>

      <nav className="nav" aria-label="Primary" onClick={onNavigate}>
        <span className="nav-label">Monitor</span>
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
