// SPDX-License-Identifier: AGPL-3.0-only
/** Pure friendship-overlap detection over current snapshots.
 *
 * A friend who appears on two or more monitored accounts is the classic
 * supporting signal for multi-accounting (never proof by itself).
 */

import type { FriendsSnapshot } from "@/api/types";

export interface FriendOverlap {
  friend_id: string;
  /** Most frequently seen nickname across accounts (falls back to the id). */
  nickname: string;
  accounts: { id: string; label: string }[];
  count: number;
  first_seen: string;
  last_seen: string;
}

export type AccountLabeler = (guid: string) => string;

function mostFrequentNickname(
  snapshots: FriendsSnapshot[],
  friendId: string,
): string {
  const counts = new Map<string, number>();
  for (const s of snapshots) {
    if (s.nickname) {
      counts.set(s.nickname, (counts.get(s.nickname) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [nickname, count] of counts) {
    if (count > bestCount) {
      best = nickname;
      bestCount = count;
    }
  }
  return best ?? friendId;
}

/** Group snapshots by friend and keep friends present on 2+ accounts. */
export function computeOverlaps(
  snapshots: FriendsSnapshot[],
  labelAccount: AccountLabeler,
): FriendOverlap[] {
  const byFriend = new Map<string, FriendsSnapshot[]>();
  for (const snapshot of snapshots) {
    const list = byFriend.get(snapshot.friend_id);
    if (list) {
      list.push(snapshot);
    } else {
      byFriend.set(snapshot.friend_id, [snapshot]);
    }
  }

  const overlaps: FriendOverlap[] = [];
  for (const [friendId, list] of byFriend) {
    const accountIds = [...new Set(list.map((s) => s.account_id))];
    if (accountIds.length < 2) continue;
    const first = list.reduce(
      (min, s) => (s.first_seen < min ? s.first_seen : min),
      list[0]?.first_seen ?? "",
    );
    const last = list.reduce(
      (max, s) => (s.last_seen > max ? s.last_seen : max),
      list[0]?.last_seen ?? "",
    );
    overlaps.push({
      friend_id: friendId,
      nickname: mostFrequentNickname(list, friendId),
      accounts: accountIds.map((id) => ({ id, label: labelAccount(id) })),
      count: accountIds.length,
      first_seen: first,
      last_seen: last,
    });
  }

  return overlaps.sort(
    (a, b) => b.count - a.count || b.last_seen.localeCompare(a.last_seen),
  );
}

/** Set of friend ids that appear on more than one account. */
export function overlapFriendIds(
  snapshots: FriendsSnapshot[],
  labelAccount: AccountLabeler,
): Set<string> {
  return new Set(
    computeOverlaps(snapshots, labelAccount).map((o) => o.friend_id),
  );
}
