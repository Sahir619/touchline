// Private leagues: create, join by invite code, list, and a league-scoped leaderboard.
import type { Hono } from 'hono';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { leagues, leagueMembers, users, streaks, trophies, picks } from '../db/schema.ts';
import { type AppEnv, requireAuth } from '../auth.ts';
import { config } from '../config.ts';
import { ensureUserInDemoLeague, DEMO_LEAGUE_NAME } from '../demo.ts';

function inviteCode(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
}

export function registerLeagueRoutes(app: Hono<AppEnv>): void {
  // Create a league (creator auto-joins).
  app.post('/api/leagues', requireAuth, async (c) => {
    const wallet = c.get('wallet');
    const body = await c.req.json().catch(() => ({}));
    const name = (typeof body.name === 'string' && body.name.trim()) || 'My League';
    const id = inviteCode();
    const ts = Date.now();
    await db.insert(leagues).values({ id, name: name.slice(0, 40), owner: wallet, createdAt: ts });
    await db.insert(leagueMembers).values({ leagueId: id, wallet, joinedAt: ts });
    return c.json({ id, name, owner: wallet, inviteCode: id });
  });

  // Join by invite code.
  app.post('/api/leagues/:id/join', requireAuth, async (c) => {
    const wallet = c.get('wallet');
    const id = c.req.param('id').toUpperCase();
    const [league] = await db.select().from(leagues).where(eq(leagues.id, id));
    if (!league) return c.json({ error: 'league not found' }, 404);
    await db.insert(leagueMembers).values({ leagueId: id, wallet, joinedAt: Date.now() }).onConflictDoNothing();
    return c.json({ id, name: league.name });
  });

  // The user's leagues.
  app.get('/api/leagues', requireAuth, async (c) => {
    const wallet = c.get('wallet');
    // SAH-74: drop the viewing user into the Demo League so their leagues list isn't a
    // lonely room. Idempotent + gated; no-op until the demo cast has been seeded.
    if (config.enableDemo) await ensureUserInDemoLeague(wallet);
    const memberships = await db.select().from(leagueMembers).where(eq(leagueMembers.wallet, wallet));
    const ids = memberships.map((m) => m.leagueId);
    if (!ids.length) return c.json([]);
    const rows = await db.select().from(leagues).where(inArray(leagues.id, ids));
    return c.json(rows.map((l) => ({ ...l, isDemo: l.name === DEMO_LEAGUE_NAME })));
  });

  // League details + scoped leaderboard (members ranked by XP).
  app.get('/api/leagues/:id', requireAuth, async (c) => {
    const id = c.req.param('id').toUpperCase();
    const [league] = await db.select().from(leagues).where(eq(leagues.id, id));
    if (!league) return c.json({ error: 'not found' }, 404);
    const members = await db.select().from(leagueMembers).where(eq(leagueMembers.leagueId, id));
    const wallets = members.map((m) => m.wallet);
    if (!wallets.length) return c.json({ league, board: [] });

    const us = await db.select().from(users).where(inArray(users.wallet, wallets));
    const sts = await db.select().from(streaks).where(inArray(streaks.wallet, wallets));
    const smap = new Map(sts.map((s) => [s.wallet, s.current]));
    const tcounts = await db.select().from(trophies).where(inArray(trophies.wallet, wallets));
    const tmap = new Map<string, number>();
    for (const t of tcounts) tmap.set(t.wallet, (tmap.get(t.wallet) ?? 0) + 1);

    const board = us
      .sort((a, b) => b.xp - a.xp)
      .map((u, i) => ({
        rank: i + 1,
        wallet: u.wallet,
        displayName: u.displayName,
        nation: u.nation,
        xp: u.xp,
        level: u.level,
        streak: smap.get(u.wallet) ?? 0,
        trophies: tmap.get(u.wallet) ?? 0,
        demo: u.demo,
      }));
    return c.json({
      league: { id: league.id, name: league.name, owner: league.owner, isDemo: league.name === DEMO_LEAGUE_NAME },
      board,
    });
  });

  // League-mates in the room: the user's league-mates (across all their leagues)
  // who have a 1X2 call on this fixture. Powers the live-room "in the room" board.
  // Picks are locked pre-match, so this reads as a live board once the whistle
  // goes — the client tints each chip ahead/behind off the running score.
  app.get('/api/fixtures/:id/room', requireAuth, async (c) => {
    const wallet = c.get('wallet');
    const fixtureId = Number(c.req.param('id'));
    if (!Number.isInteger(fixtureId) || fixtureId <= 0) return c.json({ error: 'invalid fixture id' }, 400);

    const myLeagues = await db.select().from(leagueMembers).where(eq(leagueMembers.wallet, wallet));
    const leagueIds = myLeagues.map((m) => m.leagueId);
    if (!leagueIds.length) return c.json([]);

    const members = await db.select().from(leagueMembers).where(inArray(leagueMembers.leagueId, leagueIds));
    const mates = [...new Set(members.map((m) => m.wallet))].filter((w) => w !== wallet);
    if (!mates.length) return c.json([]);

    const rows = await db
      .select()
      .from(picks)
      .where(
        and(
          eq(picks.fixtureId, fixtureId),
          eq(picks.market, '1X2_PARTICIPANT_RESULT'),
          inArray(picks.wallet, mates),
        ),
      );
    if (!rows.length) return c.json([]);

    const us = await db.select().from(users).where(inArray(users.wallet, mates));
    const umap = new Map(us.map((u) => [u.wallet, u]));

    // One call per mate — keep the most recently locked if a wallet has several.
    const latest = new Map<string, (typeof rows)[number]>();
    for (const p of rows) {
      const cur = latest.get(p.wallet);
      if (!cur || p.lockedAt > cur.lockedAt) latest.set(p.wallet, p);
    }

    const out = [...latest.values()].map((p) => {
      const u = umap.get(p.wallet);
      return {
        wallet: p.wallet,
        displayName: u?.displayName ?? null,
        nation: u?.nation ?? null,
        selection: p.selection,
        selectionLabel: p.selectionLabel,
        oddsAtLock: p.oddsAtLock,
        status: p.status,
      };
    });
    return c.json(out);
  });
}
