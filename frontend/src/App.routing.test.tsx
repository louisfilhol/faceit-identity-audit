// SPDX-License-Identifier: AGPL-3.0-only
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtures, installFetchRoutes, renderApp } from "@/test/harness";

let restore: () => void;

beforeEach(() => {
  ({ restore } = installFetchRoutes(fixtures.defaultRoutes(true)));
});

afterEach(() => {
  restore();
});

async function settle() {
  expect(
    await screen.findByRole("banner", undefined, { timeout: 5000 }),
  ).toBeTruthy();
}

describe("application routing", () => {
  it("renders the overview by default and highlights its nav item", async () => {
    window.location.hash = "#/overview";
    renderApp();
    await settle();
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeTruthy();
    const active = screen.getByRole("link", { name: "Overview" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(window.location.hash).toBe("#/overview");
  });

  it("navigates to the friends monitor via the sidebar", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/overview";
    renderApp();
    await settle();
    await user.click(screen.getByRole("link", { name: "Friends Monitor" }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "Friends Monitor" }),
    ).toBeTruthy();
    expect(window.location.hash).toBe("#/friends");
    expect(screen.getByText("Automatic monitoring")).toBeTruthy();
  });

  it("navigates to the voice identity view", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/overview";
    renderApp();
    await settle();
    await user.click(screen.getByRole("link", { name: "Voice Identity" }));
    expect(
      await screen.findByRole("heading", { name: "Voice Identity Linker" }),
    ).toBeTruthy();
    expect(window.location.hash).toBe("#/voice");
  });

  it("deep-links: loading #/voice directly renders the voice view", async () => {
    window.location.hash = "#/voice";
    renderApp();
    await settle();
    expect(
      await screen.findByRole("heading", { name: "Voice Identity Linker" }),
    ).toBeTruthy();
  });

  it("redirects unknown routes to the overview", async () => {
    window.location.hash = "#/nowhere";
    renderApp();
    await settle();
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeTruthy();
    expect(window.location.hash).toBe("#/overview");
  });
});

describe("health indicator", () => {
  it("shows 'All systems ready' when both modules are configured", async () => {
    window.location.hash = "#/overview";
    renderApp();
    await settle();
    // The badge is the page's single live status region; its visible text
    // carries the state and data-state drives the colouring.
    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent("All systems ready");
    expect(badge).toHaveAttribute("data-state", "ok");
  });

  it("shows a warning state when the voice module is off", async () => {
    restore();
    ({ restore } = installFetchRoutes(fixtures.defaultRoutes(false)));
    window.location.hash = "#/overview";
    renderApp();
    await settle();
    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent("Friends ready · voice off");
    expect(badge).toHaveAttribute("data-state", "warn");
  });

  it("shows an error state when the API is unreachable", async () => {
    restore();
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", failing);
    restore = () => vi.unstubAllGlobals();
    window.location.hash = "#/overview";
    renderApp();
    await settle();
    expect(
      await screen.findByText("API unreachable", undefined, { timeout: 6000 }),
    ).toBeTruthy();
  });
});
