"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { IconTrophy, IconCheck } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import {
  getTournamentTeams,
  getBracket,
  postBracket,
  getBracketPool,
  type Team,
  type BracketState,
  type BracketPoolRow,
} from "@/lib/game";

const lockFmt = new Intl.DateTimeFormat([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "··";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/* ============================================================================
   Slot — the champion / runner-up chip. Tap to open the team picker for it.
   ========================================================================== */
function Slot({
  label,
  team,
  optional,
  disabled,
  onEdit,
}: {
  label: string;
  team: Team | null;
  optional?: boolean;
  disabled?: boolean;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onEdit}
      disabled={disabled}
      className={cn(
        "solid flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left",
        !disabled && "cursor-pointer transition-colors hover:border-emerald/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
        disabled && "opacity-70",
      )}
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[rgba(0,217,130,0.10)] font-display text-[13px] font-bold text-emerald-deep"
      >
        {team ? initials(team.name) : "?"}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          {label}
          {optional && !team ? " · optional" : ""}
        </span>
        <span className="truncate font-display text-[17px] font-semibold leading-tight text-ink">
          {team ? team.name : optional ? "Skip for now" : "Choose a team"}
        </span>
      </span>
      {!disabled && (
        <span className="ml-auto shrink-0 text-[13px] font-semibold text-emerald-deep">
          {team ? "Change" : "Pick"}
        </span>
      )}
    </button>
  );
}

/* ============================================================================
   Picker — searchable team grid, used for both the champion and runner-up slot.
   ========================================================================== */
function Picker({
  teams,
  exclude,
  allowSkip,
  onPick,
  onSkip,
  onClose,
}: {
  teams: Team[];
  exclude?: number | null;
  allowSkip?: boolean;
  onPick: (team: Team) => void;
  onSkip?: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const pool = teams.filter((t) => t.id !== exclude);
    const q = query.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((t) => t.name.toLowerCase().includes(q));
  }, [teams, exclude, query]);

  return (
    <GlassCard className="mt-3 p-4">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search teams…"
          className={cn(
            "min-h-[44px] flex-1 rounded-[var(--radius-sm)] border border-[rgba(255,255,255,0.14)]",
            "bg-[rgba(255,255,255,0.04)] px-3 text-[15px] text-ink placeholder:text-ink-soft/70",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
          )}
        />
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] shrink-0 cursor-pointer px-2 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          Close
        </button>
      </div>

      {allowSkip && onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="mt-3 min-h-[36px] cursor-pointer text-[13px] font-semibold text-ink-soft underline decoration-dotted hover:text-ink"
        >
          Skip runner-up pick
        </button>
      )}

      <div className="mt-3 grid max-h-[340px] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
        {filtered.length === 0 ? (
          <p className="col-span-full py-6 text-center text-[14px] text-ink-soft">No teams match &ldquo;{query}&rdquo;</p>
        ) : (
          filtered.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t)}
              className={cn(
                "min-h-[44px] cursor-pointer rounded-[var(--radius-sm)] border border-[rgba(255,255,255,0.10)]",
                "bg-[rgba(255,255,255,0.03)] px-3 py-2 text-left font-display text-[14px] font-semibold text-ink",
                "transition-colors hover:border-emerald/60 hover:bg-[rgba(0,217,130,0.06)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
              )}
            >
              {t.name}
            </button>
          ))
        )}
      </div>
    </GlassCard>
  );
}

/* ============================================================================
   Pool — aggregate "who's backing whom" across every wallet.
   ========================================================================== */
