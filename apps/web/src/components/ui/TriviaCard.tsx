"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { triviaSequence } from "@touchline/shared";
import { IconBulb } from "@/components/icons";
import { cn } from "@/lib/cn";

/*
 * TriviaCard — "Did You Know?" dead-air filler (spec SAH-57).
 *
 * Storyboard (per rotation):
 *   0ms     outgoing fact fades/lifts out (160ms, ease-in)
 *   ~160ms  incoming fact fades/settles in (220ms, ease-out)
 *   +ROTATE_MS   cycle repeats through a per-seed shuffled sequence
 *
 * Decorative only — never gates the pick/lock flow or the live-match core
 * loop. Auto-rotation is paused for prefers-reduced-motion (a static fact is
 * shown instead of auto-changing content).
 */
const TIMING = {
  rotateMs: 20_000,
  exitMs: 160,
  enterMs: 220,
} as const;

export interface TriviaCardProps {
  /** Stable per-match seed (e.g. fixtureId) so the shuffle order is consistent. */
  seed: number | string;
  className?: string;
}

export function TriviaCard({ seed, className }: TriviaCardProps) {
  const reduce = useReducedMotion();
  const sequence = useMemo(() => triviaSequence(seed), [seed]);
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (reduce || sequence.length <= 1) return;
    const tick = () => {
      timer.current = setTimeout(() => {
        setIndex((i) => (i + 1) % sequence.length);
        tick();
      }, TIMING.rotateMs);
    };
    tick();
    return () => clearTimeout(timer.current);
  }, [reduce, sequence.length]);

  const current = sequence[index % sequence.length];
  if (!current) return null;

  return (
    <div className={cn("solid overflow-hidden p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
          <IconBulb className="h-3.5 w-3.5" color="var(--gold)" />
          Did you know?
        </span>
        <span className="font-display text-[10px] font-semibold uppercase tracking-wide text-ink-soft/60">
          {current.category}
        </span>
      </div>
      <div className="relative mt-2 min-h-[2.75em]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={reduce ? "static" : current.id}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: TIMING.enterMs / 1000, ease: [0.2, 0.7, 0.3, 1] } }}
            exit={reduce ? undefined : { opacity: 0, y: -4, transition: { duration: TIMING.exitMs / 1000, ease: [0.4, 0, 1, 1] } }}
            className="text-[15px] leading-snug text-ink"
          >
            {current.fact}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default TriviaCard;
