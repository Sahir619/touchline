// SAH-74 — "Make it ALIVE" demo populace. Seeds a small, believable cast (the locked
// SAH-73 roster) into a "Demo League", derives a lightweight activity feed from their
// real picks/streaks/trophies, and lets a viewing user auto-join the Demo League so no
// surface reads as an empty room.
//
// Guardrails baked in:
//  - Every seeded person is flagged users.demo = true so every surface can badge DEMO;
//    nothing ever claims a real user did anything.
//  - The seed is IDEMPOTENT and touches ONLY the five demo wallets (delete-then-reseed
//    of exactly those wallets). It never calls the fixture-wide resolvePicks(), so it can
//    never grade or corrupt a real user's open pick.
//  - Gated by config.enableDevRoutes (seed) / config.enableDemo (read side).

import { Keypair } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { eq, and, asc, desc, inArray, sql } from 'drizzle-orm';
import {
  scoreStagedPick,
  isLongShot,
  trophyTier,
  applyStreak,
  levelForXp,
  impliedProbabilityFromPct,
  computeClv,
  CLV_BEAT_THRESHOLD,
} from '@touchline/shared';
import { db } from './db/client.ts';
import {
  fixtures,
  oddsLatest,
  users,
  picks,
  streaks,
  trophies,
  leagues,
  leagueMembers,
} from './db/schema.ts';
import { getStageIdForFixture } from './tournament.ts';
import { mintTrophy } from './mint.ts';

export const DEMO_LEAGUE_NAME = 'Demo League';
const DEMO_LEAGUE_ID = 'DEMOLG'; // fixed 6-char invite code → deterministic + idempotent

export type Outcome = 'part1' | 'draw' | 'part2';
const SEL_LABEL: Record<Outcome, '1' | 'X' | '2'> = { part1: '1', draw: 'X', part2: '2' };
const SEL_INDEX: Record<Outcome, number> = { part1: 0, draw: 1, part2: 2 };

/** The locked SAH-73 cast. Order = seed order; wallets are derived deterministically so
 *  re-running the seed always targets the same five rows. */
export const DEMO_CAST = [
  { key: 'maya', displayName: 'Maya', nation: 'JPN', persona: 'hype' },
  { key: 'daniel', displayName: 'Daniel', nation: 'GER', persona: 'nerd' },
  { key: 'sam', displayName: 'Sam', nation: 'BRA', persona: 'rival' },
  { key: 'amara', displayName: 'Amara', nation: 'ESP', persona: 'hype' },
  { key: 'raj', displayName: 'Raj', nation: 'ENG', persona: 'rival' },
] as const;

/** Deterministic devnet-valid wallet per cast key (stable across seed runs). */
export function demoWallet(key: string): string {
  const seed = createHash('sha256').update(`touchline-demo:${key}`).digest().subarray(0, 32);
  return Keypair.fromSeed(new Uint8Array(seed)).publicKey.toBase58();
}

export function demoWallets(): string[] {
  return DEMO_CAST.map((c) => demoWallet(c.key));
}
function walletByName(name: string): string {
  const c = DEMO_CAST.find((x) => x.displayName === name)!;
  return demoWallet(c.key);
}

const decimal = (price: number) => price / 1000;

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

interface Loaded {
  fixture: typeof fixtures.$inferSelect;
  outcomes: { sel: Outcome; odds: number; pct: string | null }[];
  fav: { sel: Outcome; odds: number };
  /** Lowest-odds *team* outcome (part1/part2 only) — a favourite that reads as a nation,
   *  never "the draw", for the chalky personas. */
  teamFav: { sel: Outcome; odds: number };
  dog: { sel: Outcome; odds: number };
}

