// SPDX-License-Identifier: AGPL-3.0-only
import { useSyncExternalStore } from "react";
import {
  loadDemos,
  rememberDemo as persistDemo,
  type DemoRef,
} from "@/lib/storage";

/**
 * Tiny localStorage-backed store for demos ingested in this browser.
 * `useSyncExternalStore` keeps every mounted component (cluster picker,
 * voice page) consistent without a context provider.
 */

let cache: DemoRef[] | null = null;
const listeners = new Set<() => void>();

function snapshot(): DemoRef[] {
  if (!cache) cache = loadDemos();
  return cache;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Remember a freshly ingested demo and notify subscribers. */
export function rememberDemo(demo: DemoRef): void {
  cache = persistDemo(demo);
  emit();
}

export function useDemos(): DemoRef[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
