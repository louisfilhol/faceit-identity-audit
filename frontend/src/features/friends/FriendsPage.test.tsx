// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fixtures,
  installFetchRoutes,
  renderApp,
  type RouteLog,
} from "@/test/harness";

let restore: () => void;
let calls: RouteLog[];

beforeEach(() => {
  const mock = installFetchRoutes(fixtures.defaultRoutes(true));
  restore = mock.restore;
  calls = mock.calls;
});

afterEach(() => {
  restore();
});

async function openFriends() {
  window.location.hash = "#/friends";
  renderApp();
  expect(
    await screen.findByRole("heading", { level: 2, name: "Friend activity" }),
  ).toBeTruthy();
  // Wait until status + config data have arrived (scheduler form + account
  // rows render from query data).
  expect(
    await screen.findByLabelText(/Check every/, undefined, { timeout: 4000 }),
  ).toBeTruthy();
  await waitFor(
    () =>
      expect(
        screen.getAllByPlaceholderText("Nickname or profile URL").length,
      ).toBeGreaterThan(0),
    { timeout: 4000 },
  );
}

describe("friends configuration card", () => {
  it("seeds the editor from GET /api/friends/config", async () => {
    await openFriends();
    const webhook = screen.getByLabelText("Discord notification link");
    expect(webhook).toHaveValue("");
    const rows = screen.getAllByPlaceholderText("Nickname or profile URL");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveValue("guid-a");
    expect(screen.getByDisplayValue("Alpha")).toBeTruthy();
    expect(screen.getByDisplayValue("Beta")).toBeTruthy();
  });

  it("saves the edited configuration via PUT and shows feedback", async () => {
    await openFriends();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Discord notification link"));
    await user.type(
      screen.getByLabelText("Discord notification link"),
      "https://discord.com/api/webhooks/1/x",
    );
    await user.click(screen.getByRole("button", { name: /Save changes/ }));

    expect(await screen.findByText("Saved")).toBeTruthy();
    const put = calls.find(
      (c) => c.method === "PUT" && c.url === "/api/friends/config",
    );
    expect(put).toBeTruthy();
    expect(JSON.parse(put?.body ?? "{}")).toEqual({
      discord_webhook: "https://discord.com/api/webhooks/1/x",
      discord_ping: "",
      accounts: [
        { guid: "guid-a", label: "Alpha", faceit: "alpha" },
        { guid: "guid-b", label: "Beta", faceit: "beta" },
      ],
    });
  });

  it("shows the server error inline when saving fails", async () => {
    restore();
    const mock = installFetchRoutes({
      ...fixtures.defaultRoutes(true),
      "/api/friends/config": (_url, init) => {
        if (init?.method === "PUT") {
          return {
            status: 400,
            body: { detail: "Could not resolve: account #3 (ghost): 404" },
          };
        }
        return { body: fixtures.config };
      },
    });
    restore = mock.restore;
    calls = mock.calls;
    await openFriends();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Save changes/ }));
    await waitFor(() =>
      expect(
        screen.getAllByText(/Could not resolve: account #3/).length,
      ).toBeGreaterThan(0),
    );
  });

  it("adds and removes account rows locally before saving", async () => {
    await openFriends();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add account" }));
    expect(
      screen.getAllByPlaceholderText("Nickname or profile URL"),
    ).toHaveLength(3);
    const removeButtons = screen.getAllByRole("button", {
      name: "Remove account",
    });
    await user.click(removeButtons[0]!);
    expect(
      screen.getAllByPlaceholderText("Nickname or profile URL"),
    ).toHaveLength(2);
  });

  it("saves the scheduler settings via PUT /api/friends/scheduler", async () => {
    await openFriends();
    const user = userEvent.setup();
    const interval = screen.getByLabelText(/Check every/);
    expect(interval).toBeTruthy();
    await user.clear(interval as HTMLInputElement);
    await user.type(interval as HTMLInputElement, "30");
    await user.click(screen.getByRole("button", { name: /Save frequency/ }));
    expect(await screen.findByText("Saved")).toBeTruthy();
    const put = calls.find(
      (c) => c.method === "PUT" && c.url === "/api/friends/scheduler",
    );
    expect(JSON.parse(put?.body ?? "{}")).toEqual({
      enabled: true,
      interval_minutes: 30,
    });
  });

  it("rejects interval values outside 1–1440 without calling the API", async () => {
    await openFriends();
    const user = userEvent.setup();
    const interval = screen.getByLabelText(/Check every/);
    await user.clear(interval);
    await user.type(interval, "9999");
    await user.click(screen.getByRole("button", { name: /Save frequency/ }));
    expect(await screen.findByText("Use 1–1440 minutes")).toBeTruthy();
    expect(
      calls.find((c) => c.url === "/api/friends/scheduler"),
    ).toBeUndefined();
  });
});

