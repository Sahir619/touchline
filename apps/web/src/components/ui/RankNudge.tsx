"use client";

import { cn } from "@/lib/cn";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { IconTarget } from "@/components/icons";
import type { RankDrop } from "@/lib/rank";

export interface RankNudgeProps {
  /** The detected rank slip — rank + (optionally) who passed you. */
  drop: RankDrop;
  /** Full card on /play; compact single line on /you (Oracle Record). */
  variant?: "full" | "compact";
  /** Deep-link to today's marquee pick (/play) or back to the slate (/you). */
  onReclaim: () => void;
  /** Dismiss — re-arms only on a *new* drop. */
  onDismiss: () => void;
}

/** "Raj passed you. " when the leaderboard row is nameable, else empty. */
function passedClause(passedBy: string | null): string {
  return passedBy ? `${passedBy} passed you. ` : "";
}

/**
 * RankNudge — the loss-aversion return nudge (SAH-70). When the user's leaderboard
 * rank slipped since their last visit, this prompts a reclaim with a direct CTA to
 * today's marquee pick. Loss-aversion only: there's no positive/climb variant by
 * design. Copy carries no monetary framing. Dismissable.
 */
export function RankNudge({ drop, variant = "full", onReclaim, onDismiss }: RankNudgeProps) {
  const clause = passedClause(drop.passedBy);

  if (variant === "compact") {
    // Oracle Record line — persistent "defend your rank" prompt on /you.
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-[var(--radius-sm)] px-4 py-3",
          "border border-coral/40 bg-[rgba(255,106,77,0.06)] ring-1 ring-coral/10",
        )}
        role="alert"
      >
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[rgba(255,106,77,0.12)]"
        >
          <IconTarget className="h-4 w-4" color="var(--coral)" />
        </span>
        <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-ink">
          <span className="font-semibold">You slipped to #{drop.rank}.</span>{" "}
          <span className="text-ink-soft">{clause}Defend your rank.</span>
        </p>
        <button
          type="button"
          onClick={onReclaim}
          className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-coral underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:underline"
        >
          Reclaim it
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-[16px] leading-none text-ink-soft transition-colors hover:text-ink focus-visible:outline-none focus-visible:underline"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <GlassCard
      className={cn("flex items-center gap-4 p-4", "border-coral/40 ring-1 ring-coral/20")}
      role="alert"
    >
      {/* Static coral (no pulse) — mirrors AtRiskPrompt; the daily-challenge hero
          long-shot is the single pulsing element on the Today grid (SAH-36 cap). */}
      <span
        aria-hidden
        className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[rgba(255,106,77,0.12)]"
      >
        <IconTarget className="h-6 w-6" color="var(--coral)" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-coral">
          You slipped to #{drop.rank}
        </p>
        <p className="text-[16px] font-semibold leading-snug text-ink">
          {clause}One pick to reclaim it.
        </p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-ink-soft">
          A rank you own is worth defending. Call today&apos;s marquee match.
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-stretch gap-1.5">
        <Button onClick={onReclaim} className="whitespace-nowrap px-4 py-2 text-[13px]">
          Make a call to reclaim it
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[12px] font-medium text-ink-soft transition-colors hover:text-ink focus-visible:outline-none focus-visible:underline"
        >
          Later
        </button>
      </div>
    </GlassCard>
  );
}

export default RankNudge;
