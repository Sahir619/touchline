"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { IconTrophy } from "@/components/icons";

export interface ChampionPromptProps {
  onPick: () => void;
  onDismiss: () => void;
}

/**
 * ChampionPrompt — one-time nudge toward the season-long bracket pick (SAH-60).
 * Emerald, not urgent-coral like AtRiskPrompt — this isn't time-critical within
 * the day, just unclaimed until the tournament kicks off.
 */
export function ChampionPrompt({ onPick, onDismiss }: ChampionPromptProps) {
  return (
    <GlassCard className="flex items-center gap-4 p-4">
      <span
        aria-hidden
        className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[rgba(255,199,0,0.12)]"
      >
        <IconTrophy className="h-6 w-6" color="var(--gold)" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-gold">
          Season-long pick
        </p>
        <p className="text-[16px] font-semibold leading-snug text-ink">
          Pick your champion before kickoff.
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-stretch gap-1.5">
        <Button onClick={onPick} className="whitespace-nowrap px-4 py-2 text-[13px]">
          Pick now
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

export default ChampionPrompt;
