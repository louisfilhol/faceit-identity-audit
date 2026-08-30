// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AccountLabeler } from "@/features/overview/overlap";
import { fmtTs } from "@/lib/format";
import { queryKeys } from "@/api/keys";
import type { OverlapDetailResponse, TimelinePoint } from "@/api/types";
import { useAccountLabels, useOverlapDetail, useOverlapList } from "./queries";

/** Step-line chart of shared friends over time. */
function OverlapChart({ timeline }: { timeline: TimelinePoint[] }) {
  const chart = useMemo(() => {
    if (timeline.length < 2) return null;
    const width = 640;
    const height = 170;
    const left = 34;
    const right = 12;
    const top = 12;
    const bottom = 26;
    const pts = timeline.map((p) => ({
      t: new Date(p.ts).getTime(),
      v: p.overlap,
    }));
    const tMin = pts[0]?.t ?? 0;
    const tMax = pts[pts.length - 1]?.t ?? 0;
    const vMax = Math.max(1, ...pts.map((p) => p.v));
    const x = (t: number) =>
      left + ((t - tMin) / Math.max(1, tMax - tMin)) * (width - left - right);
    const y = (v: number) => top + (1 - v / vMax) * (height - top - bottom);
    let line = `M ${x(pts[0]?.t ?? 0).toFixed(1)} ${y(pts[0]?.v ?? 0).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p) line += ` H ${x(p.t).toFixed(1)} V ${y(p.v).toFixed(1)}`;
    }
    const area = `${line} V ${height - bottom} H ${x(tMin).toFixed(1)} Z`;
    return {
      width,
      height,
      left,
      right,
      yZero: y(0),
      yMax: y(vMax),
      line,
      area,
      vMax,
      minLabel: new Date(tMin).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
      }),
      maxLabel: new Date(tMax).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
      }),
    };
  }, [timeline]);

  if (!chart) return null;

  return (
    <div className="overlap-chart">
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-label="Shared friends over time"
      >
        <line
          className="overlap-baseline"
          x1={chart.left}
          y1={chart.yZero}
          x2={chart.width - chart.right}
          y2={chart.yZero}
        />
        <line
          className="overlap-baseline"
          x1={chart.left}
          y1={chart.yMax}
          x2={chart.width - chart.right}
          y2={chart.yMax}
          strokeDasharray="3 4"
        />
        <path className="overlap-area" d={chart.area} />
        <path className="overlap-line" d={chart.line} />
        <text
          className="overlap-axis"
          x={chart.left - 7}
          y={chart.yMax + 4}
          textAnchor="end"
        >
          {chart.vMax}
        </text>
        <text
          className="overlap-axis"
          x={chart.left - 7}
          y={chart.yZero + 4}
          textAnchor="end"
        >
          0
        </text>
        <text className="overlap-axis" x={chart.left} y={chart.height - 7}>
          {chart.minLabel}
        </text>
        <text
          className="overlap-axis"
          textAnchor="end"
          x={chart.width - chart.right}
          y={chart.height - 7}
        >
          {chart.maxLabel}
        </text>
      </svg>
    </div>
  );
}

function OverlapStats({
  payload,
  label,
}: {
  payload: OverlapDetailResponse;
  label: AccountLabeler;
}) {
  const la = payload.a.label || label(payload.a.guid);
  const lb = payload.b.label || label(payload.b.guid);
  const share = (friendCount: number) =>
    friendCount ? Math.round((100 * payload.common_count) / friendCount) : 0;
  const peak = payload.timeline.reduce(
    (max, p) => (p.overlap > max.overlap ? p : max),
    { overlap: 0, ts: null as string | null },
  );
  return (
    <div className="kpi-grid overlap-stats">
      <div className="kpi">
        <div className="kpi-label">Shared now</div>
        <div className="kpi-value">{payload.common_count}</div>
        <div className="kpi-foot">common friends</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Of {la}</div>
        <div className="kpi-value">{share(payload.a.friend_count)}%</div>
        <div className="kpi-foot">{payload.a.friend_count} friends</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Of {lb}</div>
        <div className="kpi-value">{share(payload.b.friend_count)}%</div>
        <div className="kpi-foot">{payload.b.friend_count} friends</div>
      </div>
      <div className="kpi accent">
        <div className="kpi-label">Peak shared</div>
        <div className="kpi-value">{peak.overlap}</div>
        <div className="kpi-foot">{peak.ts ? `on ${fmtTs(peak.ts)}` : "—"}</div>
      </div>
    </div>
  );
}

export function OverlapCard() {
  const queryClient = useQueryClient();
  const listQuery = useOverlapList();
  const label = useAccountLabels();
  const [pairKey, setPairKey] = useState("");
  const [touched, setTouched] = useState(false);

  const pairs = useMemo(() => listQuery.data?.pairs ?? [], [listQuery.data]);
  const accounts = useMemo(
    () => listQuery.data?.accounts ?? [],
    [listQuery.data],
  );

  // Keep the selected pair valid; default to the strongest pair.
  const effectiveKey = useMemo(() => {
    if (!pairs.length) return "";
    if (touched && pairs.some((p) => `${p.guid_a}|${p.guid_b}` === pairKey)) {
      return pairKey;
    }
    const first = pairs[0];
    return first ? `${first.guid_a}|${first.guid_b}` : "";
  }, [pairs, pairKey, touched]);

  const [effA, effB] = effectiveKey ? effectiveKey.split("|") : [null, null];
  const detail = useOverlapDetail(effA, effB);

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: queryKeys.friends.overlapList,
    });

  return (
    <div className="card">
      <div className="card-head">
        <h3>Common friends overlap</h3>
        <div className="table-tools">
          <select
            className="select"
            aria-label="Account pair"
            value={effectiveKey}
            disabled={!pairs.length}
            onChange={(e) => {
              setTouched(true);
              setPairKey(e.target.value);
            }}
          >
            {!pairs.length ? (
              <option value="">
                {accounts.length < 2
                  ? "Need 2+ seeded accounts"
                  : "No account pairs"}
              </option>
            ) : (
              pairs.map((p) => {
                const la = p.label_a || label(p.guid_a);
                const lb = p.label_b || label(p.guid_b);
                return (
                  <option
                    key={`${p.guid_a}|${p.guid_b}`}
                    value={`${p.guid_a}|${p.guid_b}`}
                  >
                    {la} ↔ {lb} · {p.common} shared
                  </option>
                );
              })
            )}
          </select>
          <button type="button" className="btn ghost sm" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>
      <p className="card-hint">
        See which friends two monitored accounts share and how the overlap
        changes over time. This is a signal, not proof of multi-accounting.
      </p>

      {!effA || !effB ? (
        <div className="empty">
          {accounts.length
            ? "Run a friends check for at least two accounts to compare their friend lists."
            : "Seed at least two accounts with a friends check to see their shared friends."}
        </div>
      ) : detail.isError ? (
        <div className="empty bad">{(detail.error as Error).message}</div>
      ) : !detail.data ? (
        <div className="empty">Loading…</div>
      ) : (
        <>
          <OverlapStats payload={detail.data} label={label} />
          <OverlapChart timeline={detail.data.timeline} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Shared friend</th>
                  <th>
                    {detail.data.a.label || label(detail.data.a.guid)} since
                  </th>
                  <th>
                    {detail.data.b.label || label(detail.data.b.guid)} since
                  </th>
                </tr>
              </thead>
              <tbody>
                {!detail.data.common_friends.length ? (
                  <tr>
                    <td colSpan={3} className="empty">
                      No shared friends between these two accounts right now.
                    </td>
                  </tr>
                ) : (
                  detail.data.common_friends.map((f) => (
                    <tr key={f.friend_id}>
                      <td>{f.nickname || f.friend_id}</td>
                      <td className="sub">{fmtTs(f.first_seen_a)}</td>
                      <td className="sub">{fmtTs(f.first_seen_b)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
