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

/** Humanized relative time for dense table cells ("just now", "5m ago",
 * "2h ago", "3d ago"). Falls back to the absolute timestamp after two weeks. */
export function fmtRel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}m ago`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h ago`;
  if (sec < 14 * 86_400) return `${Math.round(sec / 86_400)}d ago`;
  return fmtTs(iso);
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
