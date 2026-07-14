// @touchline/shared — TxLINE wire types (zod schemas + inferred TS types)
// Field names/types verified against _extracted/docs.yaml (TxLINE off-chain API v1.5.2)
// and the VERIFIED section of TxLINE_SmokeTest_Results.md (live devnet capture 2026-06-27).
//
// Conventions:
//  - Timestamps (Ts / StartTime / ts) are epoch MILLISECONDS (13 digits).
//  - Prices are decimal odds × 1000. Pct is a 3-dp string, or "NA" on quarter lines.
//  - Object schemas use .passthrough() so unmodelled fields (other sports, lineups,
//    clocks, stats, ...) never break parsing of the soccer subset Touchline cares about.

import { z } from 'zod';
import { SUPER_ODDS_TYPES, PRICE_NAMES_VALUES } from './constants';

/**
 * Recursively drop null-valued keys so `.optional()` fields parse cleanly.
 * The TxLINE wire format sends explicit nulls for absent optionals
 * (e.g. `"GameState":null`), which zod's `.optional()` rejects.
 */
export function stripNullsDeep(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(stripNullsDeep);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v === null) continue;
      out[k] = stripNullsDeep(v);
    }
    return out;
  }
  return input;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** A scheduled match. `FixtureId` (i64) is the canonical key; `StartTime` is the lock deadline. */
export const FixtureSchema = z
  .object({
    Ts: z.number().int(),
    StartTime: z.number().int(),
    Competition: z.string(),
    CompetitionId: z.number().int(),
    FixtureGroupId: z.number().int(),
    Participant1Id: z.number().int(),
    Participant1: z.string(),
    Participant2Id: z.number().int(),
    Participant2: z.string(),
    FixtureId: z.number().int(),
    Participant1IsHome: z.boolean(),
  })
  .passthrough();

export type Fixture = z.infer<typeof FixtureSchema>;

// ---------------------------------------------------------------------------
// Odds
// ---------------------------------------------------------------------------

/** The three confirmed market types; permissive fallback for any future SuperOddsType. */
export const SuperOddsTypeSchema = z.enum(SUPER_ODDS_TYPES);
export type SuperOddsTypeEnum = z.infer<typeof SuperOddsTypeSchema>;

export const PriceNameSchema = z.enum(PRICE_NAMES_VALUES);
export type PriceNameEnum = z.infer<typeof PriceNameSchema>;

/** Pct value: 3-decimal string (e.g. "52.632") or the literal "NA" for quarter lines. */
export const PctValueSchema = z.string().regex(/^(NA|\d+\.\d{3})$/);

/**
 * A single odds offer = ONE bookmaker × ONE market × ONE fixture.
 * Market identity = SuperOddsType + MarketParameters + MarketPeriod (see `marketKey`).
 * Outcomes are index-aligned across PriceNames[i] / Prices[i] / Pct[i].
 */
const OddsPayloadObject = z
  .object({
    FixtureId: z.number().int(),
    MessageId: z.string(),
    Ts: z.number().int(),
    Bookmaker: z.string(),
    BookmakerId: z.number().int(),
    // Kept as string (not the enum) so unexpected market types still parse; narrow with
    // SuperOddsTypeSchema where you specifically handle the three known markets.
    SuperOddsType: z.string(),
    GameState: z.string().optional(),
    InRunning: z.boolean(),
    MarketParameters: z.string().optional(),
    MarketPeriod: z.string().optional(),
    PriceNames: z.array(z.string()).optional(),
    Prices: z.array(z.number().int()).optional(),
    Pct: z.array(z.string()).optional(),
  })
  .passthrough();

/** Strips wire nulls, then validates. */
export const OddsPayloadSchema = z.preprocess(stripNullsDeep, OddsPayloadObject);

export type OddsPayload = z.infer<typeof OddsPayloadObject>;

/** SSE wrapper for the odds stream: `data` carries one OddsPayload; heartbeats set `event`. */
export const OddsStreamEventSchema = z
  .object({
    id: z.string().optional(),
    event: z.string().optional(),
    data: OddsPayloadSchema.optional(),
  })
  .passthrough();

export type OddsStreamEvent = z.infer<typeof OddsStreamEventSchema>;

// ---------------------------------------------------------------------------
// Scores (soccer-focused)
// ---------------------------------------------------------------------------

