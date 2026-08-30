// SPDX-License-Identifier: AGPL-3.0-only
import { Pill } from "@/components/common/Pill";
import type { CheckResponse } from "@/api/types";

/** Per-account outcome pills shown after a manual friends check. */
export function CheckResultPills({
  results,
}: {
  results: CheckResponse["results"];
}) {
  if (!results.length) {
    return <span className="pill subtle">No accounts configured</span>;
  }
  return (
    <>
      {results.map((r, i) => (
        <Pill
          key={`${r.label}-${i}`}
          tone={r.ok ? "green" : "red"}
          title={r.ok ? undefined : r.error}
        >
          {r.label} {r.ok ? `+${r.added ?? 0}/−${r.removed ?? 0}` : "err"}
        </Pill>
      ))}
    </>
  );
}