function PoolBreakdown({ rows }: { rows: BracketPoolRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (!rows.length) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 px-1 font-display text-[13px] font-semibold uppercase tracking-wide text-ink-soft">
        Who the pool&apos;s backing
      </h2>
      <div className="solid flex flex-col divide-y divide-[rgba(255,255,255,0.06)] p-1">
        {rows.slice(0, 8).map((r) => {
          const pct = total ? Math.round((r.count / total) * 100) : 0;
          return (
            <div key={r.championId} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate font-display text-[14px] font-semibold text-ink">
                {r.championName}
              </span>
              <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                <div className="h-full rounded-full bg-emerald" style={{ width: `${pct}%` }} />
              </div>
              <span className="tnum w-10 shrink-0 text-right text-[13px] font-semibold text-ink-soft">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function BracketPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const token = useSession((s) => s.token);
  const hydrated = useSession((s) => s.hydrated);

  const [teams, setTeams] = useState<Team[]>([]);
  const [state, setState] = useState<BracketState | null>(null);
  const [pool, setPool] = useState<BracketPoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [champion, setChampion] = useState<Team | null>(null);
  const [runnerUp, setRunnerUp] = useState<Team | null>(null);
  const [editing, setEditing] = useState<"champion" | "runnerUp" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Guest-viewable by design (proxy.ts excludes /bracket from the wallet
  // gate): a shared pool link should show the champion picks and pool
  // breakdown with no wallet required. Only *making* a call needs a session
  // — handled inline below, not by bouncing the whole page to /connect.
  useEffect(() => {
    let active = true;
    getTournamentTeams().then((t) => {
      if (active) setTeams(t);
    });
    getBracketPool().then((p) => {
      if (active) setPool(p);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      if (hydrated) setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    getBracket(token).then((s) => {
      if (!active) return;
      setState(s);
      if (s?.pick) {
        setChampion({ id: s.pick.championId, name: s.pick.championName });
        setRunnerUp(
          s.pick.runnerUpId != null ? { id: s.pick.runnerUpId, name: s.pick.runnerUpName ?? "" } : null,
        );
      } else {
        setEditing("champion");
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [token, hydrated]);

  const locked = state?.locked ?? false;
  const resolved = state?.pick?.status === "resolved";
  const dirty =
    !!champion &&
    (champion.id !== state?.pick?.championId || (runnerUp?.id ?? null) !== (state?.pick?.runnerUpId ?? null));

  async function handleSave() {
    if (!champion) return;
    // A guest can browse teams and stage a champion pick, but saving it needs a
    // session — send them to sign in rather than silently no-op on tap.
    if (!token) {
      router.push("/connect?next=/bracket");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await postBracket(token, champion.id, champion.name, runnerUp?.id ?? null, runnerUp?.name ?? null);
      setState((prev) => (prev ? { ...prev, pick: res.pick } : prev));
      setEditing(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, ease: [0.2, 0.7, 0.3, 1] }}
        >
          <div className="flex items-center gap-2">
            <IconTrophy className="h-6 w-6" color="var(--gold)" />
            <h1 className="font-display text-[28px] font-bold leading-none tracking-tight text-ink">
              Champion
            </h1>
          </div>
          <p className="mt-2 text-[15px] leading-snug text-ink-soft">
            One pick for the whole tournament. Call the champion (and runner-up for
            bonus points) before the first kickoff. It&apos;s graded independently and
            rolls straight into your XP.
          </p>

          {state?.lockAt != null && (
            <p className="tnum mt-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
              {locked ? "Pool locked" : `Locks ${lockFmt.format(new Date(state.lockAt))}`}
            </p>
          )}

          {loading ? (
            <div className="mt-5 flex flex-col gap-2">
              <div className="solid h-16 animate-pulse" />
              <div className="solid h-16 animate-pulse bg-[rgba(255,255,255,0.05)]" />
            </div>
          ) : locked && !state?.pick ? (
            <div className="solid mt-5 px-6 py-10 text-center">
              <p className="font-display text-[17px] font-bold text-ink">Picks are closed</p>
              <p className="mx-auto mt-1 max-w-xs text-[14px] text-ink-soft">
                The pool locked at kickoff without a call from this wallet.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-5 flex flex-col gap-2.5">
                <Slot
                  label="Champion"
                  team={champion}
                  disabled={locked || resolved}
                  onEdit={() => setEditing("champion")}
                />
                <Slot
                  label="Runner-up"
                  team={runnerUp}
                  optional
                  disabled={locked || resolved}
                  onEdit={() => setEditing("runnerUp")}
                />
              </div>

              <AnimatePresence mode="wait">
                {editing && !locked && !resolved && (
                  <motion.div
                    key={editing}
                    initial={reduce ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={reduce ? undefined : { opacity: 0, height: 0 }}
                    transition={{ duration: 0.22 }}
                    className="overflow-hidden"
                  >
                    <Picker
                      teams={teams}
                      exclude={editing === "runnerUp" ? champion?.id : runnerUp?.id}
                      allowSkip={editing === "runnerUp"}
                      onPick={(t) => {
                        if (editing === "champion") {
                          setChampion(t);
                          setEditing(runnerUp ? null : "runnerUp");
                        } else {
                          setRunnerUp(t);
                          setEditing(null);
                        }
                      }}
                      onSkip={() => {
                        setRunnerUp(null);
                        setEditing(null);
                      }}
                      onClose={() => setEditing(null)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {error && (
                <p className="mt-3 text-[13px] font-medium text-coral">{error}</p>
              )}

              {resolved ? (
                <div className="solid mt-4 flex items-center gap-3 px-4 py-3">
                  <IconCheck className="h-5 w-5 shrink-0" color="var(--emerald-deep)" />
                  <p className="text-[14px] text-ink-soft">
                    Graded: <span className="font-semibold text-ink">{state?.pick?.points ?? 0} pts</span> banked
                    to your XP.
                  </p>
                </div>
              ) : !locked ? (
                <Button
                  onClick={handleSave}
                  disabled={!champion || saving || !dirty}
                  className="mt-4 w-full"
                >
                  {saving ? "Saving…" : saved ? "Saved ✓" : state?.pick ? "Update pick" : "Save pick"}
                </Button>
              ) : null}
            </>
          )}

          <PoolBreakdown rows={pool} />
        </motion.div>
      </div>
    </AppShell>
  );
}
