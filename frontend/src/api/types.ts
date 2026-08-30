// SPDX-License-Identifier: AGPL-3.0-only
/** Request/response types for the FastAPI backend.
 *
 * Written against the routers in `web/routers/` (friends.py, voice.py,
 * faceit.py) and the dataclasses in `voice-identity-linker/core/models.py`.
 * Keep these in sync when an endpoint shape changes.
 */

// ---------------------------------------------------------------- health

export interface Health {
  status: string;
  friends_configured: boolean;
  voice_available: boolean;
}

// ---------------------------------------------------------------- friends

export interface SchedulerSettings {
  enabled: boolean;
  interval_minutes: number;
}

/** Result summary of the last finished scheduler-driven check. */
export interface SchedulerLastResult {
  accounts: number;
  ok: number;
  failed: number;
  added: number;
  removed: number;
}

export interface SchedulerSnapshot extends SchedulerSettings {
  configured: boolean;
  /** Number of accounts in the saved config (0 while only the example exists). */
  accounts: number;
  /** The scheduler task is alive. */
  active: boolean;
  /** A check is currently executing in the scheduler thread. */
  running: boolean;
  last_started: number | null;
  last_finished: number | null;
  last_result: SchedulerLastResult | null;
  last_error: string | null;
  next_run: number | null;
}

export interface FriendsAccount {
  guid?: string;
  faceit?: string;
  label?: string;
}

export interface FriendsConfig {
  discord_webhook: string;
  discord_ping: string;
  accounts: FriendsAccount[];
  scheduler: SchedulerSettings;
  _used_file: string;
}

export interface SaveConfigResult {
  ok: boolean;
  used_file: string;
  accounts: number;
}

export interface ResolveResult {
  guid: string;
  nickname: string | null;
  country: string | null;
  avatar: string | null;
  resolved: boolean;
}

export interface FriendsStatus {
  used_file: string;
  has_webhook: boolean;
  accounts: number;
  db_exists: boolean;
  event_count: number;
  snapshot_accounts: number;
  scheduler: SchedulerSnapshot;
}

export interface CheckResult {
  label: string;
  ok: boolean;
  added?: number;
  removed?: number;
  error?: string;
}

export interface CheckResponse {
  results: CheckResult[];
}

export type EventKind = "added" | "removed";

export interface FriendsEvent {
  ts: string;
  account_lbl: string;
  kind: EventKind | string;
  friend_id: string;
  nickname: string | null;
}

export interface FriendsSnapshot {
  account_id: string;
  friend_id: string;
  nickname: string | null;
  first_seen: string;
  last_seen: string;
}

export interface OverviewAccount {
  guid: string;
  seeded_at: string;
  friend_count: number;
  label?: string;
}

export interface OverlapPair {
  guid_a: string;
  guid_b: string;
  friend_count_a: number;
  friend_count_b: number;
  common: number;
  jaccard: number;
  label_a?: string;
  label_b?: string;
}

export interface OverlapListResponse {
  accounts: OverviewAccount[];
  pairs: OverlapPair[];
}

export interface CommonFriend {
  friend_id: string;
  nickname: string | null;
  first_seen_a: string;
  first_seen_b: string;
}

export interface TimelinePoint {
  ts: string;
  overlap: number;
}

export interface OverlapDetailResponse {
  a: OverviewAccount;
  b: OverviewAccount;
  common_count: number;
  common_friends: CommonFriend[];
  timeline: TimelinePoint[];
  generated_at: string;
}

// ---------------------------------------------------------------- voice

export type IngestJobStatus = "queued" | "running" | "completed" | "failed";

export interface IngestPlayerProgress {
  steamid?: string;
  nickname?: string | null;
  status?: string;
  reason?: string | null;
}

export interface IngestProgress {
  phase: string;
  current: number;
  total: number;
  percent: number;
  players: IngestPlayerProgress[];
  message: string;
}

export interface IngestPlayerStat {
  steamid: string;
  nickname?: string | null;
  status: string;
}

export interface IngestJob {
  job_id: string;
  status: IngestJobStatus;
  filename: string;
  upload_bytes?: number;
  deduplicated?: boolean;
  created?: number;
  started?: number | null;
  finished?: number | null;
  demo_id: number | null;
  result: { demo_id: number; players: IngestPlayerStat[] } | null;
  error: string | null;
  progress: IngestProgress;
}

/** Response of POST /api/voice/ingest — 202 for a fresh/queued job, 200 for a
 * deduplicated upload that already reached "completed". */
export interface IngestAccepted {
  job_id: string;
  status: IngestJobStatus;
  deduplicated: boolean;
  status_url: string;
}

export interface VoicePlayer {
  steamid: string;
  nickname: string | null;
  consent: boolean;
  clip_count: number;
  audio_sec: number;
}

export type VerifyVerdict = "same" | "different" | "inconclusive";

/** POST /api/voice/verify response (VerifyResult minus both steamid fields). */
export interface VerifyEvidence {
  a: { steamid: string; nickname: string | null };
  b: { steamid: string; nickname: string | null };
  score: number;
  mean_score: number;
  threshold: number;
  same_speaker: boolean | null;
  verdict: VerifyVerdict;
  band_low: number;
  band_high: number;
  clip_count_a: number;
  clip_count_b: number;
  demo_count_a: number;
  demo_count_b: number;
  pair_count: number;
  window_pair_count: number;
  pair_scores: number[];
  score_min: number;
  score_max: number;
  score_mean: number;
  score_std: number;
  score_p10: number;
  score_p90: number;
  agreement: number;
  same_pair_fraction: number;
  evidence_quality: string;
  reasons: string[];
}

export interface MatchRow {
  steamid: string;
  nickname: string | null;
  score: number;
  clip_count: number;
  audio_sec: number;
  consent: boolean;
  verdict: VerifyVerdict;
  median_score: number | null;
  agreement: number | null;
  same_pair_fraction: number | null;
  evidence_quality: string;
  reasons: string[];
}

export interface MatchResponse {
  threshold: number;
  matches: MatchRow[];
}

export interface ClusterMember {
  steamid: string;
  nickname: string | null;
}

export interface ClusterResponse {
  demo_id: number;
  groups: ClusterMember[][];
}

// ---------------------------------------------------------------- faceit sync

export interface SyncAccountRef {
  label: string | null;
  faceit: string | null;
  guid: string | null;
}

export interface SyncVoiceHit {
  steamid: string;
  nickname: string | null;
  matches: {
    steamid: string;
    nickname: string | null;
    score: number;
    candidate_score?: number;
    verdict: VerifyVerdict;
    evidence_quality?: string;
    reasons?: string[];
  }[];
}

export type SyncMatchStatus =
  "ingested" | "downloaded" | "skipped_existing" | "no_demo" | "failed";

export interface SyncMatch {
  match_id: string;
  date?: string;
  account?: string;
  local?: boolean;
  status?: SyncMatchStatus;
  error?: string;
  demo_id?: number;
  voice_matches?: SyncVoiceHit[];
}

export interface SyncJobResult {
  matches?: SyncMatch[];
  downloaded?: number;
  failed?: number;
  [key: string]: unknown;
}

export interface SyncJobState {
  running: boolean;
  started: number | null;
  finished: number | null;
  log: string[];
  result: SyncJobResult | null;
  error: string | null;
}

export interface FaceitStatus {
  accounts: SyncAccountRef[];
  cdp_configured: boolean;
  headless_default: boolean;
  profile_exists: boolean;
  demos_dir: string;
  playwright_installed: boolean;
  job: SyncJobState;
}
