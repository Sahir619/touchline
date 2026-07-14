// Match Replay engine (Phase 1). Re-streams a FINISHED fixture's REAL recorded score
// events through a per-socket channel at a configurable speed multiplier, so judges (and
// signed-in users) can relive a real match after the tournament ends.
//
// ISOLATION IS BY CONSTRUCTION (the phase's correctness centerpiece):
//  - This module imports ONLY `db` + schema tables for SELECTs, plus `decimalOdds`. It has
//    NO writer in scope: no applyScore / resolveFixture / resolvePicks / stampClosingLines,
//    no bus, no pundit / punditHistory. It therefore CANNOT write a real-fixture row, settle
//    a real pick, mint a trophy, or pollute real pundit history.
//  - A ReplaySession emits ONLY to the per-socket callback handed to its constructor. Frames
//    never touch the global bus, so no other client and no real-fixture consumer can see them.
// Task 3's functional test proves all of the above.
//
// Design note (odds): finished WC fixtures have NO captured odds history (odds_latest keeps
// only the latest snapshot), so we do NOT synthesize movement. The replay carries the REAL
// recorded score events and exposes the single stored 1X2 snapshot ONCE, in the init frame,
// explicitly labelled a non-live reference snapshot. The pundit reacts to replayed
// goals/cards only (template lines, no LLM), never to odds swings (there are none).

import { and, asc, eq } from 'drizzle-orm';
import { db } from './db/client.ts';
import { fixtures, scoreState, scoreEvents, oddsLatest, lineups } from './db/schema.ts';
import { decimalOdds } from '@touchline/shared';

// --------------------------------------------------------------------------
// Replay frame protocol (exported; Plan 03's web hook mirrors this union).
// WS envelope (server->client): { type:'replay', payload: ReplayFrame }.
// --------------------------------------------------------------------------

export type ReplayIncident = 'goal' | 'own_goal' | 'card' | 'var' | 'sub';

export type ReplayFrame =
  | {
      kind: 'init';
      fixtureId: number;
      participant1: string;
      participant2: string;
      competition: string;
      speed: number;
      refOdds: { label: '1' | 'X' | '2'; price: number }[] | null; // static snapshot, decimal
      refOddsNote: 'snapshot';
      totalIncidents: number;
    }
  | {
      kind: 'tick';
      seq: number;
      minute: number | null;
      p1: number;
      p2: number;
      statusLabel: string;
      incident: ReplayIncident;
      side: 1 | 2 | null;
      player: string | null;
      line: string; // template pundit line
    }
  | { kind: 'clock'; minute: number | null; p1: number; p2: number; statusLabel: string } // liveness heartbeat
  | { kind: 'end'; p1: number; p2: number; finalStatus: string }; // 'Full time' | 'after extra time' | 'on penalties'

// Hard wall-clock cap so even a long ET + penalties replay terminates, and one session can
// never run forever (frees timers regardless of the speed multiplier).
const MAX_REPLAY_MS = 8 * 60_000;

const DEFAULT_SPEED = 20;
const MIN_SPEED = 1;
const MAX_SPEED = 20_000;

// Finish rule, inlined so replay.ts NEVER imports resolve.ts. Kept in lockstep with
// resolve.ts isFinished (including the '5' gameState) so the catalog and resolution agree
// on what "finished" means.
const FINISHED_STATUS = new Set(['F', 'FET', 'FPE']);
function isFinishedState(state: { statusSoccerId: string | null; gameState: string | null }): boolean {
  if (state.statusSoccerId && FINISHED_STATUS.has(state.statusSoccerId)) return true;
  const g = (state.gameState ?? '').toLowerCase();
  return g === 'finished' || g === 'ended' || g === 'fulltime' || g === 'ft' || g === '5';
}

// Narrow view of the fields we read from a stored score's jsonb blob (90-min Total goals).
interface ScoreBlob {
  Participant1?: { Total?: { Goals?: number } };
  Participant2?: { Total?: { Goals?: number } };
}
function goalsFromScore(scoreSoccer: unknown): { p1: number; p2: number } {
  const s = (scoreSoccer as ScoreBlob | null) ?? null;
  const p1 = s?.Participant1?.Total?.Goals ?? 0;
  const p2 = s?.Participant2?.Total?.Goals ?? 0;
  return { p1, p2 };
}