/**
 * Soccer fixture status codes (statusSoccerId). Canonical short codes:
 * NS not-started, H1 1st half, HT half-time, H2 2nd half, ET1/ET2 extra time,
 * FET full extra time, PE/FPE penalties, WET/WPE waiting extra/penalties,
 * HTET half-time of ET, I interrupted, A abandoned, C cancelled, P postponed,
 * F finished, TXCC/TXCS TxODDS internal closing states.
 */
export const SOCCER_FIXTURE_STATUSES = [
  'NS',
  'H1',
  'HT',
  'H2',
  'ET1',
  'ET2',
  'FET',
  'PE',
  'FPE',
  'WET',
  'WPE',
  'HTET',
  'I',
  'A',
  'C',
  'P',
  'F',
  'TXCC',
  'TXCS',
] as const;

export const SoccerFixtureStatusSchema = z.enum(SOCCER_FIXTURE_STATUSES);
export type SoccerFixtureStatus = z.infer<typeof SoccerFixtureStatusSchema>;

/**
 * How a goal was scored. Kept a permissive string, NOT an enum: the live wire uses values
 * outside any documented set (verified: "Shot", "Own" — an own goal, note NOT "OwnGoal";
 * "Head"/"Penalty" also plausible). An enum here silently dropped every "Own"-goal event
 * (e.g. fixture 18176123 Seq590), so a soft string is the robust choice.
 */
export const GoalTypeSchema = z.string();
export type GoalType = z.infer<typeof GoalTypeSchema>;

/** Match clock for a soccer event. */
export const SoccerFixtureClockSchema = z
  .object({
    running: z.boolean(),
    seconds: z.number().int(),
  })
  .passthrough();
export type SoccerFixtureClock = z.infer<typeof SoccerFixtureClockSchema>;

/**
 * Per-period team tally. The wire OMITS a stat key entirely when its count is 0 — e.g. a
 * clean sheet arrives as `Total: {YellowCards:2, Corners:2}` with NO `Goals` key (verified
 * on the 2-0 fixture 18179552, loser's Total). `Goals` therefore DEFAULTS to 0 so an absent
 * key reads as zero goals — without this, resolve.ts's resultFromScore/finalGoalsFromScore
 * see `undefined` and refuse to settle any result where a side scored 0 (i.e. most matches).
 * The other tallies stay optional (only Goals gates resolution).
 */
export const SoccerScoreSchema = z
  .object({
    Goals: z.number().int().optional().default(0),
    YellowCards: z.number().int().optional(),
    RedCards: z.number().int().optional(),
    Corners: z.number().int().optional(),
  })
  .passthrough();
export type SoccerScore = z.infer<typeof SoccerScoreSchema>;

/** A participant's score broken down by period; every period is optional. */
export const SoccerTotalScoreSchema = z
  .object({
    H1: SoccerScoreSchema.optional(),
    HT: SoccerScoreSchema.optional(),
    H2: SoccerScoreSchema.optional(),
    ET1: SoccerScoreSchema.optional(),
    ET2: SoccerScoreSchema.optional(),
    PE: SoccerScoreSchema.optional(),
    ETTotal: SoccerScoreSchema.optional(),
    Total: SoccerScoreSchema.optional(),
  })
  .passthrough();
export type SoccerTotalScore = z.infer<typeof SoccerTotalScoreSchema>;

/**
 * Full-fixture score: per-participant period breakdown. BOTH participants are optional —
 * early in a match the wire ships only the side that has a stat (e.g. `Score` = just
 * `{Participant1}` after the first goal, or even `{}` on a corner-only frame), verified on
 * fixture 18175918 Seq160/266. Requiring both silently dropped the first goal of a match.
 */
export const SoccerFixtureScoreSchema = z
  .object({
    Participant1: SoccerTotalScoreSchema.optional(),
    Participant2: SoccerTotalScoreSchema.optional(),
  })
  .passthrough();
export type SoccerFixtureScore = z.infer<typeof SoccerFixtureScoreSchema>;

