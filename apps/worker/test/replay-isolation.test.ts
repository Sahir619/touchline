// Match Replay isolation — the phase's correctness centerpiece.
//
// Seeds a REAL finished fixture + a REAL open pick in an in-memory DB, runs a full
// ReplaySession to completion, and proves BY OBSERVATION that a replay:
//   - writes ZERO rows for the real fixture (score_events/odds_latest/fixtures unchanged,
//     score_state byte-identical),
//   - never resolves a real pick, mints a trophy, or moves xp/streak,
//   - never emits on the global bus or pollutes real pundit history,
//   - streams an ordered, accelerated frame stream ending on the true final score.
// Plus a static import-boundary assertion: replay.ts never imports bus/resolve/closing/pundit
// and contains no DB writes (isolation by construction, not just by observation).
//
// CRITICAL ordering: db/client.ts instantiates PGlite at import time, so env MUST be set
// BEFORE any worker import and every worker import is dynamic.

process.env.PGLITE_DATA_DIR = ':memory:';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ''; // force the embedded PGlite path regardless of .env

const assert = (await import('node:assert/strict')).default;
const { test } = await import('node:test');
const { readFileSync } = await import('node:fs');

const { initDb, db } = await import('../src/db/client.ts');
const schema = await import('../src/db/schema.ts');
const { ReplaySession, listReplayableFixtures } = await import('../src/replay.ts');
const { bus } = await import('../src/bus.ts');
const { startPunditHistory, getPunditHistory } = await import('../src/punditHistory.ts');

const FIXTURE_ID = 18179552; // Switzerland v Algeria 2-0 F (a real finished shape)
const WALLET = 'RealWallet1111111111111111111111111111111111';
const BASE_TS = 1_700_000_000_000;
const min = (m: number) => BASE_TS + m * 60_000;

