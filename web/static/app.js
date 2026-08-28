/* SPDX-License-Identifier: AGPL-3.0-only */
"use strict";

/* ==========================================================================
   FACEIT Multi-Account Detection — dashboard app
   Vanilla JS, no dependencies. Hash-based views: #/overview #/friends #/voice
   ========================================================================== */

// ---------------------------------------------------------------- helpers

const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtTs = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
};

const fmtDur = (sec) => {
  sec = Number(sec) || 0;
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)} min`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};

const fmtNum = (n) => (Number(n) ?? 0).toLocaleString();

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) throw new Error(data.detail || data.message || res.statusText || "request failed");
  return data;
}

// ------------------------------------------------------------------ state

const state = {
  health: null,
  friendsStatus: null,
  config: null,
  events: [],
  snapshots: [],
  overlap: { accounts: [], pairs: [] },
  players: [],
  view: "overview",
  demos: loadDemos(),
};

let activeIngestJobId = null;
let ingestPollTimer = null;

function loadDemos() {
  try { return JSON.parse(localStorage.getItem("dsh.demos") || "[]"); }
  catch { return []; }
}
function persistDemos() {
  try { localStorage.setItem("dsh.demos", JSON.stringify(state.demos.slice(0, 20))); } catch { /* ignore */ }
}

const VIEW_TITLES = { overview: "Overview", friends: "Friends Monitor", voice: "Voice Identity" };

// ------------------------------------------------------------------ toasts

function toast(msg, kind = "", ms = 4200) {
  const box = $("toasts");
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.innerHTML =
    `<span class="toast-msg">${esc(msg)}</span>` +
    `<button class="toast-close" aria-label="Dismiss">✕</button>`;
  const close = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 260);
  };
  el.querySelector(".toast-close").addEventListener("click", close);
  box.appendChild(el);
  if (ms > 0) setTimeout(close, ms);
  while (box.children.length > 4) box.firstChild.remove();
}

// ---------------------------------------------------------------- routing

function navigate(view, push = true) {
  if (push) {
    if (location.hash !== "#/" + view) location.hash = "#/" + view;
    return; // hashchange handler does the rest
  }
  state.view = view;
  $$(".nav-item").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  $("page-title").textContent = VIEW_TITLES[view] || "Overview";
  if (view === "friends") loadFriendsData();
  if (view === "voice") loadVoiceData();
  if (view === "overview") renderOverview();
  $("sidebar").classList.remove("open");
}

window.addEventListener("hashchange", () => {
  const v = (location.hash.replace(/^#\//, "") || "overview").split("?")[0];
  navigate(VIEW_TITLES[v] ? v : "overview", false);
});

// ------------------------------------------------------------------ health

async function refreshHealth() {
  try {
    state.health = await api("/api/health");
    const h = state.health;
    const badge = $("health-badge");
    const text = $("health-text");
    const fReady = !!h.friends_configured, vReady = !!h.voice_available;
    if (fReady && vReady) {
      badge.dataset.state = "ok"; text.textContent = "All systems ready";
    } else if (fReady) {
      badge.dataset.state = "warn"; text.textContent = "Friends ready · voice off";
    } else if (vReady) {
      badge.dataset.state = "warn"; text.textContent = "Voice ready · friends off";
    } else {
      badge.dataset.state = "err"; text.textContent = "Not configured";
    }
    const banner = $("voice-unavailable");
    if (banner) banner.hidden = !!vReady;
    if (!vReady) {
      state.players = [];
      if (state.view === "overview") renderOverview();
      if (state.view === "voice") renderPlayers();
    }
  } catch {
    $("health-badge").dataset.state = "err";
    $("health-text").textContent = "API unreachable";
  }
}

function bumpUpdated() {
  $("last-updated").textContent = "updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ================================================================= OVERVIEW

async function renderOverview() {
  const fs = state.friendsStatus, players = state.players;

  $("kpi-accounts").textContent = fs ? fmtNum(fs.accounts) : "—";
  $("kpi-accounts-foot").textContent = fs ? (fs.db_exists ? "monitored accounts" : "no config") : "loading…";

  const nEvents = fs ? fs.event_count : 0;
  $("kpi-events").textContent = nEvents ? fmtNum(nEvents) : "—";
  const adds = state.events.filter((e) => e.kind === "added").length;
  const rems = state.events.filter((e) => e.kind === "removed").length;
  $("kpi-events-foot").textContent = state.events.length
    ? `last ${state.events.length}: ${adds} adds · ${rems} removes`
    : "adds / removes";

  const friendIds = new Set(state.snapshots.map((s) => s.friend_id));
  $("kpi-friends").textContent = friendIds.size ? fmtNum(friendIds.size) : "—";
  $("kpi-friends-foot").textContent = state.snapshots.length ? "across all accounts" : "no snapshots yet";

  $("kpi-players").textContent = players.length ? fmtNum(players.length) : "—";
  $("kpi-players-foot").textContent = state.health?.voice_available ? "embedded in DB" : "voice off";
  const clips = players.reduce((a, p) => a + (p.clip_count || 0), 0);
  const audio = players.reduce((a, p) => a + (p.audio_sec || 0), 0);
  $("kpi-clips").textContent = clips ? fmtNum(clips) : "—";
  $("kpi-audio").textContent = audio ? fmtDur(audio) : "—";

  renderOverlaps();
  renderRecentEvents();
  bumpUpdated();
}

function computeOverlaps() {
  const byFriend = new Map();
  for (const s of state.snapshots) {
    if (!byFriend.has(s.friend_id)) byFriend.set(s.friend_id, []);
    byFriend.get(s.friend_id).push(s);
  }
  const accLabel = accountLabel();
  const out = [];
  for (const [fid, list] of byFriend) {
    const accounts = [...new Set(list.map((x) => x.account_id))];
    if (accounts.length < 2) continue;
    const nickCounts = new Map();
    for (const x of list) if (x.nickname) nickCounts.set(x.nickname, (nickCounts.get(x.nickname) || 0) + 1);
    const nickname = [...nickCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || fid;
    out.push({
      friend_id: fid,
      nickname,
      accounts: accounts.map((a) => ({ id: a, label: accLabel(a) })),
      count: accounts.length,
      first: list.reduce((m, x) => (x.first_seen < m ? x.first_seen : m), list[0].first_seen),
      last: list.reduce((m, x) => (x.last_seen > m ? x.last_seen : m), list[0].last_seen),
    });
  }
  return out.sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
}

function overlapFriendIds() {
  const set = new Set();
  for (const o of computeOverlaps()) set.add(o.friend_id);
  return set;
}

function renderOverlaps() {
  const overlaps = computeOverlaps();
  const box = $("overlap-list");
  $("overlap-count").textContent = overlaps.length;
  if (!state.snapshots.length) {
    box.innerHTML = `<div class="empty">No snapshots yet — run a friends check to start watching.</div>`;
    return;
  }
  if (!overlaps.length) {
    box.innerHTML = `<div class="empty">No overlaps detected. Every friend is unique to one account so far.</div>`;
    return;
  }
  box.innerHTML = overlaps.slice(0, 8).map((o) =>
    `<div class="overlap-item">
      <div class="overlap-avatar">${esc((o.nickname[0] || "?").toUpperCase())}</div>
      <div class="overlap-main">
        <div class="overlap-name">${esc(o.nickname)} <span class="pill amber">${o.count} accounts</span></div>
        <div class="overlap-meta">seen ${fmtTs(o.first)} → ${fmtTs(o.last)}</div>
        <div class="overlap-accounts">${o.accounts.map((a) => `<span class="overlap-account">${esc(a.label || a.id)}</span>`).join("")}</div>
      </div>
    </div>`).join("");
}

function renderRecentEvents() {
  const tbody = $("overview-events");
  const rows = state.events.slice(0, 10);
  tbody.innerHTML = !rows.length
    ? `<tr><td colspan="4" class="empty">No events yet. Run a check to seed.</td></tr>`
    : rows.map((e) =>
        `<tr>
          <td class="sub">${esc(fmtTs(e.ts))}</td>
          <td>${esc(e.account_lbl || "—")}</td>
          <td><span class="tag ${e.kind}">${esc(e.kind)}</span></td>
          <td>${esc(e.nickname || e.friend_id || "—")}</td>
        </tr>`).join("");
}

// ================================================================ FRIENDS

function accountLabel() {
  const map = {};
  for (const a of state.config?.accounts || []) map[a.guid] = a.label || a.faceit || a.guid;
  return (guid) => map[guid] || guid;
}

function renderScheduler(s) {
  if (!s) return;
  $("scheduler-enabled").checked = !!s.enabled;
  $("scheduler-interval").value = s.interval_minutes || 5;

  const dot = $("scheduler-dot");
  let label = `every ${s.interval_minutes}m`;
  let cls = "green";
  if (!s.configured) { label = "save config"; cls = "subtle"; }
  else if (!s.accounts) { label = "no accounts"; cls = "subtle"; }
  else if (!s.enabled) { label = "off"; cls = "subtle"; }
  else if (s.running) { label = "checking…"; cls = "amber"; }
  else if (s.last_error) { label = "error"; cls = "red"; }
  dot.textContent = label;
  dot.className = "pill " + cls;

  const detail = $("scheduler-detail");
  if (s.last_error) {
    detail.textContent = `Last scheduler error: ${s.last_error}`;
  } else if (s.running) {
    detail.textContent = "A background friends check is running now.";
  } else if (s.last_finished) {
    const when = fmtTs(new Date(s.last_finished * 1000).toISOString());
    const result = s.last_result;
    const summary = result
      ? ` ${result.ok}/${result.accounts} accounts ok · +${result.added}/−${result.removed}.`
      : "";
    detail.textContent = `Last check ${when}.${summary}`;
  } else {
    detail.textContent = s.enabled
      ? "The server will check monitored accounts automatically."
      : "Automatic checks are disabled; manual checks are still available.";
  }
}

async function loadFriendsStatus() {
  try {
    state.friendsStatus = await api("/api/friends/status");
    const s = state.friendsStatus;
    $("status-config-file").textContent = s.used_file;
    $("status-accounts").textContent = s.accounts;
    $("status-webhook").textContent = s.has_webhook ? "configured" : "empty";
    $("status-events").textContent = fmtNum(s.event_count);
    $("status-snapshots").textContent = s.snapshot_accounts;
    $("status-db").textContent = s.db_exists ? "initialized" : "missing";
    renderScheduler(s.scheduler);
    const dot = $("status-dot");
    dot.textContent = s.accounts ? "active" : "no accounts";
    dot.className = "pill " + (s.accounts ? "green" : "subtle");
    if (state.view === "overview") renderOverview();
    bumpUpdated();
  } catch (e) {
    $("status-dot").textContent = "error";
    $("status-dot").className = "pill red";
  }
}

async function loadConfig() {
  try {
    state.config = await api("/api/friends/config");
    renderScheduler(state.config.scheduler);
    $("cfg-webhook").value = state.config.discord_webhook || "";
    $("cfg-ping").value = state.config.discord_ping || "";
    const box = $("cfg-accounts");
    box.innerHTML = "";
    (state.config.accounts || []).forEach((a) => addAccountRow(a));
  } catch { /* config may not exist yet */ }
}

function addAccountRow(a = {}) {
  const row = document.createElement("div");
  row.className = "account-row";
  row.innerHTML =
    `<input data-f="guid" type="text" placeholder="Nickname, profile URL or GUID" value="${esc(a.guid || "")}" spellcheck="false" />` +
    `<input data-f="label" type="text" placeholder="Label" value="${esc(a.label || "")}" spellcheck="false" />` +
    `<input data-f="faceit" type="text" placeholder="FACEIT name" value="${esc(a.faceit || "")}" spellcheck="false" />` +
    `<button class="btn ghost sm" data-act="resolve" title="Resolve to GUID" aria-label="Resolve to GUID">⇄</button>` +
    `<button class="btn ghost sm" data-act="remove" title="Remove account" aria-label="Remove account">✕</button>`;
  row.querySelector('[data-act="remove"]').addEventListener("click", () => {
    row.remove();
    toast("Account row removed (unsaved)", "");
  });
  row.querySelector('[data-act="resolve"]').addEventListener("click", async () => {
    const btn = row.querySelector('[data-act="resolve"]');
    const guidInput = row.querySelector('[data-f="guid"]');
    const q = guidInput.value.trim() || row.querySelector('[data-f="faceit"]').value.trim();
    if (!q) { toast("Type a nickname, profile URL or GUID first", "bad"); return; }
    btn.disabled = true;
    btn.textContent = "…";
    try {
      const r = await api("/api/friends/resolve?q=" + encodeURIComponent(q));
      guidInput.value = r.guid;
      if (r.nickname) {
        const faceit = row.querySelector('[data-f="faceit"]');
        const label = row.querySelector('[data-f="label"]');
        if (!faceit.value.trim()) faceit.value = r.nickname;
        if (!label.value.trim()) label.value = r.nickname;
      }
      toast(r.resolved
        ? `Resolved ${r.nickname} → ${r.guid.slice(0, 8)}…`
        : "Already a GUID — nothing to resolve", "good");
    } catch (e) {
      toast("Resolve failed: " + e.message, "bad", 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = "⇄";
    }
  });
  $("cfg-accounts").appendChild(row);
}

function collectConfig() {
  const accounts = Array.from($("cfg-accounts").children).map((row) => ({
    guid: row.querySelector('[data-f="guid"]').value.trim(),
    label: row.querySelector('[data-f="label"]').value.trim(),
    faceit: row.querySelector('[data-f="faceit"]').value.trim(),
  })).filter((a) => a.guid || a.faceit || a.label);
  return {
    discord_webhook: $("cfg-webhook").value.trim(),
    discord_ping: $("cfg-ping").value.trim(),
    accounts,
  };
}

async function saveConfig() {
  const out = $("config-saved");
  const btn = $("btn-save-config");
  out.textContent = "saving…"; out.className = "result-note busy";
  btn.disabled = true;
  try {
    await api("/api/friends/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectConfig()),
    });
    out.textContent = "Saved ✓"; out.className = "result-note good";
    toast("Configuration saved", "good");
    await Promise.all([loadConfig(), loadFriendsStatus()]);
  } catch (e) {
    out.textContent = e.message; out.className = "result-note bad";
    toast("Could not save config: " + e.message, "bad", 6000);
  } finally {
    btn.disabled = false;
    setTimeout(() => { out.textContent = ""; out.className = "result-note"; }, 4000);
  }
}

async function saveScheduler() {
  const out = $("scheduler-saved");
  const btn = $("btn-save-scheduler");
  const interval = Number($("scheduler-interval").value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 1440) {
    out.textContent = "Use 1–1440 minutes";
    out.className = "result-note bad";
    return;
  }
  out.textContent = "saving…"; out.className = "result-note busy";
  btn.disabled = true;
  try {
    const r = await api("/api/friends/scheduler", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: $("scheduler-enabled").checked,
        interval_minutes: interval,
      }),
    });
    renderScheduler(r.scheduler);
    out.textContent = "Saved ✓"; out.className = "result-note good";
    toast("Automatic monitoring schedule saved", "good");
    await loadFriendsStatus();
  } catch (e) {
    out.textContent = e.message; out.className = "result-note bad";
    toast("Could not save schedule: " + e.message, "bad", 6000);
  } finally {
    btn.disabled = false;
    setTimeout(() => { out.textContent = ""; out.className = "result-note"; }, 4000);
  }
}

async function runCheck(target) {
  const btn = $(target);
  const note = target === "btn-quick-check" ? $("quick-check-result") : $("check-result");
  btn.disabled = true;
  const old = btn.innerHTML;
  btn.innerHTML = `<span class="spin"></span> Scanning…`;
  note.hidden = false;
  note.innerHTML = `<span class="result-note busy">Running checks against FACEIT — this can take a minute…</span>`;
  try {
    const { results } = await api("/api/friends/check", { method: "POST" });
    const good = results.filter((r) => r.ok);
    const bad = results.filter((r) => !r.ok);
    note.innerHTML = results.map((r) =>
      `<span class="pill ${r.ok ? "green" : "red"}" style="margin:0 6px 6px 0">${esc(r.label)} ${r.ok ? `+${r.added}/−${r.removed}` : "err"}</span>`
    ).join("") || `<span class="pill subtle">No accounts configured</span>`;
    if (bad.length) toast(`${bad.length} account check(s) failed — see results`, "bad", 6000);
    else toast(`Check done · ${results.length} account(s) scanned`, "good");
    await Promise.all([loadFriendsStatus(), loadEvents(), loadSnapshots(), loadOverlap()]);
    renderOverview();
  } catch (e) {
    note.innerHTML = `<span class="result-note bad">${esc(e.message)}</span>`;
    toast("Check failed: " + e.message, "bad", 6000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

async function loadEvents() {
  try {
    const { events } = await api("/api/friends/events?limit=500");
    state.events = events || [];
    renderEvents();
  } catch { state.events = []; renderEvents(); }
}

function renderEvents() {
  const q = ($("events-search").value || "").trim().toLowerCase();
  const kind = $("events-filter-kind").value;
  const rows = state.events.filter((e) =>
    (!kind || e.kind === kind) &&
    (!q || (e.nickname || "").toLowerCase().includes(q) || (e.friend_id || "").toLowerCase().includes(q))
  );
  const tbody = $("events-table").querySelector("tbody");
  $("events-count").textContent = fmtNum(rows.length);
  tbody.innerHTML = !rows.length
    ? `<tr><td colspan="4" class="empty">No matching events.</td></tr>`
    : rows.map((e) =>
        `<tr>
          <td class="sub">${esc(fmtTs(e.ts))}</td>
          <td>${esc(e.account_lbl || "—")}</td>
          <td><span class="tag ${e.kind}">${esc(e.kind)}</span></td>
          <td>${esc(e.nickname || e.friend_id || "—")}</td>
        </tr>`).join("");
}

async function loadSnapshots() {
  try {
    const { snapshots } = await api("/api/friends/snapshots");
    state.snapshots = snapshots || [];
  } catch { state.snapshots = []; }
  renderWatch();
  if (state.view === "overview") renderOverview();
}

function renderWatch() {
  const q = ($("watch-search").value || "").trim().toLowerCase();
  const overlapIds = overlapFriendIds();
  const label = accountLabel();
  const rows = state.snapshots
    .filter((s) => !q || (s.nickname || "").toLowerCase().includes(q) || (s.friend_id || "").toLowerCase().includes(q))
    .sort((a, b) =>
      (label(a.account_id) || "").localeCompare(label(b.account_id) || "") ||
      (a.nickname || "").localeCompare(b.nickname || ""));
  const tbody = $("watch-table").querySelector("tbody");
  $("watch-count").textContent = fmtNum(rows.length);
  tbody.innerHTML = !rows.length
    ? `<tr><td colspan="4" class="empty">${state.snapshots.length ? "No matching friends." : "No snapshots yet — run a check to build the watch list."}</td></tr>`
    : rows.map((s) =>
        `<tr>
          <td>${esc(label(s.account_id))}</td>
          <td>${esc(s.nickname || s.friend_id)} ${overlapIds.has(s.friend_id) ? `<span class="tag warn">overlap</span>` : ""}</td>
          <td class="sub">${esc(fmtTs(s.first_seen))}</td>
          <td class="sub">${esc(fmtTs(s.last_seen))}</td>
        </tr>`).join("");
}

// --------------------------------------------------------------- overlap

async function loadOverlap() {
  try {
    state.overlap = await api("/api/friends/overlap");
  } catch {
    state.overlap = { accounts: [], pairs: [] };
  }
  renderOverlapPairSelect();
  await loadOverlapDetail();
}

function renderOverlapPairSelect() {
  const sel = $("overlap-pair");
  const pairs = state.overlap.pairs || [];
  const previous = sel.value;
  if (!pairs.length) {
    const seeded = (state.overlap.accounts || []).length;
    sel.innerHTML =
      `<option value="">${seeded < 2 ? "Need 2+ seeded accounts" : "No account pairs"}</option>`;
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const label = accountLabel();
  sel.innerHTML = pairs.map((p) => {
    const la = p.label_a || label(p.guid_a);
    const lb = p.label_b || label(p.guid_b);
    return `<option value="${esc(p.guid_a)}|${esc(p.guid_b)}">${esc(la)} ↔ ${esc(lb)} · ${p.common} shared</option>`;
  }).join("");
  if (previous && [...sel.options].some((o) => o.value === previous)) sel.value = previous;
}

async function loadOverlapDetail() {
  const [a, b] = ($("overlap-pair").value || "").split("|");
  const stats = $("overlap-stats"), chart = $("overlap-chart"), empty = $("overlap-empty");
  const wrap = $("overlap-table-wrap");
  if (!a || !b) {
    stats.hidden = true;
    chart.hidden = true;
    wrap.hidden = true;
    empty.hidden = false;
    empty.textContent = state.overlap.accounts.length
      ? "Run a friends check for at least two accounts to compare their friend lists."
      : "Seed at least two accounts with a friends check to see their shared friends.";
    return;
  }
  empty.hidden = true;
  const label = accountLabel();
  try {
    const payload = await api(
      `/api/friends/overlap/${encodeURIComponent(a)}/${encodeURIComponent(b)}`
    );
    renderOverlapStats(payload, label);
    renderOverlapChart(payload.timeline);
    renderOverlapTable(payload, label);
  } catch (e) {
    stats.hidden = true;
    chart.hidden = true;
    wrap.hidden = true;
    empty.hidden = false;
    empty.textContent = e.message;
  }
}

function renderOverlapStats(payload, label) {
  const la = payload.a.label || label(payload.a.guid);
  const lb = payload.b.label || label(payload.b.guid);
  const share = (account) => account.friend_count
    ? Math.round((100 * payload.common_count) / account.friend_count)
    : 0;
  const peak = payload.timeline.reduce(
    (m, p) => (p.overlap > m.overlap ? p : m),
    { overlap: 0, ts: null },
  );
  const stats = $("overlap-stats");
  stats.hidden = false;
  stats.innerHTML = `
    <div class="kpi"><div class="kpi-label">Shared now</div><div class="kpi-value">${payload.common_count}</div><div class="kpi-foot">common friends</div></div>
    <div class="kpi"><div class="kpi-label">Of ${esc(la)}</div><div class="kpi-value">${share(payload.a)}%</div><div class="kpi-foot">${payload.a.friend_count} friends</div></div>
    <div class="kpi"><div class="kpi-label">Of ${esc(lb)}</div><div class="kpi-value">${share(payload.b)}%</div><div class="kpi-foot">${payload.b.friend_count} friends</div></div>
    <div class="kpi accent"><div class="kpi-label">Peak shared</div><div class="kpi-value">${peak.overlap}</div><div class="kpi-foot">${peak.ts ? "on " + esc(fmtTs(peak.ts)) : "—"}</div></div>`;
}

function renderOverlapChart(timeline) {
  const box = $("overlap-chart");
  if (!timeline || timeline.length < 2) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const width = 640, height = 170;
  const left = 34, right = 12, top = 12, bottom = 26;
  const pts = timeline.map((p) => ({ t: new Date(p.ts).getTime(), v: p.overlap }));
  const tMin = pts[0].t, tMax = pts[pts.length - 1].t;
  const vMax = Math.max(1, ...pts.map((p) => p.v));
  const x = (t) => left + ((t - tMin) / Math.max(1, tMax - tMin)) * (width - left - right);
  const y = (v) => top + (1 - v / vMax) * (height - top - bottom);
  let line = `M ${x(pts[0].t).toFixed(1)} ${y(pts[0].v).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    line += ` H ${x(pts[i].t).toFixed(1)} V ${y(pts[i].v).toFixed(1)}`;
  }
  const area = `${line} V ${height - bottom} H ${x(tMin).toFixed(1)} Z`;
  const day = (t) => new Date(t).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  box.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Shared friends over time">
      <line class="overlap-baseline" x1="${left}" y1="${y(0)}" x2="${width - right}" y2="${y(0)}" />
      <line class="overlap-baseline" x1="${left}" y1="${y(vMax)}" x2="${width - right}" y2="${y(vMax)}" stroke-dasharray="3 4" />
      <path class="overlap-area" d="${area}" />
      <path class="overlap-line" d="${line}" />
      <text class="overlap-axis" x="${left - 7}" y="${y(vMax) + 4}" text-anchor="end">${vMax}</text>
      <text class="overlap-axis" x="${left - 7}" y="${y(0) + 4}" text-anchor="end">0</text>
      <text class="overlap-axis" x="${left}" y="${height - 7}">${esc(day(tMin))}</text>
      <text class="overlap-axis" text-anchor="end" x="${width - right}" y="${height - 7}">${esc(day(tMax))}</text>
    </svg>`;
}

function renderOverlapTable(payload, label) {
  const la = payload.a.label || label(payload.a.guid);
  const lb = payload.b.label || label(payload.b.guid);
  $("overlap-col-a").textContent = `${la} since`;
  $("overlap-col-b").textContent = `${lb} since`;
  const rows = payload.common_friends;
  $("overlap-table").querySelector("tbody").innerHTML = !rows.length
    ? `<tr><td colspan="3" class="empty">No shared friends between these two accounts right now.</td></tr>`
    : rows.map((f) =>
        `<tr>
          <td>${esc(f.nickname || f.friend_id)}</td>
          <td class="sub">${esc(fmtTs(f.first_seen_a))}</td>
          <td class="sub">${esc(fmtTs(f.first_seen_b))}</td>
        </tr>`).join("");
  $("overlap-table-wrap").hidden = false;
}

function loadFriendsData() {
  loadFriendsStatus();
  loadEvents();
  loadSnapshots();
  loadOverlap();
}

// ================================================================== VOICE

async function loadVoiceData() {
  if (!state.health?.voice_available) return;
  loadPlayers();
  loadSyncStatus();
  const jobId = sessionStorage.getItem("dsh.ingestJobId");
  if (jobId) monitorIngest(jobId);
}

async function loadPlayers() {
  const tbody = $("players-table").querySelector("tbody");
  tbody.innerHTML = `<tr><td colspan="5"><div class="skeleton" style="height:18px"></div></td></tr>`;
  try {
    state.players = await api("/api/voice/players");
    renderPlayers();
  } catch (e) {
    state.players = [];
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${esc(e.message)}</td></tr>`;
  }
}

