// SPDX-License-Identifier: AGPL-3.0-only
import { HashRouter, Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/components/layout/AppShell";
import { OverviewPage } from "@/features/overview/OverviewPage";
import { FriendsPage } from "@/features/friends/FriendsPage";
import { VoicePage } from "@/features/voice/VoicePage";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/voice" element={<VoicePage />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
