// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Tag } from "@/components/common/Pill";
import {
  ResultNote,
  type ResultNoteData,
} from "@/components/common/ResultNote";
import { useToast } from "@/components/common/Toast";
import { queryKeys } from "@/api/keys";
import { uploadDemo } from "@/api/voice";
import { rememberDemo } from "@/hooks/useDemos";
import { useIngestJob } from "@/hooks/useIngestJob";
import type { IngestJob, IngestPlayerProgress } from "@/api/types";

const DEMO_FILE_PATTERN = /\.(dem|dem\.zst|dem\.gz)$/i;

const STATUS_LABEL: Record<string, string> = {
  queued: "queued",
  running: "embedding",
  embedded: "embedded",
  skipped: "skipped",
  skipped_short: "short clip",
  skipped_other: "not selected",
  error: "failed",
};

function statusTagTone(status: string): "err" | "ok" | "warn" | "skip" {
  if (status === "error") return "err";
  if (status === "embedded") return "ok";
  if (status === "running") return "warn";
  return "skip";
}

function PlayerProgress({ p }: { p: IngestPlayerProgress }) {
  const status = p.status || "queued";
  const label = STATUS_LABEL[status] ?? status;
  return (
    <div className={`ingest-player ${status}`}>
      <span className="ingest-player-name">
        {p.nickname || p.steamid || "—"}
      </span>
      <Tag tone={statusTagTone(status)}>{label}</Tag>
      <span className="ingest-player-detail">
        {p.reason ? `· ${p.reason}` : ""}
      </span>
    </div>
  );
}

function ProgressBar({ job }: { job: IngestJob | undefined }) {
  if (!job) return null;
  const progress = job.progress;
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const total = Number(progress.total) || 0;
  const current = Number(progress.current) || 0;
  return (
    <div className="ingest-progress">
      <div className="progress-head">
        <span>{progress.message || job.status}</span>
        <span className="progress-count">
          {total
            ? `${Math.min(current, total)} / ${total} players · ${Math.round(percent)}%`
            : `${Math.round(percent)}%`}
        </span>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span
          style={{ width: `${percent}%`, transition: "width 0.35s ease" }}
        />
      </div>
      <div className="ingest-players" aria-live="polite">
        {(progress.players ?? []).map((p, i) => (
          <PlayerProgress key={`${p.steamid ?? i}-${i}`} p={p} />
        ))}
      </div>
    </div>
  );
}

export function IngestCard({ onIngested }: { onIngested: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const ingest = useIngestJob();
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [clearedForDemo, setClearedForDemo] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedDemoRef = useRef<number | null>(null);

  const job = ingest.job;
  const busy =
    uploading ||
    (job !== undefined &&
      job.status !== "completed" &&
      job.status !== "failed");

  // Reset the picker once a job completes (state adjusted during render —
  // the docs-sanctioned way to react to changed external data).
  const completedDemoId =
    job?.status === "completed" && job.result ? job.result.demo_id : null;
  if (completedDemoId !== null && clearedForDemo !== completedDemoId) {
    setClearedForDemo(completedDemoId);
    setFile(null);
  }

  // The status note is fully derived from the upload + job state, so there is
  // no state to keep in sync and no stale copy after a page reload.
  let note: ResultNoteData | null = null;
  if (uploading) {
    note = { text: "Uploading demo…", cls: "result-note busy" };
  } else if (uploadError) {
    note = { text: uploadError, cls: "result-note bad" };
  } else if (job?.status === "failed") {
    note = { text: job.error || "Ingest failed", cls: "result-note bad" };
  } else if (job?.status === "completed" && job.result) {
    const players = job.result.players ?? [];
    const embedded = players.filter((p) => p.status === "embedded").length;
    note = {
      text: `Done — demo #${job.result.demo_id} · ${embedded} embedded / ${players.length} processed`,
      cls: "result-note good",
    };
  } else if (ingest.jobId) {
    note = {
      text: "Queued — extraction and embeddings are running in the background…",
      cls: "result-note busy",
    };
  }

  // One-shot side effects when a job finishes (external systems only).
  useEffect(() => {
    if (!job || job.status !== "completed" || !job.result) return;
    if (finishedDemoRef.current === job.result.demo_id) return;
    finishedDemoRef.current = job.result.demo_id;
    const players = job.result.players ?? [];
    const embedded = players.filter((p) => p.status === "embedded").length;
    rememberDemo({
      id: job.result.demo_id,
      name: job.filename,
      ts: Date.now(),
    });
    toast(`Demo ingested · ${embedded} players embedded`, "good", 6000);
    if (inputRef.current) inputRef.current.value = "";
    void queryClient.invalidateQueries({ queryKey: queryKeys.voice.players });
    onIngested();
  }, [job, queryClient, toast, onIngested]);

  useEffect(() => {
    if (job?.status === "failed") {
      toast(`Ingest failed: ${job.error || "unknown error"}`, "bad", 6000);
    } else if (ingest.error) {
      toast(
        `Could not read ingest status: ${ingest.error.message}`,
        "bad",
        6000,
      );
    }
  }, [job, ingest.error, toast]);

  const pickFile = (f: File | null) => {
    setFile(f);
    setUploadError(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files.item(0);
    if (f && DEMO_FILE_PATTERN.test(f.name)) {
      pickFile(f);
    } else {
      toast("Please drop a .dem / .dem.zst / .dem.gz file", "bad");
    }
  };

  const onIngest = async () => {
    if (!file) {
      toast("Pick a .dem file to upload", "bad");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const accepted = await uploadDemo(file);
      ingest.watch(accepted.job_id);
    } catch (e) {
      setUploadError((e as Error).message);
      toast(`Ingest failed: ${(e as Error).message}`, "bad", 6000);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Ingest demo</h3>
      </div>
      <div
        className={`drop-zone${dragOver ? " dragover" : ""}`}
        tabIndex={0}
        role="button"
        aria-label="Upload a .dem file"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={onDrop}
      >
        <Upload size={26} strokeWidth={1.8} aria-hidden="true" />
        <div className="drop-text">
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span>
                {(file.size / 1048576).toFixed(1)} MB — ready to ingest
              </span>
            </>
          ) : (
            <>
              <strong>
                Drop a <code>.dem</code> / <code>.dem.zst</code> here
              </strong>
              <span>or click to browse</span>
            </>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".dem,.dem.zst,.dem.gz"
        aria-label="Demo file"
        hidden
        onChange={(e) => pickFile(e.target.files?.item(0) ?? null)}
      />
      <div className="field-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => void onIngest()}
          disabled={busy}
        >
          Ingest
        </button>
        {note ? <ResultNote note={note} /> : null}
      </div>
      {job ? <ProgressBar job={job} /> : null}
    </div>
  );
}
