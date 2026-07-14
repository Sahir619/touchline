// Instant, client-side pundit reaction for the *moment a pick is made*.
//
// This is the demo-critical path: it needs no network, no live fixture and no
// wallet, so a brand-new guest hears the signature "pundit reacts to MY call"
// aha within seconds (SAH-31 / WIN LIST W1, fixes C1+C2). Signed-in users get
// their chosen persona; guests get the default. The live in-match pundit
// (goals / cards / odds swings / result) still streams over the WebSocket via
// the worker's Claude engine — this only covers the very first beat.
//
// Voice mirrors the worker's fallback pundit (apps/worker/src/pundit.ts):
// broadcast, confident, a little cheeky. Never "bet / wager / stake / gamble"
// and never a monetary outcome — points and bragging rights only.

import { DEFAULT_PERSONA, type PersonaId } from "@touchline/shared";

export interface PickContext {
  team: string; // the team/outcome the fan backed ("Japan", "the draw", …)
  label: "1" | "X" | "2" | string;
  odds: number; // decimal odds locked in
}

type Tier = "favourite" | "even" | "longshot";

/** How bold the call is, from the locked decimal odds. */
function tierOf(odds: number): Tier {
  if (odds <= 1.9) return "favourite";
  if (odds >= 3) return "longshot";
  return "even";
}

/** Rough "1-in-N" the market gives the pick, for the stats-flavoured lines. */
function oneIn(odds: number): number {
  return Math.max(2, Math.round(odds));
}

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

/**
 * Persona × odds-tier templates. Each returns an array of interchangeable
 * lines so repeat picks don't read canned. `{team}` / `{odds}` / `{n}` are
 * filled from the pick context.
 */
const TEMPLATES: Record<PersonaId, Record<Tier, string[]>> = {
  hype: {
    favourite: [
      "Locked on {team}, the safe hands. Now make it count on the whistle!",
      "{team} it is! No nerves on this one, let's see it home.",
    ],
    even: [
      "Ooh, {team} at {odds}, a proper coin-flip call. I LOVE the courage!",
      "{team}'s in play! This one could go either way, so buckle up.",
    ],
    longshot: [
      "{team} at {odds}?! That's a LONG shot, but land it and the whole board hears about it!",
      "OH, backing {team} against the odds. That's the call that makes a tournament!",
    ],
  },
  rival: {
    favourite: [
      "{team}, the obvious one. Bold of you to side with the whole planet.",
      "Backing {team}? Groundbreaking. Even the bookies saw that coming.",
    ],
    even: [
      "{team} at {odds}, a genuine toss-up. At least you're not hiding.",
      "So it's {team}. Fifty-fifty stuff. We'll see if the nerve holds.",
    ],
    longshot: [
      "{team} at {odds}? The market's given up on them. Prove it wrong, then.",
      "Fading the favourite for {team}. Brave. Or something. Let's watch.",
    ],
  },
  nerd: {
    favourite: [
      "{team} at {odds}, the shortest price on the board. The model agrees.",
      "Sensible: {team}'s implied probability is the highest of the three.",
    ],
    even: [
      "{team} at {odds}. Priced near 50/50, the projection's a knife-edge here.",
      "Locked {team} on a near coin-flip line. The numbers barely separate these two.",
    ],
    longshot: [
      "{team} at {odds}, about a 1-in-{n} shot. Big odds, bigger points if it lands.",
      "Contrarian: {team}'s implied odds are long. High variance, high reward.",
    ],
  },
  homer: {
    favourite: [
      "{team}, always {team}. Never in doubt, the odds are a formality.",
      "Of course it's {team}. Everyone else is just catching up.",
    ],
    even: [
      "{team} at {odds}? Forget the coin-flip. WE know how this ends.",
      "They're calling it even. They're wrong. {team} all day.",
    ],
    longshot: [
      "{team} at {odds}? Doubt us all you like. This is OUR moment.",
      "Long shot? Please. {team} were born for exactly this.",
    ],
  },
};

/**
 * Fire the instant pundit line for a freshly-made pick. Pure/synchronous:
 * demo-reliable with no network. Pass the signed-in user's persona, or omit
 * for the guest default.
 */
export function firstPickLine(ctx: PickContext, persona?: PersonaId | string | null): string {
  const id = (persona && persona in TEMPLATES ? persona : DEFAULT_PERSONA) as PersonaId;
  const tier = tierOf(ctx.odds);
  const template = rand(TEMPLATES[id][tier]);
  return template
    .replaceAll("{team}", ctx.team)
    .replaceAll("{odds}", ctx.odds.toFixed(2))
    .replaceAll("{n}", String(oneIn(ctx.odds)));
}