function renderPlayers() {
  const q = ($("players-search").value || "").trim().toLowerCase();
  const rows = state.players.filter((p) =>
    !q || (p.nickname || "").toLowerCase().includes(q) || (p.steamid || "").includes(q));
  const tbody = $("players-table").querySelector("tbody");
  $("players-count").textContent = fmtNum(rows.length);
  tbody.innerHTML = !rows.length
    ? `<tr><td colspan="5" class="empty">${state.players.length ? "No matching players." : "No players embedded yet — ingest a .dem file."}</td></tr>`
    : rows.map((p) =>
        `<tr>
          <td>${esc(p.nickname || "—")}</td>
          <td class="mono sub">${esc(p.steamid)}</td>
          <td class="num">${p.clip_count}</td>
          <td class="num">${fmtDur(p.audio_sec)}</td>
          <td><span class="tag ${p.consent ? "consent-y" : "consent-n"}">${p.consent ? "yes" : "no"}</span></td>
        </tr>`).join("");
}

// -- ingest ---------------------------------------------------------------

const INGEST_STATUS_LABEL = {
  queued: "queued",
  running: "embedding",
  embedded: "embedded",
  skipped: "skipped",
  skipped_short: "short clip",
  skipped_other: "not selected",
  error: "failed",
};

function renderIngestProgress(job) {
  const box = $("ingest-progress");
  const progress = job.progress || {};
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const total = Number(progress.total) || 0;
  const current = Number(progress.current) || 0;
  box.hidden = false;
  $("ingest-progress-message").textContent = progress.message || job.status;
  $("ingest-progress-count").textContent = total
    ? `${Math.min(current, total)} / ${total} players · ${Math.round(percent)}%`
    : `${Math.round(percent)}%`;
  $("ingest-progress-bar").style.width = `${percent}%`;
  $("ingest-player-progress").innerHTML = (progress.players || []).map((p) => {
    const status = p.status || "queued";
    const label = INGEST_STATUS_LABEL[status] || status;
    const detail = p.reason ? ` · ${esc(p.reason)}` : "";
    const tagClass = status === "error" ? "err" : status === "embedded" ? "ok" : status === "running" ? "warn" : "skip";
    return `<div class="ingest-player ${esc(status)}">
      <span class="ingest-player-name">${esc(p.nickname || p.steamid)}</span>
      <span class="tag ${tagClass}">${esc(label)}</span>
      <span class="ingest-player-detail">${detail}</span>
    </div>`;
  }).join("");
}

