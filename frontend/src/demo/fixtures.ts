// SPDX-License-Identifier: AGPL-3.0-only
/** Synthetic data for the read-only demo mode (`?demo=1`).
 *
 * Every value here is invented; no FACEIT account, SteamID, or real
 * investigation is referenced. The shapes mirror src/api/types.ts.
 */

export const demoHealth = {
  status: "ok",
  friends_configured: true,
  voice_available: true,
};

// Dates are relative to "now" so the demo never shows stale data.
const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

export const demoFriendsStatus = {
  used_file: "config.json",
  has_webhook: true,
  accounts: 3,
  db_exists: true,
  event_count: 87,
  snapshot_accounts: 3,
  scheduler: {
    enabled: true,
    interval_minutes: 5,
    configured: true,
    accounts: 3,
    active: true,
    running: false,
    last_started: (now - 3_600_000) / 1000,
    last_finished: (now - 3_500_000) / 1000,
    last_result: {
      accounts: 3,
      ok: 3,
      failed: 0,
      added: 1,
      removed: 0,
    },
    last_error: null,
    next_run: (now + 600_000) / 1000,
  },
};

export const demoConfig = {
  discord_webhook: "",
  discord_ping: "",
  accounts: [
    {
      guid: "demo-guid-alpha",
      label: "Account A (demo)",
      faceit: "demo_alpha",
    },
    {
      guid: "demo-guid-bravo",
      label: "Account B (demo)",
      faceit: "demo_bravo",
    },
    {
      guid: "demo-guid-charlie",
      label: "Account C (demo)",
      faceit: "demo_charlie",
    },
  ],
  scheduler: { enabled: true, interval_minutes: 5 },
  _used_file: "config.json",
};

export const demoEvents = {
  events: [
    {
      ts: daysAgo(0),
      account_lbl: "Account A (demo)",
      kind: "added",
      friend_id: "demo-f-mika",
      nickname: "demo_mika",
    },
    {
      ts: daysAgo(0),
      account_lbl: "Account B (demo)",
      kind: "removed",
      friend_id: "demo-f-zed",
      nickname: "demo_zed",
    },
    {
      ts: daysAgo(1),
      account_lbl: "Account C (demo)",
      kind: "added",
      friend_id: "demo-f-ivy",
      nickname: "demo_ivy",
    },
    {
      ts: daysAgo(2),
      account_lbl: "Account A (demo)",
      kind: "added",
      friend_id: "demo-f-nori",
      nickname: "demo_nori",
    },
    {
      ts: daysAgo(3),
      account_lbl: "Account B (demo)",
      kind: "removed",
      friend_id: "demo-f-kato",
      nickname: "demo_kato",
    },
  ],
};

const friendIds = [
  "demo-f-mika",
  "demo-f-nori",
  "demo-f-ivy",
  "demo-f-oka",
  "demo-f-pax",
  "demo-f-rio",
];
const nickOf = Object.fromEntries(
  friendIds.map((id, i) => [
    id,
    `demo_${["mika", "nori", "ivy", "oka", "pax", "rio"][i]}`,
  ]),
);

/** Snapshots: five friends appear on 2+ accounts (the overlap signal). */
export const demoSnapshots = {
  snapshots: [
    ...friendIds.map((id) => ({
      account_id: "demo-guid-alpha",
      friend_id: id,
      nickname: nickOf[id],
      first_seen: daysAgo(21),
      last_seen: daysAgo(0),
    })),
    ...["demo-f-mika", "demo-f-nori", "demo-f-pax"].map((id) => ({
      account_id: "demo-guid-bravo",
      friend_id: id,
      nickname: nickOf[id],
      first_seen: daysAgo(14),
      last_seen: daysAgo(0),
    })),
    ...["demo-f-mika", "demo-f-ivy", "demo-f-rio"].map((id) => ({
      account_id: "demo-guid-charlie",
      friend_id: id,
      nickname: nickOf[id],
      first_seen: daysAgo(7),
      last_seen: daysAgo(0),
    })),
  ],
};

export const demoOverlapList = {
  accounts: [
    {
      guid: "demo-guid-alpha",
      seeded_at: daysAgo(21),
      friend_count: 6,
      label: "Account A (demo)",
    },
    {
      guid: "demo-guid-bravo",
      seeded_at: daysAgo(14),
      friend_count: 3,
      label: "Account B (demo)",
    },
    {
      guid: "demo-guid-charlie",
      seeded_at: daysAgo(7),
      friend_count: 3,
      label: "Account C (demo)",
    },
  ],
  pairs: [
    {
      guid_a: "demo-guid-alpha",
      guid_b: "demo-guid-bravo",
      friend_count_a: 6,
      friend_count_b: 3,
      common: 2,
      jaccard: 0.285,
      label_a: "Account A (demo)",
      label_b: "Account B (demo)",
    },
    {
      guid_a: "demo-guid-alpha",
      guid_b: "demo-guid-charlie",
      friend_count_a: 6,
      friend_count_b: 3,
      common: 2,
      jaccard: 0.285,
      label_a: "Account A (demo)",
      label_b: "Account C (demo)",
    },
  ],
};

