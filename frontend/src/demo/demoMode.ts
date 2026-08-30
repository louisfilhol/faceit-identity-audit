// SPDX-License-Identifier: AGPL-3.0-only
/** Read-only demo mode for showcasing the UI without any private data.
 *
 * Activation is explicit and visible: the URL must contain `?demo=1`
 * (e.g. http://127.0.0.1:8000/?demo=1#/overview) and a banner is shown.
 * It never activates on its own, and demo requests never reach a server —
 * the client answers them from these fixtures or fails locally.
 */

import * as fx from "./fixtures";

export function isDemoMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  } catch {
    return false;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Resolve a demo response for a request, or null when unknown. */
export function demoResponse(path: string, method: string): Response | null {
  if (method !== "GET") {
    // Writes are acknowledged but not applied — demo mode is read-only.
    if (path === "/api/friends/config") {
      return jsonResponse({ ok: true, used_file: "demo", accounts: 3 });
    }
    if (path === "/api/friends/scheduler") {
      return jsonResponse({ ok: true, scheduler: fx.demoConfig.scheduler });
    }
    if (path === "/api/friends/check") {
      return jsonResponse({
        results: fx.demoConfig.accounts.map((a) => ({
          label: a.label ?? "",
          ok: true,
          added: 0,
          removed: 0,
        })),
      });
    }
    if (path === "/api/voice/ingest") {
      return jsonResponse({
        job_id: "demo-job",
        status: "completed",
        deduplicated: false,
        status_url: "/api/voice/ingest/demo-job",
      });
    }
    if (path === "/api/faceit/login") {
      return jsonResponse({
        ok: true,
        detail: "no browser is opened in demo mode",
      });
    }
    if (path === "/api/faceit/sync") {
      return jsonResponse({ started: true });
    }
    return jsonResponse({ ok: true });
  }

  if (path === "/api/health") return jsonResponse(fx.demoHealth);
  if (path === "/api/friends/status") return jsonResponse(fx.demoFriendsStatus);
  if (path === "/api/friends/config") return jsonResponse(fx.demoConfig);
  if (path.startsWith("/api/friends/events"))
    return jsonResponse(fx.demoEvents);
  if (path === "/api/friends/snapshots") return jsonResponse(fx.demoSnapshots);
  if (path === "/api/friends/overlap") return jsonResponse(fx.demoOverlapList);
  if (path.startsWith("/api/friends/resolve")) {
    const q = new URLSearchParams(path.split("?")[1] ?? "").get("q") ?? "";
    return jsonResponse({
      guid: `demo-guid-${encodeURIComponent(q) || "empty"}`,
      nickname: q,
      country: null,
      avatar: null,
      resolved: true,
    });
  }
  const overlapDetail = path.match(
    /^\/api\/friends\/overlap\/([^/]+)\/([^/]+)$/,
  );
  if (overlapDetail) {
    return jsonResponse(
      fx.demoOverlapDetail(
        decodeURIComponent(overlapDetail[1] ?? ""),
        decodeURIComponent(overlapDetail[2] ?? ""),
      ),
    );
  }
  if (path === "/api/voice/players") return jsonResponse(fx.demoPlayers);
  if (path === "/api/voice/verify") return jsonResponse(fx.demoVerify);
  if (path === "/api/voice/match") return jsonResponse(fx.demoMatch);
  if (path.startsWith("/api/voice/ingest")) {
    return jsonResponse({
      job_id: "demo-job",
      status: "completed",
      deduplicated: false,
      status_url: "/api/voice/ingest/demo-job",
      filename: "demo_match.dem",
      demo_id: 1,
      result: {
        demo_id: 1,
        players: fx.demoPlayers.map((p) => ({
          steamid: p.steamid,
          nickname: p.nickname,
          status: "embedded",
        })),
      },
      error: null,
      progress: {
        phase: "completed",
        current: 3,
        total: 3,
        percent: 100,
        players: [],
        message: "Ingest complete (demo)",
      },
    });
  }
  const cluster = path.match(/^\/api\/voice\/demo\/(\d+)\/cluster$/);
  if (cluster) return jsonResponse(fx.demoCluster);
  if (path === "/api/faceit/status") return jsonResponse(fx.demoFaceitStatus);
  if (path === "/api/faceit/sync/status")
    return jsonResponse(fx.demoSyncStatus);
  return null;
}
