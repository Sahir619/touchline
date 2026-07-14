"use client";

import { cn } from "@/lib/cn";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { IconFlame } from "@/components/icons";
import type { DisplayFixture } from "@/lib/api";

export interface AtRiskPromptProps {
  /** The followed-nation fixture the user hasn't called yet. */
  fixture: DisplayFixture;
  /** The user's backed nation name (e.g. "England"). */
  nationName: string;
  /** Live clock (epoch ms) — used to phrase the kickoff ("tonight" / "this afternoon"). */
  now: number;
  onCall: () => void;
  onDismiss: () => void;
}

/** "tonight" / "this afternoon" / "today" from the kickoff hour. */
function whenPhrase(startTime: number | undefined, now: number): string {
  if (startTime == null) return "today";
  if (startTime < now) return "now";
  const hour = new Date(startTime).getHours();
  if (hour < 12) return "this morning";
  if (hour < 17) return "this afternoon";
  return "tonight";
}

/**
 * AtRiskPrompt — the one in-app return nudge. When a team the user backs is playing
 * today and they haven't locked a call, this surfaces it: "England play tonight — lock
 * your call." In-app only (no browser/PWA push — deferred per W6). Dismissable.
 */
export function AtRiskPrompt({
  fixture,
  nationName,
  now,
  onCall,
  onDismiss,
}: AtRiskPromptProps) {
  const phrase = whenPhrase(fixture.startTime, now);

  return (
    <GlassCard
      className={cn(
        "flex items-center gap-4 p-4",
        "border-coral/40 ring-1 ring-coral/20",
      )}
      role="alert"
    >
      {/* Static coral, not pulsing — the daily-challenge hero long-shot on the
          Today grid is the one card that pulses (P0-3 / SAH-36 pulse cap).
          This alert already reads urgently via the coral border + copy, so a
          second concurrent pulse would just re-introduce the flashing-board
          effect the cap was meant to remove. */}
      <span
        aria-hidden
        className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[rgba(255,106,77,0.12)]"
      >
        <IconFlame className="h-6 w-6" color="var(--coral)" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-coral">
          Your team plays {phrase}
        </p>
        <p className="text-[16px] font-semibold leading-snug text-ink">
          {nationName} play {phrase}. Lock your call.
        </p>
        <p className="mt-0.5 truncate text-[12.5px] leading-snug text-ink-soft">
          {fixture.home} v {fixture.away} · {fixture.kickoff}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-stretch gap-1.5">
        <Button onClick={onCall} className="whitespace-nowrap px-4 py-2 text-[13px]">
          Lock call
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

export default AtRiskPrompt;
