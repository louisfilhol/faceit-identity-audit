// SPDX-License-Identifier: AGPL-3.0-only
import { Check, CircleAlert } from "lucide-react";

export interface ResultNoteData {
  text: string;
  cls: string;
}

/** Inline status note (".result-note …") with a leading icon for good/bad tones. */
export function ResultNote({ note }: { note: ResultNoteData }) {
  const Icon = note.cls.includes("bad")
    ? CircleAlert
    : note.cls.includes("good")
      ? Check
      : null;
  return (
    <span className={note.cls}>
      {Icon ? <Icon size={13} aria-hidden="true" /> : null}
      {note.text}
    </span>
  );
}