describe("event history", () => {
  it("filters events by kind and search term", async () => {
    await openFriends();
    const search = screen.getByLabelText(/Search events by nickname/);
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getAllByText("mutual_friend").length).toBeGreaterThan(0),
    );
    await user.type(search, "nothing-matches");
    expect(await screen.findByText("No matching events.")).toBeTruthy();
    await user.clear(search);
    await waitFor(() =>
      expect(screen.getAllByText("mutual_friend").length).toBeGreaterThan(0),
    );
  });
});

describe("known connections pagination", () => {
  it("shows 20 connections at a time and moves between pages", async () => {
    restore();
    const snapshots = Array.from({ length: 120 }, (_, index) => ({
      account_id: "guid-a",
      friend_id: `friend-${index}`,
      nickname: `friend_${String(index).padStart(3, "0")}`,
      first_seen: "2026-08-01T12:00:00Z",
      last_seen: "2026-08-30T12:00:00Z",
    }));
    const mock = installFetchRoutes({
      ...fixtures.defaultRoutes(true),
      "/api/friends/snapshots": { body: { snapshots } },
    });
    restore = mock.restore;
    calls = mock.calls;

    await openFriends();
    expect(await screen.findByText("friend_000")).toBeTruthy();
    expect(screen.getByText("friend_019")).toBeTruthy();
    expect(screen.queryByText("friend_020")).toBeNull();
    expect(screen.getByText("1–20 of 120")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("friend_020")).toBeTruthy();
    expect(screen.queryByText("friend_000")).toBeNull();
    expect(screen.getByText("21–40 of 120")).toBeTruthy();
  });
});

describe("shared friends pagination", () => {
  it("shows 20 shared friends at a time and moves between pages", async () => {
    restore();
    const commonFriends = Array.from({ length: 58 }, (_, index) => ({
      friend_id: `shared-${index}`,
      nickname: `shared_${String(index).padStart(3, "0")}`,
      first_seen_a: "2026-08-01T12:00:00Z",
      first_seen_b: "2026-08-02T12:00:00Z",
    }));
    const mock = installFetchRoutes({
      ...fixtures.defaultRoutes(true),
      "/api/friends/overlap": {
        body: {
          accounts: [
            { guid: "guid-a", label: "Alpha", friend_count: 100 },
            { guid: "guid-b", label: "Beta", friend_count: 120 },
          ],
          pairs: [
            {
              guid_a: "guid-a",
              guid_b: "guid-b",
              label_a: "Alpha",
              label_b: "Beta",
              friend_count_a: 100,
              friend_count_b: 120,
              common: 58,
              jaccard: 0.35,
            },
          ],
        },
      },
      "/api/friends/overlap/guid-a/guid-b": {
        body: {
          a: { guid: "guid-a", label: "Alpha", friend_count: 100 },
          b: { guid: "guid-b", label: "Beta", friend_count: 120 },
          common_count: commonFriends.length,
          common_friends: commonFriends,
          timeline: [
            { ts: "2026-08-01T12:00:00Z", overlap: 50 },
            { ts: "2026-08-30T12:00:00Z", overlap: 58 },
          ],
          generated_at: "2026-08-30T12:00:00Z",
        },
      },
    });
    restore = mock.restore;
    calls = mock.calls;

    await openFriends();
    expect(await screen.findByText("shared_000")).toBeTruthy();
    expect(screen.getByText("shared_019")).toBeTruthy();
    expect(screen.queryByText("shared_020")).toBeNull();
    expect(screen.getByText("1–20 of 58")).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: "Next shared friends page" }),
    );
    expect(await screen.findByText("shared_020")).toBeTruthy();
    expect(screen.queryByText("shared_000")).toBeNull();
    expect(screen.getByText("21–40 of 58")).toBeTruthy();
  });
});
