"use client";

import { cn } from "@/lib/cn";

/**
 * BeatLineChip — the compact "Beat the Line" (SAH) marker. Shown on a resolved/locked
 * call ONLY when the market moved toward the user before kickoff (`beatLine` true).
 * Electric-green accent = the app's signature "you were right before the market" signal.
 * Below-threshold calls render nothing (surfaces stay calm). Percentages show to 1dp,
 * matching the rest of the odds/probability language.
 *
 * Both props are percentages in the 0–100 range (e.g. 40.0, not 0.40). On pick cards
 * `pctAtLock` is derived as `pctAtClose%×100 − clv` (the API row carries the [0,1] fraction
 * `pctAtClose` + `clv` in points, not `pctAtLock`); callers do that conversion before passing in.
 */
export function BeatLineChip({
  pctAtLock,
  pctAtClose,
  className,
}: {
  pctAtLock: number;
  pctAtClose: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-emerald/40",
        "bg-[rgba(0,217,130,0.10)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-deep",
        className,
      )}
    >
      <span aria-hidden>⚡</span>
      Beat the line
      <span className="tnum font-medium normal-case tracking-normal text-emerald-deep/80">
        {pctAtLock.toFixed(1)}% → {pctAtClose.toFixed(1)}%
      </span>
    </span>
  );
}

export default BeatLineChip;
