// Ingestion: pull TxLINE fixtures, seed odds snapshots, then keep odds + scores fresh
// from the live SSE streams. Everything normalizes into Postgres and publishes to the bus.

import { marketKey, starManDisplayName, type OddsPayload, type ScoreEvent } from '@touchline/shared';
import { and, eq, lte } from 'drizzle-orm';
import { TxLineClient } from './txline/client.ts';
import { db } from './db/client.ts';
import { fixtures, oddsLatest, scoreState, scoreEvents, lineups } from './db/schema.ts';
import { bus } from './bus.ts';
import { isFinished, resolveFixture } from './resolve.ts';

const now = () => Date.now();

// Which soccer actions we persist to the append-only score_events log (pundit triggers +
// audit). The live wire emits a top-level Action on EVERY frame — including possession/
// comment/coverage noise — so we log only genuine match incidents to keep the log lean.
const LOGGED_ACTIONS = new Set([
  'goal',
  'own_goal',
  'yellow_card',
  'red_card',
  'second_yellow_card',
  'penalty',
  'penalty_goal',
  'penalty_missed',
  'penalty_saved',
  'penalty_outcome',
  'penalty_shootout_team',
  'substitution',
  'var',
]);

/** Fetch the World Cup fixtures snapshot and upsert them. */
export async function syncFixtures(client: TxLineClient, competitionId: number): Promise<number> {
  const list = await client.getFixtures(competitionId);
  for (const f of list) {
    await db
      .insert(fixtures)
      .values({
        fixtureId: f.FixtureId,
        competitionId: f.CompetitionId,
        competition: f.Competition,
        startTime: f.StartTime,
        fixtureGroupId: f.FixtureGroupId,
        participant1Id: f.Participant1Id,
        participant1: f.Participant1,
        participant2Id: f.Participant2Id,
        participant2: f.Participant2,
        participant1IsHome: f.Participant1IsHome,
        ts: f.Ts,
        updatedAt: now(),
      })
      .onConflictDoUpdate({
        target: fixtures.fixtureId,
        set: {
          competition: f.Competition,
          startTime: f.StartTime,
          participant1: f.Participant1,
          participant2: f.Participant2,
          ts: f.Ts,
          updatedAt: now(),
        },
      });
  }
  bus.emit('fixtures', { count: list.length });
  return list.length;
}

async function upsertOdds(o: OddsPayload): Promise<void> {
  await db
    .insert(oddsLatest)
    .values({
      fixtureId: o.FixtureId,
      marketKey: marketKey(o),
      superOddsType: o.SuperOddsType,
      marketParameters: o.MarketParameters ?? null,
      marketPeriod: o.MarketPeriod ?? null,
      bookmakerId: o.BookmakerId,
      inRunning: o.InRunning,
      priceNames: o.PriceNames ?? null,
      prices: o.Prices ?? null,
      pct: o.Pct ?? null,
      messageId: o.MessageId,
      ts: o.Ts,
      updatedAt: now(),
    })
    .onConflictDoUpdate({
      target: [oddsLatest.fixtureId, oddsLatest.marketKey],
      set: {
        inRunning: o.InRunning,
        priceNames: o.PriceNames ?? null,
        prices: o.Prices ?? null,
        pct: o.Pct ?? null,
        messageId: o.MessageId,
        ts: o.Ts,
        updatedAt: now(),
      },
    });
}

/** Seed the latest odds for each known fixture via snapshot (so the API has data immediately). */
export async function seedOdds(client: TxLineClient, fixtureIds: number[]): Promise<number> {
  let count = 0;
  for (const id of fixtureIds) {
    try {
      const snap = await client.getOddsSnapshot(id);
      for (const o of snap) {
        await upsertOdds(o);
        count++;
      }
    } catch {
      /* fixture may have no odds yet */
    }
  }
  return count;
}

/**
 * Apply ONE normalized score event to score_state + score_events, then settle the fixture
 * if it just finished. Pure DB writer — it does NOT touch the bus, so backfill/re-poll can
 * replay history without re-firing the live pundit (only runScoresStream emits 'score').
 *
 * score_state is last-write-wins, hardened two ways so out-of-order / status-less frames
 * (the live wire interleaves comment/possession/disconnected frames, and the terminal
 * `game_finalised` frame carries the final score but no StatusId) can't corrupt it:
 *  - ts guard: the upsert only overwrites when the incoming ts >= the stored ts (stale
 *    frames from a re-poll or reconnection are ignored).
 *  - status only changes on frames that actually carry a status code; a status-less frame
 *    updates the score/clock but never downgrades a known status (so the trailing
 *    `disconnected` frame can't revert a finished match to scheduled).
 */
