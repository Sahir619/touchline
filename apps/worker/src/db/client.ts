// Embedded Postgres (PGlite) + Drizzle, persisted to disk by default so game data
// survives worker restarts. Set DATABASE_URL to point at a real Postgres (Supabase)
// via node-postgres instead; the schema (below) is portable across both.

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { TOURNAMENT_STAGES, DEFAULT_TOURNAMENT_ID } from '@touchline/shared';
import * as schema from './schema.ts';
import { config } from '../config.ts';

// drizzle's query builder is identical across drivers; we type `db` against the
// PGlite return so callers get full inference regardless of the active backend.
type Db = ReturnType<typeof drizzlePglite<typeof schema>>;

let db: Db;
// Runs the CREATE TABLE bootstrap against whichever backend is active.
let rawExec: (sql: string) => Promise<void>;

if (config.databaseUrl) {
  // Real Postgres (Supabase). The `pg` driver is an optional dependency, so it is
  // resolved dynamically (and untyped) — install it to use this path:
  //   pnpm --filter @touchline/worker add pg
  let pg: { Pool: new (cfg: { connectionString: string }) => { query: (sql: string) => Promise<unknown> } };
  let drizzlePg: (client: unknown, opts: { schema: typeof schema }) => unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pg = (await import('pg' as any)) as typeof pg;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ drizzle: drizzlePg } = (await import('drizzle-orm/node-postgres' as any)) as { drizzle: typeof drizzlePg });
  } catch {
    throw new Error(
      'DATABASE_URL is set but the `pg` driver is not installed. Run `pnpm --filter @touchline/worker add pg`, or unset DATABASE_URL to use embedded PGlite.',
    );
  }
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  db = drizzlePg(pool, { schema }) as unknown as Db;
  rawExec = async (sql) => {
    await pool.query(sql);
  };
  console.log('[touchline-worker] DB backend: Postgres via DATABASE_URL');
} else {
  const pg = config.pgliteDataDir ? new PGlite(config.pgliteDataDir) : new PGlite();
  db = drizzlePglite(pg, { schema });
  rawExec = async (sql) => {
    await pg.exec(sql);
  };
  console.log(
    `[touchline-worker] DB backend: PGlite (${config.pgliteDataDir ? `persisted → ${config.pgliteDataDir}` : 'in-memory'})`,
  );
}

export { db };

