// SPDX-License-Identifier: AGPL-3.0-only
import { fmtRel, fmtTs } from "@/lib/format";
import { Tag } from "@/components/common/Pill";
import type { FriendsEvent } from "@/api/types";

/** Time / Account / Kind / Friend rows shared by overview and history views.
 *
 * `overlapIds` marks friends that appear on more than one monitored account
 * (from the overview's overlap pass) with an amber dot.
 */
export function EventRows({
  events,
  overlapIds,
}: {
  events: FriendsEvent[];
  overlapIds?: Set<string>;
}) {
  return (
    <>
      {events.map((e, i) => (
        <tr key={`${e.ts}-${e.friend_id}-${i}`}>
          <td className="sub" title={fmtTs(e.ts)}>
            {fmtRel(e.ts)}
          </td>
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
          <td>
            {e.nickname || e.friend_id || "—"}
            {overlapIds?.has(e.friend_id) ? (
              <span
                className="overlap-flag"
                role="img"
                aria-label="on multiple accounts"
                title="On multiple monitored accounts"
              />
            ) : null}
          </td>
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