// Serialize applyScore per fixture. The live SSE stream (runScoresStream) and the 60s
// backfill re-poll (startScoresBackfill) both call applyScore, and can be in flight for the
// same fixture at once. The (fixtureId, seq) score_events dedupe below is a check-then-insert
// with no unique constraint, so two concurrent calls for the same new seq could both read
// empty and double-insert. Chaining per-fixture makes each apply atomic w.r.t. the others.
// Single-worker only (in-process hot state, per the architecture) — revisit if we scale out.
const applyLocks = new Map<number, Promise<unknown>>();

// Exported for functional tests (drive real ingestion of lineups + score events); the
// live paths (runScoresStream/seedScores) call it internally.
export async function applyScore(ev: ScoreEvent): Promise<void> {
  const prev = applyLocks.get(ev.fixtureId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => applyScoreInner(ev));
  applyLocks.set(ev.fixtureId, next);
  try {
    await next;
  } finally {
    // Drop the lock only if no newer apply for this fixture chained on behind us.
    if (applyLocks.get(ev.fixtureId) === next) applyLocks.delete(ev.fixtureId);
  }
}

/**
 * Persist a `lineups` action event's official squads into the lineups table (Star Man).
 * One row per player, keyed on (fixtureId, player.normativeId) — the SAME id later goal/card
 * score events carry. Idempotent + last-write-wins: rosters publish ~30-45 min pre-kickoff
 * and can be re-sent amended, so a re-send simply overwrites (starter/number/name can change).
 */
async function upsertLineups(ev: ScoreEvent): Promise<void> {
  const ts = now();
  for (const team of ev.lineups ?? []) {
    const teamId = team.normativeId;
    const teamName = team.preferredName ?? '';
    for (const entry of team.lineups ?? []) {
      const playerId = entry.player.normativeId;
      const name = starManDisplayName(entry.player.preferredName);
      const rosterNumber = entry.rosterNumber != null ? String(entry.rosterNumber) : null;
      const starter = entry.starter ?? false;
      await db
        .insert(lineups)
        .values({ fixtureId: ev.fixtureId, playerId, name, rosterNumber, teamId, team: teamName, starter, ts: ev.ts, updatedAt: ts })
        .onConflictDoUpdate({
          target: [lineups.fixtureId, lineups.playerId],
          set: { name, rosterNumber, teamId, team: teamName, starter, ts: ev.ts, updatedAt: ts },
        });
    }
  }
}

