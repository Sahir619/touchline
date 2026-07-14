// @touchline/shared — constants
// Verified against TxLINE_SmokeTest_Results.md (2026-06-27 live devnet capture)
// and _extracted/docs.yaml (TxLINE off-chain API v1.5.2).

/**
 * World Cup 2026 competition. Confirmed live: snapshot returned 19 WC fixtures
 * under competitionId 72 (name "World Cup"). This is Touchline's core free tier.
 */
export const WORLD_CUP_COMPETITION_ID = 72 as const;

/**
 * International Friendlies. Confirmed live as competitionId 430 (1 friendly in the
 * same snapshot). Useful as a secondary feed before/after the tournament window.
 */
export const FRIENDLIES_COMPETITION_ID = 430 as const;

/**
 * Default TxLINE data + auth hosts.
 *
 * Devnet host correction (verified): the live devnet API — auth, /api/token/activate,
 * data, and SSE — all run on `txline-dev.txodds.com`. TxODDS's own example host
 * `oracle-dev.txodds.com` is dead DNS.
 */
export const TXLINE_HOSTS = {
  devnet: 'https://txline-dev.txodds.com',
  prod: 'https://txline.txodds.com',
} as const;

export type TxlineNetwork = keyof typeof TXLINE_HOSTS;

/** Default to devnet — the only place the free World Cup flow is confirmed end-to-end. */
export const DEFAULT_TXLINE_HOST = TXLINE_HOSTS.devnet;

/**
 * The consensus de-margined bookmaker. Every confirmed market line in the smoke test
 * came from `TXLineStablePriceDemargined` (BookmakerId 10021), InRunning:false pre-match.
 * Touchline locks odds from this single source so picks are scored against one clean price.
 */
export const STABLE_PRICE_BOOKMAKER = 'TXLineStablePriceDemargined' as const;
export const STABLE_PRICE_BOOKMAKER_ID = 10021 as const;

/**
 * The three SuperOddsType values confirmed live for World Cup soccer fixtures.
 * (The API itself declares SuperOddsType as a free string with no enum — these are the
 * only values observed, and the only ones Touchline builds markets on.)
 */
export const SUPER_ODDS_TYPES = [
  '1X2_PARTICIPANT_RESULT',
  'OVERUNDER_PARTICIPANT_GOALS',
  'ASIANHANDICAP_PARTICIPANT_GOALS',
] as const;

export type SuperOddsType = (typeof SUPER_ODDS_TYPES)[number];

/**
 * PriceNames conventions per market (index-aligned with Prices/Pct).
 *  - 1X2:            ["part1", "draw", "part2"]   (home / draw / away by Participant1IsHome)
 *  - Over/Under:     ["over", "under"]            with MarketParameters "line=0.5|1|1.25"
 *  - Asian Handicap: ["part1", "part2"]           with MarketParameters "line=1|1.25"
 */
export const PRICE_NAMES = {
  '1X2_PARTICIPANT_RESULT': ['part1', 'draw', 'part2'],
  OVERUNDER_PARTICIPANT_GOALS: ['over', 'under'],
  ASIANHANDICAP_PARTICIPANT_GOALS: ['part1', 'part2'],
} as const satisfies Record<SuperOddsType, readonly string[]>;

/** All distinct price-name tokens that can appear across the three confirmed markets. */
export const PRICE_NAMES_VALUES = ['part1', 'draw', 'part2', 'over', 'under'] as const;

export type PriceName = (typeof PRICE_NAMES_VALUES)[number];

/**
 * Prices are decimal odds × 1000 (verified: Prices [1957,3318,5333] = 1.957/3.318/5.333,
 * cross-checked against Pct). Pct is a string to 3 decimals, or "NA" for quarter lines.
 */
export const PRICE_SCALE = 1000 as const;

/**
 * The single season-long tournament this build tracks (World Cup, competitionId 72).
 * Bracket picks and stage weighting are keyed to this id — a second concurrent
 * tournament would need a second id, not supported yet.
 */
export const DEFAULT_TOURNAMENT_ID = 'world-cup-2026' as const;

/**
 * Full-tournament stages, group → final. `order` drives display order; `multiplier`
 * scales a correctly-called match's points (see `scorePick`) so calls made deeper in
 * the tournament are worth more — this is what makes per-match scoring compound into
 * a season-long score without changing the per-match pick flow itself. Fixtures are
 * mapped onto a stage explicitly (see worker `fixture_stages` table); unmapped
 * fixtures default to `group` (multiplier 1, i.e. today's unweighted behaviour).
 */
export const TOURNAMENT_STAGES = [
  { id: 'group', name: 'Group Stage', order: 0, multiplier: 1 },
  { id: 'r16', name: 'Round of 16', order: 1, multiplier: 1.25 },
  { id: 'qf', name: 'Quarter-Final', order: 2, multiplier: 1.5 },
  { id: 'sf', name: 'Semi-Final', order: 3, multiplier: 2 },
  { id: 'final', name: 'Final', order: 4, multiplier: 3 },
] as const;

export type StageId = (typeof TOURNAMENT_STAGES)[number]['id'];

export const DEFAULT_STAGE_ID: StageId = 'group';

/** Points awarded once the tournament champion is resolved and locked-in bracket picks are graded. */
export const BRACKET_CHAMPION_POINTS = 500 as const;
/** Points awarded for correctly calling the other finalist, independent of the champion call. */
export const BRACKET_RUNNER_UP_POINTS = 150 as const;

// ---------------------------------------------------------------------------
// Multi-market depth (W7 / SAH-35) — Over/Under totals + a couch-friendly
// correct-score band, additive to the primary 1X2 pick loop.
// ---------------------------------------------------------------------------

/**
 * Target total-goals line for the Over/Under secondary market. `OVERUNDER_PARTICIPANT_GOALS`
 * is confirmed live in the TxLINE feed (see TxLINE_SmokeTest_Results.md), but the one capture
 * we have only showed half=1 (first-half) lines at 0.5/1/1.25 — no full-match sample was
 * observed. This constant is a *target*, not a guarantee: the worker (`findOverUnderMarket`
 * in apps/worker/src/routes/picks.ts) queries whatever lines are actually on the wire for a
 * fixture and picks whichever real line is numerically closest to this. Never fabricate a
 * 2.5 line that isn't really there.
 */
export const OVERUNDER_TARGET_LINE = 2.5 as const;

/**
 * Correct-score is NOT a real TxLINE market — confirmed absent from both `SUPER_ODDS_TYPES`
 * and `PRICE_NAMES` (no SuperOddsType covers it). Shipped as a flat, non-odds-weighted pick
 * (see `CORRECT_SCORE_POINTS`) so it's honestly framed as a couch guess, not a faked
 * bookmaker price. This identifier lives in `picks.market` alongside the real SuperOddsType
 * values, but callers must never look it up in `oddsLatest` — there is no such market there.
 */
export const CORRECT_SCORE_MARKET = 'CORRECT_SCORE_BAND' as const;

/** Couch-friendly scoreline grid — a small, deliberately curated set, not every mathematically possible score. */
export const CORRECT_SCORE_OPTIONS = ['1-0', '2-1', '2-0', '0-0', '1-1', '0-1', '1-2'] as const;

export type CorrectScoreOption = (typeof CORRECT_SCORE_OPTIONS)[number];

/** Flat points for a correct-score hit — not odds-weighted (see `CORRECT_SCORE_MARKET` doc). */
export const CORRECT_SCORE_POINTS = 500 as const;
