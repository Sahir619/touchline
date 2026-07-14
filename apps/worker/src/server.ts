// Worker-owned read API (Hono) + WebSocket gateway. The Next.js app consumes these;
// TxLINE tokens never leave the worker. Live deltas fan out to WS clients from the bus.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import { eq, and, asc } from 'drizzle-orm';
import { db } from './db/client.ts';
import { fixtures, oddsLatest, scoreState, lineups } from './db/schema.ts';
import { bus } from './bus.ts';
import { listReplayableFixtures, ReplaySession } from './replay.ts';
import { config } from './config.ts';
import type { AppEnv } from './auth.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerPickRoutes } from './routes/picks.ts';
import { registerTrophyRoutes } from './routes/trophies.ts';
import { registerLeagueRoutes } from './routes/leagues.ts';
import { registerBracketRoutes } from './routes/bracket.ts';
import { registerDemoRoutes } from './routes/demo.ts';
import { registerPunditRoutes } from './routes/pundit.ts';

export function startServer(): void {
  const app = new Hono<AppEnv>();
  app.use('/*', cors({ origin: config.corsOrigins }));

  // Never leak stack traces, secrets, or driver internals to clients. Log server-side,
  // return a generic 500. Thrown HTTPExceptions keep their intended status.
  app.onError((err, c) => {
    console.error('[touchline-worker] unhandled error', err);
    return c.json({ error: 'internal error' }, 500);
  });

  registerAuthRoutes(app);
  registerPickRoutes(app);
  registerTrophyRoutes(app);
  registerLeagueRoutes(app);
  registerBracketRoutes(app);
  registerDemoRoutes(app);
  registerPunditRoutes(app);

  app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));

  app.get('/api/fixtures', async (c) => {
    const rows = await db.select().from(fixtures).orderBy(asc(fixtures.startTime));
    return c.json(rows);
  });

  // The pickable slate: each fixture with its 1X2 (match-result) market attached.
  app.get('/api/slate', async (c) => {
    const fx = await db.select().from(fixtures).orderBy(asc(fixtures.startTime));
    const slate = [];
    for (const f of fx) {
      const [m] = await db
        .select()
        .from(oddsLatest)
        .where(
          and(
            eq(oddsLatest.fixtureId, f.fixtureId),
            eq(oddsLatest.superOddsType, '1X2_PARTICIPANT_RESULT'),
          ),
        );
      slate.push({
        ...f,
        oneX2: m ? { prices: m.prices, priceNames: m.priceNames, pct: m.pct, inRunning: m.inRunning } : null,
      });
    }
    return c.json(slate);
  });

  // The Match Replay catalog: finished fixtures with a recorded event history. Public, no
  // auth — judges and signed-out users can browse replays. Read-only over existing rows.
  app.get('/api/replays', async (c) => {
    return c.json(await listReplayableFixtures());
  });

  app.get('/api/fixtures/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid fixture id' }, 400);
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.fixtureId, id));
    if (!fixture) return c.json({ error: 'not found' }, 404);
    const [state] = await db.select().from(scoreState).where(eq(scoreState.fixtureId, id));
    return c.json({ fixture, state: state ?? null });
  });

  app.get('/api/fixtures/:id/odds', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid fixture id' }, 400);
    const rows = await db.select().from(oddsLatest).where(eq(oddsLatest.fixtureId, id));
    return c.json(rows);
  });

  // Star Man: the official squads for a fixture, grouped by team. `teams` is empty until
  // the lineups event arrives (~30-45 min before kickoff). Home team (participant1) first.
  app.get('/api/fixtures/:id/lineups', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid fixture id' }, 400);
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.fixtureId, id));
    const rows = await db.select().from(lineups).where(eq(lineups.fixtureId, id));

    // Group players by team, then order teams to put participant1 first.
    const byTeam = new Map<number, { teamId: number; team: string; players: { playerId: number; name: string; rosterNumber: string | null; starter: boolean }[] }>();
    for (const r of rows) {
      let t = byTeam.get(r.teamId);
      if (!t) {
        t = { teamId: r.teamId, team: r.team, players: [] };
        byTeam.set(r.teamId, t);
      }
      t.players.push({ playerId: r.playerId, name: r.name, rosterNumber: r.rosterNumber, starter: r.starter });
    }

    // Starters first, then by shirt number (numeric), then name — a stable, readable order.
    const rosterNo = (s: string | null): number => {
      const n = s != null ? Number.parseInt(s, 10) : NaN;
      return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
    };
    for (const t of byTeam.values()) {
      t.players.sort(
        (a, b) =>
          Number(b.starter) - Number(a.starter) || rosterNo(a.rosterNumber) - rosterNo(b.rosterNumber) || a.name.localeCompare(b.name),
      );
    }

    const order = fixture ? [fixture.participant1Id, fixture.participant2Id] : [];
    const teams = [...byTeam.values()].sort((a, b) => {
      const ia = order.indexOf(a.teamId);
      const ib = order.indexOf(b.teamId);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.teamId - b.teamId;
    });
    return c.json({ teams });
  });

  app.get('/api/fixtures/:id/state', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid fixture id' }, 400);
    const [state] = await db.select().from(scoreState).where(eq(scoreState.fixtureId, id));
    return c.json(state ?? null);
  });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[touchline-worker] API + WS gateway on http://localhost:${info.port}`);
  });

  // WebSocket gateway: forward bus deltas to all connected clients.
  // (serve() returns a node http.Server; ws accepts it — cast through unknown.)
  const wss = new WebSocketServer({ server: server as unknown as import('node:http').Server });
  wss.on('connection', (ws: WebSocket) => {
    const send = (type: string, payload: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, payload }));
    };
    const offOdds = bus.on('odds', (o) => send('odds', o));
    const offScore = bus.on('score', (s) => send('score', s));
    const offFixtures = bus.on('fixtures', (f) => send('fixtures', f));
    const offResolved = bus.on('resolved', (r) => send('resolved', r));
    const offPundit = bus.on('pundit', (p) => send('pundit', p));
    const offBracket = bus.on('bracketResolved', (b) => send('bracketResolved', b));
    const offClv = bus.on('clv', (v) => send('clv', v));

    // Match Replay: at most ONE replay session per socket. The session emits ONLY through
    // this callback, so frames reach THIS socket and no other — never the bus, so no live
    // viewer or real-fixture consumer can ever receive a replay frame (isolation by transport).
    let replay: ReplaySession | null = null;
    ws.on('message', (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        return; // ignore malformed inbound frames
      }
      const m = msg as { type?: string; fixtureId?: unknown; speed?: unknown };
      if (m?.type === 'replay:start') {
        const fixtureId = Number(m.fixtureId);
        if (!Number.isInteger(fixtureId) || fixtureId <= 0) return;
        const speed = typeof m.speed === 'number' && Number.isFinite(m.speed) ? m.speed : undefined;
        replay?.stop(); // one active session per socket
        replay = new ReplaySession(
          fixtureId,
          (frame) => {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'replay', payload: frame }));
          },
          { speed },
        );
        void replay.start();
      } else if (m?.type === 'replay:stop') {
        replay?.stop();
        replay = null;
      }
    });

    ws.on('close', () => {
      offOdds();
      offScore();
      offFixtures();
      offResolved();
      offPundit();
      offBracket();
      offClv();
      replay?.stop();
    });
  });
}
