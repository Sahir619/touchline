// Scoring & resolution. When a fixture finishes, resolve open picks against the 1X2 result:
// award odds-weighted points, update the streak, grant XP, and flag long-shot trophies.
// Idempotent: only ever touches picks still in 'open' state.

import { eq, and } from 'drizzle-orm';
import {
  scoreStagedPick,
  isLongShot,
  trophyTier,
  applyStreak,
  levelForXp,
  parseOverUnderLine,
  CORRECT_SCORE_MARKET,
  SHARP_BONUS_RATE,
  STAR_MAN_MARKET,
  scoreStarMan,
  starManTrophy,
} from '@touchline/shared';
import { db } from './db/client.ts';
import { picks, streaks, users, trophies, scoreState, scoreEvents } from './db/schema.ts';
import { bus } from './bus.ts';
import { getStageIdForFixture } from './tournament.ts';

export type Outcome = 'part1' | 'draw' | 'part2';

/** Final full-time goals per side — used to grade Over/Under and correct-score picks. */
export interface FinalGoals {
  home: number;
  away: number;
}

const FINISHED = new Set(['F', 'FET', 'FPE']);

/** Is this score state a finished match? */
export function isFinished(state: { statusSoccerId: string | null; gameState: string | null }): boolean {
  if (state.statusSoccerId && FINISHED.has(state.statusSoccerId)) return true;
  const g = (state.gameState ?? '').toLowerCase();
  return g === 'finished' || g === 'ended' || g === 'fulltime' || g === 'ft' || g === '5';
}

/** Derive the 1X2 result from a stored scoreSoccer blob (uses 90-min Total goals). */
export function resultFromScore(scoreSoccer: unknown): Outcome | null {
  const s = scoreSoccer as
    | { Participant1?: { Total?: { Goals?: number } }; Participant2?: { Total?: { Goals?: number } } }
    | null;
  const g1 = s?.Participant1?.Total?.Goals;
  const g2 = s?.Participant2?.Total?.Goals;
  if (typeof g1 !== 'number' || typeof g2 !== 'number') return null;
  if (g1 > g2) return 'part1';
  if (g1 < g2) return 'part2';
  return 'draw';
}

/** Derive home/away final goals from a stored scoreSoccer blob (90-min Total), for
 *  grading Over/Under (total goals) and correct-score (exact scoreline) picks. */
export function finalGoalsFromScore(scoreSoccer: unknown): FinalGoals | null {
  const s = scoreSoccer as
    | { Participant1?: { Total?: { Goals?: number } }; Participant2?: { Total?: { Goals?: number } } }
    | null;
  const g1 = s?.Participant1?.Total?.Goals;
  const g2 = s?.Participant2?.Total?.Goals;
  if (typeof g1 !== 'number' || typeof g2 !== 'number') return null;
  return { home: g1, away: g2 };
}

async function bumpStreak(wallet: string, correct: boolean): Promise<{ current: number; longest: number }> {
  const [row] = await db.select().from(streaks).where(eq(streaks.wallet, wallet));
  const next = applyStreak({ current: row?.current ?? 0, longest: row?.longest ?? 0 }, correct);
  const ts = Date.now();
  if (row) {
    await db.update(streaks).set({ ...next, updatedAt: ts }).where(eq(streaks.wallet, wallet));
  } else {
    await db.insert(streaks).values({ wallet, ...next, updatedAt: ts });
  }
  return next;
}

async function addXp(wallet: string, points: number): Promise<void> {
  if (points <= 0) return;
  const [u] = await db.select().from(users).where(eq(users.wallet, wallet));
  if (!u) return;
  const xp = u.xp + points;
  await db.update(users).set({ xp, level: levelForXp(xp), updatedAt: Date.now() }).where(eq(users.wallet, wallet));
}

/**
 * Resolve all open picks for a fixture against `result` (1X2) and, when available,
 * `final` (total goals / exact scoreline — grades Over/Under and correct-score picks).
 * Returns a summary. Used by both live finalization (derived from score) and the dev
 * endpoint. Market-branched: previously this compared `p.selection === result` for
 * every open pick regardless of market, which would have silently mis-scored
 * Over/Under and correct-score picks as always-wrong once they existed.
 */
