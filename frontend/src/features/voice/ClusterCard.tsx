// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { useToast } from "@/components/common/Toast";
import { fetchCluster } from "@/api/voice";
import type { ClusterMember } from "@/api/types";
import { useDemos } from "@/hooks/useDemos";

const PALETTE = [
  "#ff5500",
  "#4da3ff",
  "#2fd17e",
  "#ffb020",
  "#c86bff",
  "#ff4d5e",
];

function Group({
  members,
  index,
}: {
  members: ClusterMember[];
  index: number;
}) {
  const color = PALETTE[index % PALETTE.length] ?? "#ff5500";
  return (
    <div className="cluster-group">
      <div className="cluster-group-head">
        <span
          className="dot"
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: color,
            display: "inline-block",
          }}
        />
        Group {index + 1} · {members.length} speaker
        {members.length === 1 ? "" : "s"}
      </div>
      <div className="cluster-members">
        {members.map((m) => (
          <span className="cluster-member" key={m.steamid}>
            <span className="dot" style={{ background: color }} />
            {m.nickname || m.steamid}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ClusterCard() {
  const toast = useToast();
  const demos = useDemos();
  const [demoIndex, setDemoIndex] = useState("");
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<ClusterMember[][] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveIndex =
    demoIndex !== "" && Number(demoIndex) < demos.length ? demoIndex : "0";

  const onCluster = async () => {
    const demo = demos[Number(effectiveIndex)];
    if (!demo) {
      toast("Ingest a demo first", "bad");
      return;
    }
    setBusy(true);
    setError(null);
    setGroups(null);
    try {
      const r = await fetchCluster(demo.id);
      setGroups(r.groups);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Demo clusters</h3>
      </div>
      <p className="card-hint">
        Speakers grouped by voice similarity inside an ingested demo.
      </p>
      <div className="field-row">
        <select
          className="select"
          aria-label="Demo to cluster"
          value={effectiveIndex}
          onChange={(e) => setDemoIndex(e.target.value)}
        >
          {demos.length ? (
            demos.map((d, i) => (
              <option key={`${d.id}-${i}`} value={String(i)}>
                Demo #{d.id} — {d.name}
              </option>
            ))
          ) : (
            <option value="">No demos ingested this session</option>
          )}
        </select>
        <button
          type="button"
          className="btn"
          onClick={() => void onCluster()}
          disabled={busy}
        >
          Cluster
        </button>
      </div>
      <div>
        {busy ? (
          <div className="empty">
            <div className="skeleton" style={{ height: 16, marginBottom: 8 }} />
            Clustering speakers…
          </div>
        ) : error ? (
          <div className="empty bad">{error}</div>
        ) : groups && groups.length === 0 ? (
          <div className="empty">No speaker groups found in this demo.</div>
        ) : groups ? (
          groups.map((g, i) => <Group key={i} members={g} index={i} />)
        ) : null}
      </div>
    </div>
  );
}
