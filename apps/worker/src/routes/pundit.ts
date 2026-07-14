// Pundit scrollback API (SAH-77) + conversational "Ask the Pundit" (SAH). The live pundit
// is otherwise ephemeral — lines fan out over WS and are gone. History serves the per-session
// in-memory buffer so the web "Pundit Feed" panel can populate immediately on open. Ask lets a
// fan put a question to the pundit and get an in-persona reply. Both are wallet-scoped: the
// pundit only speaks to the fan holding an open pick, so a user only ever reads their own commentary.

import type { Hono } from 'hono';
import { type AppEnv, requireAuth } from '../auth.ts';
import { getPunditHistory } from '../punditHistory.ts';
import { askPundit, ASK_PRESETS, ASK_MAX_LEN, type AskPreset } from '../pundit.ts';

// Ask throttling (rule 7: rate-limit the pundit — every ask is a paid LLM call). Two gates,
// both keyed per wallet+fixture, both in-memory (consistent with the single-worker architecture;
// swap for Redis when scaling out):
//   1. COOLDOWN — at most one ask per 300s, so a burst of taps can't fan out multiple LLM calls.
//   2. CAP — at most 5 asks per wallet+fixture for the LIFETIME of the worker process. This map is
//      never cleared, so a fan gets a hard budget of questions per match.
const ASK_COOLDOWN_MS = 300_000; // 5 minutes between asks per wallet+fixture
const ASK_MAX_PER_FIXTURE = 5; // lifetime cap per wallet+fixture (process lifetime)
const lastAsk = new Map<string, number>(); // `${wallet}:${fixtureId}` -> last ask ts
const askCount = new Map<string, number>(); // `${wallet}:${fixtureId}` -> asks consumed

export function registerPunditRoutes(app: Hono<AppEnv>): void {
  // GET /api/pundit/history?fixtureId=123 — recent lines for THIS wallet on the fixture,
  // oldest→newest. Returns [] (not an error) when there's nothing yet, so the panel can
  // render its empty state cleanly.
  app.get('/api/pundit/history', requireAuth, (c) => {
    const wallet = c.get('wallet');
    const fixtureId = Number(c.req.query('fixtureId'));
    if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
      return c.json({ error: 'invalid fixtureId' }, 400);
    }
    const lines = getPunditHistory(fixtureId, wallet);
    return c.json(lines);
  });

  // POST /api/pundit/ask — put a question to the pundit. Body:
  //   { fixtureId: number, question: string }
  // where `question` is EITHER a preset id (ASK_PRESETS) OR free text (<=140 chars,
  // newlines stripped). Replies in-persona (<=2 sentences). The reply is returned here
  // AND emitted on the bus 'pundit' event (kind 'ask') so the WS delivers it too.
  app.post('/api/pundit/ask', requireAuth, async (c) => {
    const wallet = c.get('wallet');
    const body = await c.req.json().catch(() => ({}));
    const fixtureId = Number(body.fixtureId);
    if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
      return c.json({ error: 'invalid fixtureId' }, 400);
    }

    const raw = typeof body.question === 'string' ? body.question : '';
    const question = raw.replace(/[\r\n]+/g, ' ').trim();
    const preset = (ASK_PRESETS as readonly string[]).includes(question) ? (question as AskPreset) : null;
    if (!preset) {
      if (!question) return c.json({ error: 'question required' }, 400);
      if (question.length > ASK_MAX_LEN) {
        return c.json({ error: 'question too long', max: ASK_MAX_LEN }, 400);
      }
    }

    // Throttle: keyed per wallet+fixture. Cap first (a hard per-match budget), then cooldown.
    const key = `${wallet}:${fixtureId}`;
    const now = Date.now();
    const used = askCount.get(key) ?? 0;

    // Cap exhausted — no questions left for this match, ever (process lifetime). retryAfter 0
    // because waiting won't help; the budget is spent.
    if (used >= ASK_MAX_PER_FIXTURE) {
      return c.json({ error: 'out of questions for this match', retryAfter: 0, remaining: 0 }, 429);
    }

    // Cooldown — one ask per 300s. Doesn't consume a slot, so `remaining` is unchanged.
    const last = lastAsk.get(key) ?? 0;
    const elapsed = now - last;
    if (elapsed < ASK_COOLDOWN_MS) {
      return c.json(
        {
          error: 'slow down',
          retryAfter: Math.ceil((ASK_COOLDOWN_MS - elapsed) / 1000),
          remaining: ASK_MAX_PER_FIXTURE - used,
        },
        429,
      );
    }

    // Consume a slot + stamp the cooldown BEFORE generating, so a burst of taps can't fan out
    // multiple LLM calls. `remaining` is asks left AFTER this one.
    const usedAfter = used + 1;
    askCount.set(key, usedAfter);
    lastAsk.set(key, now);
    const remaining = ASK_MAX_PER_FIXTURE - usedAfter;

    const reply = await askPundit(wallet, fixtureId, preset, preset ? '' : question);
    if (!reply) {
      // Unknown fixture. Keep the consumed slot + stamped cooldown: releasing them here would let
      // a caller spam bogus fixtureIds unthrottled (each request clearing its own gate), an
      // unbounded cheap-DB-query vector. A bad request still spends its slot and its cooldown.
      return c.json({ error: 'unknown fixture' }, 404);
    }
    return c.json({ ...reply, remaining });
  });
}
