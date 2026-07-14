"use client";

import { cn } from "@/lib/cn";
import { IconTarget, IconCheck } from "@/components/icons";
import type { DailyChallenge } from "@/lib/challenges";

export interface DailyChallengesProps {
  challenges: DailyChallenge[];
}

function ChallengeRow({ c }: { c: DailyChallenge }) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 transition-colors",
        c.done ? "bg-[rgba(0,224,138,0.08)]" : "bg-[rgba(255,255,255,0.03)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border",
          c.done
            ? "border-emerald/40 bg-[rgba(0,224,138,0.12)]"
            : "border-coral/25 bg-[rgba(255,106,77,0.08)]",
        )}
      >
        {c.done ? (
          <IconCheck className="h-4 w-4" color="var(--emerald-deep)" />
        ) : (
          <IconTarget className="h-4 w-4" color="var(--coral)" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[15px] font-semibold leading-tight",
            c.done ? "text-ink-soft line-through decoration-emerald/50" : "text-ink",
          )}
        >
          {c.label}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] leading-snug text-ink-soft">
          {c.hint}
        </p>
      </div>

      {c.progress ? (
        <span
          className={cn(
            "tnum shrink-0 font-display text-[13px] font-bold tabular-nums",
            c.done ? "text-emerald-deep" : "text-ink-soft",
          )}
        >
          {c.progress.have}/{c.progress.need}
        </span>
      ) : (
        <span
          className={cn(
            "shrink-0 font-display text-[11px] font-semibold uppercase tracking-wide",
            c.done ? "text-emerald-deep" : "text-ink-soft/70",
          )}
        >
          {c.done ? "Done" : "Open"}
        </span>
      )}
    </li>
  );
}

/**
 * DailyChallenges — the rotating 2–3 challenges for today. Each reaches a real
 * done-state derived from the user's actual calls (see lib/challenges), so ticking
 * one off requires playing, not just visiting.
 */
export function DailyChallenges({ challenges }: DailyChallengesProps) {
  if (!challenges.length) return null;
  const doneCount = challenges.filter((c) => c.done).length;

  return (
    <section aria-label="Daily challenges">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <h2 className="font-display text-[11px] font-semibold uppercase tracking-wide text-coral">
          Daily challenges
        </h2>
        <span className="tnum text-[11px] font-medium uppercase tracking-wide text-ink-soft">
          {doneCount}/{challenges.length} done
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {challenges.map((c) => (
          <ChallengeRow key={c.id} c={c} />
        ))}
      </ul>
    </section>
  );
}

export default DailyChallenges;
