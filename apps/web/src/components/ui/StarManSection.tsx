"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  getLineups,
  getMyPicksAllMarkets,
  postPick,
  shortPlayerName,
  STAR_MAN_MARKET,
  type LineupTeam,
} from "@/lib/game";

/* ============================================================================
   StarManSection (SAH) — the pre-kickoff "name a scorer" call, subordinate to
   the primary 1X2 market and the other secondary markets on /match/[id].
   Signed-in only (rendered inside the page's `token &&` guard), so guest
   behaviour matches Over/Under and correct-score: guests never see it.

   Three states, mirroring the sibling markets' own-state / own-lock pattern:
     (a) lineups not yet published -> quiet teaser, zero interactive elements;
     (b) lineups in -> two team columns of player chips (starters first, bench
         behind a disclosure), single selection across BOTH teams;
     (c) locked -> the same locked-receipt treatment, with a one-shot burst.
   ========================================================================== */

// Reward multipliers — kept web-local (not imported from @touchline/shared) so
// the web typechecks independently of the worker's parallel scoring build. Only
// used for the qualitative on-selection hint; the authoritative points come back
// from the server on lock (potentialPoints).
const STAR_MAN_BENCH_HINT = "Bench pick. Bigger reward if he delivers.";
const STAR_MAN_STARTER_HINT = "Named to start. The steady call.";

/* ------------------------------------------------------------- lock burst */
// Same tl-goalfly keyframe as the page's PickBurst, scaled to a personal beat.
// motion-safe only; reduced motion never renders it (the receipt text reads).
const BURST_COUNT = 9;
const BURST_COLORS = ["var(--emerald)", "var(--cyan)", "var(--gold)"];
const BURST_PARTICLES = Array.from({ length: BURST_COUNT }, (_, i) => {
  const angle = (i / BURST_COUNT) * Math.PI * 2 + Math.PI / 7;
  const dist = 40 + (i % 3) * 16;
  return {
    color: BURST_COLORS[i % BURST_COLORS.length]!,
    gx: Math.round(Math.cos(angle) * dist),
    gy: Math.round(Math.sin(angle) * dist) - 12,
    size: 4 + (i % 3) * 2,
    delay: (i % 4) * 40,
  };
});

function StarBurst() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      {BURST_PARTICLES.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full motion-safe:animate-[tl-goalfly_900ms_ease-out_both]"
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
      ))}
    </span>
  );
}

function StarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2.6l2.7 5.6 6.1.85-4.45 4.3 1.06 6.05L12 20.6l-5.42 2.85 1.06-6.05L3.2 9.05l6.1-.85z" />
    </svg>
  );
}

