// Pick'em, leaderboard, and a dev resolve endpoint.
import type { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import {
  decimalOdds,
  impliedProbabilityFromPct,
  scoreStagedPick,
  parseOverUnderLine,
  isPartialPeriod,
  OVERUNDER_TARGET_LINE,
  CORRECT_SCORE_MARKET,
  CORRECT_SCORE_OPTIONS,
  CORRECT_SCORE_POINTS,
  STAR_MAN_MARKET,
  STAR_MAN_BASE_POINTS,
  scoreStarMan,
  type CorrectScoreOption,
} from '@touchline/shared';
import { db } from '../db/client.ts';
import { fixtures, oddsLatest, picks, users, streaks, trophies, lineups, scoreEvents } from '../db/schema.ts';
import { type AppEnv, requireAuth } from '../auth.ts';
import { resolvePicks, type Outcome } from '../resolve.ts';
import { config } from '../config.ts';
import { markWatched, fireForFixture, fireForWallet, punditMode, type Kind } from '../pundit.ts';
import { getStageIdForFixture } from '../tournament.ts';
import { getRecentCalls } from '../demo.ts';

const SEL_LABEL: Record<Outcome, '1' | 'X' | '2'> = { part1: '1', draw: 'X', part2: '2' };
// Exported so the closing-line sweep (closing.ts) reads the SAME price/pct slot at
// close that lock used — the mapping must never diverge between the two paths.
export const SEL_INDEX: Record<Outcome, number> = { part1: 0, draw: 1, part2: 2 };

export type OuSelection = 'over' | 'under';
const OU_SEL_LABEL: Record<OuSelection, 'O' | 'U'> = { over: 'O', under: 'U' };
export const OU_SEL_INDEX: Record<OuSelection, number> = { over: 0, under: 1 }; // matches PRICE_NAMES.OVERUNDER_PARTICIPANT_GOALS

/**
 * Query every OVERUNDER_PARTICIPANT_GOALS line on the wire for this fixture and pick
 * whichever real one is numerically closest to OVERUNDER_TARGET_LINE (2.5), preferring
 * a full-match MarketPeriod over a partial one (e.g. half=1) when both exist. Never
 * fabricates a line — returns null when no Over/Under odds are available at all.
 */
async function findOverUnderMarket(fixtureId: number) {
  const rows = await db
    .select()
    .from(oddsLatest)
    .where(and(eq(oddsLatest.fixtureId, fixtureId), eq(oddsLatest.superOddsType, 'OVERUNDER_PARTICIPANT_GOALS')));

  const candidates = rows
    .filter((r) => r.marketParameters && r.prices?.length === 2)
    .map((r) => ({ row: r, line: parseOverUnderLine(r.marketParameters!), partial: isPartialPeriod(r.marketPeriod) }))
    .filter((c): c is typeof c & { line: number } => c.line != null);

  if (candidates.length === 0) return null;
  const fullMatch = candidates.filter((c) => !c.partial);
  const pool = fullMatch.length > 0 ? fullMatch : candidates;
  const closest = pool.reduce((a, b) =>
    Math.abs(b.line - OVERUNDER_TARGET_LINE) < Math.abs(a.line - OVERUNDER_TARGET_LINE) ? b : a,
  );
  return closest.row;
}

export function registerPickRoutes(app: Hono<AppEnv>): void {
  // Lock a pick (server-side; rejects after kickoff). Captures odds at lock time.
  // `market` is optional and defaults to '1X2_PARTICIPANT_RESULT' — fully backward
  // compatible with every existing caller. W7/SAH-35 adds two more markets: a real
  // odds-weighted Over/Under (OVERUNDER_PARTICIPANT_GOALS, confirmed live in TxLINE)
  // and a flat, non-odds-weighted correct-score band (CORRECT_SCORE_BAND — not a real
  // bookmaker market, see the constant's doc comment).
  app.post('/api/picks', requireAuth, async (c) => {
    const wallet = c.get('wallet');
    const body = await c.req.json().catch(() => ({}));
    const fixtureId = Number(body.fixtureId);
    const market = typeof body.market === 'string' && body.market ? body.market : '1X2_PARTICIPANT_RESULT';
    if (!fixtureId) return c.json({ error: 'bad request' }, 400);

    const [fx] = await db.select().from(fixtures).where(eq(fixtures.fixtureId, fixtureId));
    if (!fx) return c.json({ error: 'unknown fixture' }, 404);
    if (fx.startTime <= Date.now()) return c.json({ error: 'match already started' }, 400);

    // One open pick per (wallet, fixture, market) — a user may hold an open 1X2 pick
    // *and* an open Over/Under pick *and* an open correct-score pick on the same fixture.
    const existingOpenPick = async () => {
      const [existing] = await db
        .select()
        .from(picks)
        .where(
          and(
            eq(picks.wallet, wallet),
            eq(picks.fixtureId, fixtureId),
            eq(picks.market, market),
            eq(picks.status, 'open'),
          ),
        );
      return existing;
    };

    if (market === '1X2_PARTICIPANT_RESULT') {
      const selection = body.selection as Outcome;
      if (!(selection in SEL_LABEL)) return c.json({ error: 'bad request' }, 400);

      const existing = await existingOpenPick();
      if (existing) return c.json({ error: 'already picked', pick: existing }, 409);

      const [m] = await db
        .select()
        .from(oddsLatest)
        .where(and(eq(oddsLatest.fixtureId, fixtureId), eq(oddsLatest.superOddsType, '1X2_PARTICIPANT_RESULT')));
      const price = m?.prices?.[SEL_INDEX[selection]];
      if (price == null) return c.json({ error: 'no odds available yet' }, 400);

      const oddsAtLock = decimalOdds(price);
      const pctStr = m?.pct?.[SEL_INDEX[selection]];
      const pctAtLock = pctStr ? impliedProbabilityFromPct(pctStr) : null;
      const ts = Date.now();

      const [pick] = await db
        .insert(picks)
        .values({
          wallet,
          fixtureId,
          market,
          selection,
          selectionLabel: SEL_LABEL[selection],
          oddsAtLock,
          pctAtLock: pctAtLock ?? null,
          status: 'open',
          points: 0,
          lockedAt: ts,
        })
        .returning();

      // Register the fixture with the pundit engine immediately (don't wait on its
      // periodic refresh) so a goal/swing right after lock still triggers a line.
      markWatched(fixtureId);

      const stageId = await getStageIdForFixture(fixtureId);
      return c.json({ pick, potentialPoints: scoreStagedPick(oddsAtLock, true, stageId) });
    }

    if (market === 'OVERUNDER_PARTICIPANT_GOALS') {
      const selection = body.selection as OuSelection;
      if (selection !== 'over' && selection !== 'under') return c.json({ error: 'bad request' }, 400);

      const existing = await existingOpenPick();
      if (existing) return c.json({ error: 'already picked', pick: existing }, 409);

      const row = await findOverUnderMarket(fixtureId);
      if (!row) return c.json({ error: 'no odds available yet' }, 400);
      const price = row.prices?.[OU_SEL_INDEX[selection]];
      if (price == null) return c.json({ error: 'no odds available yet' }, 400);

      const oddsAtLock = decimalOdds(price);
      const pctStr = row.pct?.[OU_SEL_INDEX[selection]];
      const pctAtLock = pctStr ? impliedProbabilityFromPct(pctStr) : null;
      const ts = Date.now();

      const [pick] = await db
        .insert(picks)
        .values({
          wallet,
          fixtureId,
          market,
          selection,
          selectionLabel: OU_SEL_LABEL[selection],
          oddsAtLock,
          pctAtLock: pctAtLock ?? null,
          marketParams: row.marketParameters ?? null,
          status: 'open',
          points: 0,
          lockedAt: ts,
        })
        .returning();

      markWatched(fixtureId);
      const stageId = await getStageIdForFixture(fixtureId);
      return c.json({ pick, potentialPoints: scoreStagedPick(oddsAtLock, true, stageId) });
    }

    if (market === CORRECT_SCORE_MARKET) {
      const selection = body.selection as CorrectScoreOption;
      if (!(CORRECT_SCORE_OPTIONS as readonly string[]).includes(selection)) {
        return c.json({ error: 'bad request' }, 400);
      }

      const existing = await existingOpenPick();
      if (existing) return c.json({ error: 'already picked', pick: existing }, 409);

      // Not a real bookmaker price — flat points, no odds lookup (see CORRECT_SCORE_MARKET doc).
      const oddsAtLock = CORRECT_SCORE_POINTS / 100;
      const ts = Date.now();

      const [pick] = await db
        .insert(picks)
        .values({
          wallet,
          fixtureId,
          market,
          selection,
          selectionLabel: selection,
          oddsAtLock,
          pctAtLock: null,
          status: 'open',
          points: 0,
          lockedAt: ts,
        })
        .returning();

      markWatched(fixtureId);
      const stageId = await getStageIdForFixture(fixtureId);
      return c.json({ pick, potentialPoints: scoreStagedPick(oddsAtLock, true, stageId) });
    }

    if (market === STAR_MAN_MARKET) {
      // selection is a player.normativeId (string). The label + marketParams are derived
      // SERVER-SIDE from the stored lineup — a client-supplied label is never trusted.
      const playerId = Number(body.selection);
      if (!Number.isInteger(playerId) || playerId <= 0) return c.json({ error: 'bad request' }, 400);

      const existing = await existingOpenPick();
      if (existing) return c.json({ error: 'already picked', pick: existing }, 409);

      // The player must exist in this fixture's stored official lineup (rosters publish
      // ~30-45 min before kickoff; before then there is nothing to call).
      const [lp] = await db
        .select()
        .from(lineups)
        .where(and(eq(lineups.fixtureId, fixtureId), eq(lineups.playerId, playerId)));
      if (!lp) return c.json({ error: 'player not in lineup' }, 400);

      // Underdog = his team's 1X2 implied probability at lock is below the opponent's.
      // If no 1X2 odds are on the wire yet, underdog stays false (never guessed).
      let underdog = false;
      const [m] = await db
        .select()
        .from(oddsLatest)
        .where(and(eq(oddsLatest.fixtureId, fixtureId), eq(oddsLatest.superOddsType, '1X2_PARTICIPANT_RESULT')));
      if (m?.pct && m.pct.length === 3) {
        const p1 = impliedProbabilityFromPct(m.pct[0]!);
        const p2 = impliedProbabilityFromPct(m.pct[2]!);
        if (p1 != null && p2 != null) {
          const onParticipant1 = lp.teamId === fx.participant1Id;
          const mine = onParticipant1 ? p1 : p2;
          const opp = onParticipant1 ? p2 : p1;
          underdog = mine < opp;
        }
      }

      // Not a real bookmaker price — synthetic flat oddsAtLock mirrors the correct-score
      // convention (POINTS/100); pctAtLock is null so Star Man is never CLV-stamped.
      const oddsAtLock = STAR_MAN_BASE_POINTS / 100;
      const marketParams = JSON.stringify({ team: lp.team, starter: lp.starter, underdog });
      const ts = Date.now();

      const [pick] = await db
        .insert(picks)
        .values({
          wallet,
          fixtureId,
          market,
          selection: String(playerId),
          selectionLabel: lp.name,
          oddsAtLock,
          pctAtLock: null,
          marketParams,
          status: 'open',
          points: 0,
          lockedAt: ts,
        })
        .returning();

      markWatched(fixtureId);
      const stageId = await getStageIdForFixture(fixtureId);
      return c.json({ pick, potentialPoints: scoreStarMan({ starter: lp.starter, underdog }, true, stageId) });
    }

    return c.json({ error: 'unknown market' }, 400);
  });

  // The signed-in user's picks, newest first, enriched with the fixture. Scoped to
  // 1X2 only: this is the existing contract the live room (/live/[id]) and /you
  // structurally depend on (Pick.selection typed as part1|draw|part2). Secondary
  // markets (Over/Under, correct-score) are served by GET /api/picks/all instead.
  app.get('/api/picks', requireAuth, async (c) => {
    const wallet = c.get('wallet');
    const rows = await db
      .select()
      .from(picks)
      .where(and(eq(picks.wallet, wallet), eq(picks.market, '1X2_PARTICIPANT_RESULT')))
      .orderBy(desc(picks.lockedAt));
    const out = [];
    for (const p of rows) {
      const [fx] = await db.select().from(fixtures).where(eq(fixtures.fixtureId, p.fixtureId));
      out.push({ ...p, fixture: fx ?? null });
    }
    return c.json(out);
  });

  // The signed-in user's picks across EVERY market (1X2 + Over/Under + correct-score),
  // newest first. Powers only the new secondary-market UI (W7/SAH-35) — every existing
  // caller keeps using GET /api/picks above, unchanged.
  app.get('/api/picks/all', requireAuth, async (c) => {
    const wallet = c.get('wallet');
    const rows = await db.select().from(picks).where(eq(picks.wallet, wallet)).orderBy(desc(picks.lockedAt));
    const out = [];
    for (const p of rows) {
      const [fx] = await db.select().from(fixtures).where(eq(fixtures.fixtureId, p.fixtureId));
      // Star Man enrichment: the receipt needs the SAME potentialPoints the server
      // returned at lock (scoreStarMan includes the bench/underdog/stage multipliers,
      // which the synthetic flat oddsAtLock does NOT encode), and the live room needs to
      // know whether the called player has already found the net so a late-joining or
      // reloading viewer reflects a Star Man who already scored. Both are derived
      // server-side (never trust the client) and additive — other markets are untouched.
      if (p.market === STAR_MAN_MARKET) {
        let starter = true;
        let underdog = false;
        if (p.marketParams) {
          try {
            const parsed = JSON.parse(p.marketParams) as { starter?: boolean; underdog?: boolean };
            starter = parsed.starter ?? true;
            underdog = parsed.underdog ?? false;
          } catch {
            /* keep defaults */
          }
        }
        const stageId = await getStageIdForFixture(p.fixtureId);
        const potentialPoints = scoreStarMan({ starter, underdog }, true, stageId);
        // A legitimate (non-own) goal by the called player, from the append-only log —
        // the same rule resolve.ts and the pundit use.
        const goalRows = await db
          .select({ dataSoccer: scoreEvents.dataSoccer })
          .from(scoreEvents)
          .where(and(eq(scoreEvents.fixtureId, p.fixtureId), eq(scoreEvents.action, 'goal')));
        const selId = Number(p.selection);
        const scored = goalRows.some((r) => {
          const d = r.dataSoccer as { PlayerId?: number; GoalType?: string } | null;
          return d?.PlayerId === selId && d.GoalType !== 'Own';
        });
        out.push({ ...p, fixture: fx ?? null, potentialPoints, scored });
        continue;
      }
      out.push({ ...p, fixture: fx ?? null });
    }
    return c.json(out);
  });

  // Global leaderboard by cumulative XP.
  app.get('/api/leaderboard', async (c) => {
    const us = await db.select().from(users).orderBy(desc(users.xp)).limit(100);
    const tcounts = await db
      .select({ wallet: trophies.wallet, n: sql<number>`count(*)` })
      .from(trophies)
      .groupBy(trophies.wallet);
    const tmap = new Map(tcounts.map((t) => [t.wallet, Number(t.n)]));
    const sts = await db.select().from(streaks);
    const smap = new Map(sts.map((s) => [s.wallet, s.current]));
    // SAH-74: recent-call context for the seeded Demo League cast, so their leaderboard
    // rows match their pick history (and the activity feed) instead of reading as empty.
    const demoWalletList = us.filter((u) => u.demo).map((u) => u.wallet);
    const recentCalls = config.enableDemo ? await getRecentCalls(demoWalletList) : new Map<string, string>();
    const board = us.map((u, i) => ({
      rank: i + 1,
      wallet: u.wallet,
      displayName: u.displayName,
      nation: u.nation,
      xp: u.xp,
      level: u.level,
      trophies: tmap.get(u.wallet) ?? 0,
      streak: smap.get(u.wallet) ?? 0,
      demo: u.demo,
      recentCall: recentCalls.get(u.wallet) ?? null,
      sharpScore: u.sharpScore,
      linesBeaten: u.linesBeaten,
    }));
    return c.json(board);
  });

  // Public accuracy stats for a wallet — powers the leaderboard row popover and /you.
  app.get('/api/users/:wallet/stats', async (c) => {
    const wallet = c.req.param('wallet');
    const rows = await db
      .select({ status: picks.status, n: sql<number>`count(*)` })
      .from(picks)
      .where(and(eq(picks.wallet, wallet), eq(picks.market, '1X2_PARTICIPANT_RESULT')))
      .groupBy(picks.status);
    const counts = { open: 0, won: 0, lost: 0, void: 0 };
    for (const r of rows) {
      if (r.status in counts) counts[r.status as keyof typeof counts] = Number(r.n);
    }
    const decided = counts.won + counts.lost;
    const hitRate = decided > 0 ? counts.won / decided : null;
    return c.json({ wallet, ...counts, decided, hitRate });
  });

  // DEV ONLY: force-resolve a fixture's open picks against a result (for testing/demo,
  // since matches finish during live play). Enabled by default in dev, auto-off in
  // production (config.enableDevRoutes). Optionally gate behind DEV_RESOLVE_TOKEN.
  if (config.enableDevRoutes) {
    app.post('/api/dev/resolve/:fixtureId', async (c) => {
      if (config.devResolveToken && c.req.header('X-Dev-Token') !== config.devResolveToken) {
        return c.json({ error: 'forbidden' }, 403);
      }
      const fixtureId = Number(c.req.param('fixtureId'));
      if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
        return c.json({ error: 'invalid fixture id' }, 400);
      }
      const body = await c.req.json().catch(() => ({}));
      const result = body.result as Outcome;
      if (!['part1', 'draw', 'part2'].includes(result)) {
        return c.json({ error: 'result must be part1|draw|part2' }, 400);
      }
      // Optional: also grade Over/Under + correct-score picks in this dev call by
      // supplying the final score. Omitted (the pre-existing contract) still resolves
      // 1X2 exactly as before and leaves any secondary-market picks open.
      const homeGoals = Number.isInteger(body.homeGoals) ? (body.homeGoals as number) : null;
      const awayGoals = Number.isInteger(body.awayGoals) ? (body.awayGoals as number) : null;
      const final = homeGoals != null && awayGoals != null ? { home: homeGoals, away: awayGoals } : null;
      const summary = await resolvePicks(fixtureId, result, final);
      return c.json(summary);
    });

    // DEV ONLY: force a pundit line (goal/card/swing/result-win/result-loss) over the
    // WS for a fixture (all open picks) or a single wallet, without waiting on a real
    // live event. This is the reliability check for SAH-53: it exercises the exact
    // same generate()/bus.emit() path a real trigger uses, so a 200 here proves the
    // template-fallback-or-LLM line genuinely reaches the WS gateway.
    const PUNDIT_KINDS: Kind[] = ['goal', 'card', 'swing', 'result-win', 'result-loss'];
    app.post('/api/dev/pundit/:fixtureId', async (c) => {
      if (config.devResolveToken && c.req.header('X-Dev-Token') !== config.devResolveToken) {
        return c.json({ error: 'forbidden' }, 403);
      }
      const fixtureId = Number(c.req.param('fixtureId'));
      if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
        return c.json({ error: 'invalid fixture id' }, 400);
      }
      const body = await c.req.json().catch(() => ({}));
      const kind = body.kind as Kind;
      if (!PUNDIT_KINDS.includes(kind)) {
        return c.json({ error: `kind must be one of ${PUNDIT_KINDS.join('|')}` }, 400);
      }
      const wallet = typeof body.wallet === 'string' ? body.wallet : undefined;
      if (wallet) {
        await fireForWallet(fixtureId, wallet, kind);
      } else {
        await fireForFixture(fixtureId, kind);
      }
      return c.json({ ok: true, mode: punditMode(), fixtureId, kind, wallet: wallet ?? 'all-open-picks' });
    });
  }
}
