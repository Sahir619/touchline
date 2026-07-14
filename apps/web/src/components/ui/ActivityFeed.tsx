"use client";

// SAH-74 — the "ALIVE" home activity feed. Renders the derived Demo-League activity
// (getFeed) with the SAH-73 pundit-voice line templates, every event badged DEMO so
// nothing reads as a fraudulent real-user claim. Public data — works for guests too.
// When a signed-in user is in the Demo League, shows a proactive rank nudge on top.

import { useEffect, useState } from "react";
import Link from "next/link";
import { nationByCode } from "@touchline/shared";
import { getFeed, getLeagues, getLeague, type FeedEvent, type LeaderRow } from "@/lib/game";

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "··";
}

/** Stable variant index for an event, so a line doesn't reshuffle on every render. */
function pick(id: string, n: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % n;
}

function line(e: FeedEvent): string {
  const name = e.name;
  const odds = e.odds != null ? e.odds.toFixed(2) : "";
  switch (e.type) {
    case "called-upset": {
      const v = [
        `${name} called the ${odds} upset: ${e.outcome} to win. Bold.`,
        `${name} backed ${e.outcome} at ${odds}. ${e.shot ?? "A long shot"}, and they're on it.`,
        `${name} isn't playing it safe: ${e.outcome} to win, against the room.`,
        `${name} called ${e.outcome} when nobody else would.`,
      ];
      return v[pick(e.id, v.length)]!;
    }
    case "landed": {
      const v = [
        `${name} called ${e.outcome} and it landed.${e.points ? ` +${e.points}.` : ""}`,
        `${name} read ${e.fixture} right: ${e.outcome}, on the money.`,
      ];
      return v[pick(e.id, v.length)]!;
    }
    case "streak": {
      const n = e.n ?? 0;
      const v = [
        `${name} is on a ${n}-call streak. Reading the game clean.`,
        `${name} just locked a ${n}-streak: ${n} right in a row.`,
        `${name} is ${n} for ${n} on the group stage. Ice cold.`,
      ];
      return v[pick(e.id, v.length)]!;
    }
    case "watching": {
      const v = [
        `${name} is in the room for ${e.fixture}. Call's live.`,
        `${name} is watching ${e.fixture} with a call on the line.`,
        `${name} pulled up for ${e.fixture}. The room's filling up.`,
      ];
      return v[pick(e.id, v.length)]!;
    }
    case "minted": {
      const v = [
        `${name} banked the receipt on that ${e.outcome} call, signed on-chain.`,
        `${name}'s ${e.outcome} call is on record now. Un-deletable.`,
      ];
      return v[pick(e.id, v.length)]!;
    }
  }
}

const ICON: Record<FeedEvent["type"], string> = {
  "called-upset": "🎯",
  landed: "✓",
  streak: "🔥",
  watching: "📺",
  minted: "🏅",
};

function DemoChip() {
  return (
    <span className="shrink-0 rounded-[var(--radius-pill)] border border-[rgba(255,106,77,0.4)] bg-[rgba(255,106,77,0.12)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-coral">
      Demo
    </span>
  );
}

function FeedRow({ e }: { e: FeedEvent }) {
  const nation = nationByCode(e.nation);
  return (
    <li className="flex items-center gap-3 border-t border-[rgba(255,255,255,0.06)] px-1 py-2.5 first:border-t-0">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[rgba(0,217,130,0.10)] text-[13px]"
        aria-hidden
      >
        {nation ? nation.flag : initials(e.name)}
      </span>
      <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-ink">
        <span aria-hidden className="mr-1">{ICON[e.type]}</span>
        {line(e)}
      </p>
      <DemoChip />
    </li>
  );
}

export interface DemoRivalNudge {
  rank: number;
  rivalName: string | null;
  delta: number | null;
  /** true when the rival is ahead of the user (delta > 0). */
  ahead: boolean;
}

/**
 * The home activity feed. Optionally takes a signed-in user's wallet+token to surface a
 * proactive Demo-League rank nudge ("You're #N — Raj is D pts back").
 */
export function ActivityFeed({ token, wallet }: { token?: string | null; wallet?: string | null }) {
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [nudge, setNudge] = useState<DemoRivalNudge | null>(null);

  useEffect(() => {
    let live = true;
    getFeed().then((f) => live && setEvents(f)).catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!token || !wallet) return;
    let live = true;
    (async () => {
      const leagues = await getLeagues(token);
      const demo = leagues.find((l) => l.isDemo);
      if (!demo) return;
      const detail = await getLeague(token, demo.id);
      if (!detail || !live) return;
      const board: LeaderRow[] = detail.board;
      const me = board.find((r) => r.wallet === wallet);
      if (!me) return;
      // Raj is the designated rival (spec §6); fall back to the nearest demo player above.
      const above = board.filter((r) => r.demo && r.xp >= me.xp && r.wallet !== wallet).sort((a, b) => a.xp - b.xp)[0];
      const raj = board.find((r) => r.displayName === "Raj");
      const rival = raj ?? above ?? null;
      const delta = rival ? rival.xp - me.xp : null;
      setNudge({
        rank: me.rank,
        rivalName: rival?.displayName ?? null,
        delta: delta != null ? Math.abs(delta) : null,
        ahead: (delta ?? 0) > 0,
      });
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [token, wallet]);

  // Nothing seeded / feed empty → render nothing (no empty scaffolding on real deployments).
  if (events !== null && events.length === 0) return null;

  return (
    <section className="solid p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-display text-[13px] font-semibold uppercase tracking-wide text-ink">
          The room&rsquo;s busy
        </h2>
        <span className="rounded-[var(--radius-pill)] border border-[rgba(255,106,77,0.4)] bg-[rgba(255,106,77,0.12)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-coral">
          Demo activity · sample players
        </span>
      </div>

      {nudge && (
        <p className="mb-2 text-[13px] font-medium leading-snug text-ink-soft">
          You&rsquo;re <span className="font-display font-semibold text-ink">#{nudge.rank}</span> in the Demo League.
          {nudge.rivalName && nudge.delta != null ? (
            nudge.ahead ? (
              <>
                {" "}
                <span className="text-ink">{nudge.rivalName}</span> is {nudge.delta} pts ahead. Lock tonight&rsquo;s call to reel them in.
              </>
            ) : (
              <>
                {" "}
                <span className="text-ink">{nudge.rivalName}</span> is {nudge.delta} pts back and gaining. Lock tonight&rsquo;s call to hold them off.
              </>
            )
          ) : (
            " Lock tonight's call to climb."
          )}
        </p>
      )}

      {events === null ? (
        <ul className="animate-pulse space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-11 rounded-[var(--radius-sm)] bg-[rgba(255,255,255,0.04)]" />
          ))}
        </ul>
      ) : (
        <ul>
          {events.map((e) => (
            <FeedRow key={e.id} e={e} />
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-[rgba(255,255,255,0.06)] pt-2.5 text-[11.5px] leading-snug text-ink-soft">
        These are demo players showing how a live matchday feels.{" "}
        <Link href="/leaderboard" className="font-semibold text-emerald-deep underline-offset-2 hover:underline">
          Invite real mates
        </Link>{" "}
        and this fills up for real.
      </p>
    </section>
  );
}

export default ActivityFeed;
