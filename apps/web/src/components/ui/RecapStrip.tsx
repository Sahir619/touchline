"use client";

import { cn } from "@/lib/cn";
import { GlassCard } from "@/components/ui/GlassCard";
import { BeatLineChip } from "@/components/ui/BeatLineChip";
import { IconCheck } from "@/components/icons";
import { dayIndex } from "@/lib/challenges";
import type { Pick } from "@/lib/game";

export interface RecapStripProps {
  /** The signed-in user's picks (all time). */
  picks: Pick[];
  /** Live clock (epoch ms) — anchors "yesterday" to the current calendar day. */
  now: number;
  /** A pick already surfaced by the Win-Return hero (SAH-69) — omit it here so it
   *  isn't shown twice; the hero absorbs that line while its siblings roll in. */
  excludePickId?: number;
}

/** Picks that resolved (won/lost) on the calendar day before `now`. */
export function yesterdaysResolvedPicks(picks: Pick[], now: number): Pick[] {
  const yesterday = dayIndex(now) - 1;
  return picks.filter(
    (p) =>
      (p.status === "won" || p.status === "lost") &&
      p.resolvedAt != null &&
      dayIndex(p.resolvedAt) === yesterday,
  );
}

/**
 * RecapStrip — "Yesterday's calls": a lightweight look-back at the previous day's
 * resolved picks (win/loss + points), closing the tournament-long return loop beyond
 * the same-day AtRiskPrompt. Purely derived from picks the page already fetches —
 * no extra request, no loading state — and renders nothing when there's nothing to
 * recap (fresh account, guest, or no picks resolved yesterday).
 */
export function RecapStrip({ picks, now, excludePickId }: RecapStripProps) {
  const resolved = yesterdaysResolvedPicks(picks, now).filter(
    (p) => p.id !== excludePickId,
  );
  if (!resolved.length) return null;

  const wins = resolved.filter((p) => p.status === "won").length;
  const totalPoints = resolved.reduce((sum, p) => sum + p.points, 0);

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          Yesterday&apos;s calls
        </p>
        <p className="tnum text-[12.5px] font-semibold text-ink-soft">
          {wins}/{resolved.length} won · {totalPoints > 0 ? "+" : ""}
          {totalPoints} pts
        </p>
      </div>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {resolved.map((p) => {
          // pctAtClose is a [0,1] fraction; clv is percentage points. Convert to percent
          // (0–100) before subtracting so the chip renders real probabilities.
          const beatLine = p.beatLine === true && p.pctAtClose != null && p.clv != null;
          const pctAtClose = (p.pctAtClose ?? 0) * 100;
          const pctAtLock = pctAtClose - (p.clv ?? 0);
          return (
          <li
            key={p.id}
            className="flex items-center justify-between gap-2 text-[13px] leading-snug"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="min-w-0 truncate text-ink-soft">
                {p.fixture
                  ? `${p.fixture.participant1} v ${p.fixture.participant2}`
                  : `Match #${p.fixtureId}`}
              </span>
              {beatLine && <BeatLineChip pctAtLock={pctAtLock} pctAtClose={pctAtClose} />}
            </span>
            <span
              className={cn(
                "tnum flex shrink-0 items-center gap-1 font-semibold",
                p.status === "won" ? "text-emerald-deep" : "text-ink-soft",
              )}
            >
              {p.status === "won" && (
                <IconCheck className="h-3 w-3" color="var(--emerald-deep)" />
              )}
              {p.status === "won" ? `+${p.points}` : "0"}
            </span>
          </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

export default RecapStrip;
