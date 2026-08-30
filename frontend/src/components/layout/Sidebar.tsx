// SPDX-License-Identifier: AGPL-3.0-only
import { Gem, LayoutDashboard, Mic, Users } from "lucide-react";
import { NavLink } from "react-router";
import type { HealthSummary } from "@/hooks/useHealth";

const NAV_ITEMS = [
  {
    to: "/overview",
    label: "Overview",
    icon: <LayoutDashboard size={18} aria-hidden="true" />,
  },
  {
    to: "/friends",
    label: "Friends Monitor",
    icon: <Users size={18} aria-hidden="true" />,
  },
  {
    to: "/voice",
    label: "Voice Identity",
    icon: <Mic size={18} aria-hidden="true" />,
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
          <Gem size={20} strokeWidth={2.2} />
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