// The authoritative end-of-match label, derived from the terminal soccer status code.
// Derive the finish label from the recorded score PERIODS, not the stored status code:
// terminal StatusId 100 was observed on both pens and plain 90-minute finishes, so rows
// ingested before the shared-schema fix can carry a stale FPE. Periods never lie.
function finalStatusLabel(statusSoccerId: string | null, score?: unknown): string {
  const sc = score as
    | { Participant1?: Record<string, unknown>; Participant2?: Record<string, unknown> }
    | null
    | undefined;
  if (sc) {
    const has = (k: string) => sc.Participant1?.[k] != null || sc.Participant2?.[k] != null;
    if (has('PE')) return 'on penalties';
    if (has('ET1') || has('ET2') || has('ETTotal')) return 'after extra time';
    return 'Full time';
  }
  if (statusSoccerId === 'FET') return 'after extra time';
  if (statusSoccerId === 'FPE') return 'on penalties';
  return 'Full time'; // F (and any other finished state) reads as a normal-time finish
}

// Coarse period label from a minute. Period frames are NOT in score_events, so this is
// approximate by design (the UI is badged Replay). No betting vocabulary, no em dashes.
function statusLabelForMinute(minute: number | null): string {
  if (minute == null) return '1st half';
  if (minute <= 45) return '1st half';
  if (minute <= 90) return '2nd half';
  return 'extra time';
}

// Narrow view of the fields we read from a score event's dataSoccer jsonb blob.
interface DataBlob {
  Minutes?: number;
  Participant?: number;
  PlayerId?: number;
  GoalType?: string;
}

// A small, self-contained template set (goal / card only, no LLM, no persona). Never uses
// betting vocabulary, never an em dash.
function punditLine(incident: ReplayIncident, minute: number | null, player: string | null, action: string): string {
  const m = minute != null ? `${minute}' ` : '';
  switch (incident) {
    case 'goal':
      return player ? `${m}GOAL. ${player} finds the net.` : `${m}GOAL.`;
    case 'own_goal':
      return player ? `${m}Own goal off ${player}.` : `${m}Own goal.`;
    case 'card': {
      const sentOff = action === 'red_card' || action === 'second_yellow_card';
      if (sentOff) return player ? `${m}${player} is sent off.` : `${m}Red card.`;
      return player ? `${m}${player} goes into the book.` : `${m}Into the book.`;
    }
    case 'var':
      return `${m}VAR check under way.`;
    case 'sub':
      return player ? `${m}Change made: ${player} on.` : `${m}Substitution.`;
  }
}

// --------------------------------------------------------------------------
// Catalog + loader (read-only)
// --------------------------------------------------------------------------

export interface ReplayableFixture {
  fixtureId: number;
  participant1: string;
  participant2: string;
  competition: string;
  p1: number;
  p2: number;
  finalStatus: string;
}

/** Finished fixtures that have a recorded event history — the replay catalog. */
export async function listReplayableFixtures(): Promise<ReplayableFixture[]> {
  const states = await db.select().from(scoreState);
  const finished = states.filter((s) => isFinishedState({ statusSoccerId: s.statusSoccerId, gameState: s.gameState }));
  if (finished.length === 0) return [];

  // Fixtures that actually have a recorded incident log (empty logs are not replayable).
  const evRows = await db.select({ fixtureId: scoreEvents.fixtureId }).from(scoreEvents);
  const withEvents = new Set<number>(evRows.map((r) => r.fixtureId));
  if (withEvents.size === 0) return [];

  const fxRows = await db.select().from(fixtures);
  const fxById = new Map(fxRows.map((f) => [f.fixtureId, f]));

  const out: ReplayableFixture[] = [];
  for (const s of finished) {
    if (!withEvents.has(s.fixtureId)) continue;
    const fx = fxById.get(s.fixtureId);
    if (!fx) continue;
    const { p1, p2 } = goalsFromScore(s.scoreSoccer);
    out.push({
      fixtureId: s.fixtureId,
      participant1: fx.participant1,
      participant2: fx.participant2,
      competition: fx.competition,
      p1,
      p2,
      finalStatus: finalStatusLabel(s.statusSoccerId, s.scoreSoccer),
    });
  }
  // Most recent first (startTime desc).
  out.sort((a, b) => (fxById.get(b.fixtureId)?.startTime ?? 0) - (fxById.get(a.fixtureId)?.startTime ?? 0));
  return out;
}

export interface ReplayData {
  participant1: string;
  participant2: string;
  competition: string;
  finalP1: number;
  finalP2: number;
  finalStatus: string;
  events: { seq: number; action: string; ts: number; dataSoccer: DataBlob }[];
  players: Map<number, string>;
  /** playerId -> 1|2 via lineups.teamId; stored goal events carry NO Participant field,
   *  so scorer attribution comes from the roster (teamId == fixture participant ids). */
  sideByPlayer: Map<number, 1 | 2>;
  refOdds: { label: '1' | 'X' | '2'; price: number }[] | null;
}

