// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, requestJson } from "./client";

function okRoute(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestJson", () => {
  it("returns parsed JSON for 200 responses", async () => {
    okRoute({ hello: "world" });
    await expect(requestJson("/api/x")).resolves.toEqual({ hello: "world" });
  });

  it("treats HTTP 202 as success (background job accepted)", async () => {
    okRoute({ job_id: "abc", status: "queued" }, 202);
    await expect(requestJson<{ job_id: string }>("/api/x")).resolves.toEqual({
      job_id: "abc",
      status: "queued",
    });
  });

  it("extracts the detail message from error responses", async () => {
    okRoute({ detail: "voice module unavailable: boom" }, 500);
    const err = (await requestJson("/api/x").catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("voice module unavailable: boom");
    expect(err.status).toBe(500);
  });

  it("handles validation-error detail arrays (FastAPI 422)", async () => {
    okRoute({ detail: [{ loc: ["body"], msg: "Field required" }] }, 422);
    const err = (await requestJson("/api/x").catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(err.message).toBe("Field required");
  });

  it("falls back to statusText when the body has no message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
      ),
    );
    const err = (await requestJson("/api/x").catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(err.message).toBe("Forbidden");
    expect(err.status).toBe(403);
  });

  it("wraps network failures in ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const err = (await requestJson("/api/x").catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain("could not reach the server");
    expect(err.status).toBeUndefined();
  });

  it("rethrows AbortError untouched so callers can ignore cancellations", async () => {
    const abort = new AbortController();
    abort.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      }),
    );
    await expect(
      requestJson("/api/x", { signal: abort.signal }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof DOMException && e.name === "AbortError",
    );
  });
});

describe("requestJson in demo mode", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  function stubSpiedFetch() {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("never reaches the network: covered endpoints come from fixtures", async () => {
    window.history.replaceState(null, "", "/?demo=1");
    const fetchMock = stubSpiedFetch();
    await expect(requestJson("/api/health")).resolves.toEqual({
      status: "ok",
      friends_configured: true,
      voice_available: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails locally instead of leaking unknown endpoints to the server", async () => {
    window.history.replaceState(null, "", "/?demo=1");
    const fetchMock = stubSpiedFetch();
    const err = (await requestJson("/api/unknown").catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain("demo mode has no fixture");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
