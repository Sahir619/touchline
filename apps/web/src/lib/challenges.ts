// Daily challenges — a small, satisfiable rotating set that closes the day-to-day loop.
//
// Everything here is PURE and derived from data the app already owns (today's slate +
// the user's locked picks). No new persistence: a challenge's done-state is a function
// of the picks the streak/pick engine already stores, so "done" survives reloads for
// free and can never drift from the real game state.

import { LONG_SHOT_THRESHOLD, nationByCode } from "@touchline/shared";
import type { Pick } from "./game";
import type { DisplayFixture } from "./api";

export interface ChallengeContext {
  /** Pickable fixtures on today's live slate (id > 0). Empty in preview/offline mode. */
  slate: DisplayFixture[];
  /** The signed-in user's picks (all time). Empty for guests. */
  picks: Pick[];
  /** The user's backed nation code, if any. */
  nation: string | null;
  /** True when the live slate hasn't loaded (fallback/preview) — challenges show muted. */
  preview: boolean;
}

export interface DailyChallenge {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  /** Optional count-up progress (e.g. 2 of 3 calls). */
  progress?: { have: number; need: number };
}

/** Whole-day index — stable within a calendar day, advances once per day → rotation. */
export function dayIndex(now: number): number {
  return Math.floor(now / 86_400_000);
}

/** Picks locked on fixtures that are on today's slate. */
function callsToday(ctx: ChallengeContext): Pick[] {
  const ids = new Set(ctx.slate.map((f) => f.id));
  return ctx.picks.filter((p) => ids.has(p.fixtureId));
}

/** The slate fixture featuring the user's nation, if it's playing today. */
export function nationFixtureToday(ctx: ChallengeContext): DisplayFixture | null {
  const nat = nationByCode(ctx.nation);
  if (!nat) return null;
  return (
    ctx.slate.find((f) => f.home === nat.name || f.away === nat.name) ?? null
  );
}

type Builder = (ctx: ChallengeContext, calls: Pick[]) => DailyChallenge;

// The core loop-driver — always shown. Target scales to the slate (never asks for more
// calls than there are matches), so it stays satisfiable on a light matchday.
const makeCalls: Builder = (ctx, calls) => {
  const need = Math.min(3, Math.max(1, ctx.slate.length || 3));
  const have = Math.min(calls.length, need);
  return {
    id: "make-calls",
    label: `Make ${need} calls today`,
    hint: "Lock your predictions before kickoff.",
    done: !ctx.preview && have >= need,
    progress: { have: ctx.preview ? 0 : have, need },
  };
};

// The rotating pool — one is featured each day alongside the core challenge.
const rotating: Builder[] = [
  (ctx, calls) => ({
    id: "call-upset",
    label: "Call an upset",
    hint: `Back a long shot: odds of ${LONG_SHOT_THRESHOLD.toFixed(2)} or better.`,
    done: !ctx.preview && calls.some((p) => p.oddsAtLock >= LONG_SHOT_THRESHOLD),
  }),
  (ctx, calls) => {
    const need = ctx.slate.length || 0;
    const have = Math.min(calls.length, need);
    return {
      id: "sweep-slate",
      label: "Sweep the slate",
      hint: "Call every match on today's card.",
      done: !ctx.preview && need > 0 && have >= need,
      progress: need > 0 ? { have: ctx.preview ? 0 : have, need } : undefined,
    };
  },
  (ctx, calls) => ({
    id: "ride-favourite",
    label: "Ride a favourite",
    hint: "Back a strong pick: odds under 1.80.",
    done: !ctx.preview && calls.some((p) => p.oddsAtLock < 1.8),
  }),
];

/**
 * Build the 2–3 daily challenges for `now`:
 *  1. the core "make N calls" driver (always),
 *  2. one rotating challenge (advances each day),
 *  3. a "back your nation" challenge — only when the backed nation is playing today.
 * Every returned challenge is satisfiable from today's slate.
 */
export function buildDailyChallenges(
  ctx: ChallengeContext,
  now: number,
): DailyChallenge[] {
  const calls = callsToday(ctx);
  const out: DailyChallenge[] = [makeCalls(ctx, calls)];

  const featured = rotating[dayIndex(now) % rotating.length];
  out.push(featured(ctx, calls));

  const natFx = nationFixtureToday(ctx);
  if (natFx) {
    const nat = nationByCode(ctx.nation);
    out.push({
      id: "back-nation",
      label: `Back ${nat?.name ?? "your nation"}`,
      hint: `Call ${natFx.home} v ${natFx.away}.`,
      done: !ctx.preview && calls.some((p) => p.fixtureId === natFx.id),
    });
  }
  return out;
}