/** Create tables if absent. Kept in sync with schema.ts (PGlite has no migration runner here). */
export async function initDb(): Promise<void> {
  await rawExec(`
    CREATE TABLE IF NOT EXISTS fixtures (
      fixture_id BIGINT PRIMARY KEY,
      competition_id INTEGER NOT NULL,
      competition TEXT NOT NULL,
      start_time BIGINT NOT NULL,
      fixture_group_id INTEGER NOT NULL,
      participant1_id INTEGER NOT NULL,
      participant1 TEXT NOT NULL,
      participant2_id INTEGER NOT NULL,
      participant2 TEXT NOT NULL,
      participant1_is_home BOOLEAN NOT NULL,
      ts BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS odds_latest (
      fixture_id BIGINT NOT NULL,
      market_key TEXT NOT NULL,
      super_odds_type TEXT NOT NULL,
      market_parameters TEXT,
      market_period TEXT,
      bookmaker_id INTEGER NOT NULL,
      in_running BOOLEAN NOT NULL,
      price_names JSONB,
      prices JSONB,
      pct JSONB,
      message_id TEXT NOT NULL,
      ts BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (fixture_id, market_key)
    );
    CREATE INDEX IF NOT EXISTS odds_by_fixture ON odds_latest (fixture_id);

    CREATE TABLE IF NOT EXISTS score_state (
      fixture_id BIGINT PRIMARY KEY,
      game_state TEXT,
      status_soccer_id TEXT,
      score_soccer JSONB,
      clock JSONB,
      coverage_secondary_data BOOLEAN,
      ts BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS score_events (
      id SERIAL PRIMARY KEY,
      fixture_id BIGINT NOT NULL,
      seq INTEGER NOT NULL,
      action TEXT NOT NULL,
      data_soccer JSONB,
      ts BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_by_fixture_seq ON score_events (fixture_id, seq);

    CREATE TABLE IF NOT EXISTS lineups (
      fixture_id BIGINT NOT NULL,
      player_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      roster_number TEXT,
      team_id INTEGER NOT NULL,
      team TEXT NOT NULL,
      starter BOOLEAN NOT NULL DEFAULT false,
      ts BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (fixture_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS lineups_by_fixture ON lineups (fixture_id);

    CREATE TABLE IF NOT EXISTS users (
      wallet TEXT PRIMARY KEY,
      display_name TEXT,
      nation TEXT,
      persona TEXT NOT NULL DEFAULT 'hype',
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      sharp_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      lines_beaten INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    -- SAH-74: additive column for pre-existing persisted PGlite data (CREATE above was a
    -- no-op when the table already existed). Flags seeded Demo-League sample players.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT false;
    -- SAH — Beat the Line: additive sharpness columns for pre-existing persisted data.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS sharp_score DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS lines_beaten INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS picks (
      id SERIAL PRIMARY KEY,
      wallet TEXT NOT NULL,
      fixture_id BIGINT NOT NULL,
      market TEXT NOT NULL,
      selection TEXT NOT NULL,
      selection_label TEXT NOT NULL,
      odds_at_lock DOUBLE PRECISION NOT NULL,
      pct_at_lock DOUBLE PRECISION,
      odds_at_close DOUBLE PRECISION,
      pct_at_close DOUBLE PRECISION,
      clv DOUBLE PRECISION,
      beat_line BOOLEAN,
      market_params TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      points INTEGER NOT NULL DEFAULT 0,
      locked_at BIGINT NOT NULL,
      resolved_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS picks_by_wallet ON picks (wallet);
    CREATE INDEX IF NOT EXISTS picks_by_fixture ON picks (fixture_id);

    -- W7/SAH-35: additive column for pre-existing persisted PGlite data where the
    -- CREATE TABLE above was a no-op (table already existed without this column).
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS market_params TEXT;
    -- SAH — Beat the Line: additive closing-line columns for pre-existing persisted data.
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS odds_at_close DOUBLE PRECISION;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS pct_at_close DOUBLE PRECISION;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS clv DOUBLE PRECISION;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS beat_line BOOLEAN;

    CREATE TABLE IF NOT EXISTS streaks (
      wallet TEXT PRIMARY KEY,
      current INTEGER NOT NULL DEFAULT 0,
      longest INTEGER NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trophies (
      id SERIAL PRIMARY KEY,
      wallet TEXT NOT NULL,
      fixture_id BIGINT,
      tier TEXT NOT NULL,
      name TEXT NOT NULL,
      odds_beaten DOUBLE PRECISION,
      market TEXT,
      selection_label TEXT,
      metadata JSONB,
      mint_address TEXT,
      created_at BIGINT NOT NULL,
      minted_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS trophies_by_wallet ON trophies (wallet);

    CREATE TABLE IF NOT EXISTS leagues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS league_members (
      league_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      joined_at BIGINT NOT NULL,
      PRIMARY KEY (league_id, wallet)
    );

    CREATE TABLE IF NOT EXISTS tournament_stages (
      id TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL,
      name TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      multiplier DOUBLE PRECISION NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS fixture_stages (
      fixture_id BIGINT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bracket_picks (
      wallet TEXT NOT NULL,
      tournament_id TEXT NOT NULL,
      champion_id INTEGER NOT NULL,
      champion_name TEXT NOT NULL,
      runner_up_id INTEGER,
      runner_up_name TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      points INTEGER NOT NULL DEFAULT 0,
      locked_at BIGINT NOT NULL,
      resolved_at BIGINT,
      PRIMARY KEY (wallet, tournament_id)
    );
  `);

  // Seed the stage catalog (idempotent) so /api/tournament/stages always has rows.
  for (const s of TOURNAMENT_STAGES) {
    await db
      .insert(schema.tournamentStages)
      .values({ id: s.id, tournamentId: DEFAULT_TOURNAMENT_ID, name: s.name, order: s.order, multiplier: s.multiplier })
      .onConflictDoNothing();
  }
}
