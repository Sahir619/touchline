"use client";

import { cn } from "@/lib/cn";
import { IconFlame } from "@/components/icons";

export interface StreakChipProps extends React.HTMLAttributes<HTMLDivElement> {
  count: number;
  /** at-risk → gentle coral pulse instead of emerald */
  atRisk?: boolean;
}

/**
 * StreakChip — flame + count. Emerald by default; coral pulse when at-risk.
 */
export function StreakChip({
  count,
  atRisk = false,
  className,
  ...props
}: StreakChipProps) {
  return (
    <div
      aria-label={`${count} matchday streak`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)]",
        "min-h-[36px] px-3 py-1",
        "border font-display font-semibold tnum leading-none",
        atRisk
          ? "border-coral/40 bg-[rgba(255,106,77,0.08)] text-coral motion-safe:animate-[tl-glow_2s_ease-in-out_infinite]"
          : "border-emerald/35 bg-[rgba(0,217,130,0.10)] text-emerald-deep",
        className,
      )}
      {...props}
    >
      <span aria-hidden className="motion-safe:animate-[tl-flamepulse_2s_ease-in-out_infinite]">
        <IconFlame className="h-4 w-4" color={atRisk ? "var(--coral)" : "var(--emerald-deep)"} />
      </span>
      <span className="text-[16px]">{count}</span>
    </div>
  );
}

export default StreakChip;
