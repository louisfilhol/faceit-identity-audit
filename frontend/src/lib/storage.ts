// SPDX-License-Identifier: AGPL-3.0-only
/** localStorage-backed list of demos ingested in this browser session.
 *
 * Deliberately shares the "dsh.demos" key with the pre-React dashboard so a
 * browser that ran the old UI keeps its cluster picker list.
 */

export interface DemoRef {
  id: number;
  name: string;
  ts: number;
}

const KEY = "dsh.demos";
const MAX_ENTRIES = 20;

export function loadDemos(): DemoRef[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is DemoRef =>
        typeof d === "object" &&
        d !== null &&
        typeof (d as DemoRef).id === "number" &&
        typeof (d as DemoRef).name === "string",
    );
  } catch {
    return [];
  }
}

export function persistDemos(demos: DemoRef[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(demos.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage may be unavailable (private mode); the list is a convenience.
  }
}

/** Remember a freshly ingested demo at the front of the list. */
export function rememberDemo(demo: DemoRef): DemoRef[] {
  const next = [demo, ...loadDemos().filter((d) => d.id !== demo.id)].slice(
    0,
    MAX_ENTRIES,
  );
  persistDemos(next);
  return next;
}