export function demoOverlapDetail(a: string, b: string) {
  const accounts = Object.fromEntries(
    demoOverlapList.accounts.map((acc) => [acc.guid, acc]),
  );
  const timeline = [21, 18, 14, 11, 7, 4, 0].map((d, i) => ({
    ts: daysAgo(d),
    overlap: Math.min(2, Math.floor(i / 3) + 1),
  }));
  return {
    a: accounts[a] ?? demoOverlapList.accounts[0],
    b: accounts[b] ?? demoOverlapList.accounts[1],
    common_count: 2,
    common_friends: ["demo-f-mika", "demo-f-nori"].map((id) => ({
      friend_id: id,
      nickname: nickOf[id],
      first_seen_a: daysAgo(21),
      first_seen_b: daysAgo(14),
    })),
    timeline,
    generated_at: daysAgo(0),
  };
}

export const demoPlayers = [
  {
    steamid: "76561197960000001",
    nickname: "demo_speaker_one",
    consent: true,
    clip_count: 6,
    audio_sec: 95,
  },
  {
    steamid: "76561197960000002",
    nickname: "demo_speaker_two",
    consent: true,
    clip_count: 4,
    audio_sec: 71,
  },
  {
    steamid: "76561197960000003",
    nickname: "demo_speaker_three",
    consent: false,
    clip_count: 3,
    audio_sec: 44,
  },
];

export const demoFaceitStatus = {
  accounts: demoConfig.accounts,
  cdp_configured: false,
  headless_default: false,
  profile_exists: true,
  demos_dir: "voice-identity-linker/data/demos",
  playwright_installed: true,
  job: {
    running: false,
    started: null,
    finished: null,
    log: [],
    result: {
      matches: [
        {
          match_id: "1-demoabcd1234",
          date: daysAgo(1).slice(0, 10),
          account: "Account A (demo)",
          status: "ingested",
          demo_id: 1,
          voice_matches: [
            {
              steamid: "76561197960000001",
              nickname: "demo_speaker_one",
              matches: [
                {
                  steamid: "76561197960000002",
                  nickname: "demo_speaker_two",
                  score: 0.71,
                  verdict: "inconclusive",
                  reasons: ["insufficient demo pairs"],
                },
              ],
            },
          ],
        },
      ],
      downloaded: 1,
      failed: 0,
    },
    error: null,
  },
};

export const demoSyncStatus = demoFaceitStatus.job;

export const demoVerify = {
  a: { steamid: "76561197960000001", nickname: "demo_speaker_one" },
  b: { steamid: "76561197960000002", nickname: "demo_speaker_two" },
  score: 0.62,
  mean_score: 0.61,
  threshold: 0.5,
  same_speaker: null,
  verdict: "inconclusive",
  band_low: 0.42,
  band_high: 0.75,
  clip_count_a: 6,
  clip_count_b: 4,
  demo_count_a: 2,
  demo_count_b: 1,
  pair_count: 2,
  window_pair_count: 11,
  pair_scores: [0.58, 0.66],
  score_min: 0.31,
  score_max: 0.81,
  score_mean: 0.61,
  score_std: 0.12,
  score_p10: 0.44,
  score_p90: 0.77,
  agreement: 0.73,
  same_pair_fraction: 0.64,
  evidence_quality: "medium",
  reasons: ["2 demo pairs available", "scores span the uncertainty band"],
};

export const demoMatch = {
  threshold: 0.5,
  matches: [
    {
      steamid: "76561197960000002",
      nickname: "demo_speaker_two",
      score: 0.66,
      clip_count: 4,
      audio_sec: 71,
      consent: true,
      verdict: "inconclusive",
      median_score: 0.62,
      agreement: 0.73,
      same_pair_fraction: 0.64,
      evidence_quality: "medium",
      reasons: ["scores span the uncertainty band"],
    },
    {
      steamid: "76561197960000003",
      nickname: "demo_speaker_three",
      score: 0.31,
      clip_count: 3,
      audio_sec: 44,
      consent: false,
      verdict: "different",
      median_score: 0.28,
      agreement: 0.9,
      same_pair_fraction: 0.1,
      evidence_quality: "low",
      reasons: ["consistent below-threshold scores"],
    },
  ],
};

export const demoCluster = {
  demo_id: 1,
  groups: [
    [
      { steamid: "76561197960000001", nickname: "demo_speaker_one" },
      { steamid: "76561197960000002", nickname: "demo_speaker_two" },
    ],
    [{ steamid: "76561197960000003", nickname: "demo_speaker_three" }],
  ],
};
