// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useLocation } from "react-router";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useHealth } from "@/hooks/useHealth";
import { useToast } from "@/components/common/Toast";
import { queryKeys } from "@/api/keys";
import { isDemoMode } from "@/demo/demoMode";

const PAGE_TITLES: Record<string, string> = {
  overview: "Overview",
  friends: "Friend activity",
  voice: "Voice comparison",
};

export function AppShell() {
  const health = useHealth();
  const [navOpen, setNavOpen] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();

  const pageTitle =
    PAGE_TITLES[location.pathname.replace(/^\//, "")] ?? "Overview";

  // "updated HH:MM" mirrors the newest successful health/friends load.
  const healthState = queryClient.getQueryState(queryKeys.health);
  const friendsState = queryClient.getQueryState(queryKeys.friends.status);
  const lastUpdatedAt = Math.max(
    healthState?.dataUpdatedAt ?? 0,
    friendsState?.dataUpdatedAt ?? 0,
  );

  // The mobile drawer is modal-feeling; Escape should dismiss it.
  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  const refreshAll = useCallback(async () => {
    await queryClient.invalidateQueries();
    toast("All data refreshed", "good");
  }, [queryClient, toast]);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        health={health}
        open={navOpen}
        onNavigate={() => setNavOpen(false)}
      />
      <div className="main">
        <Topbar
          title={pageTitle}
          lastUpdatedAt={lastUpdatedAt || null}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((open) => !open)}
          onRefresh={() => void refreshAll()}
        />
        <main className="content" id="main-content">
          {isDemoMode() ? (
            <div className="banner warn" role="status">
              <strong>Preview data</strong>
              <span>
                You’re exploring a safe sample workspace. No real accounts are
                connected.
              </span>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
