// @touchline/shared — the odds-weighted scoring engine.
// All functions are PURE, typed, and deterministic. The web UI and the worker MUST
// produce identical numbers from these, so this is the single source of truth.
//
// Core idea: a correct pick is worth the (locked) decimal odds × 100 points. Backing a
// long shot that comes in pays far more than backing a favourite — rewarding nerve.

import { TOURNAMENT_STAGES, DEFAULT_STAGE_ID, BRACKET_CHAMPION_POINTS, BRACKET_RUNNER_UP_POINTS, type StageId } from './constants';

export type TrophyTier = 'bronze' | 'silver' | 'gold';
export type TrophyName = 'Outsider' | 'Giant-killer' | 'Oracle' | 'Talisman';

export interface Trophy {
  tier: TrophyTier | null;
  name: TrophyName | null;
}

export interface StreakState {
  /** Length of the current unbroken run of correct picks. */
  current: number;
  /** Longest run of correct picks ever achieved. */
  longest: number;
}

/** Odds at or above this are considered a "long shot". */
export const LONG_SHOT_THRESHOLD = 3 as const;

/** Streak lengths that unlock a milestone reward. */
export const STREAK_MILESTONES = [5, 10, 15] as const;

/**
 * Points for a single pick, scored against the decimal odds captured at lock time.
 * Correct → round(decimalOdds × 100). Incorrect → 0.
 * e.g. odds 1.957 → 196 pts; odds 5.333 → 533 pts; wrong → 0.
 */
export function scorePick(decimalOddsAtLock: number, correct: boolean): number {
  return correct ? Math.round(decimalOddsAtLock * 100) : 0;
}

/** A pick is a long shot when its decimal odds are 3.0 or greater. */
export function isLongShot(decimalOdds: number): boolean {
  return decimalOdds >= LONG_SHOT_THRESHOLD;
}

/** Bookie-implied win probability (%) from decimal odds: 1 / odds. */
export function impliedProbabilityPct(decimalOddsAtLock: number): number {
  return decimalOddsAtLock > 0 ? 100 / decimalOddsAtLock : 0;
}

/**
 * Plain-language framing of implied probability — a bare phrase like "1-in-5"
 * (when the odds are close to a clean ratio) or "18%" otherwise. Callers wrap
 * this in a sentence; use `probabilityArticle` for "a"/"an" agreement.
 */
export function impliedProbabilityPhrase(decimalOddsAtLock: number): string {
  const pct = impliedProbabilityPct(decimalOddsAtLock);
  if (pct <= 0) return '—';
  const n = Math.round(100 / pct);
  if (n >= 2 && n <= 20 && Math.abs(100 / n - pct) < 1.5) return `1-in-${n}`;
  return `${Math.round(pct)}%`;
}

/** "a" or "an" to precede a phrase from `impliedProbabilityPhrase` (e.g. "an 18%"). */
export function probabilityArticle(phrase: string): 'a' | 'an' {
  const n = parseInt(phrase, 10);
  if (Number.isNaN(n)) return 'a';
  if (n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89)) return 'an';
  return 'a';
}

/** Implied probability at/below this is treated as a genuine long-shot "against the market" hit. */
export const AGAINST_MARKET_THRESHOLD_PCT = 25 as const;

/**
 * True when the locked odds' implied probability was at/below ~25% — i.e. the
 * market gave this pick a real long-shot's chance. Used to stamp resolved
 * picks that landed "against the market" (W3 / SAH-32 edge framing).
 */
export function isAgainstMarket(decimalOddsAtLock: number): boolean {
  return impliedProbabilityPct(decimalOddsAtLock) <= AGAINST_MARKET_THRESHOLD_PCT;
}

/**
 * Map decimal odds to a long-shot trophy tier (awarded when such a pick lands):
 *  - bronze "Outsider"     : 3.00 – 4.99
 *  - silver "Giant-killer"  : 5.00 – 7.99
 *  - gold   "Oracle"        : 8.00+
 * Below 3.00 → { tier: null, name: null }.
 */
