// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/common/Toast";
import App from "@/App";

/**
 * Deterministic fetch mock: route a URL to a JSON payload, status, or a
 * function returning either. Tests install routes via `installFetchRoutes`.
 */
export type RouteHandler =
  | { status?: number; body: unknown }
  | ((
      url: URL,
      init?: RequestInit,
    ) => { status?: number; body: unknown } | null);

export interface RouteLog {
  url: string;
  method: string;
  body?: string | null;
}

export function installFetchRoutes(routes: Record<string, RouteHandler>) {
  const calls: RouteLog[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === "string" ? input : input.toString();
      const url = new URL(href, "http://testserver");
      const pathWithQuery = url.pathname + url.search;
      calls.push({
        url: pathWithQuery,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      const handler = routes[url.pathname] ?? routes[pathWithQuery];
      if (!handler) {
        return new Response(
          JSON.stringify({ detail: `no route for ${pathWithQuery}` }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      const resolved =
        typeof handler === "function" ? handler(url, init) : handler;
      if (!resolved) {
        return new Response(
          JSON.stringify({ detail: `no route for ${pathWithQuery}` }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      const status = resolved.status ?? 200;
      const text =
        typeof resolved.body === "string"
          ? resolved.body
          : JSON.stringify(resolved.body ?? null);
      return new Response(text, {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    restore: () => {
      vi.unstubAllGlobals();
      calls.length = 0;
    },
  };
}

/** Render any node wrapped in the providers the app uses. */
export function renderWithProviders(ui: ReactNode, options?: RenderOptions) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient };
}

/** Render the full application (router included). */
export function renderApp() {
  return renderWithProviders(<App />);
}

/** Common API payloads reused by several view tests. */
export const fixtures = {
  health(voice = true) {
    return { status: "ok", friends_configured: true, voice_available: voice };
  },
  friendsStatus: {
    used_file: "config.json",
    has_webhook: false,
    accounts: 3,
    db_exists: true,
    event_count: 42,
    snapshot_accounts: 3,
    scheduler: {
      enabled: true,
      interval_minutes: 5,
      configured: true,
      accounts: 3,
      active: true,
      running: false,
      last_started: null,
      last_finished: null,
      last_result: null,
      last_error: null,
      next_run: null,
    },
  },
  config: {
    discord_webhook: "",
    discord_ping: "",
    accounts: [
      { guid: "guid-a", label: "Alpha", faceit: "alpha" },
      { guid: "guid-b", label: "Beta", faceit: "beta" },
    ],
    scheduler: { enabled: true, interval_minutes: 5 },
    _used_file: "config.json",
  },
  events: {
    events: [
      {
        // Relative to load time so range-scoped overview tests never age out.
        ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        account_lbl: "Alpha",
        kind: "added",
        friend_id: "f1",
        nickname: "mutual_friend",
      },
    ],
  },
  snapshots: {
    snapshots: [
      {
        account_id: "guid-a",
        friend_id: "f1",
        nickname: "mutual_friend",
        first_seen: "2026-08-28T03:45:00Z",
        last_seen: "2026-08-29T03:45:00Z",
      },
      {
        account_id: "guid-b",
        friend_id: "f1",
        nickname: "mutual_friend",
        first_seen: "2026-08-28T04:45:00Z",
        last_seen: "2026-08-29T04:45:00Z",
      },
      {
        account_id: "guid-a",
        friend_id: "f2",
        nickname: "only_alpha",
        first_seen: "2026-08-28T03:45:00Z",
        last_seen: "2026-08-29T03:45:00Z",
      },
    ],
  },
  players: [
    {
      steamid: "76561198000000001",
      nickname: "PlayerOne",
      consent: true,
      clip_count: 5,
      audio_sec: 42,
    },
  ],
  defaultRoutes(voice = true) {
    return {
      "/api/health": { body: this.health(voice) },
      "/api/friends/status": { body: this.friendsStatus },
      "/api/friends/config": { body: this.config },
      "/api/friends/events": { body: this.events },
      "/api/friends/snapshots": { body: this.snapshots },
      "/api/friends/overlap": { body: { accounts: [], pairs: [] } },
      "/api/friends/scheduler": (_url: URL, init?: RequestInit) =>
        init?.method === "PUT"
          ? {
              status: 200,
              body: {
                ok: true,
                scheduler: {
                  ...this.friendsStatus.scheduler,
                  ...(JSON.parse(String(init.body ?? "{}")) as object),
                },
              },
            }
          : null,
      "/api/voice/players": { body: this.players },
      "/api/faceit/status": {
        body: {
          accounts: [],
          cdp_configured: false,
          headless_default: false,
          profile_exists: false,
          demos_dir: "/tmp/demos",
          playwright_installed: false,
          job: {
            running: false,
            started: null,
            finished: null,
            log: [],
            result: null,
            error: null,
          },
        },
      },
      "/api/faceit/sync/status": {
        body: {
          running: false,
          started: null,
          finished: null,
          log: [],
          result: null,
          error: null,
        },
      },
    };
  },
};
