"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { IconFlame } from "@/components/icons";
import type { OddsVariant } from "./OddsPill";

export interface MatchOutcome {
  /** outcome key: "1" (home) / "X" (draw) / "2" (away) */
  label: string;
  odds: number;
  variant?: OddsVariant;
}

export interface MatchCardProps {
  home: string;
  away: string;
  kickoff: string;
  group: string;
  outcomes: [MatchOutcome, MatchOutcome, MatchOutcome];
  /** Fires with the tapped outcome key ("1" | "X" | "2"). */
  onPick?: (label: string) => void;
  /**
   * Only the daily-challenge hero card opts its long shot into the coral pulse —
   * caps the "flashing casino board" read across the Today grid.
   */
  pulseLongShot?: boolean;
  className?: string;
}

/* 3-char uppercase code from a team name: "Brazil" → "BRA", "South Korea" → "SKO". */
function teamCode(name: string): string {
  const cleaned = name.replace(/[^A-Za-z\s]/g, "").trim();
  if (!cleaned) return "-";
  const words = cleaned.split(/\s+/);
  if (words.length > 1) {
    const initials = words.map((w) => w[0]).join("").toUpperCase();
    if (initials.length >= 3) return initials.slice(0, 3);
    // pad from the first word's tail so we always read three glyphs
    return (initials + cleaned.replace(/\s+/g, "").slice(initials.length))
      .slice(0, 3)
      .toUpperCase();
  }
  return cleaned.slice(0, 3).toUpperCase();
}

/* Odds-weighted points — the call's reward. Longer odds → bigger payoff. */
function pointsFor(odds: number): number {
  return Math.round(odds * 10);
}

function outcomeCaption(label: string, home: string, away: string): string {
  if (label === "1") return teamCode(home);
  if (label === "2") return teamCode(away);
  return "Draw";
}

/* ============================================================================
   OutcomeRow — the call is the hero: team short-code + odds-weighted points,
   with the decimal odds demoted to a muted, tabular caption. No three-up chip
   grid → defuses the bookmaker-coupon read.
   ========================================================================== */
function OutcomeRow({
  caption,
  odds,
  variant,
  pulse,
  onPick,
}: {
  caption: string;
  odds: number;
  variant: OddsVariant;
  pulse: boolean;
  onPick?: () => void;
}) {
  const longShot = variant === "long-shot";
  const selected = variant === "selected";
  const points = pointsFor(odds);

  return (
    <motion.button
      type="button"
      onClick={onPick}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.12, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        "group/row flex min-h-[44px] w-full items-center justify-between gap-3",
        "rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        selected
          ? "border-emerald bg-emerald text-on-emerald glow-emerald"
          : longShot
            ? "border-coral/60 bg-[rgba(255,106,77,0.05)] hover:bg-[rgba(255,106,77,0.09)]"
            : "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] hover:border-emerald/60 hover:bg-[rgba(255,255,255,0.06)]",
        longShot && pulse && "motion-safe:animate-[tl-glow_2s_ease-in-out_infinite]",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-display text-[15px] font-semibold tracking-tight",
          selected ? "text-on-emerald" : "text-ink",
        )}
      >
        {caption}
        {longShot && !selected ? (
          <IconFlame className="h-3.5 w-3.5" color="var(--coral)" />
        ) : null}
      </span>

      <span className="flex items-baseline gap-2">
        <span
          className={cn(
            "tnum font-display text-[17px] font-bold leading-none",
            selected ? "text-on-emerald" : longShot ? "text-coral" : "text-emerald-deep",
          )}
        >
          +{points}
        </span>
        <span
          className={cn(
            "tnum text-[11px] font-medium tabular-nums",
            selected ? "text-on-emerald/80" : "text-ink-soft/80",
          )}
        >
          {odds.toFixed(2)}
        </span>
      </span>
    </motion.button>
  );
}

/**
 * MatchCard — leads with the *call*: each outcome shows the team short-code and
 * the odds-weighted points you'd bank, with the decimal odds as quiet fine print.
 * The old loud three-up [1][X][2] chip grid is gone.
 */
export function MatchCard({
  home,
  away,
  kickoff,
  group,
  outcomes,
  onPick,
  pulseLongShot = false,
  className,
}: MatchCardProps) {
  return (
    <motion.article
      className={cn("solid flex flex-col gap-3 p-4 text-left sm:p-5", className)}
    >
      {/* Teams + caption */}
      <header>
        <h3 className="font-display text-[20px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[22px]">
          <span>{home}</span>
          <span className="mx-2 font-normal text-ink-soft">v</span>
          <span>{away}</span>
        </h3>
        <p className="tnum mt-1 text-[11px] font-medium uppercase tracking-wide text-ink-soft">
          {kickoff} · {group}
        </p>
      </header>

      {/* The call — primary affordance, points-led */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-soft/70">
          Make the call · points if you&apos;re right
        </p>
        {outcomes.map((o, i) => (
          <OutcomeRow
            key={i}
            caption={outcomeCaption(o.label, home, away)}
            odds={o.odds}
            variant={o.variant ?? "default"}
            pulse={pulseLongShot}
            onPick={onPick ? () => onPick(o.label) : undefined}
          />
        ))}
      </div>
    </motion.article>
  );
}

export default MatchCard;
