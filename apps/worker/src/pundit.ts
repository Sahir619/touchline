// The live AI pundit. Reacts to goals/cards, significant 1X2 odds swings, and pick
// resolutions for users who have an open pick on the fixture. Generates a short,
// persona-flavoured line — an OpenRouter FREE model when OPENROUTER_API_KEY (+
// OPENROUTER_MODEL) are set, else deterministic templates — and publishes it to
// the bus for the WS gateway to fan out. The template fallback is the reliability
// floor: every path below degrades to it on any provider error, so a live line
// ALWAYS reaches the WS even with no key or a failing provider.
//
// Board directive (SAH-55, supersedes SAH-53's OpenAI note): OpenRouter only —
// never OPENAI_API_KEY or any key the board hasn't explicitly provided.

import { eq, and, gt } from 'drizzle-orm';
import { marketKey, personaById, decimalOdds, STAR_MAN_MARKET, type OddsPayload, type ScoreEvent } from '@touchline/shared';
import { db } from './db/client.ts';
import { fixtures, picks, users, scoreState, oddsLatest, scoreEvents, lineups } from './db/schema.ts';
import { bus } from './bus.ts';

// ---------------------------------------------------------------------------
// Player-name awareness (Star Man). A per-fixture playerId -> display-name map,
// cached with a short TTL, lets the pundit name the scorer in goal lines and match
// reports, and lets Ask-the-Pundit reference the fan's Star Man by name. The names
// come ONLY from the stored official lineup — the LLM prompts forbid inventing any.
// ---------------------------------------------------------------------------
const PLAYER_MAP_TTL_MS = 60_000;
const playerMapCache = new Map<number, { at: number; map: Map<number, string> }>();

async function playerNameMap(fixtureId: number): Promise<Map<number, string>> {
  const now = Date.now();
  const cached = playerMapCache.get(fixtureId);
  if (cached && now - cached.at < PLAYER_MAP_TTL_MS) return cached.map;
  const rows = await db
    .select({ playerId: lineups.playerId, name: lineups.name })
    .from(lineups)
    .where(eq(lineups.fixtureId, fixtureId));
  const map = new Map<number, string>();
  for (const r of rows) map.set(r.playerId, r.name);
  playerMapCache.set(fixtureId, { at: now, map });
  return map;
}

/** True iff the given player scored a legitimate (non-own) goal in this fixture. */
async function playerScored(fixtureId: number, playerId: number): Promise<boolean> {
  const rows = await db
    .select({ dataSoccer: scoreEvents.dataSoccer })
    .from(scoreEvents)
    .where(and(eq(scoreEvents.fixtureId, fixtureId), eq(scoreEvents.action, 'goal')));
  for (const r of rows) {
    const d = r.dataSoccer as { PlayerId?: number; GoalType?: string } | null;
    if (d?.PlayerId === playerId && d.GoalType !== 'Own') return true;
  }
  return false;
}

const SWING_THRESHOLD = 4; // percentage points on a 1X2 implied-probability move
const RATE_MS = 25_000; // min gap between non-result lines per user+fixture
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const LLM_TIMEOUT_MS = 8_000;

// Golden rule #2 guardrail, enforced post-generation. The system prompt already forbids
// bet/wager/stake/gamble, but a crafted free-text "Ask the Pundit" question could jailbreak
// the model into off-brand output. Any model line that slips a banned word is treated as a
// provider failure so the caller degrades to the safe template — the reliability floor that
// is already vetted clean of this vocabulary.
const BANNED_VOCAB = /\b(bets?|betting|bettors?|wagers?|wager(?:ed|ing)|stakes?|staked|gambl(?:e|es|ed|ing))\b/i;

const openrouterKey = process.env.OPENROUTER_API_KEY || null;
const openrouterModel = process.env.OPENROUTER_MODEL || null;
// Both the key AND a model id must be supplied — a key with no model (or vice versa)
// is a misconfiguration, not a "go live" signal, so we stay on templates.
const openrouterReady = Boolean(openrouterKey && openrouterModel);

/** Which line-generation path is live. Decided once at boot; `console.log`ed below
 *  so the active mode is always visible in the worker's own startup output. */
export type PunditMode = 'openrouter' | 'template';
const mode: PunditMode = openrouterReady ? 'openrouter' : 'template';

export function punditMode(): PunditMode {
  return mode;
}

export type Kind = 'goal' | 'card' | 'swing' | 'result-win' | 'result-loss' | 'line_beat' | 'ask';

interface Ctx {
  persona: string;
  home: string;
  away: string;
  team: string; // the team/outcome the user backed
  label: '1' | 'X' | '2' | string;
  odds: number;
  streak?: number;
  // Star Man awareness: the named player involved in this event (the scorer on a goal, the
  // booked player on a card), when known from the fixture's stored lineup. Undefined otherwise.
  player?: string;
  // Beat the Line (line_beat) context — implied-probability fractions [0,1] at lock/close
  // and CLV in percentage points. Present only for line_beat lines.
  pctAtLock?: number | null;
  pctAtClose?: number | null;
  clv?: number;
}

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
/** A fraction [0,1] rendered as a whole-percent string (0.44 → "44"). */
const pctText = (f: number | null | undefined): string => (f == null ? '-' : String(Math.round(f * 100)));

