// Worker configuration from environment (apps/worker/.env). See .env.example.
import 'dotenv/config';

/**
 * Competition list resolution (backward compatible). Precedence:
 *  1. TXLINE_COMPETITION_IDS (comma-separated) — the new source of truth. Parsed to
 *     positive integers, deduped, order-preserving.
 *  2. Legacy TXLINE_WORLD_CUP_COMPETITION_ID (single number, default 72).
 * With neither set, this yields [72] — behaviorally identical to the old single-competition
 * default. config.txline.competitionId stays as an alias (= competitionIds[0]) so any legacy
 * reader is untouched.
 */
const competitionIds: number[] = (() => {
  const raw = process.env.TXLINE_COMPETITION_IDS;
  if (raw && raw.trim().length > 0) {
    const parsed = raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    const deduped = [...new Set(parsed)];
    if (deduped.length > 0) return deduped;
  }
  const legacy = Number(process.env.TXLINE_WORLD_CUP_COMPETITION_ID ?? 72);
  return [Number.isInteger(legacy) && legacy > 0 ? legacy : 72];
})();

export const config = {
  txline: {
    authHost: process.env.TXLINE_AUTH_HOST ?? 'https://txline-dev.txodds.com',
    dataHost:
      process.env.TXLINE_DATA_HOST ??
      process.env.TXLINE_AUTH_HOST ??
      'https://txline-dev.txodds.com',
    rpc: process.env.TXLINE_SOLANA_RPC ?? 'https://api.devnet.solana.com',
    walletSecret: process.env.TXLINE_WALLET_SECRET ?? '',
    serviceLevelId: Number(process.env.TXLINE_SERVICE_LEVEL_ID ?? 1),
    weeks: Number(process.env.TXLINE_SUBSCRIPTION_WEEKS ?? 4),
    /** Competitions to ingest (World Cup 72 + International Friendlies 430, etc.). */
    competitionIds,
    /** Backward-compat alias for the legacy single-competition readers.
     *  competitionIds is always non-empty (the parser guarantees a fallback); the
     *  `?? 72` only satisfies the compiler's possibly-undefined index and never fires. */
    competitionId: competitionIds[0] ?? 72,
  },
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Persistence. Precedence: DATABASE_URL (node-postgres / Supabase) > PGlite.
  // PGlite persists to disk by default so data survives worker restarts; set
  // PGLITE_DATA_DIR to relocate it, or PGLITE_DATA_DIR=:memory: to opt back into
  // ephemeral in-memory mode (e.g. for tests).
  databaseUrl: process.env.DATABASE_URL || undefined,
  pgliteDataDir:
    process.env.PGLITE_DATA_DIR === ':memory:'
      ? undefined
      : process.env.PGLITE_DATA_DIR || './.data/pglite',
  /** Session JWT signing secret. Required in production (see auth.ts). */
  sessionSecret: process.env.SESSION_SECRET || undefined,
  /** Dev resolve endpoint: on by default for demos; auto-off in production unless forced. */
  enableDevRoutes:
    process.env.ENABLE_DEV_ROUTES === 'true' ||
    (process.env.ENABLE_DEV_ROUTES !== 'false' && (process.env.NODE_ENV ?? 'development') !== 'production'),
  /** Optional shared secret guarding /api/dev/resolve (sent as X-Dev-Token). */
  devResolveToken: process.env.DEV_RESOLVE_TOKEN || undefined,
  /** SAH-74 demo populace (Demo League cast + activity feed + auto-join). On by default
   *  for local/devnet demos, auto-off in production unless forced. Read-side gate; the
   *  seed itself lives behind the dev-routes gate. */
  enableDemo:
    process.env.ENABLE_DEMO === 'true' ||
    (process.env.ENABLE_DEMO !== 'false' && (process.env.NODE_ENV ?? 'development') !== 'production'),
  port: Number(process.env.WORKER_PORT ?? 8787),
  /** Public base URL the worker is reachable at (for NFT metadata URIs). */
  workerPublicUrl: process.env.WORKER_PUBLIC_URL ?? `http://localhost:${Number(process.env.WORKER_PORT ?? 8787)}`,
  /** Secret (base58) for the trophy mint authority; falls back to the TxLINE app wallet. */
  mintAuthoritySecret: process.env.MINT_AUTHORITY_SECRET || process.env.TXLINE_WALLET_SECRET || '',
  /** Comma-separated origins allowed to call the worker API (the web app). */
  corsOrigins: (process.env.WORKER_CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim()),
} as const;

export const hasLiveCredentials = config.txline.walletSecret.length > 0;
