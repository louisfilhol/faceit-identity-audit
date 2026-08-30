// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { Pill } from "@/components/common/Pill";
import { ResultNote } from "@/components/common/ResultNote";
import { Spinner } from "@/components/common/Spinner";
import { useToast } from "@/components/common/Toast";
import { fmtNum, fmtTs } from "@/lib/format";
import type { SchedulerSnapshot } from "@/api/types";
import { CheckResultPills } from "./CheckResultArea";
import { useSaveScheduler, type CheckMutation } from "./queries";

/** Compact status pill + sentence for the scheduler panel. */
export function schedulerBadge(s: SchedulerSnapshot): {
  label: string;
  tone: "" | "subtle" | "green" | "amber" | "red";
} {
  if (!s.configured) return { label: "save config", tone: "subtle" };
  if (!s.accounts) return { label: "no accounts", tone: "subtle" };
  if (!s.enabled) return { label: "off", tone: "subtle" };
  if (s.running) return { label: "checking…", tone: "amber" };
  if (s.last_error) return { label: "error", tone: "red" };
  return { label: `every ${s.interval_minutes}m`, tone: "green" };
}

export function schedulerDetail(s: SchedulerSnapshot): string {
  if (s.last_error) return `Last scheduler error: ${s.last_error}`;
  if (s.running) return "A background friends check is running now.";
  if (s.last_finished) {
    const when = fmtTs(new Date(s.last_finished * 1000).toISOString());
    const r = s.last_result;
    const summary = r
      ? ` ${r.ok}/${r.accounts} accounts ok · +${r.added}/−${r.removed}.`
      : "";
    return `Last check ${when}.${summary}`;
  }
  return s.enabled
    ? "The server will check monitored accounts automatically."
    : "Automatic checks are disabled; manual checks are still available.";
}

function SchedulerPanel({
  scheduler,
}: {
  scheduler: SchedulerSnapshot | undefined;
}) {
  const toast = useToast();
  const save = useSaveScheduler();
  const [enabled, setEnabled] = useState(scheduler?.enabled ?? true);
  const [interval, setIntervalMinutes] = useState(
    String(scheduler?.interval_minutes ?? 5),
  );
  const [seededFrom, setSeededFrom] = useState<SchedulerSnapshot | undefined>(
    scheduler,
  );

  // Re-sync the form whenever the server reports different settings (e.g.
  // after a save or the 45 s auto-refresh). TanStack Query keeps the object
  // identity stable between unchanged polls, so in-progress edits survive.
  if (scheduler && scheduler !== seededFrom) {
    setSeededFrom(scheduler);
    setEnabled(scheduler.enabled);
    setIntervalMinutes(String(scheduler.interval_minutes));
  }

  if (!scheduler) return null;

  const badge = schedulerBadge(scheduler);
  const note = save.isPending
    ? { text: "saving…", cls: "result-note busy" }
    : save.isSuccess && save.data
      ? { text: "Saved", cls: "result-note good" }
      : save.isError
        ? { text: save.error.message, cls: "result-note bad" }
        : null;

  const onSave = () => {
    const minutes = Number(interval);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      toast("Use 1–1440 minutes", "bad");
      return;
    }
    save.mutate(
      { enabled, interval_minutes: minutes },
      {
        onSuccess: () => toast("Automatic monitoring schedule saved", "good"),
        onError: (e) =>
          toast(`Could not save schedule: ${e.message}`, "bad", 6000),
      },
    );
  };

  return (
    <div className="scheduler-panel">
      <div className="card-head">
        <h3>Automatic monitoring</h3>
        <Pill tone={badge.tone}>{badge.label}</Pill>
      </div>
      <div className="field-row">
        <label htmlFor="scheduler-enabled">Run checks automatically</label>
        <input
          id="scheduler-enabled"
          className="scheduler-toggle"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
      </div>
      <div className="field">
        <label htmlFor="scheduler-interval">
          Check every <span className="lbl-note">(minutes)</span>
        </label>
        <input
          id="scheduler-interval"
          type="number"
          min={1}
          max={1440}
          step={1}
          value={interval}
          onChange={(e) => setIntervalMinutes(e.target.value)}
        />
      </div>
      <div className="field-actions">
        <button
          type="button"
          className="btn primary sm"
          onClick={onSave}
          disabled={save.isPending}
        >
          {save.isPending ? <Spinner /> : null} Save schedule
        </button>
        {note ? <ResultNote note={note} /> : null}
      </div>
      <p className="card-hint">{schedulerDetail(scheduler)}</p>
    </div>
  );
}

export function StatusCard({
  status,
  statusError,
  scheduler,
  check,
}: {
  status:
    | {
        used_file: string;
        has_webhook: boolean;
        accounts: number;
        db_exists: boolean;
        event_count: number;
        snapshot_accounts: number;
      }
    | undefined;
  statusError: boolean;
  scheduler: SchedulerSnapshot | undefined;
  check: CheckMutation;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Status</h3>
        {statusError ? (
          <Pill tone="red">error</Pill>
        ) : (
          <Pill tone={status && status.accounts ? "green" : "subtle"}>
            {status && status.accounts ? "active" : "no accounts"}
          </Pill>
        )}
      </div>
      <dl className="kv">
        <div>
          <dt>Config file</dt>
          <dd>{status?.used_file ?? "—"}</dd>
        </div>
        <div>
          <dt>Accounts</dt>
          <dd>{status ? status.accounts : "—"}</dd>
        </div>
        <div>
          <dt>Discord webhook</dt>
          <dd>
            {status ? (status.has_webhook ? "configured" : "empty") : "—"}
          </dd>
        </div>
        <div>
          <dt>Events recorded</dt>
          <dd>{status ? fmtNum(status.event_count) : "—"}</dd>
        </div>
        <div>
          <dt>Accounts with snapshot</dt>
          <dd>{status ? status.snapshot_accounts : "—"}</dd>
        </div>
        <div>
          <dt>Database</dt>
          <dd>
            {status ? (status.db_exists ? "initialized" : "missing") : "—"}
          </dd>
        </div>
      </dl>
      <SchedulerPanel scheduler={scheduler} />
      {check.isPending || check.isSuccess || check.isError ? (
        <div className="check-result">
          {check.isPending ? (
            <span className="result-note busy">
              Running checks against FACEIT — this can take a minute…
            </span>
          ) : check.isError ? (
            <span className="result-note bad">{check.error.message}</span>
          ) : (
            <CheckResultPills results={check.data.results} />
          )}
        </div>
      ) : null}
    </div>
  );
}
