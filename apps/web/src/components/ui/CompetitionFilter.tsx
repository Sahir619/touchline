"use client";

import { cn } from "@/lib/cn";

export interface CompetitionFilterProps {
  /** Distinct competition names present on the slate (order preserved by the caller). */
  competitions: string[];
  /** Active competition, or `null` for "All". */
  value: string | null;
  /** Fires with the selected competition, or `null` when "All" is chosen. */
  onChange: (competition: string | null) => void;
  className?: string;
}

/**
 * CompetitionFilter — a presentational chip row for narrowing the slate by
 * competition. An "All" chip (default) plus one chip per distinct competition.
 * The active chip reads in the emerald accent; the rest are quiet outlines.
 *
 * Purely additive and stateless: the caller owns `value` and derives the chip
 * list, so "All" renders the slate exactly as it did before this control existed.
 */
export function CompetitionFilter({
  competitions,
  value,
  onChange,
  className,
}: CompetitionFilterProps) {
  const chips: { key: string; label: string; competition: string | null }[] = [
    { key: "__all__", label: "All", competition: null },
    ...competitions.map((c) => ({ key: c, label: c, competition: c })),
  ];

  return (
    <div
      role="group"
      aria-label="Filter matches by competition"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {chips.map((chip) => {
        const active = chip.competition === value;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.competition)}
            className={cn(
              "inline-flex min-h-[36px] items-center rounded-[var(--radius-pill)] border px-3.5 py-1",
              "font-display text-[13px] font-semibold uppercase tracking-wide leading-none",
              "transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              active
                ? "border-emerald/35 bg-[rgba(0,217,130,0.10)] text-emerald-deep"
                : "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] text-ink-soft hover:border-emerald/40 hover:text-ink",
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

export default CompetitionFilter;
