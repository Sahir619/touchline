// Thin client for the Touchline worker's read API. The worker owns TxLINE creds + the DB;
// the web app only ever sees normalized data. Override host via NEXT_PUBLIC_WORKER_URL.

import { decimalOdds } from "@touchline/shared";
import { workerFetch } from "./worker";

export interface OneX2 {
  prices: number[] | null; // decimal odds × 1000
  priceNames: string[] | null;
  pct: string[] | null;
  inRunning: boolean;
}

export interface SlateFixture {
  fixtureId: number;
  competition: string;
  startTime: number; // epoch ms
  participant1: string;
  participant2: string;
  participant1IsHome: boolean;
  oneX2: OneX2 | null;
}

/** Fetch the pickable slate (fixtures + their 1X2 market) from the worker. */
export async function getSlate(): Promise<SlateFixture[]> {
  const res = await workerFetch("/api/slate");
  if (!res.ok) throw new Error(`slate ${res.status}`);
  return (await res.json()) as SlateFixture[];
}

export interface PickOutcome {
  label: "1" | "X" | "2";
  odds: number;
  longShot: boolean;
}

export interface DisplayFixture {
  id: number;
  home: string;
  away: string;
  kickoff: string;
  /** Raw kickoff, epoch ms — powers the live countdown. Absent on fallback fixtures. */
  startTime?: number;
  group: string;
  outcomes: [PickOutcome, PickOutcome, PickOutcome];
}

const timeFmt = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });

/** Map raw slate fixtures (with a complete 1X2 market) to display-ready cards. */
export function toDisplayFixtures(slate: SlateFixture[]): DisplayFixture[] {
  const out: DisplayFixture[] = [];
  for (const f of slate) {
    const prices = f.oneX2?.prices;
    if (!prices || prices.length !== 3) continue;
    const odds = prices.map(decimalOdds) as [number, number, number];
    const maxOdds = Math.max(...odds);
    const labels: ["1", "X", "2"] = ["1", "X", "2"];
    const outcomes = odds.map((o, i) => ({
      label: labels[i],
      odds: o,
      longShot: o === maxOdds && o >= 3,
    })) as [PickOutcome, PickOutcome, PickOutcome];
    out.push({
      id: f.fixtureId,
      home: f.participant1,
      away: f.participant2,
      kickoff: timeFmt.format(new Date(f.startTime)),
      startTime: f.startTime,
      group: f.competition,
      outcomes,
    });
  }
  return out;
}
