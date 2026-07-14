// Full-tournament bracket/pool (SAH-58): stage lookups, the team catalog for the
// champion picker, and champion/runner-up resolution. Additive to the per-match
// pick loop in resolve.ts — nothing here touches picks unless a stage is explicitly
// assigned to a fixture.

import { eq, asc } from 'drizzle-orm';
import {
  DEFAULT_TOURNAMENT_ID,
  DEFAULT_STAGE_ID,
  WORLD_CUP_COMPETITION_ID,
  scoreBracket,
} from '@touchline/shared';
import { db } from './db/client.ts';
import { fixtures, fixtureStages, tournamentStages, bracketPicks, users } from './db/schema.ts';
import { bus } from './bus.ts';
import { levelForXp } from '@touchline/shared';

/**
 * The stage id a fixture is mapped to, defaulting to 'group' when unmapped.
 *
 * WC gate: stage multipliers are a World Cup-only feature. A non-72 fixture (friendly,
 * season league) — or an unknown fixture — always returns DEFAULT_STAGE_ID (flat 1x),
 * so it can never earn a knockout multiplier even if a stray fixture_stages row existed.
 */
export async function getStageIdForFixture(fixtureId: number): Promise<string> {
  const [fixture] = await db
    .select({ competitionId: fixtures.competitionId })
    .from(fixtures)
    .where(eq(fixtures.fixtureId, fixtureId));
  if (!fixture || fixture.competitionId !== WORLD_CUP_COMPETITION_ID) {
    return DEFAULT_STAGE_ID;
  }
  const [row] = await db.select().from(fixtureStages).where(eq(fixtureStages.fixtureId, fixtureId));
  return row?.stageId ?? DEFAULT_STAGE_ID;
}

/** All stages with their multiplier, ordered group → final. */
export async function listStages() {
  return db.select().from(tournamentStages).orderBy(asc(tournamentStages.order));
}

/** Assign (or reassign) a fixture to a stage. Used by the dev/admin bracket-builder route. */
export async function assignFixtureStage(fixtureId: number, stageId: string): Promise<void> {
  await db
    .insert(fixtureStages)
    .values({ fixtureId, stageId, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: fixtureStages.fixtureId, set: { stageId, updatedAt: Date.now() } });
}

/**
 * Distinct teams seen across ingested WORLD CUP fixtures — powers the champion/runner-up
 * picker. WC gate: scoped to competitionId 72 so friendly/season teams never pollute the
 * champion picker.
 */
export async function listTeams(): Promise<{ id: number; name: string }[]> {
  const rows = await db.select().from(fixtures).where(eq(fixtures.competitionId, WORLD_CUP_COMPETITION_ID));
  const map = new Map<number, string>();
  for (const f of rows) {
    map.set(f.participant1Id, f.participant1);
    map.set(f.participant2Id, f.participant2);
  }
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Tournament-wide bracket lock: the kickoff of the earliest ingested WORLD CUP fixture.
 * Once any WC match has kicked off, season-long champion/runner-up picks close (they're a
 * pre-tournament call, not a per-match one). WC gate: scoped to competitionId 72 so an
 * earlier friendly kickoff never locks the World Cup bracket.
 */
export async function bracketLockAt(): Promise<number | null> {
  const [first] = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.competitionId, WORLD_CUP_COMPETITION_ID))
    .orderBy(asc(fixtures.startTime))
    .limit(1);
  return first?.startTime ?? null;
}

/**
 * Resolve every open bracket pick against the final result. Idempotent: only
 * touches picks still 'open'. Mirrors resolve.ts's resolvePicks shape/semantics.
 */
export async function resolveBracket(
  championId: number,
  championName: string,
  runnerUpId?: number | null,
  runnerUpName?: string | null,
): Promise<{ resolved: number; wins: number }> {
  const open = await db
    .select()
    .from(bracketPicks)
    .where(eq(bracketPicks.tournamentId, DEFAULT_TOURNAMENT_ID));
  const stillOpen = open.filter((p) => p.status === 'open');

  let wins = 0;
  for (const p of stillOpen) {
    const points = scoreBracket(
      { championId: p.championId, runnerUpId: p.runnerUpId },
      { championId, runnerUpId: runnerUpId ?? null },
    );
    const ts = Date.now();
    await db
      .update(bracketPicks)
      .set({ status: 'resolved', points, resolvedAt: ts })
      .where(eq(bracketPicks.wallet, p.wallet));

    if (points > 0) {
      const [u] = await db.select().from(users).where(eq(users.wallet, p.wallet));
      if (u) {
        const xp = u.xp + points;
        await db.update(users).set({ xp, level: levelForXp(xp), updatedAt: ts }).where(eq(users.wallet, p.wallet));
      }
      wins++;
    }
    bus.emit('bracketResolved', { wallet: p.wallet, championId, correct: points > 0, points });
  }
  return { resolved: stillOpen.length, wins };
}
