// Full-tournament bracket/pool (SAH-58): a one-time, season-long champion (+ runner-up)
// call, separate from and additive to the per-match pick'em loop. Stage weighting for
// existing per-match picks lives in resolve.ts/tournament.ts and needs no dedicated route.
import type { Hono } from 'hono';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { DEFAULT_TOURNAMENT_ID } from '@touchline/shared';
import { db } from '../db/client.ts';
import { bracketPicks, users, leagueMembers, leagues } from '../db/schema.ts';
import { type AppEnv, requireAuth } from '../auth.ts';
import { config } from '../config.ts';
import { listStages, listTeams, bracketLockAt, assignFixtureStage, resolveBracket } from '../tournament.ts';

export function registerBracketRoutes(app: Hono<AppEnv>): void {
  // Stage catalog (group..final) with each stage's point multiplier.
  app.get('/api/tournament/stages', async (c) => {
    const stages = await listStages();
    return c.json(stages);
  });

  // Distinct teams from ingested fixtures — powers the champion/runner-up picker.
  app.get('/api/tournament/teams', async (c) => {
    const teams = await listTeams();
    return c.json(teams);
  });

  // The caller's bracket pick + whether the pool is still open.
  app.get('/api/bracket', requireAuth, async (c) => {
    const wallet = c.get('wallet');
    const [pick] = await db
      .select()
      .from(bracketPicks)
      .where(and(eq(bracketPicks.wallet, wallet), eq(bracketPicks.tournamentId, DEFAULT_TOURNAMENT_ID)));
    const lockAt = await bracketLockAt();
    const locked = lockAt != null && Date.now() >= lockAt;
    return c.json({ pick: pick ?? null, lockAt, locked });
  });

  // Submit or update the caller's bracket pick. Editable up until the first kickoff.
  app.post('/api/bracket', requireAuth, async (c) => {
    const wallet = c.get('wallet');
    const body = await c.req.json().catch(() => ({}));
    const championId = Number(body.championId);
    const championName = typeof body.championName === 'string' ? body.championName.slice(0, 60) : '';
    const runnerUpId = body.runnerUpId != null ? Number(body.runnerUpId) : null;
    const runnerUpName = typeof body.runnerUpName === 'string' ? body.runnerUpName.slice(0, 60) : null;
    if (!Number.isInteger(championId) || championId <= 0 || !championName) {
      return c.json({ error: 'championId and championName are required' }, 400);
    }
    if (runnerUpId != null && runnerUpId === championId) {
      return c.json({ error: 'runnerUpId must differ from championId' }, 400);
    }

    const [existing] = await db
      .select()
      .from(bracketPicks)
      .where(and(eq(bracketPicks.wallet, wallet), eq(bracketPicks.tournamentId, DEFAULT_TOURNAMENT_ID)));
    if (existing && existing.status !== 'open') {
      return c.json({ error: 'bracket already resolved' }, 400);
    }

    const lockAt = await bracketLockAt();
    if (lockAt != null && Date.now() >= lockAt) {
      return c.json({ error: 'bracket pool is locked. The tournament has kicked off' }, 400);
    }

    const ts = Date.now();
    const values = {
      wallet,
      tournamentId: DEFAULT_TOURNAMENT_ID,
      championId,
      championName,
      runnerUpId,
      runnerUpName,
      status: 'open' as const,
      points: 0,
      lockedAt: ts,
    };
    await db
      .insert(bracketPicks)
      .values(values)
      .onConflictDoUpdate({
        target: [bracketPicks.wallet, bracketPicks.tournamentId],
        set: { championId, championName, runnerUpId, runnerUpName, lockedAt: ts },
      });

    return c.json({ pick: values });
  });

  // Pool overview: aggregate champion-pick counts across all wallets — "who's backing whom".
  app.get('/api/bracket/pool', async (c) => {
    const rows = await db
      .select({ championId: bracketPicks.championId, championName: bracketPicks.championName, n: sql<number>`count(*)` })
      .from(bracketPicks)
      .where(eq(bracketPicks.tournamentId, DEFAULT_TOURNAMENT_ID))
      .groupBy(bracketPicks.championId, bracketPicks.championName)
      .orderBy(sql`count(*) desc`);
    return c.json(rows.map((r) => ({ championId: r.championId, championName: r.championName, count: Number(r.n) })));
  });

  // Bracket standings scoped to a private league — extends the existing league leaderboard
  // with the persistent season-long bracket score, so pools stay visible after the per-match
  // XP board resets attention week to week.
  app.get('/api/leagues/:id/bracket', requireAuth, async (c) => {
    const id = c.req.param('id').toUpperCase();
    const [league] = await db.select().from(leagues).where(eq(leagues.id, id));
    if (!league) return c.json({ error: 'not found' }, 404);
    const members = await db.select().from(leagueMembers).where(eq(leagueMembers.leagueId, id));
    const wallets = members.map((m) => m.wallet);
    if (!wallets.length) return c.json({ league: { id: league.id, name: league.name }, board: [] });

    const picksRows = await db
      .select()
      .from(bracketPicks)
      .where(and(inArray(bracketPicks.wallet, wallets), eq(bracketPicks.tournamentId, DEFAULT_TOURNAMENT_ID)));
    const us = await db.select().from(users).where(inArray(users.wallet, wallets));
    const umap = new Map(us.map((u) => [u.wallet, u]));

    const board = picksRows
      .map((p) => ({
        wallet: p.wallet,
        displayName: umap.get(p.wallet)?.displayName ?? null,
        nation: umap.get(p.wallet)?.nation ?? null,
        championName: p.championName,
        runnerUpName: p.runnerUpName,
        status: p.status,
        bracketPoints: p.points,
      }))
      .sort((a, b) => b.bracketPoints - a.bracketPoints);
    return c.json({ league: { id: league.id, name: league.name }, board });
  });

  // --- Dev/admin only: manual bracket construction + resolution for a demo dataset that
  // has no real group/knockout metadata from the odds feed. ---
  if (config.enableDevRoutes) {
    // Assign a fixture to a stage (group|r16|qf|sf|final) so its picks score at that stage's multiplier.
    app.post('/api/dev/tournament/stage', async (c) => {
      if (config.devResolveToken && c.req.header('X-Dev-Token') !== config.devResolveToken) {
        return c.json({ error: 'forbidden' }, 403);
      }
      const body = await c.req.json().catch(() => ({}));
      const fixtureId = Number(body.fixtureId);
      const stageId = body.stageId;
      const stages = await listStages();
      if (!Number.isInteger(fixtureId) || fixtureId <= 0) return c.json({ error: 'invalid fixtureId' }, 400);
      if (!stages.some((s) => s.id === stageId)) {
        return c.json({ error: `stageId must be one of ${stages.map((s) => s.id).join('|')}` }, 400);
      }
      await assignFixtureStage(fixtureId, stageId);
      return c.json({ ok: true, fixtureId, stageId });
    });

    // Resolve the tournament champion (+ optional runner-up), grading every open bracket pick.
    app.post('/api/dev/tournament/resolve-champion', async (c) => {
      if (config.devResolveToken && c.req.header('X-Dev-Token') !== config.devResolveToken) {
        return c.json({ error: 'forbidden' }, 403);
      }
      const body = await c.req.json().catch(() => ({}));
      const championId = Number(body.championId);
      const championName = typeof body.championName === 'string' ? body.championName : '';
      const runnerUpId = body.runnerUpId != null ? Number(body.runnerUpId) : null;
      const runnerUpName = typeof body.runnerUpName === 'string' ? body.runnerUpName : null;
      if (!Number.isInteger(championId) || championId <= 0 || !championName) {
        return c.json({ error: 'championId and championName are required' }, 400);
      }
      const summary = await resolveBracket(championId, championName, runnerUpId, runnerUpName);
      return c.json(summary);
    });
  }
}
