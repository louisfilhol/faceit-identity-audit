// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useHealth } from "@/hooks/useHealth";
import { useDemos } from "@/hooks/useDemos";
import type { MatchResponse } from "@/api/types";
import { ClusterCard } from "./ClusterCard";
import { IngestCard } from "./IngestCard";
import { MatchCard, MatchResults } from "./MatchCard";
import { PlayersCard } from "./PlayersCard";
import { SyncCard } from "./SyncCard";
import { VerifyCard } from "./VerifyCard";

export function VoicePage() {
  const health = useHealth();
  const demos = useDemos();
  const [matchResults, setMatchResults] = useState<MatchResponse | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchBusy, setMatchBusy] = useState(false);

  const onMatchResults = (results: MatchResponse | null, error?: string) => {
    setMatchResults(results);
    setMatchError(error ?? null);
  };

  return (
    <section className="view active">
      <div className="view-head">
        <div>
          <h2>Voice Identity Linker</h2>
          <p className="sub">
            Compare same-speaker evidence from CS2 demos. Voice scores support
            an investigation; they do not prove identity.
          </p>
        </div>
      </div>

      {!health.voiceAvailable ? (
        <div className="banner warn">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>Voice module unavailable.</strong> Run{" "}
            <code>voice-identity-linker/setup.sh</code> first, then restart the
            server.
          </div>
        </div>
      ) : null}

      <div className="grid-3">
        <IngestCard onIngested={() => setMatchResults(null)} />
        <VerifyCard />
        <MatchCard
          onResults={onMatchResults}
          busy={matchBusy}
          setBusy={setMatchBusy}
        />
      </div>

      <SyncCard />

      <div className="grid-2">
        {matchResults || matchError || matchBusy ? (
          <div className="card">
            <div className="card-head">
              <h3>
                {matchResults
                  ? `Match results · threshold ${matchResults.threshold.toFixed(3)}`
                  : "Match results"}
              </h3>
            </div>
            <MatchResults
              results={matchResults}
              error={matchError}
              busy={matchBusy}
            />
          </div>
        ) : null}

        {demos.length ? <ClusterCard /> : null}
      </div>

      <PlayersCard voiceAvailable={health.voiceAvailable} />
    </section>
  );
}
