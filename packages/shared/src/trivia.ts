// @touchline/shared — trivia
// Static, curated "Did You Know?" World Cup trivia set. Dead-air filler for
// /match (pre-match) and /live (between moments) — decorative only, never
// gates the pick/lock or live-match core loop.

export type TriviaCategory = 'History' | 'Records' | 'Legends' | 'Numbers' | 'World Cup 2026';

export interface TriviaFact {
  id: string;
  category: TriviaCategory;
  fact: string;
}

export const TRIVIA_FACTS: readonly TriviaFact[] = [
  {
    id: 'wc-1930-first',
    category: 'History',
    fact: 'The first World Cup was held in Uruguay in 1930 — the hosts won it, beating Argentina 4–2 in the final.',
  },
  {
    id: 'wc-brazil-five',
    category: 'Records',
    fact: 'Brazil is the only team to have played in every World Cup since it began, and the only side with five titles.',
  },
  {
    id: 'wc-klose-top-scorer',
    category: 'Records',
    fact: "Germany's Miroslav Klose is the tournament's all-time top scorer with 16 goals across four World Cups.",
  },
  {
    id: 'wc-fastest-goal',
    category: 'Records',
    fact: "The fastest goal in World Cup history came after just 11 seconds — Turkey's Hakan Şükür against South Korea in 2002.",
  },
  {
    id: 'wc-1950-maracana',
    category: 'History',
    fact: "The 1950 final at the Maracanã drew an estimated 199,000+ fans — still the largest crowd ever at a football match.",
  },
  {
    id: 'wc-golden-ball',
    category: 'Legends',
    fact: "The Golden Ball, given to the tournament's best player, was first awarded in 1982 — to Italy's Paolo Rossi.",
  },
  {
    id: 'wc-2026-expansion',
    category: 'World Cup 2026',
    fact: 'The 2026 World Cup expands to 48 teams for the first time, hosted across the United States, Mexico, and Canada.',
  },
  {
    id: 'wc-2026-matches',
    category: 'World Cup 2026',
    fact: '2026 will be the first World Cup held in three countries at once, with 104 matches across 16 host cities.',
  },
  {
    id: 'wc-1990-final',
    category: 'History',
    fact: "The 1990 final was settled by a single penalty — Andreas Brehme's spot-kick gave West Germany a 1–0 win over Argentina.",
  },
  {
    id: 'wc-youngest-scorer',
    category: 'Records',
    fact: "Pelé remains the youngest World Cup final scorer — he was 17 when he struck twice for Brazil in the 1958 final.",
  },
  {
    id: 'wc-hat-trick-final',
    category: 'Legends',
    fact: 'Only one player has ever scored a hat-trick in a World Cup final: England\'s Geoff Hurst, in 1966.',
  },
  {
    id: 'wc-most-appearances',
    category: 'Records',
    fact: "Lionel Messi holds the record for most World Cup appearances by an outfield player, with 26 matches played.",
  },
  {
    id: 'wc-trophy-design',
    category: 'History',
    fact: 'The current World Cup trophy — 18-karat gold, 36cm tall — has been awarded to every winner since 1974.',
  },
  {
    id: 'wc-var-2018',
    category: 'History',
    fact: 'The 2018 World Cup in Russia was the first to use VAR (Video Assistant Referee) at every match.',
  },
  {
    id: 'wc-smallest-nation',
    category: 'Numbers',
    fact: 'Iceland, with a population of around 350,000, became the smallest nation ever to reach a World Cup in 2018.',
  },
  {
    id: 'wc-no-host-win-since',
    category: 'Numbers',
    fact: 'No host nation has won the World Cup since France in 1998 — six tournaments and counting.',
  },
] as const;

/** Deterministic 32-bit hash → seeded PRNG (mulberry32), so a given seed always
 * produces the same shuffle — stable across re-renders/reconnects for the same match. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: number | string): number {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** A stable per-seed shuffle of the trivia set — e.g. seed on the fixtureId so
 * a match always cycles through the same order, but different matches don't
 * all open on the same fact. */
export function triviaSequence(seed: number | string): TriviaFact[] {
  const rand = mulberry32(hashSeed(seed));
  const arr = [...TRIVIA_FACTS];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}
