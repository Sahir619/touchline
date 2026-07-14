// Wallet auth: sign-in-with-Solana (message signature, no fee) → session JWT.
// The worker is the sole authority for user identity; the web stores the JWT.

import { SignJWT, jwtVerify } from 'jose';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { MiddlewareHandler } from 'hono';
import { config } from './config.ts';

export type AppEnv = { Variables: { wallet: string } };

// A shipped default secret would let anyone forge a session JWT, so refuse to boot
// with it in production. In dev we allow it but warn loudly once.
const DEV_FALLBACK_SECRET = 'touchline-dev-session-secret-change-in-prod';
if (!config.sessionSecret) {
  if (config.nodeEnv === 'production') {
    throw new Error('SESSION_SECRET must be set in production (refusing to use the dev fallback).');
  }
  console.warn(
    '[touchline-worker] SESSION_SECRET not set — using an insecure dev fallback. Set SESSION_SECRET before any non-local use.',
  );
}
const secret = new TextEncoder().encode(config.sessionSecret ?? DEV_FALLBACK_SECRET);

export async function signSession(wallet: string): Promise<string> {
  return new SignJWT({ wallet })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

export async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.wallet === 'string' ? payload.wallet : null;
  } catch {
    return null;
  }
}

/** The human-readable message the wallet signs. Must match exactly on web + worker. */
export function buildSignInMessage(wallet: string, nonce: string): string {
  return [
    'Touchline: sign in to play.',
    '',
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    '',
    'This is a free signature. No transaction, no fee.',
  ].join('\n');
}

/** Verify a base58 signature over `message` by `wallet` (base58 pubkey). */
export function verifySignature(message: string, signatureB58: string, wallet: string): boolean {
  try {
    const msg = new TextEncoder().encode(message);
    const sig = bs58.decode(signatureB58);
    const pub = bs58.decode(wallet);
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}

// --- single-use nonces (in-memory; fine for a single worker instance) ---
const nonces = new Map<string, { nonce: string; exp: number }>();

export function issueNonce(wallet: string): string {
  const nonce = crypto.randomUUID();
  nonces.set(wallet, { nonce, exp: Date.now() + 5 * 60_000 });
  return nonce;
}

export function consumeNonce(wallet: string, nonce: string): boolean {
  const e = nonces.get(wallet);
  if (!e || e.nonce !== nonce || e.exp < Date.now()) return false;
  nonces.delete(wallet);
  return true;
}

/** Hono middleware: requires a valid session, sets `wallet` on the context. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const wallet = token ? await verifySession(token) : null;
  if (!wallet) return c.json({ error: 'unauthorized' }, 401);
  c.set('wallet', wallet);
  await next();
};