function clearIngestPoll() {
  if (ingestPollTimer) clearTimeout(ingestPollTimer);
  ingestPollTimer = null;
  activeIngestJobId = null;
  sessionStorage.removeItem("dsh.ingestJobId");
}

async function finishIngest(job) {
  clearIngestPoll();
  const out = $("ingest-result"), btn = $("btn-ingest");
  btn.disabled = false;
  if (job.status === "failed") {
    out.textContent = job.error || "Ingest failed";
    out.className = "result-note bad";
    toast("Ingest failed: " + (job.error || "unknown error"), "bad", 6000);
    return;
  }

  const result = job.result || {};
  state.demos.unshift({ id: result.demo_id, name: job.filename, ts: Date.now() });
  persistDemos();
  renderDemoSelect();
  const players = result.players || [];
  const embedded = players.filter((p) => p.status === "embedded").length;
  out.textContent = `Done ✓ demo #${result.demo_id} · ${embedded} embedded / ${players.length} processed`;
  out.className = "result-note good";
  toast(`Demo ingested · ${embedded} players embedded`, "good", 6000);
  $("ingest-file-name").innerHTML = `<strong>Drop a <code>.dem</code> / <code>.dem.zst</code> here</strong><span>or click to browse</span>`;
  $("file-dem").value = "";
  $("cluster-card").hidden = false;
  await loadPlayers();
  if (state.view === "overview") renderOverview();
}

