// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { FriendsSnapshot } from "@/api/types";
import { computeOverlaps, overlapFriendIds } from "./overlap";

const label = (guid: string) =>
  ({ "guid-a": "Alpha", "guid-b": "Beta", "guid-c": "Gamma" })[guid] ?? guid;

function snap(
  accountId: string,
  friendId: string,
  nickname: string | null,
): FriendsSnapshot {
  return {
    account_id: accountId,
    friend_id: friendId,
    nickname,
    first_seen: "2026-08-28T03:45:00Z",
    last_seen: "2026-08-29T03:45:00Z",
  };
}

describe("computeOverlaps", () => {
  it("returns friends present on two or more accounts only", () => {
    const snapshots = [
      snap("guid-a", "shared", "SharedGuy"),
      snap("guid-b", "shared", "SharedGuy"),
      snap("guid-a", "solo", "OnlyAlpha"),
    ];
    const overlaps = computeOverlaps(snapshots, label);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.friend_id).toBe("shared");
    expect(overlaps[0]?.count).toBe(2);
    expect(overlaps[0]?.nickname).toBe("SharedGuy");
  });

  it("labels accounts through the labeler and falls back to guids", () => {
    const snapshots = [snap("guid-a", "f1", "x"), snap("guid-c", "f1", "x")];
    const [overlap] = computeOverlaps(snapshots, label);
    expect(overlap?.accounts.map((a) => a.label)).toEqual(["Alpha", "Gamma"]);
  });

  it("uses the most frequent nickname across accounts", () => {
    const snapshots = [
      snap("guid-a", "f1", "current_name"),
      snap("guid-b", "f1", "current_name"),
      snap("guid-c", "f1", "old_name"),
    ];
    const [overlap] = computeOverlaps(snapshots, label);
    expect(overlap?.nickname).toBe("current_name");
  });

  it("falls back to the friend id when no nickname exists", () => {
    const snapshots = [snap("guid-a", "f9", null), snap("guid-b", "f9", null)];
    const [overlap] = computeOverlaps(snapshots, label);
    expect(overlap?.nickname).toBe("f9");
  });

  it("sorts by account count descending, then recency", () => {
    const snapshots = [
      snap("guid-a", "two-accounts", "a"),
      snap("guid-b", "two-accounts", "a"),
      snap("guid-a", "three-accounts", "b"),
      snap("guid-b", "three-accounts", "b"),
      snap("guid-c", "three-accounts", "b"),
    ];
    const overlaps = computeOverlaps(snapshots, label);
    expect(overlaps.map((o) => o.count)).toEqual([3, 2]);
    expect(overlaps[0]?.friend_id).toBe("three-accounts");
  });

  it("tracks first/last seen across all snapshots of the friend", () => {
    const snapshots: FriendsSnapshot[] = [
      {
        ...snap("guid-a", "f1", "x"),
        first_seen: "2026-08-01T00:00:00Z",
        last_seen: "2026-08-20T00:00:00Z",
      },
      {
        ...snap("guid-b", "f1", "x"),
        first_seen: "2026-08-05T00:00:00Z",
        last_seen: "2026-08-25T00:00:00Z",
      },
    ];
    const [overlap] = computeOverlaps(snapshots, label);
    expect(overlap?.first_seen).toBe("2026-08-01T00:00:00Z");
    expect(overlap?.last_seen).toBe("2026-08-25T00:00:00Z");
  });

  it("overlapFriendIds returns a lookup set", () => {
    const snapshots = [
      snap("guid-a", "f1", "x"),
      snap("guid-b", "f1", "x"),
      snap("guid-a", "f2", "y"),
    ];
    const ids = overlapFriendIds(snapshots, label);
    expect(ids.has("f1")).toBe(true);
    expect(ids.has("f2")).toBe(false);
  });

  it("handles an empty snapshot list", () => {
    expect(computeOverlaps([], label)).toEqual([]);
  });
});