export function trophyTier(decimalOdds: number): Trophy {
  if (decimalOdds >= 8) return { tier: 'gold', name: 'Oracle' };
  if (decimalOdds >= 5) return { tier: 'silver', name: 'Giant-killer' };
  if (decimalOdds >= 3) return { tier: 'bronze', name: 'Outsider' };
  return { tier: null, name: null };
}

/**
 * Advance a streak by one pick result.
 * Correct → current + 1 (and longest grows to match). Incorrect → current resets to 0.
 * Pure: returns a new object, never mutates `prev`.
 */
export function applyStreak(prev: StreakState, correct: boolean): StreakState {
  const current = correct ? prev.current + 1 : 0;
  const longest = Math.max(prev.longest, current);
  return { current, longest };
}

/** True when a streak length hits a milestone (5, 10, or 15). */
export function streakMilestone(n: number): boolean {
  return (STREAK_MILESTONES as readonly number[]).includes(n);
}

/** The stage's point multiplier, or 1 for an unknown/unmapped stage id. */
export function stageMultiplier(stageId: string | null | undefined): number {
  return TOURNAMENT_STAGES.find((s) => s.id === stageId)?.multiplier ?? 1;
}

/**
 * Season-long score for a single match pick: the base odds-weighted `scorePick`
 * result, scaled by the fixture's tournament stage (group=1x … final=3x). Additive
 * to the existing per-match loop — an unmapped fixture defaults to `DEFAULT_STAGE_ID`
 * (group, 1x), so this is a no-op until stages are explicitly assigned.
 */
export function scoreStagedPick(decimalOddsAtLock: number, correct: boolean, stageId: string | null | undefined): number {
  return Math.round(scorePick(decimalOddsAtLock, correct) * stageMultiplier(stageId ?? DEFAULT_STAGE_ID));
}

// ---------------------------------------------------------------------------
// Beat the Line (CLV) — the sharp-bettor skill signal, reframed for fans.
// For every locked pick we snapshot the market's CLOSING implied probability at
// kickoff. Closing-line value (CLV) = how far the market moved TOWARD the picked
// selection between lock and close, in percentage points. A positive move means
// the user was ahead of the market — the canonical "sharp" signal. Copy never
// uses bet/wager/stake/gamble: it's "the line", "the market", "sharp".
// ---------------------------------------------------------------------------

/** CLV (percentage points) at/above which a pick is judged to have "beaten the line". */
export const CLV_BEAT_THRESHOLD = 2 as const;

/** Bonus fraction of a WON pick's base points when that pick also beat the line. */
export const SHARP_BONUS_RATE = 0.25 as const;

/**
 * Closing-line value in PERCENTAGE POINTS (1 dp), toward the picked selection.
 * Inputs are implied probabilities as fractions in [0,1] (TxLINE Pct/100, exactly
 * as stored in picks.pctAtLock / picks.pctAtClose). Returns null when either side
 * is missing — e.g. correct-score picks carry no pctAtLock and never participate.
 * e.g. lock 0.40 → close 0.44 ⇒ +4.0 (market moved 4 points toward the pick).
 */
export function computeClv(
  pctAtLock: number | null | undefined,
  pctAtClose: number | null | undefined,
): number | null {
  if (pctAtLock == null || pctAtClose == null) return null;
  return Math.round((pctAtClose - pctAtLock) * 100 * 10) / 10;
}

// ---------------------------------------------------------------------------
// Star Man (SAH — Star Man) — before kickoff, a fan calls ONE player from either
// team's official lineup as their Star Man. If he scores (own goals never count),
// the call wins. Rewards scale with unlikelihood: a benched pick and/or an underdog's
// player pay a multiplier on the flat base. Not a real bookmaker market (no TxLINE
// price), so it is flat-based, not odds-weighted — same honest framing as
// correct-score. Copy stays call/pick/line; never bet/wager/stake/gamble.
// ---------------------------------------------------------------------------