function monitorIngest(jobId) {
  if (activeIngestJobId === jobId) return;
  if (ingestPollTimer) clearTimeout(ingestPollTimer);
  activeIngestJobId = jobId;

  const poll = async () => {
    try {
      const job = await api(`/api/voice/ingest/${encodeURIComponent(jobId)}`);
      renderIngestProgress(job);
      if (job.status === "completed" || job.status === "failed") {
        await finishIngest(job);
        return;
      }
      ingestPollTimer = setTimeout(poll, 1000);
    } catch (e) {
      clearIngestPoll();
      $("ingest-result").textContent = `Could not read ingest status: ${e.message}`;
      $("ingest-result").className = "result-note bad";
      $("btn-ingest").disabled = false;
    }
  };
  poll();
}

function bindDropZone() {
  const zone = $("drop-zone"), input = $("file-dem");
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => {
    const f = input.files[0];
    $("ingest-file-name").innerHTML = f
      ? `<strong>${esc(f.name)}</strong><span>${(f.size / 1048576).toFixed(1)} MB — ready to ingest</span>`
      : `<strong>Drop a <code>.dem</code> / <code>.dem.zst</code> here</strong><span>or click to browse</span>`;
  });
  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("dragover"); }));
  zone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f && /\.(dem|dem\.zst|dem\.gz)$/i.test(f.name)) {
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event("change"));
    } else {
      toast("Please drop a .dem / .dem.zst / .dem.gz file", "bad");
    }
  });
}

