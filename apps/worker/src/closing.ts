// Beat the Line — the closing-line stamping sweep.
//
// For every locked pick we want the market's CLOSING implied probability at kickoff.
// Once a fixture has started, this sweep reads the latest odds for each of its still-
// unstamped picks, snapshots the closing decimal odds + implied pct for the picked
// selection, and computes CLV (percentage points the market moved TOWARD the pick
// between lock and close). A pick that beat the line (clv >= CLV_BEAT_THRESHOLD) is
// the canonical sharp-bettor skill signal, reframed for fans — no betting language.
//
// Idempotent: guarded by `pct_at_close IS NULL`, so a pick is stamped exactly once.
// Correct-score picks carry a null pctAtLock and are excluded — they never participate.

import { eq, and, isNull, isNotNull, lte, sql } from 'drizzle-orm';
import {
  decimalOdds,
  impliedProbabilityFromPct,
  computeClv,
  CLV_BEAT_THRESHOLD,
} from '@touchline/shared';
import { db } from './db/client.ts';
import { fixtures, oddsLatest, picks, users, type PickRow } from './db/schema.ts';
import { bus } from './bus.ts';
import { SEL_INDEX, OU_SEL_INDEX, type OuSelection } from './routes/picks.ts';
import type { Outcome } from './resolve.ts';

interface CloseSnapshot {
  odds: number; // closing decimal odds for the picked selection
  pct: number | null; // implied prob as a fraction [0,1], mirroring pctAtLock ("NA" → null)
}

/**
 * Snapshot the CLOSING odds for a pick's exact selection. Reuses the SAME
 * selection→price-index mapping the lock path used (SEL_INDEX / OU_SEL_INDEX) so the
 * two can never diverge. Over/Under matches the EXACT line captured at lock
 * (marketParams), never merely the closest line to 2.5 — the market could have added
 * or dropped lines by kickoff. Returns null when no comparable odds are on the wire yet
 * (leave the pick unstamped and retry next sweep, rather than guess).
 */
async function readCloseSnapshot(p: PickRow): Promise<CloseSnapshot | null> {
  if (p.market === '1X2_PARTICIPANT_RESULT') {
    const idx = SEL_INDEX[p.selection as Outcome];
    if (idx == null) return null;
    const [m] = await db
      .select()
      .from(oddsLatest)
      .where(and(eq(oddsLatest.fixtureId, p.fixtureId), eq(oddsLatest.superOddsType, '1X2_PARTICIPANT_RESULT')));
    const price = m?.prices?.[idx];
    if (price == null) return null;
    const pctStr = m?.pct?.[idx];
    return { odds: decimalOdds(price), pct: pctStr ? impliedProbabilityFromPct(pctStr) : null };
  }

  if (p.market === 'OVERUNDER_PARTICIPANT_GOALS') {
    if (!p.marketParams) return null;
    const idx = OU_SEL_INDEX[p.selection as OuSelection];
    if (idx == null) return null;
    const rows = await db
      .select()
      .from(oddsLatest)
      .where(and(eq(oddsLatest.fixtureId, p.fixtureId), eq(oddsLatest.superOddsType, 'OVERUNDER_PARTICIPANT_GOALS')));
    // The exact line locked; prefer a full 2-price row if params repeat across periods.
    const row =
      rows.find((r) => r.marketParameters === p.marketParams && r.prices?.length === 2) ??
      rows.find((r) => r.marketParameters === p.marketParams);
    const price = row?.prices?.[idx];
    if (price == null) return null;
    const pctStr = row?.pct?.[idx];
    return { odds: decimalOdds(price), pct: pctStr ? impliedProbabilityFromPct(pctStr) : null };
  }

  // Correct-score (flat, no real odds) never reaches here — excluded by the pctAtLock guard.
  return null;
}

/**
 * One pass: stamp the closing line on every kicked-off fixture's unstamped picks.
 * Returns the number of picks stamped this pass. One-shot idempotent per pick via the
 * `pct_at_close IS NULL` guard.
 */
export async function stampClosingLines(): Promise<number> {
  const now = Date.now();
  const started = await db
    .select({ fixtureId: fixtures.fixtureId })
    .from(fixtures)
    .where(lte(fixtures.startTime, now));
  if (started.length === 0) return 0;

  let stamped = 0;
  for (const { fixtureId } of started) {
    const pending = await db
      .select()
      .from(picks)
      .where(
        and(
          eq(picks.fixtureId, fixtureId),
          eq(picks.status, 'open'),
          isNull(picks.pctAtClose),
          isNotNull(picks.pctAtLock),
        ),
      );
    if (pending.length === 0) continue;

    for (const p of pending) {
      const close = await readCloseSnapshot(p);
      if (!close || close.pct == null) continue; // no comparable closing pct yet — retry next sweep

      const clv = computeClv(p.pctAtLock, close.pct);
      const beatLine = clv != null && clv >= CLV_BEAT_THRESHOLD;

      // Re-assert the `pct_at_close IS NULL` guard IN the UPDATE (not just the SELECT) and
      // key off whether a row was actually stamped. This makes the stamp+increment atomic
      // against an overlapping sweep pass: only the pass that wins the row proceeds to bump
      // sharp_score / lines_beaten, so the cumulative leaderboard stats can't double-count.
      const updated = await db
        .update(picks)
        .set({ oddsAtClose: close.odds, pctAtClose: close.pct, clv, beatLine })
        .where(and(eq(picks.id, p.id), isNull(picks.pctAtClose)))
        .returning({ id: picks.id });
      if (updated.length === 0) continue; // another pass already stamped this pick
      stamped++;

      // sharp_score is a CUMULATIVE sharpness score: it accrues max(0, clv) for EVERY
      // stamped pick (not only beats). lines_beaten counts only picks that beat the line.
      const gain = clv != null ? Math.max(0, clv) : 0;
      if (gain > 0 || beatLine) {
        const set: Record<string, unknown> = { updatedAt: Date.now() };
        if (gain > 0) set.sharpScore = sql`${users.sharpScore} + ${gain}`;
        if (beatLine) set.linesBeaten = sql`${users.linesBeaten} + 1`;
        await db.update(users).set(set).where(eq(users.wallet, p.wallet));
      }

      // Emit ONLY when the pick beat the line (per the fixed WS/bus contract).
      if (beatLine) {
        bus.emit('clv', {
          wallet: p.wallet,
          fixtureId: p.fixtureId,
          market: p.market,
          selectionLabel: p.selectionLabel,
          pctAtLock: p.pctAtLock,
          pctAtClose: close.pct,
          clv: clv!,
          beatLine,
        });
      }
    }
  }
  return stamped;
}

/**
 * Schedule the closing sweep every 30s. Wrapped in try/catch + console.error so a bad
 * pass can never crash the worker. Returns a stop function (clearInterval).
 */
export function startClosingSweep(): () => void {
  // In-flight guard: a pass that runs longer than the 30s interval must not overlap with
  // the next tick, or two passes could interleave over the same still-unstamped picks.
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await stampClosingLines();
    } catch (e) {
      console.error('[touchline-worker] closing-line sweep failed', e);
    } finally {
      running = false;
    }
  };
  void tick();
  const handle = setInterval(() => void tick(), 30_000);
  console.log('[touchline-worker] closing-line sweep running (every 30s).');
  return () => clearInterval(handle);
}
