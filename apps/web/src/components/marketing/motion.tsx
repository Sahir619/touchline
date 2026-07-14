"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import type { ReactNode } from "react";
import { useRef } from "react";

/* ============================================================================
   Marketing motion primitives — one shared choreography for every marketing
   page so section reveals feel like one system, not per-page one-offs.

   Stadium Night motion law (DESIGN.md §Motion):
     ease  = soft-settle cubic-bezier(.2,.7,.3,1)
     durs  = micro 120 / short 220 / medium 360 / celebratory 800
     always respect prefers-reduced-motion → instant final state.
   ========================================================================== */

const EASE = [0.2, 0.7, 0.3, 1] as const;

/* Reveal — a single element rises + fades in the first time it scrolls into
   view. `delay` staggers siblings by hand where a container isn't practical. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 18,
  as = "div",
  once = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: keyof typeof motion;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  const M = motion[as] as typeof motion.div;
  return (
    <M
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-60px" }}
      transition={{ duration: 0.5, ease: EASE, delay: reduce ? 0 : delay }}
    >
      {children}
    </M>
  );
}

/* Stagger — container that cascades its <StaggerItem> children into view.
   Use for grids/lists where the cascade reads as "the section assembling". */
export function Stagger({
  children,
  className,
  gap = 0.07,
  once = true,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  gap?: number;
  once?: boolean;
  as?: keyof typeof motion;
}) {
  const reduce = useReducedMotion();
  const M = motion[as] as typeof motion.div;
  return (
    <M
      className={className}
      initial={reduce ? false : "hidden"}
      whileInView={reduce ? undefined : "show"}
      viewport={{ once, margin: "-60px" }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: gap, delayChildren: 0.04 } },
      }}
    >
      {children}
    </M>
  );
}

export function StaggerItem({
  children,
  className,
  y = 18,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  y?: number;
  as?: keyof typeof motion;
}) {
  const M = motion[as] as typeof motion.div;
  return (
    <M
      className={className}
      variants={{
        hidden: { opacity: 0, y },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
      }}
    >
      {children}
    </M>
  );
}

/* Parallax — subtle vertical drift tied to scroll. Deliberately small
   (default ±28px) so it reads as depth, not motion-sickness. Reduced-motion
   users get a static element. */
export function Parallax({
  children,
  className,
  distance = 28,
}: {
  children: ReactNode;
  className?: string;
  distance?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  return (
    <div ref={ref} className={className}>
      <motion.div style={reduce ? undefined : { y }}>{children}</motion.div>
    </div>
  );
}
