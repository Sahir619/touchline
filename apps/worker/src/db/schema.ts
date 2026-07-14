// Internal normalized schema (Drizzle + Postgres dialect, runs on embedded PGlite).
// TxLINE's three feeds collapse onto one FixtureId. We keep the LATEST odds per market
// and the LATEST score state per fixture, plus an append-only event log for the pundit.

import {
  pgTable,
  bigint,
  integer,
  doublePrecision,
  text,
  boolean,
  jsonb,
  serial,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

/** One row per World Cup fixture (mirrors TxLINE Fixture, camelCased). */
export const fixtures = pgTable('fixtures', {
  fixtureId: bigint('fixture_id', { mode: 'number' }).primaryKey(),
  competitionId: integer('competition_id').notNull(),
  competition: text('competition').notNull(),
  startTime: bigint('start_time', { mode: 'number' }).notNull(), // kickoff, epoch ms
  fixtureGroupId: integer('fixture_group_id').notNull(),
  participant1Id: integer('participant1_id').notNull(),
  participant1: text('participant1').notNull(),
  participant2Id: integer('participant2_id').notNull(),
  participant2: text('participant2').notNull(),
  participant1IsHome: boolean('participant1_is_home').notNull(),
  ts: bigint('ts', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** Latest odds per (fixture, market line). marketKey = SuperOddsType|MarketParameters|MarketPeriod. */
export const oddsLatest = pgTable(
  'odds_latest',
  {
    fixtureId: bigint('fixture_id', { mode: 'number' }).notNull(),
    marketKey: text('market_key').notNull(),
    superOddsType: text('super_odds_type').notNull(),
    marketParameters: text('market_parameters'),
    marketPeriod: text('market_period'),
    bookmakerId: integer('bookmaker_id').notNull(),
    inRunning: boolean('in_running').notNull(),
    priceNames: jsonb('price_names').$type<string[]>(),
    prices: jsonb('prices').$type<number[]>(), // decimal odds × 1000
    pct: jsonb('pct').$type<string[]>(), // "52.632" or "NA"
    messageId: text('message_id').notNull(),
    ts: bigint('ts', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fixtureId, t.marketKey] }),
    byFixture: index('odds_by_fixture').on(t.fixtureId),
  }),
);

/** Latest aggregated score state per fixture (for the scoreboard + resolution). */
export const scoreState = pgTable('score_state', {
  fixtureId: bigint('fixture_id', { mode: 'number' }).primaryKey(),
  gameState: text('game_state'),
  statusSoccerId: text('status_soccer_id'),
  scoreSoccer: jsonb('score_soccer'),
  clock: jsonb('clock'),
  coverageSecondaryData: boolean('coverage_secondary_data'),
  ts: bigint('ts', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** Append-only log of soccer score actions (goals/cards/etc.) — fuels pundit triggers + audit. */
export const scoreEvents = pgTable(
  'score_events',
  {
    id: serial('id').primaryKey(),
    fixtureId: bigint('fixture_id', { mode: 'number' }).notNull(),
    seq: integer('seq').notNull(),
    action: text('action').notNull(),
    dataSoccer: jsonb('data_soccer'),
    ts: bigint('ts', { mode: 'number' }).notNull(),
  },
  (t) => ({
    byFixtureSeq: index('events_by_fixture_seq').on(t.fixtureId, t.seq),
  }),
);

/**
 * Star Man rosters. One row per player in a fixture's official lineup, upserted from
 * the TxLINE `lineups` action event (arrives ~30-45 min before kickoff, may be re-sent
 * amended → last write wins on the PK). `playerId` is `player.normativeId` — the SAME id
 * that later goal/card score events carry, so resolution joins on it directly.
 */
export const lineups = pgTable(
  'lineups',
  {
    fixtureId: bigint('fixture_id', { mode: 'number' }).notNull(),
    playerId: integer('player_id').notNull(), // player.normativeId (score-event join key)
    name: text('name').notNull(), // fan-facing display name, e.g. 'A. Amenda'
    rosterNumber: text('roster_number'),
    teamId: integer('team_id').notNull(), // team normativeId == fixture participantNId
    team: text('team').notNull(),
    starter: boolean('starter').notNull().default(false),
    ts: bigint('ts', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fixtureId, t.playerId] }),
    byFixture: index('lineups_by_fixture').on(t.fixtureId),
  }),
);

export type LineupRow = typeof lineups.$inferSelect;

// ---------------------------------------------------------------------------
// User data (keyed by Solana wallet address)
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  wallet: text('wallet').primaryKey(),
  displayName: text('display_name'),
  nation: text('nation'),
  persona: text('persona').notNull().default('hype'),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  // SAH-74: true for seeded "Demo League" sample players (never a real user). Lets every
  // surface badge them DEMO so nothing reads as a fraudulent real-user claim.
  demo: boolean('demo').notNull().default(false),
  // SAH — Beat the Line: cumulative sharpness (sum of max(0, clv) over all stamped
  // picks) and a count of picks that beat the closing line (clv >= threshold).
  sharpScore: doublePrecision('sharp_score').notNull().default(0),
  linesBeaten: integer('lines_beaten').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** A locked prediction. odds/pct captured at lock so scoring is reproducible. */
export const picks = pgTable(
  'picks',
  {
    id: serial('id').primaryKey(),
    wallet: text('wallet').notNull(),
    fixtureId: bigint('fixture_id', { mode: 'number' }).notNull(),
    market: text('market').notNull(), // e.g. '1X2_PARTICIPANT_RESULT' | 'OVERUNDER_PARTICIPANT_GOALS' | 'CORRECT_SCORE_BAND'
    selection: text('selection').notNull(), // 'part1'|'draw'|'part2' | 'over'|'under' | a scoreline e.g. '2-1'
    selectionLabel: text('selection_label').notNull(), // '1'|'X'|'2' | 'O'|'U' | the scoreline itself
    oddsAtLock: doublePrecision('odds_at_lock').notNull(), // decimal odds (synthetic flat value for correct-score)
    pctAtLock: doublePrecision('pct_at_lock'),
    // SAH — Beat the Line: the market's CLOSING snapshot at kickoff (stamped once by the
    // closing sweep). oddsAtClose = decimal odds; pctAtClose = implied prob as a fraction
    // [0,1] mirroring pctAtLock; clv = pct-points toward the pick; beatLine = clv >= 2.
    oddsAtClose: doublePrecision('odds_at_close'),
    pctAtClose: doublePrecision('pct_at_close'),
    clv: doublePrecision('clv'),
    beatLine: boolean('beat_line'),
    // Raw MarketParameters captured at lock (e.g. "line=2.5") for Over/Under picks, so
    // resolution can grade against the exact locked line without re-querying odds that
    // may have moved or disappeared by settlement time. Null for 1X2 / correct-score.
    marketParams: text('market_params'),
    status: text('status').notNull().default('open'), // open | won | lost | void
    points: integer('points').notNull().default(0),
    lockedAt: bigint('locked_at', { mode: 'number' }).notNull(),
    resolvedAt: bigint('resolved_at', { mode: 'number' }),
  },
  (t) => ({
    byWallet: index('picks_by_wallet').on(t.wallet),
    byFixture: index('picks_by_fixture').on(t.fixtureId),
  }),
);

export const streaks = pgTable('streaks', {
  wallet: text('wallet').primaryKey(),
  current: integer('current').notNull().default(0),
  longest: integer('longest').notNull().default(0),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** Earned (not bought) trophies. mintAddress is null until minted on devnet. */
export const trophies = pgTable(
  'trophies',
  {
    id: serial('id').primaryKey(),
    wallet: text('wallet').notNull(),
    fixtureId: bigint('fixture_id', { mode: 'number' }),
    tier: text('tier').notNull(), // bronze | silver | gold
    name: text('name').notNull(), // Outsider | Giant-killer | Oracle
    oddsBeaten: doublePrecision('odds_beaten'),
    market: text('market'),
    selectionLabel: text('selection_label'),
    metadata: jsonb('metadata'),
    mintAddress: text('mint_address'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    mintedAt: bigint('minted_at', { mode: 'number' }),
  },
  (t) => ({
    byWallet: index('trophies_by_wallet').on(t.wallet),
  }),
);

export const leagues = pgTable('leagues', {
  id: text('id').primaryKey(), // invite code
  name: text('name').notNull(),
  owner: text('owner').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const leagueMembers = pgTable(
  'league_members',
  {
    leagueId: text('league_id').notNull(),
    wallet: text('wallet').notNull(),
    joinedAt: bigint('joined_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.leagueId, t.wallet] }),
  }),
);

// ---------------------------------------------------------------------------
// Full-tournament bracket/pool (SAH-58) — additive to the per-match pick loop.
// Stage weighting scales existing match points; bracket picks are a separate,
// one-time season-long call (champion / runner-up) graded once the tournament ends.
// ---------------------------------------------------------------------------

/** Group → final stage catalog. Seeded from @touchline/shared TOURNAMENT_STAGES on boot. */
export const tournamentStages = pgTable('tournament_stages', {
  id: text('id').primaryKey(), // 'group' | 'r16' | 'qf' | 'sf' | 'final'
  tournamentId: text('tournament_id').notNull(),
  name: text('name').notNull(),
  order: integer('order').notNull(),
  multiplier: doublePrecision('multiplier').notNull().default(1),
});

/** Explicit fixture → stage mapping. A fixture with no row here defaults to group (1x). */
export const fixtureStages = pgTable('fixture_stages', {
  fixtureId: bigint('fixture_id', { mode: 'number' }).primaryKey(),
  stageId: text('stage_id').notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** One season-long bracket pick per wallet per tournament: predicted champion (+ optional runner-up). */
export const bracketPicks = pgTable(
  'bracket_picks',
  {
    wallet: text('wallet').notNull(),
    tournamentId: text('tournament_id').notNull(),
    championId: integer('champion_id').notNull(),
    championName: text('champion_name').notNull(),
    runnerUpId: integer('runner_up_id'),
    runnerUpName: text('runner_up_name'),
    status: text('status').notNull().default('open'), // open | resolved
    points: integer('points').notNull().default(0),
    lockedAt: bigint('locked_at', { mode: 'number' }).notNull(),
    resolvedAt: bigint('resolved_at', { mode: 'number' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.wallet, t.tournamentId] }),
  }),
);

export type BracketPickRow = typeof bracketPicks.$inferSelect;

export type FixtureRow = typeof fixtures.$inferSelect;
export type OddsRow = typeof oddsLatest.$inferSelect;
export type ScoreStateRow = typeof scoreState.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type PickRow = typeof picks.$inferSelect;
export type TrophyRow = typeof trophies.$inferSelect;