/** Before/after snapshot attached to a corrected (VAR) event. */
export const SoccerUpdateReferenceSchema = z
  .object({
    // Nested Clock arrives wire-shaped (PascalCase `{Running, Seconds}`), unlike the
    // normalized top-level clock — kept a loose passthrough so an `action_amend`'s
    // New/Previous refs (e.g. 18179552 Seq930) parse instead of being dropped on the
    // case mismatch. These VAR refs aren't read downstream, so no need to normalize them.
    Clock: z.object({}).passthrough().optional(),
    FreeKickType: z.string().optional(),
    GoalType: GoalTypeSchema.optional(),
    Minutes: z.number().int().optional(),
    Outcome: z.string().optional(),
    PlayerId: z.number().int().optional(),
    PlayerInId: z.number().int().optional(),
    PlayerOutId: z.number().int().optional(),
    ThrowInType: z.string().optional(),
    Type: z.string().optional(),
  })
  .passthrough();
export type SoccerUpdateReference = z.infer<typeof SoccerUpdateReferenceSchema>;

// ---------------------------------------------------------------------------
// Lineups (Star Man) — a `lineups` action event carries the official squads.
// Verified live (2026-07-03/04, txline-dev.txodds.com): the JOIN KEY between a
// lineup entry and later goal/card score events is `player.normativeId` (NOT the
// entry's `fixturePlayerId`, which is a separate id space that matches nothing in
// score events). The team-level `normativeId` equals the fixture's Participant1Id/
// Participant2Id exactly. Display name = `player.preferredName` ("Lastname, Firstname").
// Rosters arrive ~30-45 min before kickoff and may be re-sent amended (last write wins).
// ---------------------------------------------------------------------------

/** One player entry within a team's lineup. `player.normativeId` is the score-event join key. */
export const LineupPlayerSchema = z
  .object({
    fixturePlayerId: z.number().int().optional(),
    statusId: z.number().int().optional(),
    positionId: z.number().int().optional(),
    unitId: z.number().int().optional(),
    // Shirt number — wire type varies (number/string); consumers coerce to string.
    rosterNumber: z.union([z.string(), z.number()]).optional(),
    starter: z.boolean().optional(),
    starred: z.boolean().optional(),
    player: z
      .object({
        // UUID string on the wire; normativeId below is the goal-event join key.
        id: z.union([z.string(), z.number()]).optional(),
        normativeId: z.number().int(),
        country: z.string().optional(),
        dateOfBirth: z.string().optional(),
        preferredName: z.string(),
      })
      .passthrough(),
  })
  .passthrough();
export type LineupPlayer = z.infer<typeof LineupPlayerSchema>;

/** A team's lineup block. `normativeId` == fixture Participant1Id/Participant2Id. */
export const LineupTeamSchema = z
  .object({
    // Wire sends UUID strings here (docs imply numbers); normativeId is the numeric key we use.
    id: z.union([z.string(), z.number()]).optional(),
    normativeId: z.number().int(),
    preferredName: z.string().optional(),
    lineups: z.array(LineupPlayerSchema).optional().default([]),
  })
  .passthrough();
export type LineupTeam = z.infer<typeof LineupTeamSchema>;

/** Per-action soccer detail. Player fields populated only when coverageSecondaryData === true. */
export const SoccerDataSchema = z
  .object({
    Action: z.string().optional(),
    Type: z.string().optional(),
    Minutes: z.number().int().optional(),
    Participant: z.number().int().optional(),
    PlayerId: z.number().int().optional(),
    PlayerInId: z.number().int().optional(),
    PlayerOutId: z.number().int().optional(),
    Goal: z.boolean().optional(),
    GoalType: GoalTypeSchema.optional(),
    Penalty: z.boolean().optional(),
    RedCard: z.boolean().optional(),
    YellowCard: z.boolean().optional(),
    Corner: z.boolean().optional(),
    VAR: z.boolean().optional(),
    Color: z.string().optional(),
    Outcome: z.string().optional(),
    FreeKickType: z.string().optional(),
    ThrowInType: z.string().optional(),
    VenueType: z.string().optional(),
    StatusId: z.number().int().optional(),
    New: SoccerUpdateReferenceSchema.optional(),
    Previous: SoccerUpdateReferenceSchema.optional(),
  })
  .passthrough();
export type SoccerData = z.infer<typeof SoccerDataSchema>;

/**
 * The internal, normalized soccer score event Touchline consumes everywhere downstream
 * (ingest → score_state/score_events → pundit → web). Each event carries a running
 * per-period `scoreSoccer`, an optional `dataSoccer` action detail (with derived
 * Goal/YellowCard/RedCard booleans the pundit keys off), a normalized `clock`
 * (`{running, seconds}` — lowercase, matching what the web reads), and a `gameState`
 * DERIVED from the status mapping (never the unreliable raw wire GameState).
 *
 * Field-name conventions are camelCase — the shape the spec (`docs.yaml`) documents.
 * The LIVE wire violates the spec and ships PascalCase generic slots
 * (`Score`/`Data`/`StatusId`/`Type`/`Clock`); `ScoreEventSchema` below accepts BOTH
 * shapes and transforms the wire shape into this one (see the transform + evidence block).
 */
