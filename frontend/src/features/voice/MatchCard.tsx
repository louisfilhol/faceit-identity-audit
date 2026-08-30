// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { Spinner } from "@/components/common/Spinner";
import { useToast } from "@/components/common/Toast";
import { matchVoice } from "@/api/voice";
import type { MatchResponse } from "@/api/types";

/** Search form; results render in the sibling card (see VoicePage). */
export function MatchCard({
  onResults,
  busy,
  setBusy,
}: {
  onResults: (results: MatchResponse | null, error?: string) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const toast = useToast();
  const [steamid, setSteamid] = useState("");
  const [k, setK] = useState("10");

  const onMatch = async () => {
    const sid = steamid.trim();
    if (!sid) {
      toast("Enter a SteamID to match", "bad");
      return;
    }
    setBusy(true);
    onResults(null);
    try {
      const r = await matchVoice(sid, Number(k) || 10);
      onResults(r);
    } catch (e) {
      onResults(null, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Find similar voices</h3>
      </div>
      <div className="field">
        <label htmlFor="match-id">Account Steam ID</label>
        <input
          id="match-id"
          type="text"
          placeholder="7656119…"
          value={steamid}
          spellCheck={false}
          onChange={(e) => setSteamid(e.target.value)}
        />
      </div>
      <details className="evidence-details search-options">
        <summary>Search options</summary>
        <div className="field">
          <label htmlFor="match-k">Number of results</label>
          <input
            id="match-k"
            type="number"
            value={k}
            min={1}
            max={50}
            onChange={(e) => setK(e.target.value)}
          />
        </div>
      </details>
      <div className="field-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => void onMatch()}
          disabled={busy}
        >
          {busy ? <Spinner /> : null} Find matches
        </button>
      </div>
    </div>
  );
}

export function MatchResults({
  results,
  error,
  busy,
}: {
  results: MatchResponse | null;
  error: string | null;
  busy: boolean;
}) {
  if (busy) {
    return (
      <div className="empty">
        <div className="skeleton" style={{ height: 16, marginBottom: 8 }} />
        Searching voiceprints…
      </div>
    );
  }
  if (error) return <div className="empty bad">{error}</div>;
  if (!results) return null;
  if (!results.matches.length) {
    return <div className="empty">No matches found for this voiceprint.</div>;
  }
  const maxScore = Math.max(...results.matches.map((m) => m.score), 0.0001);
  return (
    <div>
      {results.matches.map((m, i) => {
        const hot = m.verdict === "same";
        const uncertain = m.verdict === "inconclusive";
        const shownScore = m.median_score ?? m.score;
        const pct = Math.max(4, Math.min(100, (m.score / maxScore) * 100));
        const marker = hot ? "SAME" : uncertain ? "?" : "different";
        const color = hot
          ? "var(--red)"
          : uncertain
            ? "var(--amber)"
            : "var(--text-2)";
        return (
          <div className="score-row" key={`${m.steamid}-${i}`}>
            <div>{m.nickname || "—"}</div>
            <div className="mono sub" style={{ fontSize: "11.5px" }}>
              {m.steamid}
            </div>
            <div
              className={`score-bar${hot ? " hot" : uncertain ? " uncertain" : ""}`}
              title={(m.reasons ?? []).join("; ")}
            >
              <span style={{ width: `${pct.toFixed(0)}%` }} />
            </div>
            <div className="score-val" style={{ color }}>
              {shownScore.toFixed(3)} {marker}
            </div>
          </div>
        );
      })}
    </div>
  );
}