/** Read everything a replay needs for one fixture. Null if unknown or has no events. */
export async function loadReplayData(fixtureId: number): Promise<ReplayData | null> {
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.fixtureId, fixtureId));
  if (!fixture) return null;
  const [state] = await db.select().from(scoreState).where(eq(scoreState.fixtureId, fixtureId));
  if (!state) return null;

  const evRows = await db
    .select()
    .from(scoreEvents)
    .where(eq(scoreEvents.fixtureId, fixtureId))
    .orderBy(asc(scoreEvents.seq));
  if (evRows.length === 0) return null;

  const lineupRows = await db.select().from(lineups).where(eq(lineups.fixtureId, fixtureId));
  const players = new Map<number, string>();
  const sideByPlayer = new Map<number, 1 | 2>();
  for (const l of lineupRows) {
    players.set(l.playerId, l.name);
    if (l.teamId === fixture.participant1Id) sideByPlayer.set(l.playerId, 1);
    else if (l.teamId === fixture.participant2Id) sideByPlayer.set(l.playerId, 2);
  }

  // Static reference 1X2 snapshot (decimal odds), exposed ONCE in the init frame.
  const [odds] = await db
    .select()
    .from(oddsLatest)
    .where(and(eq(oddsLatest.fixtureId, fixtureId), eq(oddsLatest.superOddsType, '1X2_PARTICIPANT_RESULT')));
  let refOdds: { label: '1' | 'X' | '2'; price: number }[] | null = null;
  const prices = odds?.prices;
  if (prices && prices.length > 0) {
    const labels: ('1' | 'X' | '2')[] = ['1', 'X', '2'];
    const mapped: { label: '1' | 'X' | '2'; price: number }[] = [];
    for (let i = 0; i < prices.length && i < 3; i++) {
      mapped.push({ label: labels[i]!, price: decimalOdds(prices[i]!) });
    }
    refOdds = mapped.length > 0 ? mapped : null;
  }

  const { p1, p2 } = goalsFromScore(state.scoreSoccer);

  return {
    participant1: fixture.participant1,
    participant2: fixture.participant2,
    competition: fixture.competition,
    finalP1: p1,
    finalP2: p2,
    finalStatus: finalStatusLabel(state.statusSoccerId, state.scoreSoccer),
    events: evRows.map((e) => ({
      seq: e.seq,
      action: e.action,
      ts: e.ts,
      dataSoccer: ((e.dataSoccer as DataBlob | null) ?? {}) as DataBlob,
    })),
    players,
    sideByPlayer,
    refOdds,
  };
}

// --------------------------------------------------------------------------
// ReplaySession — schedules a finished fixture's incidents onto a per-socket emit callback.
// --------------------------------------------------------------------------

interface ScheduledTick {
  at: number;
  frame: Extract<ReplayFrame, { kind: 'tick' }>;
}

export class ReplaySession {
  private readonly fixtureId: number;
  private readonly emit: (f: ReplayFrame) => void;
  private readonly speed: number;

  private done = false;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  // Running scoreline as incidents fire (fed to the clock heartbeat for liveness).
  private curP1 = 0;
  private curP2 = 0;
  private interpMinute = 0;

  // Authoritative final, filled once data loads.
  private finalP1 = 0;
  private finalP2 = 0;
  private finalStatus = 'Full time';

