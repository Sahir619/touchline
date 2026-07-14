"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  animate,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { cn } from "@/lib/cn";

/* ============================================================================
   LineMove — the signature moment. "Beat the Line" enacted.

   The whole product spine in one animated card: you make a call, the market's
   implied probability is X%, and by kickoff the market has moved toward you to
   Y%. The gap (CLV — closing line value) is the sharp-bettor skill metric,
   framed in plain fan language: "the market came to you."

   Motion law: soft-settle ease, the number climbs once in view and holds, the
   verdict chip pops on settle. Reduced-motion → final state, no animation.
   Animates transform/opacity + a MotionValue number only (no layout thrash).
   ========================================================================== */

const EASE = [0.2, 0.7, 0.3, 1] as const;

export function LineMove({
  team = "Japan",
  from = 22,
  to = 31,
  className,
  loop = true,
}: {
  /** the outcome the fan called */
  team?: string;
  /** market's implied % when the call was made */
  from?: number;
  /** market's implied % at kickoff (the closing line) */
  to?: number;
  className?: string;
  /** replay gently while in view (hero) vs play once (inline sidebar) */
  loop?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  // once: true — start when first revealed, then keep looping while mounted.
  // Stop/start on scroll caused a mid-sweep freeze whenever the card hovered
  // near the inView margin boundary (visibly on screen but "out of view").
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const clv = to - from;
  const pct = useMotionValue(from);
  const label = useTransform(pct, (v) => `${Math.round(v)}%`);
  const barWidth = useTransform(pct, (v) => `${v}%`);
  const [settled, setSettled] = useState(reduce);

  useEffect(() => {
    if (reduce) {
      pct.set(to);
      setSettled(true);
      return;
    }
    if (!inView) return;

    // Drive the replay loop by hand: framer's repeat of a keyframe+times
    // animation stalled after the first cycle (sweep, snap back, frozen).
    // Each cycle restarts itself on completion instead.
    let cancelled = false;
    let controls: ReturnType<typeof animate> | undefined;
    const cycle = () => {
      if (cancelled) return;
      pct.set(from);
      controls = animate(pct, loop ? [from, from, to, to] : [from, to], {
        duration: loop ? 5.2 : 1.4,
        times: loop ? [0, 0.16, 0.46, 1] : [0, 1],
        ease: EASE,
        onUpdate: (v) => setSettled(v >= to - 0.4),
        onComplete: () => {
          if (loop && !cancelled) cycle();
        },
      });
    };
    cycle();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [inView, reduce, from, to, loop, pct]);

  return (
    <div
      ref={ref}
      className={cn(
        "solid relative overflow-hidden p-5 sm:p-6",
        className,
      )}
    >
      {/* header — the frame */}
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-deep">
          Beat the Line
        </span>
        <span className="tnum text-[11px] font-medium uppercase tracking-wide text-ink-soft/80">
          {team} to win · World Cup
        </span>
      </div>

      {/* the two reads */}
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-soft/80">
            When you called it
          </p>
          <p className="tnum mt-1 font-display text-[26px] font-bold leading-none text-ink">
            {from}%
          </p>
          <p className="mt-1 text-[11px] text-ink-soft/70">market&rsquo;s read</p>
        </div>

        <span aria-hidden className="pb-6 font-display text-[18px] text-ink-soft/50">
          →
        </span>

        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-soft/80">
            By kickoff
          </p>
          <motion.p
            className={cn(
              "tnum mt-1 font-display text-[34px] font-bold leading-none transition-colors duration-300",
              settled ? "text-emerald" : "text-ink",
            )}
          >
            {label}
          </motion.p>
          <p className="mt-1 text-[11px] text-ink-soft/70">market moved your way</p>
        </div>
      </div>

      {/* the track — your entry tick vs where the market closed */}
      <div className="relative mt-5 h-2.5 w-full rounded-[var(--radius-pill)] bg-[rgba(255,255,255,0.06)]">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-[var(--radius-pill)] bg-gradient-to-r from-[rgba(0,224,138,0.55)] to-emerald"
          style={{ width: barWidth }}
        />
        {/* fixed marker at your entry point */}
        <div
          className="absolute -top-1 bottom-[-4px] w-[2px] rounded bg-ink/70"
          style={{ left: `${from}%` }}
          aria-hidden
        />
        <span
          className="absolute top-[14px] -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-ink-soft"
          style={{ left: `${from}%` }}
        >
          your call
        </span>
      </div>

      {/* verdict — pops once the line has moved to you */}
      <motion.div
        className="mt-7 flex flex-wrap items-center gap-2"
        initial={false}
        animate={
          reduce
            ? { opacity: 1, y: 0 }
            : settled
              ? { opacity: 1, y: 0 }
              : { opacity: 0, y: 6 }
        }
        transition={{ duration: 0.32, ease: EASE }}
      >
        <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-emerald/50 bg-[rgba(0,224,138,0.12)] px-3 py-1.5 font-display text-[12px] font-semibold uppercase tracking-wide text-emerald-deep">
          +{clv} pts CLV · the market came to you
        </span>
        <span className="text-[13px] font-medium text-ink-soft">
          You beat the line.
        </span>
      </motion.div>
    </div>
  );
}

export default LineMove;
