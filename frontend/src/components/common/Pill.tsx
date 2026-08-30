// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";

export type PillTone = "" | "subtle" | "green" | "red" | "amber" | "blue";
export type TagTone =
  | "added"
  | "removed"
  | "green"
  | "red"
  | "warn"
  | "ok"
  | "skip"
  | "err"
  | "consent-y"
  | "consent-n";

export function Pill({
  tone = "",
  children,
  title,
}: {
  tone?: PillTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`pill${tone ? ` ${tone}` : ""}`} title={title}>
      {children}
    </span>
  );
}

export function Tag({
  tone,
  title,
  children,
}: {
  tone: TagTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={`tag ${tone}`} title={title}>
      {children}
    </span>
  );
}