/** Market identifier for a Star Man call. Lives in picks.market alongside the real markets. */
export const STAR_MAN_MARKET = 'STAR_MAN_GOAL' as const;

/** Flat base points for a Star Man who scores (before bench/underdog/stage multipliers). */
export const STAR_MAN_BASE_POINTS = 30 as const;

/** Multiplier when the called player started on the bench (a bolder call). */
export const STAR_MAN_BENCH_MULT = 1.5 as const;

/** Multiplier when the called player's team was the underdog on the market at lock. */
export const STAR_MAN_UNDERDOG_MULT = 1.5 as const;

/**
 * Points for a Star Man call that came in. Flat base scaled by:
 *  - bench: ×STAR_MAN_BENCH_MULT when the player did NOT start (starter === false),
 *  - underdog: ×STAR_MAN_UNDERDOG_MULT when his team was the market underdog at lock,
 *  - the fixture's tournament stage multiplier (group=1x … final=3x), same as every
 *    other market. A losing call is 0. Rounded to a whole number of points.
 */
export function scoreStarMan(
  opts: { starter: boolean; underdog: boolean },
  correct: boolean,
  stageId: string | null | undefined,
): number {
  if (!correct) return 0;
  const base =
    STAR_MAN_BASE_POINTS *
    (opts.starter ? 1 : STAR_MAN_BENCH_MULT) *
    (opts.underdog ? STAR_MAN_UNDERDOG_MULT : 1);
  return Math.round(base * stageMultiplier(stageId ?? DEFAULT_STAGE_ID));
}

/**
 * The "Talisman" trophy for a Star Man call that landed AND carried extra nerve
 * (a benched player and/or an underdog's player). tier = gold when BOTH bench and
 * underdog were true, else silver. Returns null when neither applies (a favourite's
 * starter scoring is a clean win, but not trophy-worthy). Own goals never reach here.
 */
export function starManTrophy(opts: { bench: boolean; underdog: boolean }): Trophy {
  if (!opts.bench && !opts.underdog) return { tier: null, name: null };
  return { tier: opts.bench && opts.underdog ? 'gold' : 'silver', name: 'Talisman' };
}

/**
 * Fan-facing Star Man display name from a TxLINE `preferredName` ("Lastname, Firstname").
 * Renders as "F. Lastname" (e.g. "Amenda, Aurele" -> "A. Amenda", "Ndoye, Dan" -> "D. Ndoye",
 * "Hany Eldemerdash, Mohamed" -> "M. Hany Eldemerdash"). Names without a comma pass through
 * trimmed. The worker snapshots this server-side into the pick label — never trusts a client
 * label — and the same helper keeps the web's rendering identical.
 */
export function starManDisplayName(preferredName: string): string {
  const idx = preferredName.indexOf(',');
  if (idx === -1) return preferredName.trim();
  const surname = preferredName.slice(0, idx).trim();
  const rest = preferredName.slice(idx + 1).trim();
  const initial = rest ? rest[0]!.toUpperCase() : '';
  return initial ? `${initial}. ${surname}` : surname;
}

export interface BracketResult {
  championId: number;
  runnerUpId?: number | null;
}

export interface BracketPickInput {
  championId: number;
  runnerUpId?: number | null;
}

/**
 * Score a full-tournament bracket/pool pick once the champion (and, optionally, the
 * other finalist) is known. The champion and runner-up calls are independent — a
 * wrong champion pick can still bank runner-up points.
 */
export function scoreBracket(pick: BracketPickInput, result: BracketResult): number {
  let points = 0;
  if (pick.championId === result.championId) points += BRACKET_CHAMPION_POINTS;
  if (result.runnerUpId != null && pick.runnerUpId === result.runnerUpId) points += BRACKET_RUNNER_UP_POINTS;
  return points;
}
