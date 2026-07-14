// @touchline/worker — the persistent live engine.
// Phase 1: TxLINE auth → ingest fixtures/odds/scores into Postgres → serve read API + WS.
// Later phases add scoring/resolution, the AI pundit, and Solana trophy mints.

import { config, hasLiveCredentials } from './config.ts';
import { initDb, db } from './db/client.ts';
import { fixtures } from './db/schema.ts';
import { startServer } from './server.ts';
import { startPundit } from './pundit.ts';
import { startPunditHistory } from './punditHistory.ts';
import { startClosingSweep } from './closing.ts';
import { subscribeAndActivate } from './txline/auth.ts';
import { TxLineClient } from './txline/client.ts';
import {
  syncFixtures,
  seedOdds,
  seedStartedScores,
  startScoresBackfill,
  runOddsStream,
  runScoresStream,
} from './ingest.ts';

async function main() {
  await initDb();
  console.log('[touchline-worker] DB ready (PGlite)');

  // API + WS gateway come up immediately, even before live data.
  startServer();
  startPundit();
  startPunditHistory();
  startClosingSweep();

  if (!hasLiveCredentials) {
    console.log(
      '[touchline-worker] No TXLINE_WALLET_SECRET set — running API-only (no live ingestion).',
    );
    return;
  }

  console.log('[touchline-worker] authenticating with TxLINE (subscribe + activate)…');
  const { jwt, apiToken } = await subscribeAndActivate({
    rpc: config.txline.rpc,
    walletSecret: config.txline.walletSecret,
    authHost: config.txline.authHost,
    serviceLevelId: config.txline.serviceLevelId,
    weeks: config.txline.weeks,
  });
  console.log(`[touchline-worker] authenticated (apiToken ${apiToken.slice(0, 18)}…)`);

  const client = new TxLineClient(jwt, apiToken, config.txline.dataHost);

  // Ingest each configured competition independently. A failure on one competition
  // (e.g. the token rejecting 430) logs a skip and never stops the others or crashes
  // the worker — per-competition graceful degradation.
  let count = 0;
  for (const cid of config.txline.competitionIds) {
    try {
      const n = await syncFixtures(client, cid);
      count += n;
      console.log(`[touchline-worker] ingested ${n} fixtures (competition ${cid})`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(
        `[touchline-worker] competition ${cid} ingest skipped (token/feed rejected): ${message}`,
      );
    }
  }
  console.log(`[touchline-worker] ingested ${count} fixtures total across ${config.txline.competitionIds.length} competition(s)`);

  const ids = (await db.select({ id: fixtures.fixtureId }).from(fixtures)).map((r) => r.id);
  const seeded = await seedOdds(client, ids);
  console.log(`[touchline-worker] seeded ${seeded} odds records from snapshots`);

  // Seed scores from snapshots for kicked-off fixtures (the SSE safety net): catches up any
  // fixture that started/finished while the worker was down, and settles its picks.
  const seededScores = await seedStartedScores(client);
  console.log(`[touchline-worker] seeded ${seededScores} score events from snapshots`);

  // Start the live streams (long-running; reconnect handled inside the client).
  const ac = new AbortController();
  runOddsStream(client, ac.signal).catch((e) => console.error('[odds stream]', e));
  runScoresStream(client, ac.signal).catch((e) => console.error('[scores stream]', e));
  // Periodic scores re-poll so any SSE frame missed during a disconnect self-heals.
  const stopScoresBackfill = startScoresBackfill(client);
  console.log('[touchline-worker] live odds + scores streams running.');

  const shutdown = () => {
    console.log('\n[touchline-worker] shutting down…');
    stopScoresBackfill();
    ac.abort();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[touchline-worker] fatal', err);
  process.exit(1);
});
