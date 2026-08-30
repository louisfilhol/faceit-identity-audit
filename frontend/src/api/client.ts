// SPDX-License-Identifier: AGPL-3.0-only
/** Central API client.
 *
 * Every network call goes through `requestJson` so JSON parsing, error
 * extraction, cancellation, and HTTP 202 handling live in exactly one place.
 * Components never call `fetch` directly. When the explicit `?demo=1` demo
 * mode is active, requests are answered from local synthetic fixtures
 * instead of the network.
 */

import { demoResponse, isDemoMode } from "@/demo/demoMode";

/** Error raised for non-2xx responses, network failures, and invalid JSON. */
export class ApiError extends Error {
  /** HTTP status code when the server answered; undefined for network errors. */
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function extractMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload) return payload;
  if (payload && typeof payload === "object") {
    const detail = (payload as Record<string, unknown>).detail;
    if (typeof detail === "string" && detail) return detail;
    // FastAPI 422 validation errors carry an array of message objects.
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as Record<string, unknown> | undefined;
      const msg = first && typeof first.msg === "string" ? first.msg : null;
      if (msg) return msg;
    }
    const message = (payload as Record<string, unknown>).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  /** JSON-serializable body; sent with an application/json content type. */
  json?: unknown;
  /** Raw init passthrough for multipart uploads. */
  body?: BodyInit;
  signal?: AbortSignal;
}

/**
 * Perform one JSON API request. Both 200 and 202 are success statuses
 * (background ingest jobs are accepted asynchronously).
 */
export async function requestJson<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", json, body, signal } = options;

  if (isDemoMode()) {
    // Demo mode is hermetic: requests are answered from local fixtures or not
    // at all — an unknown endpoint must never leak out to a real server.
    const demo = demoResponse(path, method);
    if (demo) return (await demo.json()) as T;
    throw new ApiError(
      `demo mode has no fixture for ${method} ${path} — this is a bug, ` +
        "please report it",
    );
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      ...(body !== undefined ? { body } : {}),
      ...(json !== undefined
        ? {
            body: JSON.stringify(json),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(`could not reach the server (${String(err)})`);
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      extractMessage(payload, response.statusText || "request failed"),
      response.status,
    );
  }
  return payload as T;
}

/** Build a query string, skipping empty parameters. */
export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}
