// SPDX-License-Identifier: AGPL-3.0-only
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtures, installFetchRoutes, renderApp } from "@/test/harness";

let restore: () => void;

beforeEach(() => {
  restore = installFetchRoutes(fixtures.defaultRoutes(true)).restore;
});

afterEach(() => {
  restore();
  sessionStorage.clear();
});

describe("voice module availability", () => {
  it("hides the unavailable banner and lists players when the module is ready", async () => {
    window.location.hash = "#/voice";
    renderApp();
    expect(
      await screen.findByRole("heading", { name: "Voice Identity Linker" }),
    ).toBeTruthy();
    expect(await screen.findByText("PlayerOne")).toBeTruthy();
    expect(screen.queryByText(/Voice module unavailable/)).toBeNull();
    expect(screen.getByLabelText("Search players by nickname")).toBeTruthy();
  });

  it("shows the responsible-use banner and never fetches players when unavailable", async () => {
    const mock = installFetchRoutes(fixtures.defaultRoutes(false));
    restore = mock.restore;
    window.location.hash = "#/voice";
    renderApp();
    expect(await screen.findByText(/Voice module unavailable/)).toBeTruthy();
    expect(screen.getByText(/voice-identity-linker\/setup\.sh/)).toBeTruthy();
    // The players endpoint must stay untouched in this state.
    expect(
      mock.calls.find((c) => c.url === "/api/voice/players"),
    ).toBeUndefined();
    // Consent messaging stays visible.
    expect(screen.getByText(/do not prove identity/i)).toBeTruthy();
  });

  it("renders consent tags per player", async () => {
    window.location.hash = "#/voice";
    renderApp();
    expect(await screen.findByText("PlayerOne")).toBeTruthy();
    expect(screen.getByText("yes")).toBeTruthy();
  });
});
