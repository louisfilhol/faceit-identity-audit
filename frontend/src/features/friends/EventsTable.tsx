// SPDX-License-Identifier: AGPL-3.0-only
import { fmtTs } from "@/lib/format";
import { Tag } from "@/components/common/Pill";
import type { FriendsEvent } from "@/api/types";

/** Time / Account / Kind / Friend rows shared by overview and history views. */
export function EventRows({ events }: { events: FriendsEvent[] }) {
  return (
    <>
      {events.map((e, i) => (
        <tr key={`${e.ts}-${e.friend_id}-${i}`}>
          <td className="sub">{fmtTs(e.ts)}</td>
          <td>{e.account_lbl || "—"}</td>
          <td>
            <Tag
              tone={
                e.kind === "added" || e.kind === "removed" ? e.kind : "warn"
              }
            >
              {e.kind}
            </Tag>
          </td>
          <td>{e.nickname || e.friend_id || "—"}</td>
        </tr>
      ))}
    </>
  );
}

export const EVENTS_TABLE_HEAD = (
  <thead>
    <tr>
      <th>Time</th>
      <th>Account</th>
      <th>Kind</th>
      <th>Friend</th>
    </tr>
  </thead>
);