function fallbackLine(kind: Kind, c: Ctx): string {
  const p = c.persona;
  const team = c.team;
  if (kind === 'result-win') {
    return {
      hype: `YESSS! ${team} came through. That's points in the bank and a streak alive!`,
      rival: `Well, well. ${team} actually delivered. Don't let it go to your head.`,
      nerd: `${team} held. Your ${c.odds.toFixed(2)} call cashed, exactly what the number implied.`,
      homer: `Never in doubt. ${team} were always winning that. Always.`,
    }[p] ?? `${team} came through. Nice call.`;
  }
  if (kind === 'result-loss') {
    return {
      hype: `Ah no! ${team} let us down, but we go again next match, head up!`,
      rival: `Backed ${team}, did you? The market warned you. It usually does.`,
      nerd: `${team} didn't land. Variance happens; the process was fine.`,
      homer: `Robbery. ${team} deserved better. We'll get them next time.`,
    }[p] ?? `${team} fell short this time.`;
  }
  if (kind === 'goal') {
    const who = c.player;
    if (who) {
      return {
        hype: pick([`${who} SCORES! The whole complexion just changed for your ${team} call!`, `GOAL from ${who}! Your ${team} pick is right in the mix now!`]),
        rival: pick([`${who} scores. Suddenly your ${team} pick looks... interesting.`, `${who} finds the net. Hope you're on the right side of this one.`]),
        nerd: `${who} scores, recalculating. Your ${team} pick's live probability just shifted.`,
        homer: `GET IN, ${who}! That's the kind of football ${team} were made for!`,
      }[p] ?? `${who} scores! Your ${team} pick is in play.`;
    }
    return {
      hype: pick([`GOAL! The whole complexion just changed for your ${team} call!`, `That's a goal! Your ${team} pick is right in the mix now!`]),
      rival: pick([`A goal. Suddenly your ${team} pick looks... interesting.`, `Goal in. Hope you're on the right side of this one.`]),
      nerd: `Goal logged, recalculating. Your ${team} pick's live probability just shifted.`,
      homer: `GET IN! That's the kind of football ${team} were made for!`,
    }[p] ?? `Goal! Your ${team} pick is in play.`;
  }
  if (kind === 'card') {
    const who = c.player;
    if (who) {
      return {
        hype: `Card for ${who}! Tension cranking up around your ${team} call!`,
        rival: `${who} goes into the book. Could swing things, for or against your ${team} pick.`,
        nerd: `${who} booked; expect the market to twitch on your ${team} line.`,
        homer: `Outrageous card on ${who} against the run of play. Stay strong, ${team}.`,
      }[p] ?? `${who} booked. Watch this one.`;
    }
    return {
      hype: `Card shown! Tension cranking up around your ${team} call!`,
      rival: `A card. Could swing things, for or against your ${team} pick.`,
      nerd: `Booking registered; expect the market to twitch on your ${team} line.`,
      homer: `Outrageous decision against the run of play. Stay strong, ${team}.`,
    }[p] ?? `Card shown. Watch this one.`;
  }
  if (kind === 'line_beat') {
    const from = pctText(c.pctAtLock);
    const to = pctText(c.pctAtClose);
    const cl = c.clv != null ? c.clv.toFixed(1) : '-';
    return {
      hype: pick([
        `The books just BLINKED. You were there first on ${team}! ${from}% to ${to}%.`,
        `You beat the line on ${team}! The market chased you from ${from}% to ${to}%.`,
      ]),
      rival: pick([
        `Hm. The market drifted your way on ${team}: ${from}% to ${to}%. Sharp. This time.`,
        `You were ahead of the line on ${team}: ${from}% to ${to}%. Don't get comfortable.`,
      ]),
      nerd: pick([
        `Closing line came to you: ${team} firmed ${from}% to ${to}% (+${cl}pt CLV). Textbook sharp signal.`,
        `Value caught on ${team}: implied ${from}% at lock, ${to}% at close. The number moved to you.`,
      ]),
      homer: pick([
        `See?! Even the market came round on ${team}: ${from}% up to ${to}%. Told you.`,
        `The line moved to US on ${team}: ${from}% to ${to}%. They doubted, then they followed.`,
      ]),
    }[p] ?? `You were ahead of the market on ${team}: ${from}% to ${to}%.`;
  }
  // swing
  return {
    hype: `Big odds move on your ${team} pick (locked at ${c.odds.toFixed(2)}). The market's reacting!`,
    rival: `The market just moved on ${team}. You locked ${c.odds.toFixed(2)}. Bold or doomed?`,
    nerd: `Significant price move on ${team}; your ${c.odds.toFixed(2)} lock is now off-market.`,
    homer: `Doubters shifting their money on ${team}. Let them. We know.`,
  }[p] ?? `Odds moving on your ${team} pick.`;
}

function buildPrompt(kind: Kind, c: Ctx): { system: string; user: string } {
  const persona = personaById(c.persona);
  const system =
    `You are a live football pundit for "Touchline", narrating ONE fan's prediction during a match. ` +
    `Persona: ${persona?.name ?? 'Hype-man'} (${persona?.blurb ?? 'loud and all-in'}). ` +
    `Write ONE punchy sentence (max 22 words), present tense, second person ("you"/"your pick"). ` +
    `Never use the words bet, wager, stake, or gamble. ` +
    `Use ONLY the player names explicitly provided here; never invent, guess, or complete a player's name. ` +
    `No emojis unless the persona is the hype-man.`;
  if (kind === 'line_beat') {
    const user =
      `Their pick just BEAT THE CLOSING LINE. The market moved toward their selection after they locked it in. ` +
      `The match is ${c.home} v ${c.away}. The fan backed "${c.team}" (${c.label}); the market's implied probability ` +
      `moved from ${pctText(c.pctAtLock)}% at lock to ${pctText(c.pctAtClose)}% at close` +
      (c.clv != null ? ` (a ${c.clv.toFixed(1)}-point move their way)` : '') +
      `. Celebrate that they were ahead of the market, sharper than the line.`;
    return { system, user };
  }
  const event =
    kind === 'goal' ? `A goal was just scored${c.player ? ` by ${c.player}` : ''}.`
    : kind === 'card' ? `A card was just shown${c.player ? ` to ${c.player}` : ''}.`
    : kind === 'swing' ? 'The odds on their pick moved significantly.'
    : kind === 'result-win' ? 'Their pick just WON.'
    : 'Their pick just LOST.';
  const user =
    `${event} The match is ${c.home} v ${c.away}. The fan backed "${c.team}" (${c.label}) at odds ${c.odds.toFixed(2)}.` +
    (c.streak != null ? ` Their current streak is ${c.streak}.` : '');
  return { system, user };
}

