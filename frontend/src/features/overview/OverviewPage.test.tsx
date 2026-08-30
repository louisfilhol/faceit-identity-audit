// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtures, installFetchRoutes, renderApp } from "@/test/harness";

let restore: () => void;

beforeEach(() => {
  ({ restore } = installFetchRoutes(fixtures.defaultRoutes(true)));
});

afterEach(() => {
  restore();
});

describe("overview dashboard", () => {
  it("renders KPI values from the API", async () => {
    window.location.hash = "#/overview";
    renderApp();
    expect(
      await screen.findByText("Live snapshot of both detection tools."),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("42")).toBeTruthy(); // events recorded
    });
    expect(screen.getByText("3")).toBeTruthy(); // friends accounts
  });

  it("computes the friendship overlap from snapshots", async () => {
    window.location.hash = "#/overview";
    renderApp();
    // The fixture has one friend on two accounts.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Suspicious overlaps/ }),
      ).toBeTruthy();
    });
    await waitFor(() => {
      // The count badge's accessible content is its visible text.
      expect(screen.getByText("1", { selector: ".pill" })).toBeTruthy();
    });
    expect(screen.getAllByText("mutual_friend").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("2 accounts")).toBeTruthy();
    // Account labels come from the saved configuration.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    // Unique friends watched = {f1, f2} in the snapshot fixture.
    expect(
      await screen.findByText("2", { selector: ".kpi-value" }),
    ).toBeTruthy();
  });

  it("shows recent events in the table", async () => {
    window.location.hash = "#/overview";
    renderApp();
    await waitFor(() =>
      expect(screen.getAllByText("mutual_friend").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("added")).toBeTruthy();
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
  });

  it("renders server-provided nicknames as text, never as HTML", async () => {
    restore();
    const events = {
      events: [
        {
          ts: "2026-08-28T03:45:00Z",
          account_lbl: "<script>alert(1)</script>",
          kind: "added",
          friend_id: "f1",
          nickname: "<b>bold</b><script>alert(1)</script>",
        },
      ],
    };
    ({ restore } = installFetchRoutes({
      ...fixtures.defaultRoutes(true),
      "/api/friends/events": { body: events },
    }));
    window.location.hash = "#/overview";
    renderApp();
    expect(await screen.findByText(/bold/)).toBeTruthy();
    // The markup must be displayed literally, not interpreted. A low-level
    // document query is the point here: the regression being guarded is an
    // element node for <b>/<script> actually appearing in the DOM, which no
    // role-based query can express.
    // eslint-disable-next-line testing-library/no-node-access
    expect(document.querySelector("b")).toBeNull();
    // eslint-disable-next-line testing-library/no-node-access
    expect(document.querySelector("script")).toBeNull();
    expect(
      screen.getByText(
        (_, el) => el?.textContent === "<b>bold</b><script>alert(1)</script>",
      ),
    ).toBeTruthy();
  });

  it("offers a link to the full friends history", async () => {
    window.location.hash = "#/overview";
    renderApp();
    expect(await screen.findByText("View all →")).toBeTruthy();
  });
});