test('replay isolation: zero real writes, zero resolution/mint, zero bus/pundit pollution, ordered accelerated stream', async () => {
  await initDb();
  startPunditHistory();

  // --- SEED a REAL fixture + a REAL open pick -----------------------------------------
  await db.insert(schema.fixtures).values({
    fixtureId: FIXTURE_ID,
    competitionId: 72,
    competition: 'World Cup',
    startTime: BASE_TS,
    fixtureGroupId: 1,
    participant1Id: 900,
    participant1: 'Switzerland',
    participant2Id: 901,
    participant2: 'Algeria',
    participant1IsHome: true,
    ts: BASE_TS,
    updatedAt: BASE_TS,
  });

  const finalScore = {
    Participant1: { Total: { Goals: 2 } },
    Participant2: { Total: { Goals: 0 } },
  };
  await db.insert(schema.scoreState).values({
    fixtureId: FIXTURE_ID,
    gameState: 'finished',
    statusSoccerId: 'F',
    scoreSoccer: finalScore,
    clock: { running: false, seconds: 5400 },
    coverageSecondaryData: true,
    ts: min(90),
    updatedAt: min(90),
  });

  // Two legit goals for participant 1 (seq 10, 20) + one yellow card (seq 15) → reconstructs 2-0.
  await db.insert(schema.scoreEvents).values([
    { fixtureId: FIXTURE_ID, seq: 10, action: 'goal', dataSoccer: { Participant: 1, PlayerId: 101, GoalType: 'Shot', Minutes: 23 }, ts: min(23) },
    { fixtureId: FIXTURE_ID, seq: 15, action: 'yellow_card', dataSoccer: { Participant: 2, PlayerId: 201, Minutes: 40 }, ts: min(40) },
    { fixtureId: FIXTURE_ID, seq: 20, action: 'goal', dataSoccer: { Participant: 1, PlayerId: 102, GoalType: 'Head', Minutes: 67 }, ts: min(67) },
  ]);

  await db.insert(schema.lineups).values([
    { fixtureId: FIXTURE_ID, playerId: 101, name: 'B. Embolo', rosterNumber: '7', teamId: 900, team: 'Switzerland', starter: true, ts: BASE_TS, updatedAt: BASE_TS },
    { fixtureId: FIXTURE_ID, playerId: 102, name: 'X. Shaqiri', rosterNumber: '10', teamId: 900, team: 'Switzerland', starter: true, ts: BASE_TS, updatedAt: BASE_TS },
    { fixtureId: FIXTURE_ID, playerId: 201, name: 'R. Mahrez', rosterNumber: '7', teamId: 901, team: 'Algeria', starter: true, ts: BASE_TS, updatedAt: BASE_TS },
  ]);

  await db.insert(schema.oddsLatest).values({
    fixtureId: FIXTURE_ID,
    marketKey: '1X2_PARTICIPANT_RESULT||',
    superOddsType: '1X2_PARTICIPANT_RESULT',
    bookmakerId: 1,
    inRunning: false,
    priceNames: ['1', 'X', '2'],
    prices: [1800, 3600, 4200],
    pct: ['52.632', '26.316', '21.053'],
    messageId: 'seed-1',
    ts: BASE_TS,
    updatedAt: BASE_TS,
  });

  await db.insert(schema.users).values({ wallet: WALLET, xp: 100, createdAt: BASE_TS, updatedAt: BASE_TS });
  await db.insert(schema.streaks).values({ wallet: WALLET, current: 3, longest: 3, updatedAt: BASE_TS });
  await db.insert(schema.picks).values({
    wallet: WALLET,
    fixtureId: FIXTURE_ID,
    market: '1X2_PARTICIPANT_RESULT',
    selection: 'part1',
    selectionLabel: '1',
    oddsAtLock: 1.8,
    status: 'open',
    points: 0,
    lockedAt: BASE_TS,
    resolvedAt: null,
  });

  // --- CAPTURE BEFORE -----------------------------------------------------------------
  const countRows = async (t: unknown): Promise<number> => (await db.select().from(t as never)).length;
  const before = {
    events: await countRows(schema.scoreEvents),
    odds: await countRows(schema.oddsLatest),
    fixtures: await countRows(schema.fixtures),
    trophies: await countRows(schema.trophies),
  };
  const { eq } = await import('drizzle-orm');
  const [stateBefore] = await db.select().from(schema.scoreState).where(eq(schema.scoreState.fixtureId, FIXTURE_ID));
  const stateTsBefore = stateBefore!.ts;
  const stateScoreBefore = JSON.stringify(stateBefore!.scoreSoccer);

  const [pickBefore] = await db.select().from(schema.picks).where(eq(schema.picks.fixtureId, FIXTURE_ID));
  const [userBefore] = await db.select().from(schema.users).where(eq(schema.users.wallet, WALLET));
  const [streakBefore] = await db.select().from(schema.streaks).where(eq(schema.streaks.wallet, WALLET));

  // Bus spy: replay must emit NOTHING on the global bus (the by-construction proof).
  const busHits: { t: string }[] = [];
  for (const t of ['score', 'odds', 'resolved', 'clv', 'pundit', 'fixtures', 'bracketResolved'] as const) {
    bus.on(t, () => busHits.push({ t }));
  }

  // --- RUN a full replay to completion ------------------------------------------------
  const frames: import('../src/replay.ts').ReplayFrame[] = [];
  let resolveDone!: () => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    setTimeout(() => rej(new Error('replay timeout')), 20_000);
  });
  const t0 = Date.now();
  const session = new ReplaySession(
    FIXTURE_ID,
    (f) => {
      frames.push(f);
      if (f.kind === 'end') resolveDone();
    },
    { speed: 10_000 },
  );
  void session.start();
  await done;
  const elapsed = Date.now() - t0;

  // --- ASSERT: no real-fixture writes -------------------------------------------------
  assert.equal(await countRows(schema.scoreEvents), before.events, 'score_events count unchanged');
  assert.equal(await countRows(schema.oddsLatest), before.odds, 'odds_latest count unchanged');
  assert.equal(await countRows(schema.fixtures), before.fixtures, 'fixtures count unchanged');
  const [stateAfter] = await db.select().from(schema.scoreState).where(eq(schema.scoreState.fixtureId, FIXTURE_ID));
  assert.equal(stateAfter!.ts, stateTsBefore, 'score_state ts byte-identical');
  assert.equal(JSON.stringify(stateAfter!.scoreSoccer), stateScoreBefore, 'score_state scoreSoccer byte-identical');

  // --- ASSERT: no resolution / no mint / no scoring side effects ----------------------
  const [pickAfter] = await db.select().from(schema.picks).where(eq(schema.picks.fixtureId, FIXTURE_ID));
  assert.equal(pickAfter!.status, 'open', 'pick still open');
  assert.equal(pickAfter!.points, 0, 'pick points still 0');
  assert.equal(pickAfter!.resolvedAt, pickBefore!.resolvedAt, 'pick resolvedAt still null');
  assert.equal(await countRows(schema.trophies), before.trophies, 'trophies count still 0');
  const [streakAfter] = await db.select().from(schema.streaks).where(eq(schema.streaks.wallet, WALLET));
  assert.equal(streakAfter!.current, streakBefore!.current, 'streak.current still 3');
  const [userAfter] = await db.select().from(schema.users).where(eq(schema.users.wallet, WALLET));
  assert.equal(userAfter!.xp, userBefore!.xp, 'users.xp still 100');

  // --- ASSERT: no pundit-history or bus pollution -------------------------------------
  assert.deepEqual(getPunditHistory(FIXTURE_ID, WALLET), [], 'pundit history for real fixture stays empty');
  assert.equal(busHits.length, 0, 'replay emitted NOTHING on the global bus');

  // --- ASSERT: ordered, accelerated frame stream ending on the true score -------------
  assert.equal(frames[0]!.kind, 'init', 'first frame is init');
  const ends = frames.filter((f) => f.kind === 'end');
  assert.equal(ends.length, 1, 'exactly one end frame');
  assert.equal(frames[frames.length - 1]!.kind, 'end', 'end frame is last');

  const ticks = frames.filter((f): f is Extract<import('../src/replay.ts').ReplayFrame, { kind: 'tick' }> => f.kind === 'tick');
  assert.ok(ticks.length >= 1, 'at least one tick before end (the stream actually played)');
  let lastSeq = -Infinity;
  let lastP1 = 0;
  let lastP2 = 0;
  for (const tk of ticks) {
    assert.ok(tk.seq >= lastSeq, 'ticks in non-decreasing seq order');
    lastSeq = tk.seq;
    assert.ok(tk.p1 >= lastP1 && tk.p2 >= lastP2, 'running score monotonic non-decreasing');
    lastP1 = tk.p1;
    lastP2 = tk.p2;
    if (tk.incident === 'goal') assert.ok(tk.player != null, 'goal ticks carry a player name from the lineup map');
  }
  assert.equal(lastP1, 2, 'running score reaches 2 for participant 1');
  assert.equal(lastP2, 0, 'running score reaches 0 for participant 2');

  const end = ends[0]!;
  assert.equal(end.kind, 'end');
  if (end.kind === 'end') {
    assert.equal(end.p1, 2, 'end p1 === 2');
    assert.equal(end.p2, 0, 'end p2 === 0');
    assert.equal(end.finalStatus, 'Full time', 'end finalStatus === Full time');
  }

  assert.ok(elapsed < 5000, `replay played back in a few seconds (elapsed=${elapsed}ms)`);

  // Catalog lists this finished, event-bearing fixture.
  const catalog = await listReplayableFixtures();
  assert.ok(catalog.some((c) => c.fixtureId === FIXTURE_ID), 'catalog includes the seeded fixture');

  session.stop(); // idempotent teardown
});

test('import boundary: replay.ts has no writers or bus/resolve/closing/pundit imports', async () => {
  const src = readFileSync(new URL('../src/replay.ts', import.meta.url), 'utf8');
  // Strip line comments so the header block's mention of these names never false-matches.
  const code = src
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

  const forbidden: [RegExp, string][] = [
    [/db\.(insert|update|delete)/, 'DB write'],
    [/from '\.\/bus/, "import of ./bus"],
    [/from '\.\/resolve/, 'import of ./resolve'],
    [/from '\.\/closing/, 'import of ./closing'],
    [/from '\.\/pundit/, 'import of ./pundit or ./punditHistory'],
    [/applyScore|resolveFixture|resolvePicks|stampClosingLines/, 'call into a real writer'],
  ];
  for (const [re, label] of forbidden) {
    assert.ok(!re.test(code), `replay.ts must not contain ${label} (matched ${re})`);
  }
});