const ScoreEventObject = z
  .object({
    fixtureId: z.number().int(),
    gameState: z.string(),
    ts: z.number().int(),
    seq: z.number().int(),
    action: z.string(),
    // Mapped soccer status short-code (H1/HT/H2/ET2/PE/F/FET/FPE/…). Optional: a status-less
    // wire frame (comment/possession/disconnected) leaves it undefined and never changes
    // stored status. resolve.ts isFinished() checks the {F,FET,FPE} set on this field.
    statusSoccerId: z.string().optional(),
    coverageSecondaryData: z.boolean().optional(),
    coverageType: z.string().optional(),
    confirmed: z.boolean().optional(),
    // Identity / context (present on the wire; optional here to stay soccer-lean & robust).
    startTime: z.number().int().optional(),
    competitionId: z.number().int().optional(),
    fixtureGroupId: z.number().int().optional(),
    participant1Id: z.number().int().optional(),
    participant2Id: z.number().int().optional(),
    participant1IsHome: z.boolean().optional(),
    id: z.number().int().optional(),
    clock: SoccerFixtureClockSchema.optional(),
    scoreSoccer: SoccerFixtureScoreSchema.optional(),
    dataSoccer: SoccerDataSchema.optional(),
    // Present on a `lineups` action event only (Star Man): the official squads for both
    // teams. Carried through from the wire so ingest can persist the roster.
    lineups: z.array(LineupTeamSchema).optional(),
  })
  .passthrough();

export type ScoreEvent = z.infer<typeof ScoreEventObject>;

// ---------------------------------------------------------------------------
// Empirical numeric StatusId → soccer status mapping.
// ---------------------------------------------------------------------------
//
// The TxLINE OpenAPI spec (docs.yaml "Scores") documents a camelCase `statusSoccerId`
// carrying STRING status codes. The LIVE devnet wire (probed 2026-07-03 against
// txline-dev.txodds.com, competition 72) instead ships a NUMERIC top-level `StatusId`
// with NO published string mapping, and its `GameState` stays frozen at "scheduled"
// through an entire live match (extra time + penalties included) — so GameState is
// useless for liveness/finish detection. The map below was reverse-engineered from the
// full score-event history of three real fixtures. Evidence per id:
//
//   1  → NS  (scheduled)  — pre-match. All 3 fixtures: Action venue/pitch/jersey/
//                           kickoff_team, Clock 0s Stopped, no score periods.
//                           (18179552 Seq3-17, 18176123 Seq5-12, 18175918 Seq3-16)
//   2  → H1  (live)       — FIRST HALF. 18175918 (Argentina v Cape Verde, live during
//                           probe): Seq20 kickoff then shots/possession, Clock RUNNING
//                           0→809s. (The two finished fixtures' snapshots prune in-play
//                           H1 frames, which is why 2 shows only on the live one.)
//   3  → HT  (live)       — HALF-TIME. Both finished fixtures: Action halftime_finalised,
//                           Clock Stopped, periods H1/HT/Total only, no H2 yet.
//                           (18179552 Seq520, 18176123 Seq492)
//   4  → H2  (live)       — SECOND HALF. Both: goal/yellow_card/corner, Clock RUNNING
//                           2747→5747s, H2 period present. (18179552 Seq543-1066, 18176123 Seq590)
//   5  → F   (finished)   — FINISHED IN NORMAL TIME. 18179552 (Switzerland v Algeria):
//                           Seq1067 Action status → Seq1069 clock_adjustment (Clock 0
//                           Stopped) → Seq1070 game_finalised. Final periods H1/HT/H2/Total
//                           ONLY — no ET, no PE. This is the exclusive terminal id for a
//                           90-minute finish (a match headed to ET shows 6 here instead — see below).
//   6  → WET (live)       — END OF NORMAL TIME, AWAITING EXTRA TIME. 18176123 Seq968:
//                           Action kickoff_team, Clock 5400s (=90:00) STOPPED, sits between
//                           H2 (4) and ET (9). Non-terminal — the match continued to ET+pens.
//   9  → ET2 (live)       — EXTRA TIME IN PROGRESS. 18176123 Seq1128-1307: kickoff/corner/
//                           yellow_card/shot, Clock RUNNING 6300→7290s (105-121'). A single
//                           id spans both ET halves; ET1 vs ET2 is NOT distinguishable from
//                           StatusId alone — 'ET2' is a representative live-extra-time code
//                           (the web renders any ET* identically as "Extra time").
//   11 → PE  (live)       — ET→PENALTIES TRANSITION. 18176123 Seq1311: clock_adjustment,
//                           Clock reset 0 Stopped, immediately after ET, before the shootout.
//   12 → PE  (live)       — PENALTY SHOOTOUT IN PROGRESS. 18176123 Seq1343-1349: standby,
//                           penalty_shootout_team, penalty_outcome; the PE period appears here.
//   13 → PE  (live)       — shootout status frame. 18176123 Seq1350, between the pens frames
//                           and the finalise. (11/12/13 all = live penalties; the exact
//                           sub-state isn't separable, but all are non-terminal.)
//   100→ FPE (finished)   — FINISHED ON PENALTIES. 18176123 (Australia v Egypt, PE 2-4):
//                           Seq1352 game_finalised, PE period Goals 2/4, terminal. Distinct
//                           terminal id from a normal-time finish (5), exactly as expected.
//
// Ids NOT observed and therefore NOT guessed (mapped to unknown → gameState derived, never
// 'finished'): a finished-after-ET-without-penalties terminal id (no such fixture in the
// sample) and abandoned/postponed/interrupted (A/C/P/I). The 'game_finalised' action
// override below is the safety net that STILL detects those finishes from the score periods.
type StatusCategory = 'scheduled' | 'live' | 'finished';
interface MappedStatus {
  code?: SoccerFixtureStatus;
  state: StatusCategory;
}

