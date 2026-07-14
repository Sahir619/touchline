"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { decimalOdds } from "@touchline/shared";
import { AppShell } from "@/components/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { CompetitionFilter } from "@/components/ui/CompetitionFilter";
import { cn } from "@/lib/cn";
import { getSlate, type SlateFixture } from "@/lib/api";

const timeFmt = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });

interface LiveTile {
  id: number;
  home: string;
  away: string;
  competition: string;
  startTime: number;
  inPlay: boolean;
  prices: [number, number, number] | null;
}

function toTiles(slate: SlateFixture[]): LiveTile[] {
  const tiles = slate.map((f) => {
    const p = f.oneX2?.prices;
    const prices = p && p.length === 3 ? (p.map(decimalOdds) as [number, number, number]) : null;
    return {
      id: f.fixtureId,
      home: f.participant1,
      away: f.participant2,
      competition: f.competition,
      startTime: f.startTime,
      inPlay: Boolean(f.oneX2?.inRunning),
      prices,
    };
  });
  // in-play first, then nearest kickoff
  return tiles.sort((a, b) => {
    if (a.inPlay !== b.inPlay) return a.inPlay ? -1 : 1;
    return a.startTime - b.startTime;
  });
}

export default function LiveIndexPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [tiles, setTiles] = useState<LiveTile[]>([]);
  const [loading, setLoading] = useState(true);
  const [competition, setCompetition] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSlate()
      .then((slate) => {
        if (!active) return;
        setTiles(toTiles(slate));
      })
      .catch(() => {
        /* keep empty */
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const liveCount = useMemo(() => tiles.filter((t) => t.inPlay).length, [tiles]);

  // Distinct competitions on the wire, first-seen (post-sort) order preserved. The
  // chip row only surfaces at 2+, so a single-competition slate is unchanged.
  const competitions = useMemo(() => {
    const seen: string[] = [];
    for (const t of tiles) {
      if (t.competition && !seen.includes(t.competition)) seen.push(t.competition);
    }
    return seen;
  }, [tiles]);

  // Rendered tiles: all at default (All), else only the picked competition. The
  // in-play-first / kickoff sort from toTiles is preserved within the filtered set.
  const shownTiles = useMemo(
    () => (competition ? tiles.filter((t) => t.competition === competition) : tiles),
    [tiles, competition],
  );

  const enter = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.36, ease: [0.2, 0.7, 0.3, 1] as const, delay: reduce ? 0 : i * 0.04 },
  });

  return (
    <AppShell>
      <motion.div {...enter(0)} className="flex items-end justify-between gap-3 pt-1">
        <div>
          <h1 className="font-display text-[34px] font-bold leading-none tracking-tight text-ink">Live</h1>
          <p className="tnum mt-1.5 flex items-center gap-2 text-[13px] font-medium uppercase tracking-wide text-ink-soft">
            {liveCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-coral">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full bg-coral motion-safe:animate-[tl-heart_1.1s_ease-in-out_infinite]"
                />
                {liveCount} in play
              </span>
            ) : (
              "Follow your calls in real time"
            )}
          </p>
        </div>
      </motion.div>

      {/* Additive (Match Replay): a self-contained entry to the public replay catalog.
          Does not touch the slate fetch, tile ordering, or live-count above/below.
          Removing this single block restores /live exactly. */}
      <motion.button
        {...enter(1)}
        type="button"
        onClick={() => router.push("/replay")}
        whileTap={reduce ? undefined : { scale: 0.99 }}
        className={cn(
          "mt-4 flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[rgba(255,106,77,0.28)] bg-[rgba(255,106,77,0.06)] px-4 py-3 text-left",
          "transition-colors hover:bg-[rgba(255,106,77,0.10)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        <span className="flex items-center gap-2.5">
          <span className="inline-flex items-center rounded-[var(--radius-pill)] border border-[rgba(255,106,77,0.4)] bg-[rgba(255,106,77,0.12)] px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-coral">
            Replay
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
            Replay a finished match
          </span>
        </span>
        <span aria-hidden className="font-display text-[15px] font-semibold uppercase tracking-wide text-emerald-deep">
          browse ▸
        </span>
      </motion.button>

      {/* Competition filter — additive; renders only when 2+ competitions are on the
          wire. At default (All) the tile list below is unchanged, preserving today's
          in-play-first order. */}
      {competitions.length > 1 && (
        <motion.div {...enter(2)} className="mt-4">
          <CompetitionFilter
            competitions={competitions}
            value={competition}
            onChange={setCompetition}
          />
        </motion.div>
      )}

      {loading ? (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="solid h-32 animate-pulse" />
          <div className="solid h-32 animate-pulse" />
        </div>
      ) : tiles.length === 0 ? (
        <motion.div {...enter(1)} className="mt-5">
          <GlassCard className="p-6 text-center">
            <p className="text-[16px] font-medium text-ink">No matches on the wire right now.</p>
            <p className="mt-1 text-[15px] text-ink-soft">Lock a pick from Today and it&apos;ll light up here at kickoff.</p>
          </GlassCard>
        </motion.div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {shownTiles.map((t, i) => (
            <motion.button
              key={t.id}
              {...enter(1 + i)}
              type="button"
              onClick={() => router.push(`/live/${t.id}`)}
              whileTap={reduce ? undefined : { scale: 0.99 }}
              className={cn(
                "solid flex flex-col gap-3 p-4 text-left sm:p-5",
                "transition-shadow hover:shadow-[0_10px_28px_rgba(0,0,0,0.4)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="tnum text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                  {t.competition}
                </span>
                {t.inPlay ? (
                  <span className="inline-flex items-center gap-1.5 font-display text-[12px] font-semibold uppercase tracking-wide text-coral">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full bg-coral motion-safe:animate-[tl-heart_1.1s_ease-in-out_infinite]"
                    />
                    Live
                  </span>
                ) : (
                  <span className="tnum text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                    {timeFmt.format(new Date(t.startTime))}
                  </span>
                )}
              </div>

              <h2 className="font-display text-[22px] font-semibold leading-[1.05] tracking-tight text-ink">
                <span>{t.home}</span>
                <span className="mx-2 font-normal text-ink-soft">v</span>
                <span>{t.away}</span>
              </h2>

              <div className="flex items-center justify-between">
                {t.prices ? (
                  <div className="flex gap-1.5">
                    {(["1", "X", "2"] as const).map((lbl, idx) => (
                      <span
                        key={lbl}
                        className="tnum inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[rgba(255,255,255,0.05)] px-2.5 py-1 text-[13px] font-medium text-ink"
                      >
                        <span className="text-ink-soft">{lbl}</span>
                        {t.prices![idx].toFixed(2)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[14px] text-ink-soft">Odds soon</span>
                )}
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
