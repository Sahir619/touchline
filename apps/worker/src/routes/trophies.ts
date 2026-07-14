// Trophy routes: list, mint (devnet), and public metadata + image for the NFT.
import type { Hono } from 'hono';
import { eq, desc, and, isNotNull, lte, count } from 'drizzle-orm';
import { impliedProbabilityPct } from '@touchline/shared';
import { db } from '../db/client.ts';
import { trophies } from '../db/schema.ts';
import { type AppEnv, requireAuth } from '../auth.ts';
import { mintTrophy } from '../mint.ts';
import { config } from '../config.ts';

const TIER_COLOR: Record<string, string> = { bronze: '#CF7E45', silver: '#9FB0B8', gold: '#F2B33C' };

function coinSvg(tier: string, name: string, odds: number | null, edition: number | null): string {
  const c = TIER_COLOR[tier] ?? '#CF7E45';
  const oddsLabel = odds ? `${odds.toFixed(2)}×` : '';
  const editionLabel = edition ? `#${edition}` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="#EFFAF4"/><stop offset="100%" stop-color="#E2F4FF"/>
    </radialGradient>
    <linearGradient id="coin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c}"/><stop offset="100%" stop-color="${c}99"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" fill="url(#bg)"/>
  <circle cx="300" cy="270" r="150" fill="url(#coin)" stroke="#0A1F17" stroke-opacity="0.12" stroke-width="6"/>
  <circle cx="300" cy="270" r="120" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="3"/>
  <text x="300" y="262" text-anchor="middle" font-family="Arial, sans-serif" font-size="58" font-weight="800" fill="#0A1F17">${oddsLabel}</text>
  <text x="300" y="312" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#0A1F17" opacity="0.7">BEATEN</text>
  <text x="300" y="478" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" font-weight="800" fill="#0A1F17">${name}</text>
  <text x="300" y="520" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#00A862" letter-spacing="2">TOUCHLINE · ${tier.toUpperCase()} ${editionLabel}</text>
</svg>`;
}

/**
 * This trophy's position among all *minted* trophies of the same tier+name, ordered
 * by mint time — e.g. the 7th Oracle ever minted. Computed on read (no schema change,
 * no fixed cap — honest "Nth so far", not a fabricated "of 100"). Unminted → null.
 */
async function editionNumber(t: typeof trophies.$inferSelect): Promise<number | null> {
  if (!t.mintedAt) return null;
  const [row] = await db
    .select({ n: count() })
    .from(trophies)
    .where(
      and(
        eq(trophies.tier, t.tier),
        eq(trophies.name, t.name),
        isNotNull(trophies.mintAddress),
        lte(trophies.mintedAt, t.mintedAt),
      ),
    );
  return Number(row?.n ?? 1);
}

export function registerTrophyRoutes(app: Hono<AppEnv>): void {
  app.get('/api/trophies', requireAuth, async (c) => {
    const rows = await db
      .select()
      .from(trophies)
      .where(eq(trophies.wallet, c.get('wallet')))
      .orderBy(desc(trophies.createdAt));
    const withEdition = await Promise.all(rows.map(async (t) => ({ ...t, edition: await editionNumber(t) })));
    return c.json(withEdition);
  });

  app.post('/api/trophies/:id/mint', requireAuth, async (c) => {
    const id = Number(c.req.param('id'));
    try {
      const mintAddress = await mintTrophy(id, c.get('wallet'));
      return c.json({ mintAddress, explorer: `https://explorer.solana.com/address/${mintAddress}?cluster=devnet` });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.get('/api/trophies/:id/metadata', async (c) => {
    const id = Number(c.req.param('id'));
    const [t] = await db.select().from(trophies).where(eq(trophies.id, id));
    if (!t) return c.json({ error: 'not found' }, 404);
    const edition = await editionNumber(t);
    const impliedPct = t.oddsBeaten ? Math.round(impliedProbabilityPct(t.oddsBeaten)) : null;
    const verifyUrl = t.mintAddress
      ? `https://explorer.solana.com/address/${t.mintAddress}?cluster=devnet`
      : null;
    return c.json({
      name: `${t.name} by Touchline${edition ? ` #${edition}` : ''}`,
      symbol: 'TLINE',
      description:
        `Earned on Touchline by beating the bookies${t.oddsBeaten ? ` at ${t.oddsBeaten.toFixed(2)}×` : ''}` +
        `${impliedPct ? ` (a ${impliedPct}% implied chance, per the odds locked in at pick time)` : ''}. ` +
        `Proof-of-skill, not for sale.` +
        (verifyUrl ? ` Verify this exact asset on-chain: ${verifyUrl}` : ''),
      image: `${config.workerPublicUrl}/api/trophies/${t.id}/image`,
      attributes: [
        { trait_type: 'Tier', value: t.tier },
        { trait_type: 'Trophy', value: t.name },
        { trait_type: 'Edition', value: edition ?? 0 },
        { trait_type: 'Odds beaten', value: t.oddsBeaten ?? 0 },
        { trait_type: 'Implied probability beaten (%)', value: impliedPct ?? 0 },
        { trait_type: 'Market', value: t.market ?? '1X2' },
        { trait_type: 'Selection', value: t.selectionLabel ?? '' },
        { trait_type: 'Date', value: new Date(t.createdAt).toISOString().slice(0, 10) },
      ],
      external_url: verifyUrl ?? undefined,
    });
  });

  app.get('/api/trophies/:id/image', async (c) => {
    const id = Number(c.req.param('id'));
    const [t] = await db.select().from(trophies).where(eq(trophies.id, id));
    if (!t) return c.text('not found', 404);
    const edition = await editionNumber(t);
    return c.body(coinSvg(t.tier, t.name, t.oddsBeaten, edition), 200, { 'Content-Type': 'image/svg+xml' });
  });
}