const STATUS_ID_MAP: Readonly<Record<number, MappedStatus>> = {
  1: { code: 'NS', state: 'scheduled' },
  2: { code: 'H1', state: 'live' },
  3: { code: 'HT', state: 'live' },
  4: { code: 'H2', state: 'live' },
  5: { code: 'F', state: 'finished' },
  6: { code: 'WET', state: 'live' },
  9: { code: 'ET2', state: 'live' },
  11: { code: 'PE', state: 'live' },
  12: { code: 'PE', state: 'live' },
  13: { code: 'PE', state: 'live' },
  100: { code: 'F', state: 'finished' }, // generic 'finished' — variant re-derived from periods above
};

function participantHasPeriod(
  p: SoccerTotalScore | undefined,
  keys: readonly (keyof SoccerTotalScore)[],
): boolean {
  if (!p) return false;
  return keys.some((k) => p[k] != null);
}

/** Penalties were taken iff a PE period exists on either side. */
export function scoreHasPenalties(s: SoccerFixtureScore | undefined): boolean {
  if (!s) return false;
  return participantHasPeriod(s.Participant1, ['PE']) || participantHasPeriod(s.Participant2, ['PE']);
}

/** Extra time was played iff any ET period exists on either side. */
export function scoreHasExtraTime(s: SoccerFixtureScore | undefined): boolean {
  const et = ['ET1', 'ET2', 'ETTotal'] as const;
  if (!s) return false;
  return participantHasPeriod(s.Participant1, et) || participantHasPeriod(s.Participant2, et);
}

/**
 * Derive {status code, liveness} for a soccer frame. Precedence:
 *  1. `game_finalised` action → FINISHED, with the finish TYPE (F / FET / FPE) read from
 *     which score periods are present. This is the authoritative end-of-match frame
 *     (evidence: 18179552 Seq1070, 18176123 Seq1352) and detects finishes even when the
 *     terminal StatusId is absent (normal-time finalise carries no StatusId) or unmapped.
 *  2. Numeric StatusId via the empirical map above.
 *  3. No/unknown StatusId → infer liveness from the clock; NEVER claim 'finished' without
 *     evidence (an unmapped in-play id is treated as live, non-terminal).
 */
