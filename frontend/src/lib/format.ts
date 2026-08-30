// SPDX-License-Identifier: AGPL-3.0-only
/** Formatting helpers shared across all views. */

/** Format an ISO timestamp for tables and metadata lines. */
export function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Humanize a duration in seconds ("42s", "3.4 min", "2h 05m"). */
export function fmtDur(sec: number | null | undefined): string {
  const s = Number(sec) || 0;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Locale-formatted integer; falls back to "—" for missing values. */
export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

/** "updated 14:32" caption for the top bar. */
export function fmtClock(ts: number): string {
  return `updated ${new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Shorten a FACEIT match id for compact table cells ("1-abcd1234…" → "abcd1234"). */
export function shortMatchId(id: string | null | undefined): string {
  return String(id || "")
    .replace(/^1-/, "")
    .slice(0, 8);
}

/** Last 5 characters of a SteamID (compact display inside tags). */
export function shortId(sid: string | null | undefined): string {
  return String(sid || "").slice(-5);
}
