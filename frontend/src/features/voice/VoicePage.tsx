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
          <h2>Voice comparison</h2>
          <p className="sub">
            Compare speakers across match recordings. Voice is supporting
            evidence, never proof of identity on its own.
          </p>
        </div>
      </div>

      {!health.voiceAvailable ? (
        <div className="banner warn">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>Voice comparison isn’t ready yet.</strong> Ask the workspace
            owner to finish voice setup, then refresh this page.
          </div>
        </div>
      ) : null}

      <div className="grid-2 voice-primary">
        <VerifyCard />
        <MatchCard
          onResults={onMatchResults}
          busy={matchBusy}
          setBusy={setMatchBusy}
        />
      </div>

      {matchResults || matchError || matchBusy ? (
        <div className="card match-results-card">
          <div className="card-head">
            <h3>Similar voices</h3>
          </div>
          <MatchResults
            results={matchResults}
            error={matchError}
            busy={matchBusy}
          />
        </div>
      ) : null}

      <details className="setup-disclosure voice-library-disclosure">
        <summary>Add recordings to the voice library</summary>
        <div className="voice-library-content">
          <div className="grid-2">
            <IngestCard onIngested={() => setMatchResults(null)} />
            {demos.length ? <ClusterCard /> : null}
          </div>
          <SyncCard />
        </div>
      </details>

      <PlayersCard voiceAvailable={health.voiceAvailable} />
    </section>
  );
}
