"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { cn } from "@/lib/cn";
import { getReplays, type ReplayCatalogRow } from "@/lib/replay";

/* ============================================================================
   /replay — the PUBLIC replay catalog.

   Guest-safe: outside the proxy.ts wallet-gate matcher, reads no session, calls
   only the public GET /api/replays. Judges with no wallet can browse finished
   matches and open any one to watch it replay through the live pipeline.
   ========================================================================== */

export default function ReplayIndexPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [rows, setRows] = useState<ReplayCatalogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getReplays()
      .then((r) => {
        if (active) setRows(r);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const enter = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.36, ease: [0.2, 0.7, 0.3, 1] as const, delay: reduce ? 0 : i * 0.04 },
  });

  return (
    <AppShell>
      <motion.div {...enter(0)} className="pt-1">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-pill)] border border-[rgba(255,106,77,0.4)] bg-[rgba(255,106,77,0.12)] px-3 py-1 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-coral">
          Replay a finished match
        </span>
        <h1 className="mt-2 font-display text-[34px] font-bold leading-none tracking-tight text-ink">Replays</h1>
        <p className="mt-1.5 text-[15px] text-ink-soft">
          Watch a real recorded match play out through the live pipeline. No wallet needed.
        </p>
      </motion.div>

      {loading ? (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="solid h-32 animate-pulse" />
          <div className="solid h-32 animate-pulse" />
        </div>
      ) : rows.length === 0 ? (
        <motion.div {...enter(1)} className="mt-5">
          <GlassCard className="p-6 text-center">
            <p className="text-[16px] font-medium text-ink">No recorded matches to replay yet.</p>
            <p className="mt-1 text-[15px] text-ink-soft">
              Finished matches with a recorded history show up here.
            </p>
          </GlassCard>
        </motion.div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {rows.map((r, i) => (
            <motion.button
              key={r.fixtureId}
              {...enter(1 + i)}
              type="button"
              onClick={() => router.push(`/replay/${r.fixtureId}`)}
              whileTap={reduce ? undefined : { scale: 0.99 }}
              className={cn(
                "solid flex flex-col gap-3 p-4 text-left sm:p-5",
                "transition-shadow hover:shadow-[0_10px_28px_rgba(0,0,0,0.4)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="tnum text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                  {r.competition}
                </span>
                <span className="font-display text-[12px] font-semibold uppercase tracking-wide text-coral">
                  Replay
                </span>
              </div>

              <h2 className="font-display text-[22px] font-semibold leading-[1.05] tracking-tight text-ink">
                <span>{r.participant1}</span>
                <span className="mx-2 font-normal text-ink-soft">v</span>
                <span>{r.participant2}</span>
              </h2>

              <div className="flex items-center justify-between">
                <span className="tnum inline-flex items-center gap-2 font-display text-[18px] font-bold text-ink">
                  {r.p1}
                  <span className="text-ink-soft/50">-</span>
                  {r.p2}
                  <span className="ml-1 text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                    {r.finalStatus}
                  </span>
                </span>
                <span aria-hidden className="font-display text-[15px] font-semibold uppercase tracking-wide text-emerald-deep">
                  watch ▸
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </AppShell>
  );
}