async function ingestDemo() {
  const out = $("ingest-result"), btn = $("btn-ingest");
  const file = $("file-dem").files[0];
  if (!file) { toast("Pick a .dem file to upload", "bad"); return; }
  out.textContent = "Uploading demo…"; out.className = "result-note busy";
  btn.disabled = true;
  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await api("/api/voice/ingest", { method: "POST", body: fd });
    sessionStorage.setItem("dsh.ingestJobId", r.job_id);
    out.textContent = "Queued — extraction and embeddings are running in the background…";
    out.className = "result-note busy";
    renderIngestProgress({
      status: "queued",
      progress: {
        percent: 0,
        current: 0,
        total: 0,
        players: [],
        message: "Waiting for the ingest worker…",
      },
    });
    monitorIngest(r.job_id);
  } catch (e) {
    out.textContent = e.message; out.className = "result-note bad";
    toast("Ingest failed: " + e.message, "bad", 6000);
    btn.disabled = false;
  }
}

function renderDemoSelect() {
  const sel = $("cluster-demo");
  sel.innerHTML = state.demos.length
    ? state.demos.map((d, i) => `<option value="${i}">Demo #${d.id} — ${esc(d.name)}</option>`).join("")
    : `<option value="">No demos ingested this session</option>`;
}

async function loadCluster() {
  const sel = $("cluster-demo");
  const box = $("cluster-result");
  const i = +sel.value;
  const demo = state.demos[i];
  if (!demo) { toast("Ingest a demo first", "bad"); return; }
  box.innerHTML = `<div class="empty"><div class="skeleton" style="height:16px;margin-bottom:8px"></div>Clustering speakers…</div>`;
  try {
    const { groups } = await api(`/api/voice/demo/${demo.id}/cluster`);
    if (!groups.length) {
      box.innerHTML = `<div class="empty">No speaker groups found in this demo.</div>`;
      return;
    }
    const palette = ["#ff5500", "#4da3ff", "#2fd17e", "#ffb020", "#c86bff", "#ff4d5e"];
    box.innerHTML = groups.map((g, gi) =>
      `<div class="cluster-group">
        <div class="cluster-group-head">
          <span class="dot" style="width:9px;height:9px;border-radius:50%;background:${palette[gi % palette.length]}"></span>
          Group ${gi + 1} · ${g.length} speaker${g.length === 1 ? "" : "s"}
        </div>
        <div class="cluster-members">
          ${g.map((m) => `<span class="cluster-member"><span class="dot" style="background:${palette[gi % palette.length]}"></span>${esc(m.nickname || m.steamid)}</span>`).join("")}
        </div>
      </div>`).join("");
  } catch (e) {
    box.innerHTML = `<div class="empty bad">${esc(e.message)}</div>`;
  }
}

