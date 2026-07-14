"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn";
import { IconFlame } from "@/components/icons";

export type OddsVariant = "default" | "selected" | "long-shot" | "locked";

export interface OddsPillProps extends Omit<HTMLMotionProps<"button">, "children"> {
  /** the decimal odds value, e.g. 8.20 */
  odds: number | string;
  /** tiny caption above the number — outcome ("1" / "X" / "2", team, "over") */
  label?: string;
  variant?: OddsVariant;
  /**
   * Long-shot pills are static coral by default. Only the single hero "daily
   * challenge" long-shot opts into the coral pulse — capping it avoids the
   * flashing-casino-board read on the Today grid.
   */
  pulse?: boolean;
}

const base =
  "relative inline-flex flex-col items-center justify-center gap-0.5 " +
  "min-h-[44px] min-w-[64px] px-3 py-1.5 rounded-[var(--radius-pill)] " +
  "transition-colors duration-[var(--dur-micro)] cursor-pointer select-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald " +
  "focus-visible:ring-offset-1 focus-visible:ring-offset-canvas";

const variants: Record<OddsVariant, string> = {
  // resting reading chip on a solid card
  default:
    "bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.12)] text-ink hover:border-emerald/70 hover:bg-[rgba(255,255,255,0.08)]",
  // emerald fill — your pick
  selected:
    "bg-emerald text-on-emerald border border-emerald glow-emerald",
  // coral outline — the long shot (never colour-only: paired with a flame)
  "long-shot":
    "bg-[rgba(255,106,77,0.06)] border border-coral text-coral",
  // frozen
  locked:
    "bg-[rgba(255,255,255,0.03)] border border-dashed border-[rgba(255,255,255,0.18)] text-ink-soft cursor-default",
};

const labelTone: Record<OddsVariant, string> = {
  default: "text-ink-soft",
  selected: "text-on-emerald/80",
  "long-shot": "text-coral/80",
  locked: "text-ink-soft",
};

export function OddsPill({
  odds,
  label,
  variant = "default",
  pulse = false,
  className,
  disabled,
  ...props
}: OddsPillProps) {
  const isLocked = variant === "locked";
  const value = typeof odds === "number" ? odds.toFixed(2) : odds;

  return (
    <motion.button
      whileTap={isLocked ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.12, ease: [0.4, 0, 0.2, 1] }}
      disabled={disabled || isLocked}
      aria-pressed={variant === "selected"}
      className={cn(
        base,
        variants[variant],
        // pulse only on the single hero long-shot — the rest stay static coral
        variant === "long-shot" && pulse && "motion-safe:animate-[tl-glow_2s_ease-in-out_infinite]",
        className,
      )}
      {...props}
    >
      {label ? (
        <span
          className={cn(
            "text-[10px] font-medium uppercase tracking-wide leading-none",
            labelTone[variant],
          )}
        >
          {label}
        </span>
      ) : null}
      <span className="tnum font-display text-[17px] font-semibold leading-none">
        {value}
        {variant === "long-shot" ? (
          <IconFlame className="ml-1 inline-block h-3.5 w-3.5 align-[-0.15em]" color="var(--coral)" />
        ) : null}
      </span>
    </motion.button>
  );
}

export default OddsPill;
