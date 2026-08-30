// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { Pill } from "@/components/common/Pill";
import { Spinner } from "@/components/common/Spinner";
import { useToast } from "@/components/common/Toast";
import { verifyPair } from "@/api/voice";
import type { VerifyEvidence } from "@/api/types";

const VERDICT_META: Record<
  string,
  { tone: "red" | "green" | "amber"; label: string }
> = {
  same: { tone: "red", label: "SAME speaker" },
  different: { tone: "green", label: "different speakers" },
  inconclusive: { tone: "amber", label: "INCONCLUSIVE" },
};

export function VerifyCard() {
  const toast = useToast();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<VerifyEvidence | null>(null);

  const onVerify = async () => {
    const sidA = a.trim();
    const sidB = b.trim();
    if (!sidA || !sidB) {
      toast("Enter both SteamIDs", "bad");
      return;
    }
    setBusy(true);
    setError(null);
    setEvidence(null);
    try {
      const r = await verifyPair(sidA, sidB);
      setEvidence(r);
      if (r.verdict === "same") {
        toast("Repeated demos support the same-speaker verdict", "bad", 6000);
      } else if (r.verdict === "different") {
        toast("Repeated demos support different speakers", "good");
      } else {
        toast(
          "Voice evidence is inconclusive — collect more demos",
          "busy",
          6000,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verdict = evidence
    ? (VERDICT_META[evidence.verdict] ?? VERDICT_META.inconclusive)
    : null;
  const pairScores = evidence
    ? (evidence.pair_scores ?? []).map((s) => s.toFixed(3)).join(", ")
    : "";

  return (
    <div className="card">
      <div className="card-head">
        <h3>Verify two accounts</h3>
      </div>
      <p className="card-hint">
        A verdict requires repeated evidence from distinct demos. The
        uncertainty band is operational, not a calibrated identity probability.
      </p>
      <div className="field">
        <label htmlFor="verify-a">SteamID A</label>
        <input
          id="verify-a"
          type="text"
          placeholder="7656119…"
          value={a}
          spellCheck={false}
          onChange={(e) => setA(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="verify-b">SteamID B</label>
        <input
          id="verify-b"
          type="text"
          placeholder="7656119…"
          value={b}
          spellCheck={false}
          onChange={(e) => setB(e.target.value)}
        />
      </div>
      <div className="field-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => void onVerify()}
          disabled={busy}
        >
          {busy ? <Spinner /> : null} Compare
        </button>
        {busy ? (
          <span className="result-note busy">comparing…</span>
        ) : evidence && verdict ? (
          <span className="result-note">
            <Pill tone="blue">score {evidence.score.toFixed(3)}</Pill>{" "}
            <Pill tone={verdict.tone}>{verdict.label}</Pill>
          </span>
        ) : error ? (
          <span className="result-note bad">{error}</span>
        ) : null}
      </div>
      {evidence ? (
        <div className="verify-evidence">
          <div className="verify-metrics">
            <span>
              <strong>{evidence.clip_count_a}</strong> windows /{" "}
              {evidence.demo_count_a} demos (A)
            </span>
            <span>
              <strong>{evidence.clip_count_b}</strong> windows /{" "}
              {evidence.demo_count_b} demos (B)
            </span>
            <span>
              <strong>{evidence.window_pair_count}</strong> window comparisons
            </span>
            <span>
              <strong>{evidence.pair_count}</strong> equally weighted demo pairs
            </span>
            <span>
              <strong>{(evidence.agreement * 100).toFixed(0)}%</strong> verdict
              agreement
            </span>
            <span>
              <strong>{(evidence.same_pair_fraction * 100).toFixed(0)}%</strong>{" "}
              same-speaker support
            </span>
            <span>
              <strong>{evidence.evidence_quality}</strong> evidence
            </span>
          </div>
          <div className="verify-spread">
            threshold {evidence.threshold.toFixed(3)} · operational uncertainty
            band {evidence.band_low.toFixed(3)}–{evidence.band_high.toFixed(3)}{" "}
            · P10–P90 {evidence.score_p10.toFixed(3)}–
            {evidence.score_p90.toFixed(3)} · range{" "}
            {evidence.score_min.toFixed(3)}–{evidence.score_max.toFixed(3)} ·
            mean-vector {evidence.mean_score.toFixed(3)}
          </div>
          {pairScores ? (
            <div className="verify-pairs">demo-pair scores: {pairScores}</div>
          ) : null}
          <ul>
            {(evidence.reasons ?? []).map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