// OpenAI-compatible chat completions call against OpenRouter's FREE-tier model.
// Never touches ANTHROPIC_API_KEY / OPENAI_API_KEY — OpenRouter + a `:free` model
// id, both explicitly supplied by the board via env, is the only live path.
async function openrouterLine(kind: Kind, c: Ctx): Promise<string> {
  const { system, user } = buildPrompt(kind, c);
  return openrouterChat(system, user);
}

/** The raw OpenRouter chat call (shared by the reactive lines and the conversational
 *  "Ask the Pundit" replies). Throws on any provider error; callers fall back to a template. */
async function openrouterChat(system: string, user: string, maxTokens = 80): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${openrouterKey}`,
        'X-Title': 'Touchline',
      },
      body: JSON.stringify({
        model: openrouterModel,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    let text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty openrouter response');
    // Models sometimes wrap the whole line in matching quotes — strip that one layer so
    // the pundit reads as a spoken line, not a citation.
    if (text.length > 1 && /^["'“”].*["'“”]$/.test(text)) text = text.slice(1, -1).trim();
    // Reject banned gambling vocabulary — the caller falls back to the safe template.
    if (BANNED_VOCAB.test(text)) throw new Error('pundit output contained banned vocabulary');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function generate(kind: Kind, c: Ctx): Promise<string> {
  if (mode === 'openrouter') {
    try {
      return await openrouterLine(kind, c);
    } catch (e) {
      console.error(`[touchline-worker] pundit: OpenRouter call failed, falling back to template (${kind})`, e);
    }
  }
  return fallbackLine(kind, c);
}

async function loadCtx(wallet: string, fixtureId: number, streak?: number): Promise<Ctx | null> {
  // Scoped to 1X2: pundit commentary (team/selection/odds phrasing below) only
  // understands the part1|draw|part2 shape. Now that Over/Under and correct-score
  // picks (W7/SAH-35) can share a wallet+fixture with a 1X2 pick, an unscoped query
  // could grab the wrong row and narrate the wrong market.
  const [p] = await db
    .select()
    .from(picks)
    .where(and(eq(picks.wallet, wallet), eq(picks.fixtureId, fixtureId), eq(picks.market, '1X2_PARTICIPANT_RESULT')));
  if (!p) return null;
  const [u] = await db.select().from(users).where(eq(users.wallet, wallet));
  const [fx] = await db.select().from(fixtures).where(eq(fixtures.fixtureId, fixtureId));
  if (!fx) return null;
  const team = p.selection === 'part1' ? fx.participant1 : p.selection === 'part2' ? fx.participant2 : 'the draw';
  return {
    persona: u?.persona ?? 'hype',
    home: fx.participant1,
    away: fx.participant2,
    team,
    label: p.selectionLabel,
    odds: p.oddsAtLock,
    streak,
  };
}

const lastFired = new Map<string, number>();
const watched = new Set<number>();

/** Register a fixture as having an open pick immediately, so a goal/swing/card that
 *  lands right after a pick is locked isn't missed waiting on the next periodic
 *  `refresh()` (up to 12s later). Called from the picks route on lock. */
export function markWatched(fixtureId: number): void {
  watched.add(fixtureId);
}

export async function fireForWallet(fixtureId: number, wallet: string, kind: Kind, streak?: number, player?: string): Promise<void> {
  const isResult = kind === 'result-win' || kind === 'result-loss';
  const key = `${wallet}:${fixtureId}`;
  if (!isResult) {
    const last = lastFired.get(key) ?? 0;
    if (Date.now() - last < RATE_MS) return;
    lastFired.set(key, Date.now());
  }
  const ctx = await loadCtx(wallet, fixtureId, streak);
  if (!ctx) return;
  if (player) ctx.player = player;
  const line = await generate(kind, ctx);
  bus.emit('pundit', { wallet, fixtureId, line, persona: ctx.persona, kind, ts: Date.now() });
}

/** Map a stored selectionLabel back to a human team/outcome phrase for line_beat. */
function teamFromLabel(label: string, fx: { participant1: string; participant2: string }): string {
  if (label === '1') return fx.participant1;
  if (label === '2') return fx.participant2;
  if (label === 'X') return 'the draw';
  if (label === 'O') return 'the Over';
  if (label === 'U') return 'the Under';
  return label; // correct-score scoreline etc. (never emitted for line_beat)
}

/**
 * Beat the Line pundit line. Driven by a bus 'clv' event (emitted only when a pick beat
 * the closing line). Bypasses the RATE_MS gate — like result lines, a line-beat is a
 * meaningful one-shot moment, not noisy stream chatter. Builds its ctx from the event
 * payload (which carries the pct move) rather than reloading a 1X2 pick, so it narrates
 * the exact market that beat the line (1X2 OR Over/Under).
 */
export async function fireLineBeat(v: {
  wallet: string;
  fixtureId: number;
  selectionLabel: string;
  pctAtLock: number | null;
  pctAtClose: number | null;
  clv: number;
}): Promise<void> {
  const [fx] = await db.select().from(fixtures).where(eq(fixtures.fixtureId, v.fixtureId));
  if (!fx) return;
  const [u] = await db.select().from(users).where(eq(users.wallet, v.wallet));
  const ctx: Ctx = {
    persona: u?.persona ?? 'hype',
    home: fx.participant1,
    away: fx.participant2,
    team: teamFromLabel(v.selectionLabel, fx),
    label: v.selectionLabel,
    odds: 0, // unused by the line_beat prompt/fallback (they narrate the pct move instead)
    pctAtLock: v.pctAtLock,
    pctAtClose: v.pctAtClose,
    clv: v.clv,
  };
  const line = await generate('line_beat', ctx);
  bus.emit('pundit', { wallet: v.wallet, fixtureId: v.fixtureId, line, persona: ctx.persona, kind: 'line_beat', ts: Date.now() });
}

// ---------------------------------------------------------------------------
// Ask the Pundit (conversational) — the fan asks a question, the pundit replies
// in-persona. Reuses the same context/persona plumbing, OpenRouter path and
// template-fallback floor as the reactive lines above, and publishes the reply
// on the SAME bus 'pundit' event (kind: 'ask') so the WS gateway fans it out
// with no server/web wiring change.
// ---------------------------------------------------------------------------

export const ASK_PRESETS = ['hows_my_call', 'what_happened', 'settle_my_nerves'] as const;
export type AskPreset = (typeof ASK_PRESETS)[number];
export const ASK_MAX_LEN = 140;

/** The natural-language question each preset stands for (fed to the LLM). */
const PRESET_QUESTION: Record<AskPreset, string> = {
  hows_my_call: "How's my call looking right now?",
  what_happened: 'What just happened in the match?',
  settle_my_nerves: 'Settle my nerves, talk me through this.',
};

interface AskCtx {
  persona: string;
  home: string;
  away: string;
  hasPick: boolean;
  team: string; // '' when the fan has no call on this fixture
  label: string;
  odds: number;
  beatLine: boolean;
  clv: number | null;
  homeGoals: number;
  awayGoals: number;
  minute: number | null;
  status: string | null; // short human phrase, e.g. 'first half'
  liveOdds: [number, number, number] | null; // decimal [home, draw, away]
  // Star Man awareness: the fan's Star Man call on this fixture (display name) and whether
  // he has already scored a legitimate goal. null name = no Star Man call on this fixture.
  starManName: string | null;
  starManScored: boolean;
  preset: AskPreset | null;
  question: string; // the resolved natural-language question
}

function shortStatus(id: string | null | undefined): string | null {
  const code = (id ?? '').toUpperCase();
  if (!code || code === 'NS') return null;
  if (code.startsWith('HT')) return 'half-time';
  if (code === 'F' || code.startsWith('TXC')) return 'full time';
  if (code.startsWith('H1')) return 'first half';
  if (code.startsWith('H2')) return 'second half';
  if (code.startsWith('ET') || code.startsWith('FET')) return 'extra time';
  if (code.startsWith('PE') || code.startsWith('FPE')) return 'penalties';
  return 'live';
}

/** Whose 1X2 outcome is currently leading, as a selectionLabel. */
function leadLabel(homeGoals: number, awayGoals: number): '1' | 'X' | '2' {
  if (homeGoals > awayGoals) return '1';
  if (awayGoals > homeGoals) return '2';
  return 'X';
}

async function loadAskCtx(
  wallet: string,
  fixtureId: number,
  preset: AskPreset | null,
  freeText: string,
): Promise<AskCtx | null> {
  const [fx] = await db.select().from(fixtures).where(eq(fixtures.fixtureId, fixtureId));
  if (!fx) return null;
  const [u] = await db.select().from(users).where(eq(users.wallet, wallet));
  // The fan's 1X2 call on this fixture (if any) — the pundit narrates the 1X2 shape.
  const [p] = await db
    .select()
    .from(picks)
    .where(and(eq(picks.wallet, wallet), eq(picks.fixtureId, fixtureId), eq(picks.market, '1X2_PARTICIPANT_RESULT')));
  const [ss] = await db.select().from(scoreState).where(eq(scoreState.fixtureId, fixtureId));
  const [od] = await db
    .select()
    .from(oddsLatest)
    .where(and(eq(oddsLatest.fixtureId, fixtureId), eq(oddsLatest.superOddsType, '1X2_PARTICIPANT_RESULT')));

  const sc = ss?.scoreSoccer as
    | { Participant1?: { Total?: { Goals?: number } }; Participant2?: { Total?: { Goals?: number } } }
    | null
    | undefined;
  const homeGoals = sc?.Participant1?.Total?.Goals ?? 0;
  const awayGoals = sc?.Participant2?.Total?.Goals ?? 0;
  const clockSeconds = (ss?.clock as { seconds?: number } | null | undefined)?.seconds ?? null;
  const minute = clockSeconds != null ? Math.floor(clockSeconds / 60) : null;

  const prices = od?.prices ?? null;
  const liveOdds =
    prices && prices.length === 3
      ? ([decimalOdds(prices[0]!), decimalOdds(prices[1]!), decimalOdds(prices[2]!)] as [number, number, number])
      : null;

  // The fan's Star Man call on this fixture (if any) — name + whether he has scored.
  const [sm] = await db
    .select()
    .from(picks)
    .where(and(eq(picks.wallet, wallet), eq(picks.fixtureId, fixtureId), eq(picks.market, STAR_MAN_MARKET)));
  const starManName = sm ? sm.selectionLabel : null;
  const starManScored = sm ? await playerScored(fixtureId, Number(sm.selection)) : false;

  const team = p ? (p.selection === 'part1' ? fx.participant1 : p.selection === 'part2' ? fx.participant2 : 'the draw') : '';
  return {
    persona: u?.persona ?? 'hype',
    home: fx.participant1,
    away: fx.participant2,
    hasPick: Boolean(p),
    team,
    label: p?.selectionLabel ?? '',
    odds: p?.oddsAtLock ?? 0,
    beatLine: p?.beatLine ?? false,
    clv: p?.clv ?? null,
    homeGoals,
    awayGoals,
    minute,
    status: shortStatus(ss?.statusSoccerId),
    liveOdds,
    starManName,
    starManScored,
    preset,
    question: preset ? PRESET_QUESTION[preset] : freeText,
  };
}

function buildAskPrompt(c: AskCtx): { system: string; user: string } {
  const persona = personaById(c.persona);
  const system =
    `You are a live football pundit for "Touchline", talking directly to ONE fan during a match. ` +
    `Persona: ${persona?.name ?? 'Hype-man'} (${persona?.blurb ?? 'loud and all-in'}). ` +
    `Answer their question in character in AT MOST two short sentences, present tense, second person ("you"/"your call"). ` +
    `Never use the words bet, wager, stake, gamble, or any money/cash framing (no "put money on", "odds to win cash"). ` +
    `this is a free prediction game. Talk "call", "pick", "the line", "the market", "points". ` +
    `No emojis unless the persona is the hype-man. Only use the facts given below; if you can't answer from them, ` +
    `deflect warmly in character, and never invent a scoreline, result or statistic. ` +
    `Use ONLY the player names explicitly provided here; never invent, guess, or complete a player's name.`;
  const min = c.minute != null ? ` at ${c.minute}'` : c.status ? ` (${c.status})` : '';
  // Pre-kickoff there is no score and no match action; say so explicitly or the model
  // narrates possession/chances for a match that has not started.
  const scoreLine =
    c.status == null && c.minute == null && c.homeGoals === 0 && c.awayGoals === 0
      ? `${c.home} v ${c.away} has NOT kicked off yet. There is no score and no match action; only pre-match talk.`
      : `Current score: ${c.home} ${c.homeGoals}-${c.awayGoals} ${c.away}${min}.`;
  const pickLine = c.hasPick
    ? `The fan's call on this match: ${c.team} (${c.label}) locked at ${c.odds.toFixed(2)} decimal odds` +
      (c.beatLine ? `, a call that has since beaten the closing line` : '') +
      `.`
    : `The fan has NOT made a call on this match yet.`;
  // Star Man context: name the fan's called player and whether he has scored yet.
  const starManLine = c.starManName
    ? ` Their Star Man call is ${c.starManName}, who has ${c.starManScored ? 'ALREADY scored' : 'not scored yet'}.`
    : '';
  const marketLine = c.liveOdds
    ? ` Latest 1X2 line: ${c.home} ${c.liveOdds[0].toFixed(2)}, draw ${c.liveOdds[1].toFixed(2)}, ${c.away} ${c.liveOdds[2].toFixed(2)}.`
    : '';
  const user = `${scoreLine} ${pickLine}${starManLine}${marketLine}\n\nThe fan asks: "${c.question}"`;
  return { system, user };
}