  constructor(fixtureId: number, emit: (f: ReplayFrame) => void, opts?: { speed?: number }) {
    this.fixtureId = fixtureId;
    this.emit = emit;
    const requested = opts?.speed ?? DEFAULT_SPEED;
    this.speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number.isFinite(requested) ? requested : DEFAULT_SPEED));
  }

  async start(): Promise<void> {
    if (this.done) return;
    const data = await loadReplayData(this.fixtureId);
    // Guard: unknown fixture or no recorded events -> emit nothing, mark done.
    if (!data) {
      this.done = true;
      return;
    }
    // stop() may have been called while the async load was in flight.
    if (this.done) return;

    this.finalP1 = data.finalP1;
    this.finalP2 = data.finalP2;
    this.finalStatus = data.finalStatus;

    this.emit({
      kind: 'init',
      fixtureId: this.fixtureId,
      participant1: data.participant1,
      participant2: data.participant2,
      competition: data.competition,
      speed: this.speed,
      refOdds: data.refOdds,
      refOddsNote: 'snapshot',
      totalIncidents: data.events.length,
    });

    const firstTs = data.events[0]!.ts;
    let p1 = 0;
    let p2 = 0;
    const scheduled: ScheduledTick[] = [];

    for (const ev of data.events) {
      const d = ev.dataSoccer;
      const action = ev.action;
      const evPlayerId = typeof d.PlayerId === 'number' ? d.PlayerId : null;
      // Stored goal events carry no Participant; attribute the side via the scorer's roster
      // entry (lineups.teamId). Explicit Participant, when present, still wins.
      const part: 1 | 2 | null =
        d.Participant === 1 ? 1 : d.Participant === 2 ? 2 : (evPlayerId != null ? (data.sideByPlayer.get(evPlayerId) ?? null) : null);
      const goalType = typeof d.GoalType === 'string' ? d.GoalType : undefined;

      let incident: ReplayIncident | null = null;
      let side: 1 | 2 | null = null;

      if ((action === 'goal' || action === 'penalty_goal') && goalType !== 'Own') {
        incident = 'goal';
        side = part;
        if (part === 1) p1++;
        else if (part === 2) p2++;
      } else if (action === 'own_goal' || ((action === 'goal' || action === 'penalty_goal') && goalType === 'Own')) {
        // An own goal credits the OPPONENT of the crediting participant.
        incident = 'own_goal';
        const opp: 1 | 2 | null = part === 1 ? 2 : part === 2 ? 1 : null;
        side = opp;
        if (opp === 1) p1++;
        else if (opp === 2) p2++;
      } else if (action === 'yellow_card' || action === 'red_card' || action === 'second_yellow_card') {
        incident = 'card';
        side = part;
      } else if (action === 'var') {
        incident = 'var';
        side = part;
      } else if (action === 'substitution') {
        incident = 'sub';
        side = part;
      } else {
        // penalty_missed / penalty_saved / penalty_outcome / shootout frames etc. advance no
        // score and produce no tick (the authoritative end frame carries the true final).
        continue;
      }

      // Use the event's real Minutes when recorded; otherwise show NO minute rather than a
      // wall-clock guess (the log can start mid-match, which made a 44' goal read as 0').
      const minute = typeof d.Minutes === 'number' ? d.Minutes : null;
      // Coarse phase label may still use the wall-clock estimate (it is approximate by
      // design and only picks 1st half / 2nd half / extra time, never a printed minute).
      const phaseMinute = minute ?? Math.max(0, Math.floor((ev.ts - firstTs) / 60_000));
      const player = evPlayerId != null ? (data.players.get(evPlayerId) ?? null) : null;
      const at = Math.min((ev.ts - firstTs) / this.speed, MAX_REPLAY_MS);

      scheduled.push({
        at,
        frame: {
          kind: 'tick',
          seq: ev.seq,
          minute,
          p1,
          p2,
          statusLabel: statusLabelForMinute(phaseMinute),
          incident,
          side,
          player,
          line: punditLine(incident, minute, player, action),
        },
      });
    }

    // ~1s liveness heartbeat: advances the interpolated minute and echoes the running score.
    this.clockTimer = setInterval(() => {
      if (this.done) return;
      this.interpMinute += 1;
      this.emit({
        kind: 'clock',
        minute: this.interpMinute,
        p1: this.curP1,
        p2: this.curP2,
        statusLabel: statusLabelForMinute(this.interpMinute),
      });
    }, 1000);

    for (const item of scheduled) {
      const t = setTimeout(() => {
        if (this.done) return;
        this.curP1 = item.frame.p1;
        this.curP2 = item.frame.p2;
        this.emit(item.frame);
      }, item.at);
      this.timers.push(t);
    }

    // Emit the authoritative end frame after the last incident (or at the hard cap, whichever
    // comes first). Both paths route through finish(), which is guarded to fire exactly once.
    const lastAt = scheduled.length > 0 ? scheduled[scheduled.length - 1]!.at : 0;
    const endAt = Math.min(lastAt + 50, MAX_REPLAY_MS);
    this.timers.push(setTimeout(() => this.finish(), endAt));
    this.timers.push(setTimeout(() => this.finish(), MAX_REPLAY_MS));
  }

  /** Stop all timers and go silent. Idempotent; emits nothing further. */
  stop(): void {
    this.done = true;
    this.clearTimers();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.clearTimers();
    this.emit({ kind: 'end', p1: this.finalP1, p2: this.finalP2, finalStatus: this.finalStatus });
  }

  private clearTimers(): void {
    if (this.clockTimer != null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
  }
}