export function deriveSoccerStatus(input: {
  statusId?: number | null;
  action?: string | null;
  score?: SoccerFixtureScore | undefined;
  clockRunning?: boolean;
}): MappedStatus {
  if (input.action === 'game_finalised') {
    const code: SoccerFixtureStatus = scoreHasPenalties(input.score)
      ? 'FPE'
      : scoreHasExtraTime(input.score)
        ? 'FET'
        : 'F';
    return { code, state: 'finished' };
  }
  if (input.statusId != null) {
    const m = STATUS_ID_MAP[input.statusId];
    if (m) {
      // Terminal numeric ids are unreliable for the finish VARIANT: id 100 was observed on
      // BOTH a penalties finish (18176123) and a plain 90-minute finish (18179549, 1-0, no
      // ET/PE periods). Trust the recorded score periods for the variant; keep 'finished'.
      if (m.state === 'finished') {
        const code: SoccerFixtureStatus = scoreHasPenalties(input.score)
          ? 'FPE'
          : scoreHasExtraTime(input.score)
            ? 'FET'
            : 'F';
        return { code, state: 'finished' };
      }
      return m;
    }
    return { state: 'live' }; // present but unmapped → in-play, non-terminal
  }
  if (input.clockRunning) return { state: 'live' };
  return { state: 'scheduled' };
}

// ---------------------------------------------------------------------------
// The REAL live wire shape (PascalCase generic slots) + transform to internal.
// ---------------------------------------------------------------------------

/** Raw wire clock: `{Running, Seconds}` (PascalCase), transformed to the lowercase internal shape. */
const WireClockSchema = z
  .object({ Running: z.boolean().optional(), Seconds: z.number().int().optional() })
  .passthrough();

/**
 * The score event AS IT ACTUALLY ARRIVES on `/api/scores/snapshot` + `/api/scores/stream`
 * (spec-violating PascalCase, soccer payload in the generic `Score`/`Data`/`StatusId` slots).
 * `.passthrough()` keeps Stats/Possession/Kickoff/etc. Soccer-only via SportId/Type refine.
 */
const WireScoreEventObject = z
  .object({
    FixtureId: z.number().int(),
    Ts: z.number().int(),
    Seq: z.number().int(),
    Action: z.string().optional(),
    StatusId: z.number().int().optional(),
    GameState: z.string().optional(),
    Type: z.string().optional(),
    SportId: z.number().int().optional(),
    CoverageSecondaryData: z.boolean().optional(),
    CoverageType: z.string().optional(),
    Confirmed: z.boolean().optional(),
    StartTime: z.number().int().optional(),
    CompetitionId: z.number().int().optional(),
    FixtureGroupId: z.number().int().optional(),
    Participant1Id: z.number().int().optional(),
    Participant2Id: z.number().int().optional(),
    Participant1IsHome: z.boolean().optional(),
    Id: z.number().int().optional(),
    Clock: WireClockSchema.optional(),
    Score: SoccerFixtureScoreSchema.optional(),
    Data: SoccerDataSchema.optional(),
    // Star Man: the official squads, present only on a `lineups` action frame.
    Lineups: z.array(LineupTeamSchema).optional(),
  })
  .passthrough()
  // Soccer only: reject an event that explicitly declares a non-soccer sport. Events with
  // neither field (rare) are NOT rejected on this basis — every real WC frame carries SportId:1.
  .refine(
    (w) => (w.SportId == null || w.SportId === 1) && (w.Type == null || w.Type === 'Soccer'),
    { message: 'non-soccer event' },
  );

/** Map the raw wire event onto the internal camelCase ScoreEvent. */
function wireToScoreEvent(w: z.infer<typeof WireScoreEventObject>): ScoreEvent {
  const action = w.Action ?? '';
  const status = deriveSoccerStatus({
    statusId: w.StatusId,
    action,
    score: w.Score,
    clockRunning: w.Clock?.Running,
  });

  // Build dataSoccer from the generic Data slot PLUS derived Goal/YellowCard/RedCard
  // booleans — the live wire signals the incident ONLY via the top-level Action string
  // ({goal, yellow_card, red_card}); the Data slot holds just {GoalType, PlayerId, …}.
  // The pundit keys its goal/card triggers off these booleans, so the transform sets them.
  // We STRIP any Goal/YellowCard/RedCard already on the wire Data and set them purely from
  // the authoritative Action, so a "possible"/VAR-review frame (which can carry a stray
  // Goal flag) never false-fires a goal line — only a confirmed `goal` action does.
  const { Goal: _g, YellowCard: _y, RedCard: _r, ...restData } = (w.Data ?? {}) as SoccerData;
  const dataSoccer: SoccerData = {
    ...restData,
    Action: action,
    ...(action === 'goal' ? { Goal: true } : {}),
    ...(action === 'yellow_card' ? { YellowCard: true } : {}),
    ...(action === 'red_card' || action === 'second_yellow_card' ? { RedCard: true } : {}),
  };

  return {
    fixtureId: w.FixtureId,
    gameState: status.state,
    ts: w.Ts,
    seq: w.Seq,
    action,
    statusSoccerId: status.code,
    coverageSecondaryData: w.CoverageSecondaryData,
    coverageType: w.CoverageType,
    confirmed: w.Confirmed,
    startTime: w.StartTime,
    competitionId: w.CompetitionId,
    fixtureGroupId: w.FixtureGroupId,
    participant1Id: w.Participant1Id,
    participant2Id: w.Participant2Id,
    participant1IsHome: w.Participant1IsHome,
    id: w.Id,
    clock: w.Clock ? { running: w.Clock.Running ?? false, seconds: w.Clock.Seconds ?? 0 } : undefined,
    scoreSoccer: w.Score,
    dataSoccer,
    lineups: w.Lineups,
  };
}

