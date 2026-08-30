// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "@/components/common/Toast";
import { fixtures, installFetchRoutes } from "@/test/harness";
import { useIngestJob } from "@/hooks/useIngestJob";
import { IngestCard } from "./IngestCard";
import type { IngestJob } from "@/api/types";

const JOB_ID = "job-123";
const POLL_MS = 1000;

function job(status: string, overrides: Partial<IngestJob> = {}): IngestJob {
  return {
    job_id: JOB_ID,
    status: status as IngestJob["status"],
    filename: "match.dem",
    demo_id: null,
    result: null,
    error: null,
    progress: {
      phase: status,
      current: 1,
      total: 2,
      percent: 50,
      players: [
        { steamid: "765…1", nickname: "P1", status: "embedded" },
        { steamid: "765…2", nickname: "P2", status: "running" },
      ],
      message: "Embedding players…",
    },
    ...overrides,
  };
}

/** Probe component exposing the ingest-job hook lifecycle. */
function IngestProbe() {
  const ingest = useIngestJob();
  return (
    <div>
      <span data-testid="job-status">{ingest.job?.status ?? "none"}</span>
      <button type="button" onClick={() => ingest.watch(JOB_ID)}>
        watch
      </button>
      <button type="button" onClick={() => ingest.clear()}>
        clear
      </button>
    </div>
  );
}

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

let restore: (() => void) | undefined;
let statusFetches: { count: number };

beforeEach(() => {
  statusFetches = { count: 0 };
});

afterEach(() => {
  restore?.();
  restore = undefined;
  sessionStorage.clear();
  localStorage.clear();
});

describe("ingest job polling lifecycle", () => {
  it("polls the job until it completes, then stops", async () => {
    const statuses = ["queued", "running", "running", "completed"];
    restore = installFetchRoutes({
      [`/api/voice/ingest/${JOB_ID}`]: () => {
        const status =
          statuses[Math.min(statusFetches.count, statuses.length - 1)] ??
          "queued";
        statusFetches.count += 1;
        return { body: job(status) };
      },
    }).restore;

    renderWithProviders(<IngestProbe />);
    await userEvent.click(screen.getByRole("button", { name: "watch" }));
    await waitFor(
      () => expect(screen.getByTestId("job-status").textContent).toBe("queued"),
      { timeout: 4000 },
    );
    await waitFor(
      () =>
        expect(screen.getByTestId("job-status").textContent).toBe("completed"),
      { timeout: 15_000 },
    );

    const completedFetches = statusFetches.count;
    // No further polling after the terminal status.
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 3));
    expect(statusFetches.count).toBe(completedFetches);
  }, 30_000);

  it("stops polling when the watching component unmounts", async () => {
    restore = installFetchRoutes({
      [`/api/voice/ingest/${JOB_ID}`]: () => {
        statusFetches.count += 1;
        return { body: job("running") };
      },
    }).restore;

    const { unmount } = renderWithProviders(<IngestProbe />);
    await userEvent.click(screen.getByRole("button", { name: "watch" }));
    await waitFor(() => expect(statusFetches.count).toBeGreaterThanOrEqual(1), {
      timeout: 4000,
    });

    unmount();
    const atUnmount = statusFetches.count;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 3));
    expect(statusFetches.count).toBe(atUnmount);
  }, 30_000);
});

describe("ingest card", () => {
  it("uploads a demo, shows the queued state and per-player progress", async () => {
    let uploadCount = 0;
    restore = installFetchRoutes({
      "/api/health": { body: fixtures.health(true) },
      "/api/voice/players": { body: [] },
      "/api/voice/ingest": () => {
        uploadCount += 1;
        return {
          status: 202,
          body: {
            job_id: JOB_ID,
            status: "queued",
            deduplicated: false,
            status_url: `/api/voice/ingest/${JOB_ID}`,
          },
        };
      },
      [`/api/voice/ingest/${JOB_ID}`]: () => ({
        body: job("queued"),
      }),
    }).restore;

    renderWithProviders(<IngestCard onIngested={() => {}} />);

    const file = new File(["demo-bytes"], "match.dem", { type: "" });
    // The file input is visually hidden behind the drop zone but stays
    // reachable through its label for keyboard and assistive tech users.
    const input = screen.getByLabelText("Demo file");
    await userEvent.upload(input, file);
    expect(screen.getByText("match.dem")).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: "Add to library" }),
    );
    // 202 accepted → queued message + progress panel with player rows.
    expect(
      await screen.findByText(
        /Preparing voices from this recording/,
        undefined,
        {
          timeout: 4000,
        },
      ),
    ).toBeTruthy();
    expect(screen.getByText("P1")).toBeTruthy();
    expect(screen.getByText("embedded")).toBeTruthy();
    expect(uploadCount).toBe(1);
  }, 20_000);

  it("renders per-player progress with status labels and reasons", async () => {
    restore = installFetchRoutes({
      [`/api/voice/ingest/${JOB_ID}`]: {
        body: job("running", {
          progress: {
            phase: "embedding",
            current: 1,
            total: 3,
            percent: 33,
            players: [
              {
                steamid: "1",
                nickname: "ShortClip",
                status: "skipped_short",
                reason: "0.4s audio",
              },
              {
                steamid: "2",
                nickname: "Broken",
                status: "error",
                reason: "decode failed",
              },
            ],
            message: "Embedding…",
          },
        }),
      },
    }).restore;

    // Seed the job id into sessionStorage the same way a page reload
    // resumes an in-flight job.
    sessionStorage.setItem("dsh.ingestJobId", JOB_ID);
    renderWithProviders(<IngestCard onIngested={() => {}} />);

    expect(
      await screen.findByText("ShortClip", undefined, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.getByText("short clip")).toBeTruthy();
    expect(screen.getByText(/0.4s audio/)).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText(/decode failed/)).toBeTruthy();
  }, 20_000);
});