function askFallback(c: AskCtx): string {
  const p = c.persona;
  const team = c.team;
  const ahead = c.hasPick && c.label === leadLabel(c.homeGoals, c.awayGoals);
  const scoreText = `${c.home} ${c.homeGoals}-${c.awayGoals} ${c.away}`;
  const min = c.minute != null ? ` at ${c.minute}'` : c.status ? ` (${c.status})` : '';

  if (c.preset === 'hows_my_call') {
    if (!c.hasPick) {
      return {
        hype: `No call from you on this one yet?! Lock a pick in and I'll ride every kick with you!`,
        rival: `You want my read on a call you haven't made. Pick a side first, then we'll talk.`,
        nerd: `No pick logged on this fixture yet. Make a call and I'll track the probabilities for you.`,
        homer: `Back a side and I'll cheer it home. You've not made your call here yet.`,
      }[p] ?? `You haven't made a call on this one yet. Lock a pick and I'll break it down.`;
    }
    if (ahead) {
      return {
        hype: `Your ${team} call is LIVE and in front. This is exactly the ride you signed up for!`,
        rival: `Your ${team} call is ahead. Enjoy it. Matches have a way of turning.`,
        nerd: `${team} is in front; your ${c.odds.toFixed(2)} call is tracking ahead of the number.`,
        homer: `${team} on top, right where they belong. Never a doubt.`,
      }[p] ?? `Your ${team} call is ahead right now, looking good.`;
    }
    return {
      hype: `Your ${team} call is still alive. One moment flips this whole thing, stay with it!`,
      rival: `Your ${team} call is chasing it. Bold pick, and the market did warn you.`,
      nerd: `${team} isn't ahead yet, but there's match left for your ${c.odds.toFixed(2)} call to come good.`,
      homer: `${team} are due. They've been the better side and it'll show. Hold the line.`,
    }[p] ?? `Your ${team} call is behind for now, but it's not over.`;
  }

  if (c.preset === 'what_happened') {
    return {
      hype: `We're at ${scoreText}${min}. Every second matters now, do not look away!`,
      rival: `It's ${scoreText}${min}. Not much between them, whatever the scoreboard flatters.`,
      nerd: `Current state: ${scoreText}${min}. Broadly where the pre-match numbers had it.`,
      homer: `${scoreText}${min}. Our lot are giving everything, you can feel it.`,
    }[p] ?? `Right now it's ${scoreText}${min}.`;
  }

  if (c.preset === 'settle_my_nerves') {
    if (ahead) {
      return {
        hype: `Breathe. You're AHEAD and flying. Enjoy this one, you earned the ride!`,
        rival: `Nervous while you're winning? Relax. Panicking never changed a scoreline.`,
        nerd: `Take a breath: you're in front and the process was sound. Trust it, not the pulse.`,
        homer: `Easy now. We're on top and I always had faith. Sit back and enjoy it.`,
      }[p] ?? `Deep breath. You're ahead. Enjoy it.`;
    }
    return {
      hype: `Deep breath. Nothing's decided yet. Backs straight, we go again on the next kick!`,
      rival: `You made the call, now you live with it. Relax. Panicking never changed a scoreline.`,
      nerd: `Take a breath: it's one match and variance is loud over ninety minutes. Trust the process.`,
      homer: `Easy now, have faith. Our side doesn't let us down, and neither will this.`,
    }[p] ?? `Deep breath. It's not decided yet. Stay with it.`;
  }

  // Free text with no LLM available — a graceful in-persona deflection.
  return {
    hype: `Love the curiosity! I'm best on your call and the live action, so ask how your pick's looking!`,
    rival: `Cute question. I stick to your calls and what's on the pitch, so try me on those.`,
    nerd: `That's outside my model. I read your picks, the score and the market. Ask about those.`,
    homer: `Ha! I've only got eyes for the match and your call. Ask me about those and I'll talk all day.`,
  }[p] ?? `I'm best on your call and the live match. Ask me about those and I'm all yours.`;
}