export async function resolvePicks(
  fixtureId: number,
  result: Outcome,
  final?: FinalGoals | null,
): Promise<{ resolved: number; wins: number }> {
  const open = await db
    .select()
    .from(picks)
    .where(and(eq(picks.fixtureId, fixtureId), eq(picks.status, 'open')));

  const stageId = await getStageIdForFixture(fixtureId);

  // Star Man: the set of player.normativeIds who scored a LEGITIMATE goal (own goals never
  // count) in this fixture, derived from the append-only score_events log. Computed lazily
  // and once — most fixtures carry no Star Man pick, so we only pay for it when one exists.
  let starManScorers: Set<number> | null = null;
  const legitScorers = async (): Promise<Set<number>> => {
    if (starManScorers) return starManScorers;
    const rows = await db
      .select()
      .from(scoreEvents)
      .where(and(eq(scoreEvents.fixtureId, fixtureId), eq(scoreEvents.action, 'goal')));
    const set = new Set<number>();
    for (const r of rows) {
      const d = r.dataSoccer as { PlayerId?: number; GoalType?: string } | null;
      if (d?.PlayerId != null && d.GoalType !== 'Own') set.add(d.PlayerId);
    }
    starManScorers = set;
    return set;
  };

  let wins = 0;
  let resolvedCount = 0;
  for (const p of open) {
    let correct = false;
    let voided = false;
    // Star Man call snapshot (starter/underdog), parsed from marketParams captured at lock.
    let starMan: { starter: boolean; underdog: boolean } | null = null;

    if (p.market === '1X2_PARTICIPANT_RESULT') {
      correct = p.selection === result;
    } else if (p.market === STAR_MAN_MARKET) {
      // Correct iff the called player scored a non-own goal (join on player.normativeId).
      const scorers = await legitScorers();
      correct = scorers.has(Number(p.selection));
      let parsed: { starter?: boolean; underdog?: boolean } = {};
      if (p.marketParams) {
        try {
          parsed = JSON.parse(p.marketParams) as { starter?: boolean; underdog?: boolean };
        } catch {
          parsed = {};
        }
      }
      starMan = { starter: parsed.starter ?? true, underdog: parsed.underdog ?? false };
    } else if (p.market === 'OVERUNDER_PARTICIPANT_GOALS') {
      // Can't grade without the final score, or without the line captured at lock —
      // leave the pick open rather than guess; it'll resolve on the next finish event.
      if (!final) continue;
      const line = p.marketParams ? parseOverUnderLine(p.marketParams) : null;
      if (line == null) continue;
      const total = final.home + final.away;
      if (total === line) {
        // Integer-line exact tie — a genuine push, bookmaker convention: no win/loss.
        voided = true;
      } else {
        correct = p.selection === 'over' ? total > line : total < line;
      }
    } else if (p.market === CORRECT_SCORE_MARKET) {
      if (!final) continue;
      correct = p.selection === `${final.home}-${final.away}`;
    } else {
      // Unknown market — never silently mis-score; leave it open.
      continue;
    }

    resolvedCount++;
    // Beat the Line: a correct pick that also beat the closing line earns a sharp bonus
    // (SHARP_BONUS_RATE of its base points). Idempotent — resolvePicks only ever touches
    // 'open' picks, so a settled pick is never re-scored or double-bonused. Star Man is
    // flat-based (scoreStarMan), never odds-weighted, and carries no beatLine (pctAtLock is
    // null) so it never earns the sharp bonus.
    const basePoints = voided
      ? 0
      : starMan
        ? scoreStarMan(starMan, correct, stageId)
        : scoreStagedPick(p.oddsAtLock, correct, stageId);
    const sharpBonus = !voided && !starMan && correct && p.beatLine ? Math.round(basePoints * SHARP_BONUS_RATE) : 0;
    const points = basePoints + sharpBonus;
    const ts = Date.now();
    await db
      .update(picks)
      .set({ status: voided ? 'void' : correct ? 'won' : 'lost', points, resolvedAt: ts })
      .where(eq(picks.id, p.id));

    if (voided) continue; // no streak/XP/trophy/bus effect for a push

    const streak = await bumpStreak(p.wallet, correct);
    await addXp(p.wallet, points);

    // Star Man: a winning call earns the 'Talisman' trophy when it carried extra nerve
    // (a benched player and/or an underdog's player). tier = gold when BOTH, else silver;
    // oddsBeaten is null (Star Man is not an odds market). A favourite's starter scoring
    // wins points but no trophy.
    if (correct && starMan) {
      const t = starManTrophy({ bench: !starMan.starter, underdog: starMan.underdog });
      if (t.tier && t.name) {
        await db.insert(trophies).values({
          wallet: p.wallet,
          fixtureId,
          tier: t.tier,
          name: t.name,
          oddsBeaten: null,
          market: p.market,
          selectionLabel: p.selectionLabel,
          metadata: { starter: starMan.starter, underdog: starMan.underdog, lockedAt: p.lockedAt },
          createdAt: ts,
        });
      }
    }

    // Trophy-granting is the 1X2/Over-Under "beat the long shot" mechanic; correct-score
    // is flat, non-odds-weighted points and never claims an "odds beaten" trophy, even
    // though its synthetic oddsAtLock would otherwise clear the long-shot threshold.
    if (correct && !starMan && p.market !== CORRECT_SCORE_MARKET && isLongShot(p.oddsAtLock)) {
      const tier = trophyTier(p.oddsAtLock);
      if (tier.tier && tier.name) {
        await db.insert(trophies).values({
          wallet: p.wallet,
          fixtureId,
          tier: tier.tier,
          name: tier.name,
          oddsBeaten: p.oddsAtLock,
          market: p.market,
          selectionLabel: p.selectionLabel,
          metadata: { result, lockedAt: p.lockedAt },
          createdAt: ts,
        });
      }
    }

    // The live room (/live/[id]) listens for exactly one 'resolved' event per
    // wallet+fixture and isn't market-aware — a second event from a secondary-market
    // pick on the same fixture would clobber its result banner. Keep this event
    // scoped to 1X2 (unchanged contract); secondary-market resolution surfaces on
    // next load via GET /api/picks/all instead.
    if (p.market === '1X2_PARTICIPANT_RESULT') {
      bus.emit('resolved', { wallet: p.wallet, fixtureId, correct, points, streak: streak.current });
    }
    if (correct) wins++;
  }
  return { resolved: resolvedCount, wins };
}

/** Resolve a fixture from its stored final score (no-op unless finished). */
export async function resolveFixture(fixtureId: number): Promise<{ resolved: number; wins: number } | null> {
  const [state] = await db.select().from(scoreState).where(eq(scoreState.fixtureId, fixtureId));
  if (!state || !isFinished(state)) return null;
  const result = resultFromScore(state.scoreSoccer);
  if (!result) return null;
  const final = finalGoalsFromScore(state.scoreSoccer);
  return resolvePicks(fixtureId, result, final);
}