// -- verify / match -------------------------------------------------------

async function verifyPair() {
  const out = $("verify-result");
  const evidence = $("verify-evidence");
  const a = $("verify-a").value.trim(), b = $("verify-b").value.trim();
  if (!a || !b) { toast("Enter both SteamIDs", "bad"); return; }
  evidence.hidden = true;
  out.textContent = "comparing…"; out.className = "result-note busy";
  try {
    const r = await api("/api/voice/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steamid_a: a, steamid_b: b }),
    });
    const verdictMeta = {
      same: ["red", "SAME speaker"],
      different: ["green", "different speakers"],
      inconclusive: ["amber", "INCONCLUSIVE"],
    }[r.verdict] || ["amber", "INCONCLUSIVE"];
    const verdict = `<span class="pill ${verdictMeta[0]}">${verdictMeta[1]}</span>`;
    out.innerHTML = `<span class="pill blue">score ${r.score.toFixed(3)}</span> ${verdict}`;
    out.className = "result-note";
    const pairScores = (r.pair_scores || []).map((score) => score.toFixed(3)).join(", ");
    evidence.innerHTML = `
      <div class="verify-metrics">
        <span><strong>${r.clip_count_a}</strong> windows / ${r.demo_count_a} demos (A)</span>
        <span><strong>${r.clip_count_b}</strong> windows / ${r.demo_count_b} demos (B)</span>
        <span><strong>${r.window_pair_count}</strong> window comparisons</span>
        <span><strong>${r.pair_count}</strong> equally weighted demo pairs</span>
        <span><strong>${(r.agreement * 100).toFixed(0)}%</strong> verdict agreement</span>
        <span><strong>${(r.same_pair_fraction * 100).toFixed(0)}%</strong> same-speaker support</span>
        <span><strong>${esc(r.evidence_quality)}</strong> evidence</span>
      </div>
      <div class="verify-spread">threshold ${r.threshold.toFixed(3)} · operational uncertainty band ${r.band_low.toFixed(3)}–${r.band_high.toFixed(3)} · P10–P90 ${r.score_p10.toFixed(3)}–${r.score_p90.toFixed(3)} · range ${r.score_min.toFixed(3)}–${r.score_max.toFixed(3)} · mean-vector ${r.mean_score.toFixed(3)}</div>
      ${pairScores ? `<div class="verify-pairs">demo-pair scores: ${esc(pairScores)}</div>` : ""}
      <ul>${(r.reasons || []).map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul>`;
    evidence.hidden = false;
    if (r.verdict === "same") toast("Repeated demos support the same-speaker verdict", "bad", 6000);
    else if (r.verdict === "different") toast("Repeated demos support different speakers", "good");
    else toast("Voice evidence is inconclusive — collect more demos", "busy", 6000);
  } catch (e) {
    out.textContent = e.message; out.className = "result-note bad";
    evidence.hidden = true;
  }
}

