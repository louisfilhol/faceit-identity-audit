// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pill, Tag } from "@/components/common/Pill";
import { fmtDur, fmtNum } from "@/lib/format";
import { queryKeys } from "@/api/keys";
import { usePlayers } from "@/hooks/usePlayers";

export function PlayersCard({ voiceAvailable }: { voiceAvailable: boolean }) {
  const queryClient = useQueryClient();
  const playersQuery = usePlayers(voiceAvailable);
  const [search, setSearch] = useState("");
  const players = useMemo(() => playersQuery.data ?? [], [playersQuery.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter(
      (p) =>
        !q ||
        (p.nickname || "").toLowerCase().includes(q) ||
        (p.steamid || "").includes(q),
    );
  }, [players, search]);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.voice.players });

  return (
    <div className="card">
      <div className="card-head">
        <h3>Known players</h3>
        <div className="table-tools">
          <div className="search-box">
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder="Search nickname…"
              aria-label="Search players by nickname"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Pill tone="subtle">{fmtNum(rows.length)}</Pill>
          <button type="button" className="btn ghost sm" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nickname</th>
              <th>SteamID</th>
              <th>Clips</th>
              <th>Audio</th>
              <th>Consent</th>
            </tr>
          </thead>
          <tbody>
            {playersQuery.isLoading ? (
              <tr>
                <td colSpan={5}>
                  <div className="skeleton" style={{ height: 18 }} />
                </td>
              </tr>
            ) : playersQuery.isError ? (
              <tr>
                <td colSpan={5} className="empty">
                  {(playersQuery.error as Error).message}
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={5} className="empty">
                  {players.length
                    ? "No matching players."
                    : "No players embedded yet — ingest a .dem file."}
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr key={p.steamid}>
                  <td>{p.nickname || "—"}</td>
                  <td className="mono sub">{p.steamid}</td>
                  <td className="num">{p.clip_count}</td>
                  <td className="num">{fmtDur(p.audio_sec)}</td>
                  <td>
                    <Tag tone={p.consent ? "consent-y" : "consent-n"}>
                      {p.consent ? "yes" : "no"}
                    </Tag>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