/**
 * Parse a scores feed item, accepting BOTH shapes:
 *  - the live PascalCase wire (transformed to internal), OR
 *  - the spec's camelCase shape (already internal) — so a future TxLINE fix to honor
 *    their own docs doesn't silently re-break ingestion.
 * Strips wire nulls first (TxLINE sends explicit nulls for absent optionals).
 * Order matters: the camelCase branch requires lowercase `fixtureId`, which the PascalCase
 * wire lacks, so a wire frame cleanly falls through to the wire branch.
 */
export const ScoreEventSchema = z.preprocess(
  stripNullsDeep,
  z.union([ScoreEventObject, WireScoreEventObject.transform(wireToScoreEvent)]),
);

/** SSE wrapper for the scores stream: `data` carries one ScoreEvent; heartbeats set `event`. */
export const ScoresStreamEventSchema = z
  .object({
    id: z.string().optional(),
    event: z.string().optional(),
    data: ScoreEventSchema.optional(),
  })
  .passthrough();
export type ScoresStreamEvent = z.infer<typeof ScoresStreamEventSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a TxLINE integer price to decimal odds. e.g. 1957 → 1.957 */
export function decimalOdds(priceInt: number): number {
  return priceInt / 1000;
}

/**
 * Parse a Pct string into an implied probability in [0,1].
 * "52.632" → 0.52632 ; "NA" (quarter lines) → null ; anything unparseable → null.
 */
export function impliedProbabilityFromPct(pct: string): number | null {
  if (pct === 'NA') return null;
  const n = Number.parseFloat(pct);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

/**
 * Stable identity for a market line within a fixture.
 * `${SuperOddsType}|${MarketParameters ?? ''}|${MarketPeriod ?? ''}`
 * e.g. "OVERUNDER_PARTICIPANT_GOALS|line=2.5|half=0"
 */
export function marketKey(o: {
  SuperOddsType: string;
  MarketParameters?: string;
  MarketPeriod?: string;
}): string {
  return `${o.SuperOddsType}|${o.MarketParameters ?? ''}|${o.MarketPeriod ?? ''}`;
}

/**
 * Parse the numeric total-goals line out of an Over/Under `MarketParameters` string,
 * e.g. "line=2.5" -> 2.5. Returns null if the string doesn't match the confirmed
 * "line=<number>" shape — callers must never guess a line from an unparseable value.
 */
export function parseOverUnderLine(marketParameters: string): number | null {
  const m = /line=(-?\d+(?:\.\d+)?)/.exec(marketParameters);
  if (!m) return null;
  const n = Number.parseFloat(m[1] ?? '');
  return Number.isFinite(n) ? n : null;
}

/**
 * True when a `MarketPeriod` string denotes a partial period (e.g. "half=1", first
 * half) rather than the full match. The only live capture we have showed `half=1`
 * lines; an absent/empty MarketPeriod (or an explicit "half=0") is treated as
 * full-match, matching TxLINE's own convention that period 0 is the whole match.
 */
export function isPartialPeriod(marketPeriod: string | null | undefined): boolean {
  if (!marketPeriod) return false;
  const m = /^half=(\d+)$/.exec(marketPeriod.trim());
  if (!m) return false;
  return Number.parseInt(m[1] ?? '0', 10) > 0;
}