async function matchVoice() {
  const card = $("match-card"), box = $("match-result");
  const sid = $("match-id").value.trim();
  if (!sid) { toast("Enter a SteamID to match", "bad"); return; }
  card.hidden = false;
  box.innerHTML = `<div class="empty"><div class="skeleton" style="height:16px;margin-bottom:8px"></div>Searching voiceprints…</div>`;
  try {
    const r = await api("/api/voice/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steamid: sid, k: +$("match-k").value || 10 }),
    });
    card.querySelector("h3").textContent = `Match results · threshold ${r.threshold.toFixed(3)}`;
    if (!r.matches.length) {
      box.innerHTML = `<div class="empty">No matches found for this voiceprint.</div>`;
      return;
    }
    const maxScore = Math.max(...r.matches.map((m) => m.score), 0.0001);
    box.innerHTML = r.matches.map((m) => {
      const hot = m.verdict === "same";
      const uncertain = m.verdict === "inconclusive";
      const shownScore = m.median_score ?? m.score;
      const pct = Math.max(4, Math.min(100, (m.score / maxScore) * 100));
      const marker = hot ? "SAME" : uncertain ? "?" : "different";
      const color = hot ? "var(--red)" : uncertain ? "var(--amber)" : "var(--text-2)";
      return `<div class="score-row">
        <div>${esc(m.nickname || "—")}</div>
        <div class="mono sub" style="font-size:11.5px">${esc(m.steamid)}</div>
        <div class="score-bar ${hot ? "hot" : uncertain ? "uncertain" : ""}" title="${esc((m.reasons || []).join("; "))}"><span style="width:${pct.toFixed(0)}%"></span></div>
        <div class="score-val" style="color:${color}">${shownScore.toFixed(3)} ${marker}</div>
      </div>`;
    }).join("");
  } catch (e) {
    box.innerHTML = `<div class="empty bad">${esc(e.message)}</div>`;
  }
}

// -- faceit demo sync -----------------------------------------------------

let syncPollTimer = null;

async function loadSyncStatus() {
  const pill = $("sync-session");
  try {
    const s = await api("/api/faceit/status");
    let text, cls = "pill subtle";
    if (!s.playwright_installed) { text = "playwright missing"; cls = "pill red"; }
    else if (s.cdp_configured) { text = "CDP browser"; cls = "pill green"; }
    else if (s.profile_exists) { text = "session saved"; cls = "pill green"; }
    else { text = "login needed"; }
    pill.textContent = "session: " + text;
    pill.className = cls;
    $("btn-sync-start").disabled = !s.playwright_installed;
    $("btn-sync-login").disabled = !s.playwright_installed;
  } catch {
    pill.textContent = "session: unavailable";
    pill.className = "pill red";
  }
}

async function syncLogin() {
  const btn = $("btn-sync-login"), note = $("sync-note");
  btn.disabled = true;
  note.textContent = "opening a browser window — log in to FACEIT there…";
  note.className = "result-note busy";
  try {
    const r = await api("/api/faceit/login", { method: "POST" });
    note.textContent = r.detail || "logged in ✓";
    note.className = "result-note good";
    toast("FACEIT session saved", "good");
  } catch (e) {
    note.textContent = e.message;
    note.className = "result-note bad";
    toast("Login failed: " + e.message, "bad", 6000);
  } finally {
    btn.disabled = false;
    loadSyncStatus();
    setTimeout(() => { note.textContent = ""; note.className = "result-note"; }, 6000);
  }
}