async function generateAsk(c: AskCtx): Promise<string> {
  if (mode === 'openrouter') {
    try {
      const { system, user } = buildAskPrompt(c);
      // Ask replies are up to two sentences — give them more room than the one-line reactions.
      return await openrouterChat(system, user, 140);
    } catch (e) {
      console.error('[touchline-worker] pundit: OpenRouter ask failed, falling back to template', e);
    }
  }
  return askFallback(c);
}

/**
 * Answer a fan's question about a fixture in-persona. Returns the reply envelope
 * (also emitted on the bus 'pundit' event, kind 'ask', so the WS delivers it too),
 * or null if the fixture is unknown. `preset` is one of ASK_PRESETS; when null,
 * `freeText` is the (already validated + sanitised) free-text question.
 */
export async function askPundit(
  wallet: string,
  fixtureId: number,
  preset: AskPreset | null,
  freeText: string,
): Promise<{ line: string; persona: string; kind: 'ask'; ts: number } | null> {
  const ctx = await loadAskCtx(wallet, fixtureId, preset, freeText);
  if (!ctx) return null;
  const line = await generateAsk(ctx);
  const ts = Date.now();
  bus.emit('pundit', { wallet, fixtureId, line, persona: ctx.persona, kind: 'ask', ts });
  return { line, persona: ctx.persona, kind: 'ask', ts };
}

