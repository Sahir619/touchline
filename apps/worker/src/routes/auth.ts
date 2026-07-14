// Auth + profile routes: sign-in-with-Solana, /api/me get/update.
import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import bs58 from 'bs58';
import { NATION_CODES, PERSONA_IDS, type Profile } from '@touchline/shared';
import { db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import {
  type AppEnv,
  buildSignInMessage,
  issueNonce,
  consumeNonce,
  verifySignature,
  signSession,
  requireAuth,
} from '../auth.ts';

function isValidWallet(wallet: string): boolean {
  try {
    return bs58.decode(wallet).length === 32;
  } catch {
    return false;
  }
}

function toProfile(u: typeof users.$inferSelect): Profile {
  return {
    wallet: u.wallet,
    displayName: u.displayName,
    nation: u.nation,
    persona: u.persona,
    xp: u.xp,
    level: u.level,
    sharpScore: u.sharpScore,
    linesBeaten: u.linesBeaten,
    createdAt: u.createdAt,
  };
}

async function loadProfile(wallet: string): Promise<Profile | null> {
  const [u] = await db.select().from(users).where(eq(users.wallet, wallet));
  return u ? toProfile(u) : null;
}

export function registerAuthRoutes(app: Hono<AppEnv>): void {
  // Step 1: client asks for a nonce + the exact message to sign.
  app.get('/api/auth/nonce', (c) => {
    const wallet = c.req.query('wallet') ?? '';
    if (!isValidWallet(wallet)) return c.json({ error: 'invalid wallet' }, 400);
    const nonce = issueNonce(wallet);
    return c.json({ message: buildSignInMessage(wallet, nonce), nonce });
  });

  // Step 2: client returns { wallet, nonce, signature(base58) }.
  app.post('/api/auth/verify', async (c) => {
    const body = await c.req.json().catch(() => null);
    const wallet = body?.wallet as string | undefined;
    const nonce = body?.nonce as string | undefined;
    const signature = body?.signature as string | undefined;
    if (!wallet || !nonce || !signature || !isValidWallet(wallet)) {
      return c.json({ error: 'missing fields' }, 400);
    }
    if (!consumeNonce(wallet, nonce)) return c.json({ error: 'invalid or expired nonce' }, 401);
    const message = buildSignInMessage(wallet, nonce);
    if (!verifySignature(message, signature, wallet)) {
      return c.json({ error: 'bad signature' }, 401);
    }

    const ts = Date.now();
    await db
      .insert(users)
      .values({ wallet, persona: 'hype', xp: 0, level: 1, createdAt: ts, updatedAt: ts })
      .onConflictDoNothing();
    const profile = await loadProfile(wallet);
    const token = await signSession(wallet);
    return c.json({ token, profile, isNew: profile?.nation == null });
  });

  app.get('/api/me', requireAuth, async (c) => {
    const profile = await loadProfile(c.get('wallet'));
    return profile ? c.json(profile) : c.json({ error: 'not found' }, 404);
  });

  // Onboarding / settings update.
  app.patch('/api/me', requireAuth, async (c) => {
    const wallet = c.get('wallet');
    const body = await c.req.json().catch(() => ({}));
    const set: Record<string, unknown> = { updatedAt: Date.now() };
    if (typeof body.displayName === 'string') set.displayName = body.displayName.slice(0, 40);
    if (typeof body.nation === 'string' && (NATION_CODES as readonly string[]).includes(body.nation)) {
      set.nation = body.nation;
    }
    if (typeof body.persona === 'string' && (PERSONA_IDS as readonly string[]).includes(body.persona)) {
      set.persona = body.persona;
    }
    // Upsert, not update: a signed session is proof enough that this wallet is a user.
    // A bare UPDATE silently no-ops (200 with null body) when the row does not exist yet,
    // e.g. a session minted outside the verify flow or a verify/PATCH race.
    const ts = Date.now();
    await db
      .insert(users)
      .values({ wallet, persona: 'hype', xp: 0, level: 1, createdAt: ts, ...set, updatedAt: ts })
      .onConflictDoUpdate({ target: users.wallet, set });
    return c.json(await loadProfile(wallet));
  });
}