async function loadFixturesWithOdds(): Promise<Loaded[]> {
  const fx = await db.select().from(fixtures).orderBy(asc(fixtures.startTime));
  const out: Loaded[] = [];
  for (const f of fx) {
    const [m] = await db
      .select()
      .from(oddsLatest)
      .where(and(eq(oddsLatest.fixtureId, f.fixtureId), eq(oddsLatest.superOddsType, '1X2_PARTICIPANT_RESULT')));
    const prices = (m?.prices as number[] | undefined) ?? [];
    if (prices.length !== 3) continue;
    const pct = (m?.pct as string[] | undefined) ?? [];
    const outcomes = (['part1', 'draw', 'part2'] as Outcome[]).map((sel, i) => ({
      sel,
      odds: decimal(prices[i]!),
      pct: pct[i] ?? null,
    }));
    const fav = outcomes.reduce((a, b) => (b.odds < a.odds ? b : a));
    const dog = outcomes.reduce((a, b) => (b.odds > a.odds ? b : a));
    const teams = outcomes.filter((o) => o.sel !== 'draw');
    const teamFav = teams.reduce((a, b) => (b.odds < a.odds ? b : a));
    out.push({ fixture: f, outcomes, fav, teamFav, dog });
  }
  return out;
}

type PlanItem = { wallet: string; fx: Loaded; sel: Outcome; odds: number; pct: string | null; result: Outcome | 'open' };

/** Build the (deterministic) pick plan for the cast from whatever real fixtures exist.
 *  Each entry is graded to its persona: Maya = fun upsets (a landed one, a pending one, a
 *  missed one), Daniel = chalky win streak, Sam = a big landed long-shot (→ trophy),
 *  Amara = live pending calls, Raj = the rival sitting near the user. */
function buildPlan(loaded: Loaded[]): PlanItem[] {
  // Believable-but-real "upsets": underdogs priced 3.5–12 (a genuine long shot without the
  // absurd 100-to-1 outliers that live odds can throw up, which would wreck XP + realism).
  const banded = loaded.filter((l) => l.dog.odds >= 3.5 && l.dog.odds <= 12).sort((a, b) => b.dog.odds - a.dog.odds);
  const upsetPool = banded.length >= 3 ? banded : [...loaded].sort((a, b) => b.dog.odds - a.dog.odds);
  const favSorted = [...loaded].sort((a, b) => a.teamFav.odds - b.teamFav.odds); // chalkiest team favourites first
  const upset = (i: number) => upsetPool[i % upsetPool.length]!;
  const fav = (i: number) => favSorted[i % favSorted.length]!;
  const plan: PlanItem[] = [];
  const add = (wallet: string, fx: Loaded, sel: Outcome, result: Outcome | 'open') => {
    // keep one pick per (wallet, fixture)
    if (plan.some((p) => p.wallet === wallet && p.fx.fixture.fixtureId === fx.fixture.fixtureId)) return;
    const oc = fx.outcomes.find((o) => o.sel === sel)!;
    plan.push({ wallet, fx, sel, odds: oc.odds, pct: oc.pct, result });
  };

  const maya = walletByName('Maya');
  const daniel = walletByName('Daniel');
  const sam = walletByName('Sam');
  const amara = walletByName('Amara');
  const raj = walletByName('Raj');

  // Sam — a landed long-shot (drives a real Giant-killer/Oracle trophy) + a pending call.
  add(sam, upset(0), upset(0).dog.sel, upset(0).dog.sel);
  add(sam, upset(1), upset(1).dog.sel, 'open');

  // Maya — a missed upset (graded FIRST so her streak still ends positive), a landed
  // upset, and a pending upset.
  add(maya, upset(2), upset(2).dog.sel, upset(2).fav.sel); // missed (backed dog, fav won)
  add(maya, upset(3), upset(3).dog.sel, upset(3).dog.sel); // landed upset
  add(maya, upset(4), upset(4).dog.sel, 'open'); // pending upset

  // Daniel — chalky, high hit-rate: three team favourites, all landed → a clean 3-streak.
  add(daniel, fav(0), fav(0).teamFav.sel, fav(0).teamFav.sel);
  add(daniel, fav(1), fav(1).teamFav.sel, fav(1).teamFav.sel);
  add(daniel, fav(2), fav(2).teamFav.sel, fav(2).teamFav.sel);

  // Amara — lives in the live room: a team call + one cheeky draw, both pending.
  add(amara, fav(0), fav(0).teamFav.sel, 'open');
  add(amara, fav(3), 'draw', 'open');

  // Raj — the rival: one modest landed team favourite + one pending, so he sits near the
  // user's rank rather than running away with the board.
  add(raj, fav(4), fav(4).teamFav.sel, fav(4).teamFav.sel);
  add(raj, fav(5), fav(5).teamFav.sel, 'open');

  return plan;
}