export async function fireForFixture(fixtureId: number, kind: Kind, player?: string): Promise<void> {
  const open = await db
    .select({ wallet: picks.wallet })
    .from(picks)
    .where(and(eq(picks.fixtureId, fixtureId), eq(picks.status, 'open'), eq(picks.market, '1X2_PARTICIPANT_RESULT')));
  for (const { wallet } of open) await fireForWallet(fixtureId, wallet, kind, undefined, player);
}

const lastPct = new Map<string, (number | null)[]>();

// ---------------------------------------------------------------------------
// 5-minute match reporter — ONE update line per LIVE fixture every 5 real minutes:
// the current score, the clock minute, and one flavour observation (odds drift if the
// 1X2 line moved since the last report, else momentum from recent score_events, else a
// quiet holding line).
//
// Token economics (rule 7): the report is TEMPLATE-BUILT by default (no LLM). The LLM is
// used at most on every SECOND report for a fixture, and only when something actually
// changed since the last report (a goal/card, or a real odds move) — so a quiet match is
// pure templates and never spends a token. The line is generated ONCE per fixture per
// interval, then fanned out to each viewer.
//
// Broadcast scoping: pundit events are WALLET-SCOPED — the WS gateway broadcasts every
// 'pundit' event to all sockets, and the web filters strictly by `p.wallet === wallet`
// (live/[id]/page.tsx + punditHistory.getPunditHistory). There is no '*'/null broadcast
// convention the web tolerates. So we emit ONE event PER open-pick wallet on the fixture,
// all carrying the same line (each viewer's client keeps only its own; the per-wallet
// history buffer backfills it too), so every viewer of the fixture sees it exactly once.
const REPORT_EVERY_MS = 300_000; // one report per fixture per 5 real minutes
const REPORT_CHECK_MS = 60_000; // tick cadence; the per-fixture gate does the real 5-min spacing
const REPORT_DRIFT_PT = 3; // implied-probability points that count as "the line moved"
const GOAL_ACTIONS = new Set(['goal', 'own_goal', 'penalty_goal']);
const CARD_ACTIONS = new Set(['yellow_card', 'red_card', 'second_yellow_card']);

interface ReportState {
  lastReportAt: number;
  count: number; // reports emitted so far for this fixture (drives the every-2nd-report LLM gate)
  pct: (number | null)[] | null; // 1X2 implied-prob points at last report (odds-drift baseline)
  eventSeq: number; // max score_events.seq seen at last report (momentum baseline)
}
const reportState = new Map<number, ReportState>();

