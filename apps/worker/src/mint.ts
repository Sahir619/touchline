// Trophy minting — Metaplex Core NFTs on Solana devnet. The server (mint authority)
// pays the fee so minting is free to the user; the asset is owned by the user's wallet.
// Metadata URI points back at the worker (served from routes/trophies.ts).
//
// umi/mpl-core are imported LAZILY so the worker boots even if those (heavy) deps have
// a resolution hiccup — minting then fails gracefully at call time instead of at boot.

import bs58 from 'bs58';
import { eq } from 'drizzle-orm';
import { db } from './db/client.ts';
import { trophies } from './db/schema.ts';
import { config } from './config.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let umi: any = null;

async function getUmi() {
  if (umi) return umi;
  if (!config.mintAuthoritySecret) throw new Error('mint authority not configured');
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { keypairIdentity } = await import('@metaplex-foundation/umi');
  const { mplCore } = await import('@metaplex-foundation/mpl-core');
  const u = createUmi(config.txline.rpc).use(mplCore());
  const kp = u.eddsa.createKeypairFromSecretKey(bs58.decode(config.mintAuthoritySecret));
  u.use(keypairIdentity(kp));
  umi = u;
  return u;
}

// In-process per-trophy locks: a double-click (or duplicate request) must not fire two
// on-chain mints for one trophy. Concurrent callers await the same in-flight promise.
const inFlight = new Map<number, Promise<string>>();

/** Mint a trophy (idempotent: returns the existing mint if already minted). */
export async function mintTrophy(trophyId: number, ownerWallet: string): Promise<string> {
  if (!Number.isInteger(trophyId) || trophyId <= 0) throw new Error('invalid trophy id');

  const existing = inFlight.get(trophyId);
  if (existing) return existing;

  const p = (async () => {
    const [t] = await db.select().from(trophies).where(eq(trophies.id, trophyId));
    if (!t) throw new Error('trophy not found');
    if (t.wallet !== ownerWallet) throw new Error('not your trophy');
    if (t.mintAddress) return t.mintAddress;
    return doMint(t, ownerWallet);
  })();
  inFlight.set(trophyId, p);
  try {
    return await p;
  } finally {
    inFlight.delete(trophyId);
  }
}

async function doMint(
  t: typeof trophies.$inferSelect,
  ownerWallet: string,
): Promise<string> {
  const trophyId = t.id;
  const u = await getUmi();
  const { generateSigner, publicKey } = await import('@metaplex-foundation/umi');
  const { create } = await import('@metaplex-foundation/mpl-core');

  const asset = generateSigner(u);
  await create(u, {
    asset,
    name: `${t.name} by Touchline`,
    uri: `${config.workerPublicUrl}/api/trophies/${t.id}/metadata`,
    owner: publicKey(ownerWallet),
  }).sendAndConfirm(u);

  const mintAddress = asset.publicKey.toString();
  await db.update(trophies).set({ mintAddress, mintedAt: Date.now() }).where(eq(trophies.id, trophyId));
  return mintAddress;
}