/** Idempotent full seed. Deletes + reseeds ONLY the five demo wallets. */
export async function seedDemo(): Promise<{ league: string; members: number; picks: number; wins: number; trophies: number; minted: number }> {
  const now = Date.now();
  const loaded = await loadFixturesWithOdds();
  if (loaded.length < 5) {
    throw new Error(`not enough fixtures with 1X2 odds to seed (have ${loaded.length}, need >=5) — is the worker ingested?`);
  }
  const wallets = demoWallets();

  // 1. Wipe prior demo state (scoped strictly to the demo wallets).
  await db.delete(picks).where(inArray(picks.wallet, wallets));
  await db.delete(trophies).where(inArray(trophies.wallet, wallets));
  await db.delete(streaks).where(inArray(streaks.wallet, wallets));

  // 2. Upsert the cast users (reset xp/level so re-seeding is deterministic).
  for (const c of DEMO_CAST) {
    const wallet = demoWallet(c.key);
    const existing = await db.select().from(users).where(eq(users.wallet, wallet));
    if (existing.length) {
      await db
        .update(users)
        .set({ displayName: c.displayName, nation: c.nation, persona: c.persona, demo: true, xp: 0, level: 1, updatedAt: now })
        .where(eq(users.wallet, wallet));
    } else {
      await db.insert(users).values({
        wallet,
        displayName: c.displayName,
        nation: c.nation,
        persona: c.persona,
        demo: true,
        xp: 0,
        level: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 3. Ensure the Demo League exists (fixed id) + all cast are members.
  const [existingLeague] = await db.select().from(leagues).where(eq(leagues.id, DEMO_LEAGUE_ID));
  if (!existingLeague) {
    await db.insert(leagues).values({ id: DEMO_LEAGUE_ID, name: DEMO_LEAGUE_NAME, owner: walletByName('Daniel'), createdAt: now });
  } else {
    await db.update(leagues).set({ name: DEMO_LEAGUE_NAME, owner: walletByName('Daniel') }).where(eq(leagues.id, DEMO_LEAGUE_ID));
  }
  for (const wallet of wallets) {
    await db.insert(leagueMembers).values({ leagueId: DEMO_LEAGUE_ID, wallet, joinedAt: now }).onConflictDoNothing();
  }

  // 4. Insert + grade picks (scoped to demo wallets — NEVER resolvePicks(), which would
  //    grade real users' open picks on the same fixture).
  const plan = buildPlan(loaded);
  const acc = new Map<string, { xp: number; cur: number; longest: number }>();
  const bump = (wallet: string, correct: boolean) => {
    const a = acc.get(wallet) ?? { xp: 0, cur: 0, longest: 0 };
    const next = applyStreak({ current: a.cur, longest: a.longest }, correct);
    acc.set(wallet, { xp: a.xp, cur: next.current, longest: next.longest });
  };
  const addXp = (wallet: string, points: number) => {
    const a = acc.get(wallet) ?? { xp: 0, cur: 0, longest: 0 };
    a.xp += points;
    acc.set(wallet, a);
  };

  let pickCount = 0;
  let wins = 0;
  let trophyCount = 0;
  // Lock times are staggered slightly into the past so the feed can order by recency.
  let lockSeq = 0;
  for (const item of plan) {
    const fixtureId = item.fx.fixture.fixtureId;
    const lockedAt = now - (plan.length - lockSeq) * 60_000;
    lockSeq++;
    const stageId = await getStageIdForFixture(fixtureId);

    let status: 'open' | 'won' | 'lost' = 'open';
    let points = 0;
    let resolvedAt: number | null = null;
    if (item.result !== 'open') {
      const correct = item.sel === item.result;
      status = correct ? 'won' : 'lost';
      points = scoreStagedPick(item.odds, correct, stageId);
      resolvedAt = lockedAt + 30_000;
      bump(item.wallet, correct);
      addXp(item.wallet, points);
      if (correct) wins++;
      if (correct && isLongShot(item.odds)) {
        const tier = trophyTier(item.odds);
        if (tier.tier && tier.name) {
          await db.insert(trophies).values({
            wallet: item.wallet,
            fixtureId,
            tier: tier.tier,
            name: tier.name,
            oddsBeaten: item.odds,
            market: '1X2_PARTICIPANT_RESULT',
            selectionLabel: SEL_LABEL[item.sel],
            metadata: { result: item.result, lockedAt, demo: true },
            createdAt: resolvedAt,
          });
          trophyCount++;
        }
      }
    }

    await db.insert(picks).values({
      wallet: item.wallet,
      fixtureId,
      market: '1X2_PARTICIPANT_RESULT',
      selection: item.sel,
      selectionLabel: SEL_LABEL[item.sel],
      oddsAtLock: item.odds,
      // Fraction [0,1], identical to the real lock path (impliedProbabilityFromPct), so
      // the Beat-the-Line CLV math is consistent across demo + real picks.
      pctAtLock: item.pct ? impliedProbabilityFromPct(item.pct) : null,
      status,
      points,
      lockedAt,
      resolvedAt,
    });
    pickCount++;
  }

  // 5. Persist accumulated xp/level + streaks.
  for (const [wallet, a] of acc) {
    await db.update(users).set({ xp: a.xp, level: levelForXp(a.xp), updatedAt: now }).where(eq(users.wallet, wallet));
    await db
      .insert(streaks)
      .values({ wallet, current: a.cur, longest: a.longest, updatedAt: now })
      .onConflictDoUpdate({ target: streaks.wallet, set: { current: a.cur, longest: a.longest, updatedAt: now } });
  }

  // 5b. Beat the Line: give the cast plausible sharpness stats and stamp the closing line
  //     on each one's most valuable landed call, so the CLV surfaces (/you, leaderboard,
  //     pick rows) aren't empty. Manual + scoped to demo wallets (won picks are never
  //     touched by the live closing sweep), staying inside the idempotent reseed.
  const SHARP_STATS: Record<string, { sharpScore: number; linesBeaten: number }> = {
    // linesBeaten must match the number of won picks actually stamped below (one per
    // player, limit 1), so the "/you" "Sharp · N beaten" caption never overcounts chips.
    Maya: { sharpScore: 6.2, linesBeaten: 1 },
    Daniel: { sharpScore: 9.4, linesBeaten: 1 },
    Sam: { sharpScore: 12.1, linesBeaten: 1 },
    Amara: { sharpScore: 3.1, linesBeaten: 0 },
    Raj: { sharpScore: 4.7, linesBeaten: 1 },
  };
  for (const c of DEMO_CAST) {
    const s = SHARP_STATS[c.displayName];
    if (!s) continue;
    await db
      .update(users)
      .set({ sharpScore: s.sharpScore, linesBeaten: s.linesBeaten, updatedAt: now })
      .where(eq(users.wallet, demoWallet(c.key)));
  }
  // Stamp a believable line-beat (market firmed ~3.5 pts toward the pick) on the biggest
  // landed call for the players credited with lines beaten above.
  for (const name of ['Sam', 'Maya', 'Daniel', 'Raj']) {
    const wallet = walletByName(name);
    const [won] = await db
      .select()
      .from(picks)
      .where(and(eq(picks.wallet, wallet), eq(picks.status, 'won')))
      .orderBy(desc(picks.oddsAtLock))
      .limit(1);
    if (!won || won.pctAtLock == null) continue;
    const pctAtClose = Math.min(0.99, won.pctAtLock + 0.035); // fraction — the line firmed toward them
    const clv = computeClv(won.pctAtLock, pctAtClose); // ≈ +3.5 pct points
    // Market moved to them ⇒ closing odds shorten relative to lock.
    const oddsAtClose = Number((won.oddsAtLock * (won.pctAtLock / pctAtClose)).toFixed(3));
    await db
      .update(picks)
      .set({ oddsAtClose, pctAtClose, clv, beatLine: clv != null && clv >= CLV_BEAT_THRESHOLD })
      .where(eq(picks.id, won.id));
  }

  // 6. Best-effort: genuinely mint Sam's (the collector's) trophy on devnet so the feed's
  //    "banked the receipt on-chain" line is TRUE, not a fake claim. Never blocks the seed
  //    — skips silently if the mint authority isn't configured or devnet is slow.
  let minted = 0;
  const sam = walletByName('Sam');
  const [samTrophy] = await db.select().from(trophies).where(eq(trophies.wallet, sam)).limit(1);
  if (samTrophy) {
    try {
      const address = await Promise.race([
        mintTrophy(samTrophy.id, sam),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('mint timeout')), 20_000)),
      ]);
      if (address) minted++;
    } catch {
      /* devnet unavailable / no authority — trophy stays earned-but-unminted; feed omits the minted line */
    }
  }

  return { league: DEMO_LEAGUE_ID, members: wallets.length, picks: pickCount, wins, trophies: trophyCount, minted };
}

// ---------------------------------------------------------------------------
// Demo League membership (auto-join the viewing user)
// ---------------------------------------------------------------------------

export async function getDemoLeague() {
  const [l] = await db.select().from(leagues).where(eq(leagues.id, DEMO_LEAGUE_ID));
  return l ?? null;
}

/** Idempotently add the viewing user to the Demo League so their /leagues isn't empty.
 *  No-op if the demo league hasn't been seeded yet. */
export async function ensureUserInDemoLeague(wallet: string): Promise<boolean> {
  const league = await getDemoLeague();
  if (!league) return false;
  await db.insert(leagueMembers).values({ leagueId: DEMO_LEAGUE_ID, wallet, joinedAt: Date.now() }).onConflictDoNothing();
  return true;
}

// ---------------------------------------------------------------------------
// Derived activity feed
// ---------------------------------------------------------------------------

function outcomeLabel(fx: typeof fixtures.$inferSelect, sel: string): string {
  if (sel === 'part1') return fx.participant1 ?? 'the home side';
  if (sel === 'part2') return fx.participant2 ?? 'the away side';
  return 'the draw';
}
function fixtureLabel(fx: typeof fixtures.$inferSelect): string {
  return `${fx.participant1 ?? '?'} vs ${fx.participant2 ?? '?'}`;
}
/** Plain-language long-shot phrasing, e.g. 3.8 → "a 1-in-4 shot". Never betting language. */
function shotPhrase(odds: number): string {
  const n = Math.max(2, Math.round(odds));
  return `a 1-in-${n} shot`;
}

export interface FeedEvent {
  id: string;
  type: 'called-upset' | 'landed' | 'streak' | 'watching' | 'minted';
  name: string;
  nation: string | null;
  demo: true;
  fixture: string;
  outcome: string;
  odds: number | null;
  shot: string | null;
  n: number | null;
  points: number | null;
  ts: number;
}

/** Compose the activity feed from the cast's real picks/streaks/trophies. No event table:
 *  the feed IS the seeded data, so feed ↔ leaderboard ↔ league can never contradict. */
export async function getDemoFeed(limit = 12): Promise<FeedEvent[]> {
  const wallets = demoWallets();
  const us = await db.select().from(users).where(inArray(users.wallet, wallets));
  const umap = new Map(us.map((u) => [u.wallet, u]));
  const ps = await db.select().from(picks).where(inArray(picks.wallet, wallets));
  const fxIds = [...new Set(ps.map((p) => p.fixtureId))];
  const fxRows = fxIds.length ? await db.select().from(fixtures).where(inArray(fixtures.fixtureId, fxIds)) : [];
  const fxmap = new Map(fxRows.map((f) => [f.fixtureId, f]));
  const sts = wallets.length ? await db.select().from(streaks).where(inArray(streaks.wallet, wallets)) : [];
  const trs = wallets.length ? await db.select().from(trophies).where(inArray(trophies.wallet, wallets)) : [];

  const events: FeedEvent[] = [];
  const nameOf = (w: string) => umap.get(w)?.displayName ?? 'A player';
  const nationOf = (w: string) => umap.get(w)?.nation ?? null;
  const amara = walletByName('Amara');

  for (const p of ps) {
    const fx = fxmap.get(p.fixtureId);
    if (!fx) continue;
    const out = outcomeLabel(fx, p.selection);
    const fixLabel = fixtureLabel(fx);
    const base = { name: nameOf(p.wallet), nation: nationOf(p.wallet), demo: true as const, fixture: fixLabel, outcome: out };
    if (p.status === 'won') {
      if (p.oddsAtLock >= 3.5) {
        events.push({ id: `p${p.id}`, type: 'called-upset', ...base, odds: p.oddsAtLock, shot: shotPhrase(p.oddsAtLock), n: null, points: p.points, ts: p.resolvedAt ?? p.lockedAt });
      } else {
        events.push({ id: `p${p.id}`, type: 'landed', ...base, odds: p.oddsAtLock, shot: null, n: null, points: p.points, ts: p.resolvedAt ?? p.lockedAt });
      }
    } else if (p.status === 'open') {
      if (p.wallet === amara) {
        events.push({ id: `p${p.id}`, type: 'watching', ...base, odds: p.oddsAtLock, shot: null, n: null, points: null, ts: p.lockedAt });
      } else if (p.oddsAtLock >= 3.5) {
        events.push({ id: `p${p.id}`, type: 'called-upset', ...base, odds: p.oddsAtLock, shot: shotPhrase(p.oddsAtLock), n: null, points: null, ts: p.lockedAt });
      }
    }
  }

  for (const s of sts) {
    if (s.current >= 2) {
      events.push({ id: `s${s.wallet.slice(0, 6)}`, type: 'streak', name: nameOf(s.wallet), nation: nationOf(s.wallet), demo: true, fixture: '', outcome: '', odds: null, shot: null, n: s.current, points: null, ts: s.updatedAt });
    }
  }

  for (const t of trs) {
    if (!t.mintedAt) continue; // only claim "on-chain" when it genuinely is
    const fx = t.fixtureId != null ? fxmap.get(t.fixtureId) : undefined;
    events.push({ id: `t${t.id}`, type: 'minted', name: nameOf(t.wallet), nation: nationOf(t.wallet), demo: true, fixture: fx ? fixtureLabel(fx) : '', outcome: fx ? outcomeLabel(fx, invertLabel(t.selectionLabel)) : (t.name ?? ''), odds: t.oddsBeaten, shot: null, n: null, points: null, ts: t.mintedAt });
  }

  events.sort((a, b) => b.ts - a.ts);
  return events.slice(0, limit);
}

function invertLabel(label: string | null): string {
  if (label === '1') return 'part1';
  if (label === '2') return 'part2';
  return 'draw';
}

/** Most-recent-call context per demo wallet for the leaderboard rows. */
export async function getRecentCalls(wallets: string[]): Promise<Map<string, string>> {
  if (!wallets.length) return new Map();
  const ps = await db.select().from(picks).where(inArray(picks.wallet, wallets));
  const fxIds = [...new Set(ps.map((p) => p.fixtureId))];
  const fxRows = fxIds.length ? await db.select().from(fixtures).where(inArray(fixtures.fixtureId, fxIds)) : [];
  const fxmap = new Map(fxRows.map((f) => [f.fixtureId, f]));
  const latest = new Map<string, (typeof ps)[number]>();
  for (const p of ps) {
    const cur = latest.get(p.wallet);
    if (!cur || p.lockedAt > cur.lockedAt) latest.set(p.wallet, p);
  }
  const out = new Map<string, string>();
  for (const [wallet, p] of latest) {
    const fx = fxmap.get(p.fixtureId);
    if (!fx) continue;
    const team = outcomeLabel(fx, p.selection);
    const verb = p.status === 'won' ? 'called' : p.status === 'lost' ? 'missed' : 'backing';
    const tail = p.status === 'won' ? ' — landed ✓' : p.status === 'open' ? ' — live' : '';
    out.set(wallet, `${verb === 'backing' ? 'Backing' : verb === 'called' ? 'Called' : 'Missed'} ${team}${tail}`);
  }
  return out;
}