const wordNum = (n: number): string =>
  (['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] ?? String(n));

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The one flavour observation. Odds drift wins when the line moved; else recent momentum;
 *  else a quiet holding line. `hasBaseline` is false on a fixture's first report (nothing to
 *  compare against yet), so it opens with a neutral line. No em dashes in any template string. */
function reportFlavour(o: {
  hasBaseline: boolean;
  driftName: string | null; // participant/draw the market moved toward, if it moved enough
  goals: number;
  cards: number;
  totalGoals: number;
  scorer?: string | null; // most recent goalscorer since the last check, when known
}): string {
  if (o.driftName) return `The market's leaning toward ${o.driftName} since the last look.`;
  if (o.hasBaseline && o.goals >= 2) {
    const tail = o.scorer ? ` ${o.scorer} among the scorers.` : '';
    return `${cap(wordNum(o.goals))} goals since the last check, this one's wide open.${tail}`;
  }
  if (o.hasBaseline && o.goals === 1) return o.scorer ? `${o.scorer} strikes since the last check and reshapes it.` : `A goal since the last check reshapes it.`;
  if (o.hasBaseline && o.cards >= 2) return `${cap(wordNum(o.cards))} cards since the last check and the tension's climbing.`;
  if (o.hasBaseline && o.cards === 1) return `A booking since the last check, still finely balanced.`;
  return o.totalGoals === 0 ? `Still goalless and cagey.` : `A quiet spell, the scoreline holds.`;
}

/** The full template report line: minute, score, flavour. The reliability floor for the
 *  reporter (used by default and whenever the optional LLM path fails). No em dashes. */
function reportTemplate(home: string, away: string, hg: number, ag: number, minute: number | null, flavour: string): string {
  const clock = minute != null ? `${minute}'` : 'Live';
  return `${clock} ${home} ${hg}-${ag} ${away}. ${flavour}`;
}

/** Prompt for the optional LLM report line (one fixture-level sentence). Persona-neutral: the
 *  report is a match update, not a per-fan narration, so one line serves every viewer. */
function buildReportPrompt(home: string, away: string, hg: number, ag: number, minute: number | null, change: string): { system: string; user: string } {
  const system =
    `You are a live football pundit for "Touchline" giving fans a brief periodic match update. ` +
    `Write ONE punchy sentence (max 24 words), present tense. State the score and what has changed. ` +
    `Never use the words bet, wager, stake, or gamble, or any money/cash framing. ` +
    `Use ONLY the player names explicitly provided here; never invent, guess, or complete a player's name. No emojis.`;
  const min = minute != null ? ` at ${minute}'` : '';
  const user = `Match: ${home} ${hg}-${ag} ${away}${min}. Since the last update: ${change}. Give a short update line.`;
  return { system, user };
}

/** Report one live fixture: build the line once, fan it out to every open-pick wallet. */
async function reportFixture(fixtureId: number, now: number): Promise<void> {
  const [fx] = await db.select().from(fixtures).where(eq(fixtures.fixtureId, fixtureId));
  if (!fx) return;
  const [ss] = await db.select().from(scoreState).where(eq(scoreState.fixtureId, fixtureId));
  if (!ss || ss.gameState !== 'live') return; // only narrate while genuinely LIVE

  // The fans with a stake on this match are the only viewers who get pundit lines (and the
  // only ones whose wallet-scoped client will keep it). No stake in the room, no report.
  const walletRows = await db
    .selectDistinct({ wallet: picks.wallet, persona: users.persona })
    .from(picks)
    .leftJoin(users, eq(users.wallet, picks.wallet))
    .where(and(eq(picks.fixtureId, fixtureId), eq(picks.status, 'open')));
  if (walletRows.length === 0) return; // leave lastReportAt unstamped so a fresh picker gets a prompt opener

  const sc = ss.scoreSoccer as
    | { Participant1?: { Total?: { Goals?: number } }; Participant2?: { Total?: { Goals?: number } } }
    | null
    | undefined;
  const hg = sc?.Participant1?.Total?.Goals ?? 0;
  const ag = sc?.Participant2?.Total?.Goals ?? 0;
  const clockSeconds = (ss.clock as { seconds?: number } | null | undefined)?.seconds ?? null;
  const minute = clockSeconds != null ? Math.floor(clockSeconds / 60) : null;

  const prev = reportState.get(fixtureId);
  const hasBaseline = prev != null;

  // Odds-drift baseline: current 1X2 implied-prob points vs the last report's.
  const [od] = await db
    .select()
    .from(oddsLatest)
    .where(and(eq(oddsLatest.fixtureId, fixtureId), eq(oddsLatest.superOddsType, '1X2_PARTICIPANT_RESULT')));
  const pct = (od?.pct ?? null)?.map((p) => (p === 'NA' ? null : Number.parseFloat(p))) ?? null;
  let driftIdx = -1;
  let driftMag = 0;
  if (hasBaseline && prev.pct && pct) {
    for (let i = 0; i < pct.length; i++) {
      const a = pct[i];
      const b = prev.pct[i];
      if (a != null && b != null && a - b > driftMag) {
        driftMag = a - b; // positive = implied prob rose for outcome i = market moved toward it
        driftIdx = i;
      }
    }
  }
  const drifted = driftIdx >= 0 && driftMag >= REPORT_DRIFT_PT;
  const driftName = !drifted ? null : driftIdx === 0 ? fx.participant1 : driftIdx === 2 ? fx.participant2 : 'a draw';

  // Momentum baseline: incidents logged since the last report's max seq. On the first report
  // (no baseline) we only advance the seq cursor, so the opener never over-claims momentum.
  const sinceSeq = prev?.eventSeq ?? 0;
  const evs = await db
    .select({ seq: scoreEvents.seq, action: scoreEvents.action, dataSoccer: scoreEvents.dataSoccer })
    .from(scoreEvents)
    .where(and(eq(scoreEvents.fixtureId, fixtureId), gt(scoreEvents.seq, sinceSeq)));
  let goals = 0;
  let cards = 0;
  let maxSeq = sinceSeq;
  let lastGoalSeq = -1;
  let lastGoalPlayerId: number | null = null;
  for (const e of evs) {
    if (e.seq > maxSeq) maxSeq = e.seq;
    if (GOAL_ACTIONS.has(e.action)) {
      goals++;
      if (e.seq > lastGoalSeq) {
        const d = e.dataSoccer as { PlayerId?: number; GoalType?: string } | null;
        // Name the scorer only for a legitimate (non-own) goal.
        if (d?.PlayerId != null && d.GoalType !== 'Own') {
          lastGoalSeq = e.seq;
          lastGoalPlayerId = d.PlayerId;
        }
      }
    } else if (CARD_ACTIONS.has(e.action)) cards++;
  }
  const scorer = lastGoalPlayerId != null ? (await playerNameMap(fixtureId)).get(lastGoalPlayerId) ?? null : null;

  const flavour = reportFlavour({ hasBaseline, driftName, goals, cards, totalGoals: hg + ag, scorer });

  // Something changed iff we have a baseline AND a real move happened since it (a goal/card, or
  // an odds drift). This gates the (optional) LLM call: quiet matches stay on templates.
  const changed = hasBaseline && (drifted || goals > 0 || cards > 0);
  // LLM at MOST every second report (odd prev.count: the 2nd, 4th, ... report), and only on change.
  const useLLM = mode === 'openrouter' && changed && (prev?.count ?? 0) % 2 === 1;

  let line: string;
  if (useLLM) {
    try {
      const change = driftName
        ? `the market is leaning toward ${driftName}`
        : goals > 0
          ? `${wordNum(goals)} goal(s) scored${scorer ? `, latest from ${scorer}` : ''}`
          : cards > 0
            ? `${wordNum(cards)} card(s) shown`
            : 'little has changed';
      const { system, user } = buildReportPrompt(fx.participant1, fx.participant2, hg, ag, minute, change);
      line = await openrouterChat(system, user, 60);
    } catch (e) {
      console.error('[touchline-worker] pundit: OpenRouter report failed, falling back to template', e);
      line = reportTemplate(fx.participant1, fx.participant2, hg, ag, minute, flavour);
    }
  } else {
    line = reportTemplate(fx.participant1, fx.participant2, hg, ag, minute, flavour);
  }

  // Fan out the SAME line per open-pick wallet (see broadcast-scoping note above). Persona is
  // the fan's own, so the report reads in the same voice as their reactive lines.
  const ts = Date.now();
  for (const { wallet, persona } of walletRows) {
    bus.emit('pundit', { wallet, fixtureId, line, persona: persona ?? 'hype', kind: 'report', ts });
  }

  reportState.set(fixtureId, { lastReportAt: now, count: (prev?.count ?? 0) + 1, pct, eventSeq: maxSeq });
}

/** One reporter pass: report every LIVE fixture whose 5-minute window is due. */
async function reportTick(): Promise<void> {
  const now = Date.now();
  const live = await db.select({ fixtureId: scoreState.fixtureId }).from(scoreState).where(eq(scoreState.gameState, 'live'));
  for (const { fixtureId } of live) {
    const st = reportState.get(fixtureId);
    if (st && now - st.lastReportAt < REPORT_EVERY_MS) continue; // not due yet
    await reportFixture(fixtureId, now);
  }
}

export function startPundit(): void {
  // Track which fixtures have open picks (fast-path filter for the noisy odds stream).
  const refresh = async () => {
    const rows = await db
      .selectDistinct({ fixtureId: picks.fixtureId })
      .from(picks)
      .where(and(eq(picks.status, 'open'), eq(picks.market, '1X2_PARTICIPANT_RESULT')));
    watched.clear();
    for (const r of rows) watched.add(r.fixtureId);
  };
  void refresh();
  setInterval(() => void refresh(), 12_000);

  bus.on('odds', (o: OddsPayload) => {
    if (!watched.has(o.FixtureId) || o.SuperOddsType !== '1X2_PARTICIPANT_RESULT') return;
    const key = marketKey(o);
    const pcts = (o.Pct ?? []).map((p) => (p === 'NA' ? null : Number.parseFloat(p)));
    const prev = lastPct.get(key);
    lastPct.set(key, pcts);
    if (!prev) return;
    let maxDelta = 0;
    for (let i = 0; i < pcts.length; i++) {
      const a = pcts[i];
      const b = prev[i];
      if (a != null && b != null && Math.abs(a - b) > Math.abs(maxDelta)) maxDelta = a - b;
    }
    if (Math.abs(maxDelta) >= SWING_THRESHOLD) void fireForFixture(o.FixtureId, 'swing');
  });

  bus.on('score', (ev: ScoreEvent) => {
    if (!watched.has(ev.fixtureId)) return;
    const d = ev.dataSoccer;
    const kind: Kind | null = d?.Goal ? 'goal' : d?.RedCard || d?.YellowCard ? 'card' : null;
    if (!kind) return;
    // Name the player when we know them from the stored lineup (Star Man awareness).
    void (async () => {
      const pid = d?.PlayerId;
      const player = pid != null ? (await playerNameMap(ev.fixtureId)).get(pid) : undefined;
      await fireForFixture(ev.fixtureId, kind, player);
    })();
  });

  bus.on('resolved', (r) => {
    void fireForWallet(r.fixtureId, r.wallet, r.correct ? 'result-win' : 'result-loss', r.streak);
  });

  // Beat the Line: a 'clv' event fires ONLY when a pick beat the closing line. Narrate it
  // immediately (bypasses RATE_MS, like a result line).
  bus.on('clv', (v) => {
    void fireLineBeat(v);
  });

  // 5-minute match reporter — started alongside the engine (pattern: closing.ts startClosingSweep).
  // In-flight guard so a pass slower than the tick can't overlap; try/catch so a bad pass can
  // never crash the worker.
  let reportRunning = false;
  const reportTickGuarded = async () => {
    if (reportRunning) return;
    reportRunning = true;
    try {
      await reportTick();
    } catch (e) {
      console.error('[touchline-worker] pundit match-reporter tick failed', e);
    } finally {
      reportRunning = false;
    }
  };
  setInterval(() => void reportTickGuarded(), REPORT_CHECK_MS);

  const modeLabel = mode === 'openrouter' ? `OpenRouter ${openrouterModel}` : 'template fallback';
  console.log(`[touchline-worker] pundit engine running (mode: ${modeLabel}); match reporter every 5m per live fixture.`);
}