/* ---------------------------------------------------------------- chip */
function PlayerChip({
  roster,
  name,
  selected,
  locked,
  onPick,
}: {
  roster: string | null;
  name: string;
  selected: boolean;
  locked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={locked}
      className={cn(
        "flex min-h-[40px] w-full items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        locked
          ? "cursor-default border-dashed border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)]"
          : selected
            ? "border-emerald bg-emerald text-on-emerald glow-emerald"
            : "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] hover:border-emerald/60 hover:bg-[rgba(255,255,255,0.06)]",
      )}
    >
      <span
        className={cn(
          "tnum grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-pill)] text-[11px] font-bold tabular-nums",
          selected ? "bg-[rgba(0,0,0,0.16)] text-on-emerald" : "bg-[rgba(255,255,255,0.06)] text-ink-soft",
        )}
      >
        {roster ?? "–"}
      </span>
      <span
        className={cn(
          "min-w-0 truncate font-display text-[14px] font-semibold tracking-tight",
          selected ? "text-on-emerald" : "text-ink",
        )}
      >
        {name}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------- column */
function TeamColumn({
  team,
  starters,
  bench,
  selection,
  locked,
  showBench,
  onToggleBench,
  onPick,
}: {
  team: LineupTeam;
  starters: LineupTeam["players"];
  bench: LineupTeam["players"];
  selection: number | null;
  locked: boolean;
  showBench: boolean;
  onToggleBench: () => void;
  onPick: (playerId: number) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-2 truncate font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
        {team.team}
      </p>
      <div className="flex flex-col gap-1.5">
        {starters.map((p) => (
          <PlayerChip
            key={p.playerId}
            roster={p.rosterNumber}
            name={shortPlayerName(p.name)}
            selected={selection === p.playerId}
            locked={locked}
            onPick={() => onPick(p.playerId)}
          />
        ))}
      </div>

      {bench.length > 0 && (
        <>
          <button
            type="button"
            onClick={onToggleBench}
            className="mt-2 inline-flex min-h-[32px] items-center gap-1 text-[12px] font-semibold text-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald"
          >
            {showBench ? "Hide bench" : `Show bench (${bench.length})`}
          </button>
          <AnimatePresence initial={false}>
            {showBench && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.24, ease: [0.2, 0.7, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {bench.map((p) => (
                    <PlayerChip
                      key={p.playerId}
                      roster={p.rosterNumber}
                      name={shortPlayerName(p.name)}
                      selected={selection === p.playerId}
                      locked={locked}
                      onPick={() => onPick(p.playerId)}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- section */
export function StarManSection({ fixtureId, token }: { fixtureId: number; token: string }) {
  const reduce = useReducedMotion();
  const [lineups, setLineups] = useState<LineupTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<number | null>(null);
  const [showBench, setShowBench] = useState(false);
  const [locking, setLocking] = useState(false);
  const [justLocked, setJustLocked] = useState(false);
  const [locked, setLocked] = useState<{ label: string; points: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetchLineups = useCallback(async () => {
    const teams = await getLineups(fixtureId);
    setLineups(teams);
    return teams;
  }, [fixtureId]);

  // Initial load: lineups + any already-open Star Man pick on this fixture. Reads
  // GET /api/picks/all (the multi-market list) exactly like Over/Under and
  // correct-score do, so nothing here touches the 1X2 contract.
  useEffect(() => {
    let active = true;
    (async () => {
      const [teams, all] = await Promise.all([getLineups(fixtureId), getMyPicksAllMarkets(token)]);
      if (!active) return;
      setLineups(teams);
      const existing = all.find(
        (p) => p.fixtureId === fixtureId && p.market === STAR_MAN_MARKET && p.status === "open",
      );
      if (existing) {
        // Prefer the server's potentialPoints (bench/underdog/stage multipliers baked in) so
        // the reloaded receipt matches the at-lock number. oddsAtLock is the synthetic flat
        // base (STAR_MAN_BASE_POINTS/100), so oddsAtLock*100 would understate a bold call.
        setLocked({
          label: existing.selectionLabel,
          points: existing.potentialPoints ?? Math.round(existing.oddsAtLock * 100),
        });
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [fixtureId, token]);

  // Lineups can publish any time in the final pre-kickoff hour (sometimes minutes before
  // kickoff) — poll every 45s while the teaser is showing AND refetch on tab focus, so the
  // chips appear the moment the feed has them. No-op once locked or once lineups arrive.
  useEffect(() => {
    if (locked || lineups.length > 0) return;
    const onFocus = () => void refetchLineups();
    window.addEventListener("focus", onFocus);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refetchLineups();
    }, 45_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(poll);
    };
  }, [locked, lineups.length, refetchLineups]);

  const allPlayers = useMemo(() => lineups.flatMap((t) => t.players), [lineups]);
  const selPlayer = useMemo(
    () => allPlayers.find((p) => p.playerId === selection) ?? null,
    [allPlayers, selection],
  );

  const lock = async () => {
    if (!selection) return;
    setLocking(true);
    setError(null);
    try {
      const res = await postPick(token, fixtureId, String(selection), STAR_MAN_MARKET);
      const label = res.pick.selectionLabel || (selPlayer ? shortPlayerName(selPlayer.name) : "your Star Man");
      setLocked({ label, points: res.potentialPoints });
      setJustLocked(true);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(10);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLocking(false);
    }
  };

  // (a) not published yet — quiet teaser, no interactive elements.
  const published = lineups.length > 0;

  return (
    <div className="solid p-5">
      <p className="inline-flex items-center gap-1.5 font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
        <StarGlyph className="h-3.5 w-3.5 text-gold" />
        Star Man · name a scorer
      </p>

      {loading ? (
        <div className="mt-3 h-24 animate-pulse rounded-[var(--radius-sm)] bg-[rgba(255,255,255,0.04)]" />
      ) : locked ? (
        /* (c) locked receipt */
        <motion.div
          initial={justLocked && !reduce ? { scale: 0.94, opacity: 0.6 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={
            justLocked && !reduce ? { type: "spring", stiffness: 520, damping: 22, mass: 0.7 } : { duration: 0 }
          }
          className="relative mt-3 rounded-[var(--radius-sm)] bg-[rgba(0,217,130,0.10)] p-4"
        >
          {justLocked && !reduce && <StarBurst />}
          <p className="relative inline-flex items-center gap-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald">
            <StarGlyph className="h-3 w-3 text-gold" />
            Your Star Man · on record
          </p>
          <p className="relative mt-1 font-display text-[16px] font-semibold text-emerald-deep">
            You called {locked.label} to score.
          </p>
          <p className="tnum relative mt-0.5 text-[14px] text-ink-soft">
            {locked.points} pts on the line if he finds the net. Own goals never count.
          </p>
        </motion.div>
      ) : !published ? (
        /* (a) teaser */
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          Official lineups land closer to kickoff, sometimes only minutes before. This card updates the moment they drop.
        </p>
      ) : (
        /* (b) picker */
        <>
          <p className="mt-1 text-[12px] text-ink-soft">
            Pick one player from either side. If he scores, your call lands. The longer the shot, the bigger the reward.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {lineups.map((team) => (
              <TeamColumn
                key={team.teamId}
                team={team}
                starters={team.players.filter((p) => p.starter)}
                bench={team.players.filter((p) => !p.starter)}
                selection={selection}
                locked={false}
                showBench={showBench}
                onToggleBench={() => setShowBench((v) => !v)}
                onPick={(id) => setSelection(id)}
              />
            ))}
          </div>

          {selPlayer && (
            <p className="mt-3 text-[13px] font-medium text-ink">
              <span className="font-display text-emerald-deep">{shortPlayerName(selPlayer.name)}</span>.{" "}
              {selPlayer.starter ? STAR_MAN_STARTER_HINT : STAR_MAN_BENCH_HINT}
            </p>
          )}

          <Button onClick={lock} disabled={!selection || locking} className="mt-3 w-full">
            {locking ? "Locking…" : "Lock Star Man ★"}
          </Button>
        </>
      )}

      {error && <p className="mt-2 text-[13px] font-medium text-coral">{error}</p>}
    </div>
  );
}
