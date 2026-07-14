"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useReplayFeed } from "@/lib/replay";

/* ============================================================================
   /replay/[id] — the PUBLIC replay player.

   Guest-safe by construction: it reads NO session token, never redirects to
   /connect, and lives OUTSIDE the proxy.ts wallet-gate matcher, so a judge with
   no wallet can watch a real recorded match play through the live pipeline.

   Honesty (D2/D6): the score / scorers / pundit lines are REAL recorded data and
   are presented as such; the odds are a single stored snapshot shown ONCE and
   labelled reference-only, with no odometer and no tick animation.
   ========================================================================== */

// How long to wait for the first frame before deciding the fixture can't be replayed.
const LOAD_TIMEOUT_MS = 6000;

export default function ReplayPlayerPage() {
  const params = useParams<{ id: string }>();
  const fixtureId = Number(params.id);
  const valid = Number.isInteger(fixtureId) && fixtureId > 0;
  const reduce = useReducedMotion();

  // Optional ?speed= override (demo recordings); the worker clamps to its own range.
  // Read from window.location to avoid the useSearchParams Suspense requirement.
  const [speed] = useState(() => {
    if (typeof window === "undefined") return 20;
    const p = Number(new URLSearchParams(window.location.search).get("speed"));
    return Number.isFinite(p) && p >= 1 ? Math.min(p, 20000) : 20;
  });

  const { connected, meta, score, refOdds, lines, goalBurst, done, restart } = useReplayFeed(
    valid ? fixtureId : null,
    { speed },
  );

  // Unknown fixture / no recorded events: the worker emits nothing, so if no init
  // frame arrives within a few seconds we surface a friendly, honest fallback.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!valid) {
      setTimedOut(true);
      return;
    }
    setTimedOut(false);
    if (meta) return;
    const t = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [valid, meta]);

  const enter = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.36, ease: [0.2, 0.7, 0.3, 1] as const, delay: reduce ? 0 : i * 0.05 },
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <Link
          href="/replay"
          className="mb-3 inline-flex min-h-[40px] items-center gap-1 font-display text-[15px] font-semibold text-ink-soft hover:text-ink"
        >
          ‹ Replays
        </Link>

        {!meta && !timedOut ? (
          <div className="solid h-64 animate-pulse" />
        ) : !meta && timedOut ? (
          <div className="solid p-6 text-center">
            <p className="text-[16px] font-medium text-ink">Couldn&apos;t load this replay.</p>
            <p className="mt-1 text-[15px] text-ink-soft">The match may not have a recorded history.</p>
            <Link
              href="/replay"
              className="mt-4 inline-flex font-display text-[15px] font-semibold text-emerald-deep hover:text-emerald"
            >
              Browse replays ▸
            </Link>
          </div>
        ) : meta ? (
          <div className="flex flex-col gap-4">
            {/* ---- Replay badge + honest caption ---- */}
            <motion.div {...enter(0)} className="flex flex-col gap-2">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-pill)] border border-[rgba(255,106,77,0.4)] bg-[rgba(255,106,77,0.12)] px-3 py-1 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-coral">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-coral" />
                Replay
              </span>
              <p className="text-[14px] leading-snug text-ink-soft">
                A real recorded match, replayed through the live pipeline. Accelerated {meta.speed}x.
              </p>
            </motion.div>

            {/* ---- Scoreboard (solid reading surface, reused from the live room) ---- */}
            <motion.section {...enter(1)} className="solid relative overflow-hidden p-5">
              {goalBurst && <ReplayGoalBurst reduce={!!reduce} />}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      done ? "bg-ink-soft/40" : "bg-coral motion-safe:animate-[tl-heart_1.1s_ease-in-out_infinite]",
                    )}
                  />
                  <span className="font-display text-[12px] font-semibold uppercase tracking-wide text-coral">
                    {done ? "Full time" : "Replay"}
                  </span>
                </span>
                <span className="tnum text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                  {score.statusLabel || "Kicking off"}
                  {score.minute != null && !done ? <span className="ml-1.5 text-ink">{score.minute}&apos;</span> : null}
                  {!connected && !done && <span className="ml-2 text-coral/70">connecting…</span>}
                </span>
              </div>

              {/* score line */}
              <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="min-w-0 text-right">
                  <p className="font-display text-[18px] font-semibold leading-tight tracking-tight text-ink sm:text-[20px]">
                    {meta.participant1}
                  </p>
                </div>
                <p className="tnum font-display text-[44px] font-bold leading-none tracking-tight text-ink sm:text-[56px]">
                  {score.p1}
                  <span className="mx-2 text-ink-soft/50">-</span>
                  {score.p2}
                </p>
                <div className="min-w-0 text-left">
                  <p className="font-display text-[18px] font-semibold leading-tight tracking-tight text-ink sm:text-[20px]">
                    {meta.participant2}
                  </p>
                </div>
              </div>

              <p className="tnum mt-3 text-center text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                {meta.competition}
              </p>

              {/* ---- Reference odds row — the ONE stored snapshot, shown once, no odometer ---- */}
              <div className="mt-4 border-t border-[rgba(255,255,255,0.08)] pt-4">
                <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-wide text-ink-soft/80">
                  Reference line · snapshot, not live
                </p>
                {refOdds && refOdds.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {refOdds.map((o) => (
                      <div
                        key={o.label}
                        className="flex flex-col items-center gap-0.5 rounded-[var(--radius-sm)] bg-[rgba(255,255,255,0.04)] py-2"
                      >
                        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-soft">{o.label}</span>
                        <span className="tnum font-display text-[16px] font-semibold text-ink">{o.price.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-[14px] text-ink-soft">Odds snapshot unavailable</p>
                )}
              </div>
            </motion.section>

            {/* ---- Replay complete ---- */}
            <AnimatePresence>
              {done && (
                <motion.section
                  initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.36, ease: [0.2, 0.7, 0.3, 1] }}
                  className="solid p-5 text-center"
                >
                  <p className="font-display text-[13px] font-semibold uppercase tracking-wide text-ink-soft">
                    Replay complete
                  </p>
                  <p className="mt-1.5 font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
                    {meta.participant1} {score.p1}
                    <span className="mx-1.5 text-ink-soft/60">-</span>
                    {score.p2} {meta.participant2}
                  </p>
                  <p className="mt-0.5 text-[15px] text-ink-soft">{score.statusLabel}</p>
                  <div className="mt-4 flex flex-col items-center gap-3">
                    <Button onClick={restart} size="lg" className="w-full">
                      Watch again ▸
                    </Button>
                    <Link
                      href="/replay"
                      className="font-display text-[15px] font-semibold text-ink-soft hover:text-ink"
                    >
                      Back to replays
                    </Link>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>

            {/* ---- Pundit feed (glass bubbles, newest first) ---- */}
            <motion.section {...enter(2)}>
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                  Replay commentary
                </p>
              </div>

              {lines.length === 0 ? (
                <div className="glass p-4 text-[15px] text-ink-soft">Waiting for the first whistle…</div>
              ) : (
                <ul className="flex flex-col gap-2">
                  <AnimatePresence initial={false}>
                    {lines.map((l) => (
                      <motion.li
                        key={l.id}
                        layout={!reduce}
                        initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.2, 0.7, 0.3, 1] }}
                        className="glass relative overflow-hidden p-4"
                      >
                        <p className="relative text-[16px] leading-snug text-ink">{l.line}</p>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </motion.section>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------- goal burst */

// A brand-token dot spray behind a "GOAL!" cry — a minimal port of the live
// room's GoalBurst, kept inside the monochrome + one-accent system. motion-safe
// only; reduced motion gets a static badge that still reads.
const GOAL_PARTICLE_COUNT = 12;
const GOAL_COLORS = ["var(--emerald)", "var(--cyan)", "var(--gold)", "var(--coral)"];
const GOAL_PARTICLES = Array.from({ length: GOAL_PARTICLE_COUNT }, (_, i) => {
  const angle = (i / GOAL_PARTICLE_COUNT) * Math.PI * 2 + Math.PI / 6;
  const dist = 78 + (i % 4) * 26;
  return {
    color: GOAL_COLORS[i % GOAL_COLORS.length]!,
    gx: Math.round(Math.cos(angle) * dist),
    gy: Math.round(Math.sin(angle) * dist) - 26,
    size: 7 + (i % 3) * 3,
    delay: (i % 5) * 45,
  };
});

function ReplayGoalBurst({ reduce }: { reduce: boolean }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
      {!reduce
        ? GOAL_PARTICLES.map((p, i) => (
            <span
              key={i}
              className="absolute rounded-full motion-safe:animate-[tl-goalfly_1700ms_ease-out_both]"
              style={
                {
                  width: `${p.size}px`,
                  height: `${p.size}px`,
                  background: p.color,
                  "--gx": `${p.gx}px`,
                  "--gy": `${p.gy}px`,
                  animationDelay: `${p.delay}ms`,
                } as CSSProperties
              }
            />
          ))
        : null}
      <span
        className={cn(
          "relative rounded-[var(--radius-pill)] bg-[rgba(0,217,130,0.18)] px-4 py-1.5 font-display text-[16px] font-bold uppercase tracking-[0.14em] text-emerald-deep",
          !reduce && "motion-safe:animate-[tl-goalcry_1700ms_ease-out_both]",
        )}
      >
        Goal!
      </span>
    </span>
  );
}
