// SAH-74 — demo populace routes: a dev-gated seed trigger + the public derived activity
// feed. See ../demo.ts for the logic and guardrails.
import type { Hono } from 'hono';
import type { AppEnv } from '../auth.ts';
import { config } from '../config.ts';
import { seedDemo, getDemoFeed } from '../demo.ts';

export function registerDemoRoutes(app: Hono<AppEnv>): void {
  // Public: the derived activity feed (Demo League cast). Every event is flagged demo,
  // so the UI badges it. Empty until the seed has run. Gated so it's absent in prod.
  app.get('/api/feed', async (c) => {
    if (!config.enableDemo) return c.json([]);
    const feed = await getDemoFeed();
    return c.json(feed);
  });

  // DEV ONLY: (re)seed the Demo League cast. Idempotent; touches only the demo wallets.
  if (config.enableDevRoutes) {
    app.post('/api/dev/demo/seed', async (c) => {
      if (config.devResolveToken && c.req.header('X-Dev-Token') !== config.devResolveToken) {
        return c.json({ error: 'forbidden' }, 403);
      }
      try {
        const summary = await seedDemo();
        return c.json({ ok: true, ...summary });
      } catch (err) {
        return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
      }
    });
  }
}