async function startSync() {
  const btn = $("btn-sync-start"), note = $("sync-note");
  const limit = Math.max(1, Math.min(100, +$("sync-limit").value || 10));
  btn.disabled = true;
  try {
    await api("/api/faceit/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit }),
    });
    note.textContent = "sync running…";
    note.className = "result-note busy";
    $("sync-log").hidden = false;
    $("sync-log").textContent = "";
    if (syncPollTimer) clearInterval(syncPollTimer);
    syncPollTimer = setInterval(pollSync, 2000);
    pollSync();
  } catch (e) {
    note.textContent = e.message;
    note.className = "result-note bad";
    btn.disabled = false;
  }
}

async function pollSync() {
  let job;
  try { job = await api("/api/faceit/sync/status"); } catch { return; }
  const logBox = $("sync-log");
  logBox.hidden = false;
  logBox.textContent = (job.log || []).join("\n");
  logBox.scrollTop = logBox.scrollHeight;
  if (job.result && job.result.matches) renderSyncRows(job.result.matches);
  if (!job.running) {
    if (syncPollTimer) { clearInterval(syncPollTimer); syncPollTimer = null; }
    $("btn-sync-start").disabled = false;
    const note = $("sync-note");
    if (job.error) {
      note.textContent = job.error;
      note.className = "result-note bad";
      toast("Sync failed: " + job.error, "bad", 7000);
    } else {
      const r = job.result || {};
      note.textContent = `done · ${r.downloaded || 0} downloaded · ${r.failed || 0} failed`;
      note.className = "result-note good";
      toast(`Sync done · ${r.downloaded || 0} demo(s) downloaded`, "good", 6000);
      loadPlayers().catch(() => {});
      loadSyncStatus();
    }
  }
}

const SYNC_TAG = {
  ingested: ["ok", "ingested"],
  downloaded: ["ok", "downloaded"],
  skipped_existing: ["skip", "already local"],
  no_demo: ["skip", "no demo"],
  failed: ["err", "failed"],
};

function renderSyncRows(matches) {
  const tbody = $("sync-table").querySelector("tbody");
  tbody.innerHTML = !matches.length
    ? `<tr><td colspan="5" class="empty">Nothing synced yet.</td></tr>`
    : matches.map((m) => {
        const [cls, label] = SYNC_TAG[m.status] || ["skip", m.status || "—"];
        const voice = (m.voice_matches || []).map((v) =>
          v.matches.map((hit) => {
            const verdict = hit.verdict || "inconclusive";
            const cls = verdict === "same" ? "red" : verdict === "different" ? "green" : "warn";
            const relation = verdict === "same" ? "≈" : "↔";
            const label = verdict === "same" ? "SAME" : verdict.toUpperCase();
            const reasons = (hit.reasons || []).join("; ");
            return `<span class="tag ${cls}" title="${esc(reasons)}" style="margin:1px 4px 1px 0">${esc(v.nickname || shortId(v.steamid))} ${relation} ${esc(hit.nickname || shortId(hit.steamid))} · ${hit.score.toFixed(2)} · ${esc(label)}</span>`;
          }).join("")).join(" ");
        return `<tr>
          <td class="sub">${esc(m.date || "—")}</td>
          <td>${esc(m.account || "—")}</td>
          <td class="mono sub" style="font-size:11.5px">${esc(shortMatchId(m.match_id))}</td>
          <td><span class="tag ${cls}">${esc(label)}</span></td>
          <td>${voice || '<span class="sub">—</span>'}</td>
        </tr>`;
      }).join("");
}

const shortMatchId = (id) => String(id || "").replace(/^1-/, "").slice(0, 8);
const shortId = (sid) => String(sid || "").slice(-5);

// ------------------------------------------------------------------- bind

function bind() {
  // nav
  $$(".nav-item").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.view)));
  $("nav-toggle").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  $("btn-refresh").addEventListener("click", async () => {
    await Promise.all([refreshHealth(), loadFriendsStatus(), loadEvents(), loadSnapshots(), loadOverlap(), loadPlayers().catch(() => {})]);
    toast("All data refreshed", "good");
  });

  // friends
  $("btn-add-account").addEventListener("click", () => addAccountRow());
  $("btn-save-config").addEventListener("click", saveConfig);
  $("btn-save-scheduler").addEventListener("click", saveScheduler);
  $("btn-run-check").addEventListener("click", () => runCheck("btn-run-check"));
  $("btn-quick-check").addEventListener("click", () => runCheck("btn-quick-check"));
  $("btn-refresh-events").addEventListener("click", loadEvents);
  $("btn-refresh-watch").addEventListener("click", loadSnapshots);
  $("btn-refresh-overlap").addEventListener("click", loadOverlap);
  $("overlap-pair").addEventListener("change", loadOverlapDetail);
  $("events-search").addEventListener("input", renderEvents);
  $("events-filter-kind").addEventListener("change", renderEvents);
  $("watch-search").addEventListener("input", renderWatch);

  // voice
  bindDropZone();
  $("btn-ingest").addEventListener("click", ingestDemo);
  $("btn-verify").addEventListener("click", verifyPair);
  $("btn-match").addEventListener("click", matchVoice);
  $("btn-refresh-players").addEventListener("click", loadPlayers);
  $("players-search").addEventListener("input", renderPlayers);
  $("btn-load-cluster").addEventListener("click", loadCluster);
  // faceit demo sync
  $("btn-sync-login").addEventListener("click", syncLogin);
  $("btn-sync-start").addEventListener("click", startSync);
  renderDemoSelect();
  $("cluster-card").hidden = !state.demos.length;
}

document.addEventListener("DOMContentLoaded", async () => {
  bind();
  // initial view from hash or default
  const v = (location.hash.replace(/^#\//, "") || "overview").split("?")[0];
  navigate(VIEW_TITLES[v] ? v : "overview", false);

  await refreshHealth();
  await Promise.all([
    loadFriendsStatus(),
    loadConfig(),
    loadEvents(),
    loadSnapshots(),
    state.health?.voice_available ? loadPlayers() : Promise.resolve(),
  ]);
  renderOverview();

  // silent auto-refresh
  setInterval(() => {
    refreshHealth();
    loadFriendsStatus();
    loadEvents();
  }, 45000);
});
