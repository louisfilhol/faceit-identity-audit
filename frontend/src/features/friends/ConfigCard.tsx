// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { ArrowLeftRight, X } from "lucide-react";
import { Spinner } from "@/components/common/Spinner";
import { ResultNote } from "@/components/common/ResultNote";
import { useToast } from "@/components/common/Toast";
import type { FriendsConfig } from "@/api/types";
import {
  draftsToAccounts,
  toDrafts,
  useResolveAccount,
  useSaveConfig,
  type AccountDraft,
} from "./queries";

function AccountRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: AccountDraft;
  onChange: (next: AccountDraft) => void;
  onRemove: () => void;
}) {
  const toast = useToast();
  const resolve = useResolveAccount();
  const [resolving, setResolving] = useState(false);

  const onResolve = async () => {
    const q = draft.guid.trim() || draft.faceit.trim();
    if (!q) {
      toast("Type a nickname, profile URL or GUID first", "bad");
      return;
    }
    setResolving(true);
    try {
      const r = await resolve.mutateAsync(q);
      const next: AccountDraft = { ...draft, guid: r.guid };
      if (r.nickname) {
        if (!draft.faceit.trim()) next.faceit = r.nickname;
        if (!draft.label.trim()) next.label = r.nickname;
      }
      onChange(next);
      toast(
        r.resolved
          ? `Resolved ${r.nickname} → ${r.guid.slice(0, 8)}…`
          : "Already a GUID — nothing to resolve",
        "good",
      );
    } catch (e) {
      toast(`Resolve failed: ${(e as Error).message}`, "bad", 6000);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="account-row">
      <input
        data-f="guid"
        type="text"
        placeholder="Nickname, profile URL or GUID"
        value={draft.guid}
        spellCheck={false}
        aria-label="Account identifier (nickname, profile URL or GUID)"
        onChange={(e) => onChange({ ...draft, guid: e.target.value })}
      />
      <input
        data-f="label"
        type="text"
        placeholder="Label"
        value={draft.label}
        spellCheck={false}
        aria-label="Account label"
        onChange={(e) => onChange({ ...draft, label: e.target.value })}
      />
      <input
        data-f="faceit"
        type="text"
        placeholder="FACEIT name"
        value={draft.faceit}
        spellCheck={false}
        aria-label="FACEIT name"
        onChange={(e) => onChange({ ...draft, faceit: e.target.value })}
      />
      <button
        type="button"
        className="btn ghost sm"
        data-act="resolve"
        title="Resolve to GUID"
        aria-label="Resolve to GUID"
        onClick={() => void onResolve()}
        disabled={resolving}
      >
        {resolving ? "…" : <ArrowLeftRight size={13} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="btn ghost sm"
        data-act="remove"
        title="Remove account"
        aria-label="Remove account"
        onClick={onRemove}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ConfigCard({ config }: { config: FriendsConfig | undefined }) {
  const toast = useToast();
  const save = useSaveConfig();
  const [webhook, setWebhook] = useState("");
  const [ping, setPing] = useState("");
  const [drafts, setDrafts] = useState<AccountDraft[]>([]);
  const [seededFrom, setSeededFrom] = useState<FriendsConfig | undefined>(
    undefined,
  );

  // Re-seed the editor whenever a different config object arrives (first
  // load, after a save, or a manual refresh-all). The identity check keeps
  // unrelated re-renders from discarding in-progress edits.
  if (config && config !== seededFrom) {
    setSeededFrom(config);
    setWebhook(config.discord_webhook || "");
    setPing(config.discord_ping || "");
    setDrafts(toDrafts(config.accounts));
  }

  const note = save.isPending
    ? { text: "saving…", cls: "result-note busy" }
    : save.isSuccess && save.data
      ? { text: "Saved", cls: "result-note good" }
      : save.isError
        ? { text: save.error.message, cls: "result-note bad" }
        : null;

  const onSave = () => {
    save.mutate(
      {
        discord_webhook: webhook.trim(),
        discord_ping: ping.trim(),
        accounts: draftsToAccounts(drafts),
      },
      {
        onSuccess: () => toast("Configuration saved", "good"),
        onError: (e) =>
          toast(`Could not save config: ${e.message}`, "bad", 6000),
      },
    );
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Configuration</h3>
        <span className="pill subtle">config.json</span>
      </div>
      <div className="field">
        <label htmlFor="cfg-webhook">Discord webhook</label>
        <input
          id="cfg-webhook"
          type="url"
          placeholder="https://discord.com/api/webhooks/…"
          value={webhook}
          spellCheck={false}
          onChange={(e) => setWebhook(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cfg-ping">
          Discord ping{" "}
          <span className="lbl-note">
            (<code>&lt;@id&gt;</code>)
          </span>
        </label>
        <input
          id="cfg-ping"
          type="text"
          placeholder="<@123456789>"
          value={ping}
          spellCheck={false}
          onChange={(e) => setPing(e.target.value)}
        />
      </div>
      <div className="field">
        <div className="field-row">
          <label>Monitored accounts</label>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              setDrafts((d) => [...d, { guid: "", label: "", faceit: "" }])
            }
          >
            + Add account
          </button>
        </div>
        <div>
          {drafts.map((draft, i) => (
            <AccountRow
              key={i}
              draft={draft}
              onChange={(next) =>
                setDrafts((d) => d.map((row, j) => (j === i ? next : row)))
              }
              onRemove={() => {
                setDrafts((d) => d.filter((_, j) => j !== i));
                toast("Account row removed (unsaved)");
              }}
            />
          ))}
        </div>
        <p className="lbl-note" style={{ marginTop: 6 }}>
          Paste a nickname (exact case), a profile URL, or a GUID — the swap
          button resolves it. Saving resolves anything left unresolved.
        </p>
      </div>
      <div className="field-actions">
        <button
          type="button"
          className="btn primary"
          onClick={onSave}
          disabled={save.isPending}
        >
          {save.isPending ? <Spinner /> : null} Save config
        </button>
        {note ? <ResultNote note={note} /> : null}
      </div>
    </div>
  );
}