async function applyScoreInner(ev: ScoreEvent): Promise<void> {
  const ts = now();
  const clock = ev.clock ?? null;

  // Star Man: a `lineups` frame carries the official squads, not a score/status change.
  // Persist the roster (idempotent) and return — there is nothing to apply to score_state.
  if (ev.action === 'lineups' && ev.lineups && ev.lineups.length > 0) {
    await upsertLineups(ev);
    return;
  }

  // Columns updated on EVERY (non-stale) frame.
  const set: Record<string, unknown> = { ts: ev.ts, updatedAt: ts };
  if (ev.scoreSoccer !== undefined) set.scoreSoccer = ev.scoreSoccer;
  if (ev.clock !== undefined) set.clock = clock;
  if (ev.coverageSecondaryData != null) set.coverageSecondaryData = ev.coverageSecondaryData;
  // Status/gameState change ONLY when this frame carries a mapped status code.
  if (ev.statusSoccerId != null) {
    set.statusSoccerId = ev.statusSoccerId;
    set.gameState = ev.gameState ?? null;
  }

  await db
    .insert(scoreState)
    .values({
      fixtureId: ev.fixtureId,
      gameState: ev.gameState ?? null,
      statusSoccerId: ev.statusSoccerId ?? null,
      scoreSoccer: ev.scoreSoccer ?? null,
      clock,
      coverageSecondaryData: ev.coverageSecondaryData ?? null,
      ts: ev.ts,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: scoreState.fixtureId,
      set,
      // Skip stale updates: only overwrite when the stored ts is not newer than the incoming one.
      where: lte(scoreState.ts, ev.ts),
    });

  // Append-only action log — deduped on (fixtureId, seq). score_events has no unique
  // constraint there, so this check-then-insert relies on applyScore being serialized
  // per fixture (see applyLocks above) to stay atomic: backfill + stream (or a stream
  // reconnection) can't double-log an action (which would double the audit trail).
  if (ev.action && LOGGED_ACTIONS.has(ev.action)) {
    const existing = await db
      .select({ id: scoreEvents.id })
      .from(scoreEvents)
      .where(and(eq(scoreEvents.fixtureId, ev.fixtureId), eq(scoreEvents.seq, ev.seq)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(scoreEvents).values({
        fixtureId: ev.fixtureId,
        seq: ev.seq,
        action: ev.action,
        dataSoccer: ev.dataSoccer ?? null,
        ts: ev.ts,
      });
    }
  }

  // When a match finishes, settle its open picks (idempotent). Log failures instead of
  // swallowing them — a silent resolution failure would strand picks unsettled.
  if (isFinished({ statusSoccerId: ev.statusSoccerId ?? null, gameState: ev.gameState ?? null })) {
    try {
      const summary = await resolveFixture(ev.fixtureId);
      if (summary && summary.resolved > 0) {
        console.log(
          `[touchline-worker] resolved fixture ${ev.fixtureId}: ${summary.resolved} picks, ${summary.wins} wins`,
        );
      }
    } catch (e) {
      console.error(`[touchline-worker] failed to resolve fixture ${ev.fixtureId}`, e);
    }
  }
}

// Pre-kickoff coverage window: TxLINE opens coverage (venue/warm-ups/LINEUPS) well before
// kickoff, and lineups can publish any time in the last hour. Poll inside this window too,
// so Star Man rosters land the moment TxLINE has them even if the SSE stream missed the frame.
const PRE_KICKOFF_POLL_MS = 3 * 60 * 60 * 1000;

/**
 * Fixture ids the snapshot backfill / re-poll should refresh: kicked off but unfinished,
 * PLUS fixtures starting within the pre-kickoff coverage window (for lineups).
 */
async function startedUnfinishedFixtureIds(): Promise<number[]> {
  const started = await db
    .select({ id: fixtures.fixtureId })
    .from(fixtures)
    .where(lte(fixtures.startTime, now() + PRE_KICKOFF_POLL_MS));
  if (started.length === 0) return [];
  const states = await db
    .select({ id: scoreState.fixtureId, statusSoccerId: scoreState.statusSoccerId, gameState: scoreState.gameState })
    .from(scoreState);
  const finished = new Set(
    states.filter((s) => isFinished({ statusSoccerId: s.statusSoccerId, gameState: s.gameState })).map((s) => s.id),
  );
  return started.map((f) => f.id).filter((id) => !finished.has(id));
}

/**
 * Seed score state from the per-fixture scores snapshot — the SSE safety net. Mirrors
 * seedOdds. Events are applied in ascending Seq order (the ts guard + seq-dedup make this
 * idempotent), so a fixture that kicked off / finished while the worker was down is caught
 * up and settled without the live stream. Does NOT emit to the bus (no stale pundit lines).
 */
export async function seedScores(client: TxLineClient, fixtureIds: number[]): Promise<number> {
  let count = 0;
  for (const id of fixtureIds) {
    try {
      const events = await client.getScoresSnapshot(id);
      events.sort((a, b) => a.seq - b.seq);
      for (const ev of events) {
        await applyScore(ev);
        count++;
      }
    } catch {
      /* fixture may have no scores yet */
    }
  }
  return count;
}

/** Boot-time convenience: seed scores for every kicked-off, unfinished fixture. */
export async function seedStartedScores(client: TxLineClient): Promise<number> {
  return seedScores(client, await startedUnfinishedFixtureIds());
}

/**
 * Periodic scores re-poll (default every 60s) for started-but-unfinished fixtures, so any
 * SSE frame missed during a disconnect self-heals from the snapshot. Same shape as the
 * closing sweep: setInterval + try/catch + in-flight guard so a slow pass can't overlap
 * itself and a bad pass can't crash the worker. Returns a stop function.
 */
export function startScoresBackfill(client: TxLineClient, intervalMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const ids = await startedUnfinishedFixtureIds();
      if (ids.length > 0) await seedScores(client, ids);
    } catch (e) {
      console.error('[touchline-worker] scores re-poll failed', e);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => void tick(), intervalMs);
  console.log(`[touchline-worker] scores re-poll running (every ${Math.round(intervalMs / 1000)}s).`);
  return () => clearInterval(handle);
}

/** Long-running: consume the live odds SSE stream into the DB + bus. */
export async function runOddsStream(client: TxLineClient, signal: AbortSignal): Promise<void> {
  for await (const o of client.streamOdds({ signal })) {
    await upsertOdds(o);
    bus.emit('odds', o);
  }
}

/** Long-running: consume the live scores SSE stream into the DB + bus. */
export async function runScoresStream(client: TxLineClient, signal: AbortSignal): Promise<void> {
  for await (const ev of client.streamScores({ signal })) {
    await applyScore(ev);
    bus.emit('score', ev);
  }
}
