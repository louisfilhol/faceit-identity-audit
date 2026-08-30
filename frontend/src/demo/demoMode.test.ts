// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import { isDemoMode, demoResponse } from "./demoMode";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("demo mode activation", () => {
  it("is off by default and never activates on its own", () => {
    expect(isDemoMode()).toBe(false);
  });

  it("activates only with an explicit ?demo=1 parameter", () => {
    window.history.replaceState(null, "", "/?demo=1#/overview");
    expect(isDemoMode()).toBe(true);
  });

  it("stays off for arbitrary other parameters", () => {
    window.history.replaceState(null, "", "/?demo=0#/overview");
    expect(isDemoMode()).toBe(false);
    window.history.replaceState(null, "", "/?other=1#/overview");
    expect(isDemoMode()).toBe(false);
  });
});

describe("demo fixture coverage", () => {
  // Every endpoint the API client can produce must be answerable locally, so
  // demo mode never needs the network (enforced again in client.test.ts).
  const covered = [
    ["GET", "/api/health"],
    ["GET", "/api/friends/status"],
    ["GET", "/api/friends/config"],
    ["PUT", "/api/friends/config"],
    ["GET", "/api/friends/events?limit=500"],
    ["GET", "/api/friends/snapshots"],
    ["GET", "/api/friends/overlap"],
    ["GET", "/api/friends/overlap/a/b"],
    ["GET", "/api/friends/resolve?q=demo_alpha"],
    ["POST", "/api/friends/check"],
    ["PUT", "/api/friends/scheduler"],
    ["GET", "/api/voice/players"],
    ["POST", "/api/voice/ingest"],
    ["GET", "/api/voice/ingest/demo-job"],
    ["POST", "/api/voice/verify"],
    ["POST", "/api/voice/match"],
    ["GET", "/api/voice/demo/1/cluster"],
    ["GET", "/api/faceit/status"],
    ["GET", "/api/faceit/sync/status"],
    ["POST", "/api/faceit/login"],
    ["POST", "/api/faceit/sync"],
  ] as const;

  it.each(covered)("%s %s is answered by a fixture", (method, path) => {
    const response = demoResponse(path, method);
    expect(response).not.toBeNull();
    expect(response?.ok).toBe(true);
  });
});
