"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { IconTrophy } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import {
  getLeague,
  getLeagueBracket,
  shareInvite,
  type League,
  type LeaderRow as LeaderRowT,
  type LeagueBracketRow,
} from "@/lib/game";
import { LeaderRow, PlayerPopover } from "../../leaderboard/page";

/* invite code may ride on the league object under a couple of names */
function inviteCodeOf(league: League): string {
  const l = league as League & { inviteCode?: string; code?: string };
  return l.inviteCode ?? l.code ?? league.id;
}

/* Real shareable invite — native share sheet where available, else a
   copy-link of the /join/[code] deep-link, not just the raw code. */
function InviteShare({ leagueName, code }: { leagueName: string; code: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "shared">("idle");

  const share = async () => {
    const result = await shareInvite(leagueName, code);
    if (result === "copied" || result === "shared") {
      setStatus(result);
      setTimeout(() => setStatus("idle"), 1600);
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-pill)]",
        "border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-4 py-2 cursor-pointer",
        "transition-colors hover:border-emerald/50 hover:bg-[rgba(0,217,130,0.05)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
      )}
      aria-label={`Share invite link for ${leagueName}`}
    >
      <span className="tnum font-display text-[16px] font-bold uppercase tracking-[0.18em] text-ink">
        {code}
      </span>
      <span
        className={cn(
          "text-[13px] font-semibold",
          status !== "idle" ? "text-emerald-deep" : "text-ink-soft",
        )}
      >
        {status === "copied" ? "Copied ✓" : status === "shared" ? "Shared ✓" : "Share invite"}
      </span>
    </button>
  );
}

function shortWallet(w: string) {
  return w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "··";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/* ============================================================================
   Standings / Pool segmented control — same visual as the leaderboard's
   Global/Friends switch.
   ========================================================================== */
type BoardTab = "standings" | "pool";

function BoardTabs({ tab, onChange }: { tab: BoardTab; onChange: (t: BoardTab) => void }) {
  const tabs: { id: BoardTab; label: string }[] = [
    { id: "standings", label: "Standings" },
    { id: "pool", label: "Pool" },
  ];
  return (
    <div role="tablist" aria-label="League board" className="glass mb-4 flex gap-1 p-1">
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "relative flex-1 rounded-[var(--radius-sm)] py-2.5 text-center",
              "min-h-[44px] cursor-pointer font-display text-[15px] font-semibold tracking-tight",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
              active ? "text-on-emerald" : "text-ink-soft hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId="league-board-seg"
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="absolute inset-0 -z-10 rounded-[var(--radius-sm)] bg-emerald glow-emerald"
              />
            )}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================================
   BracketBoard — the persistent season-long champion-pick standings for this
   private league (SAH-60). Points don't reset week to week like the XP board.
   ========================================================================== */
function BracketRow({ row, isYou, index }: { row: LeagueBracketRow; isYou: boolean; index: number }) {
  const name = row.displayName || shortWallet(row.wallet);
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: Math.min(index * 0.035, 0.5), ease: [0.2, 0.7, 0.3, 1] }}
      className={cn(
        "solid flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4",
        isYou && "ring-2 ring-emerald ring-offset-2 ring-offset-canvas",
      )}
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[rgba(0,217,130,0.10)] font-display text-[14px] font-bold text-emerald-deep"
      >
        {initials(name)}
      </span>

      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-display text-[16px] font-semibold leading-tight text-ink">
            {name}
          </span>
          {isYou && (
            <span className="shrink-0 rounded-[var(--radius-pill)] bg-emerald px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-on-emerald">
              You
            </span>
          )}
        </span>
        <span className="mt-0.5 truncate text-[13px] text-ink-soft">
          {row.championName}
          {row.runnerUpName ? ` · ${row.runnerUpName}` : ""}
        </span>
      </span>

      <span className="ml-auto shrink-0 text-right">
        <span className="tnum block font-display text-[18px] font-bold leading-none text-ink">
          {row.bracketPoints.toLocaleString()}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          {row.status === "resolved" ? "graded" : "pts"}
        </span>
      </span>
    </motion.li>
  );
}

function BracketBoard({ id, myWallet }: { id: string; myWallet: string | undefined }) {
  const token = useSession((s) => s.token);
  const [rows, setRows] = useState<LeagueBracketRow[] | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    let active = true;
    getLeagueBracket(token, id).then((res) => {
      if (active) setRows(res?.board ?? []);
    });
    return () => {
      active = false;
    };
  }, [token, id]);

  if (rows === null) {
    return (
      <ul className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="solid h-[64px] animate-pulse bg-[rgba(255,255,255,0.05)]" />
        ))}
      </ul>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="solid px-6 py-10 text-center text-[15px] text-ink-soft">
        No champion picks in this league yet.{" "}
        <Link href="/bracket" className="font-semibold text-emerald-deep hover:underline">
          Make the call
        </Link>
        .
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => b.bracketPoints - a.bracketPoints);
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((row, i) => (
        <BracketRow key={row.wallet} row={row} index={i} isYou={Boolean(myWallet) && row.wallet === myWallet} />
      ))}
    </ul>
  );
}

export default function LeaguePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const token = useSession((s) => s.token);
  const hydrated = useSession((s) => s.hydrated);
  const myWallet = useSession((s) => s.profile?.wallet);

  const [data, setData] = useState<{ league: League; board: LeaderRowT[] } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState<LeaderRowT | null>(null);
  const [boardTab, setBoardTab] = useState<BoardTab>("standings");

  // auth gate
  useEffect(() => {
    if (hydrated && !token) router.replace("/connect");
  }, [hydrated, token, router]);

  useEffect(() => {
    if (!token || !id) return;
    let active = true;
    setLoading(true);
    getLeague(token, id).then((res) => {
      if (!active) return;
      if (!res) setNotFound(true);
      else setData(res);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [token, id]);

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <Link
          href="/leaderboard"
          className="mb-3 inline-flex min-h-[40px] items-center gap-1 font-display text-[15px] font-semibold text-ink-soft hover:text-ink"
        >
          ‹ Leaderboard
        </Link>

        {loading ? (
          <>
            <div className="solid h-28 animate-pulse" />
            <ul className="mt-4 flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <li
                  key={i}
                  className="solid h-[64px] animate-pulse bg-[rgba(255,255,255,0.05)]"
                />
              ))}
            </ul>
          </>
        ) : notFound || !data ? (
          <div className="solid px-6 py-12 text-center">
            <p className="font-display text-[18px] font-bold text-ink">
              League not found
            </p>
            <p className="mx-auto mt-1 max-w-xs text-[15px] text-ink-soft">
              This league may have been removed, or your invite has expired.
            </p>
            <Button
              onClick={() => router.push("/leaderboard")}
              className="mt-5"
              variant="ghost"
            >
              Back to leaderboard
            </Button>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, ease: [0.2, 0.7, 0.3, 1] }}
          >
            {/* header */}
            <header className="solid p-5">
              <div className="flex items-center gap-2">
                <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                  {data.league.isDemo ? "Sample league" : "Private league"}
                </p>
                {data.league.isDemo && (
                  <span className="rounded-[var(--radius-pill)] border border-[rgba(255,106,77,0.4)] bg-[rgba(255,106,77,0.12)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-coral">
                    Demo
                  </span>
                )}
              </div>
              <h1 className="mt-1 font-display text-[26px] font-bold leading-tight tracking-tight text-ink">
                {data.league.name}
              </h1>
              {data.league.isDemo ? (
                <p className="mt-2 text-[13.5px] leading-snug text-ink-soft">
                  A sample league of demo players, so you can see Touchline full of life before your mates pile in.
                </p>
              ) : (
                <div className="mt-4">
                  <p className="mb-1.5 text-[13px] font-medium text-ink-soft">
                    Invite code: share it to add players
                  </p>
                  <InviteShare leagueName={data.league.name} code={inviteCodeOf(data.league)} />
                </div>
              )}
            </header>

            {/* board */}
            <section className="mt-5">
              <BoardTabs tab={boardTab} onChange={setBoardTab} />

              {boardTab === "standings" ? (
                data.board.length === 0 ? (
                  <div className="solid px-6 py-10 text-center text-[15px] text-ink-soft">
                    No picks logged yet. First to lock a pick takes top spot.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {data.board.map((row, i) => (
                      <LeaderRow
                        key={row.wallet}
                        row={row}
                        index={i}
                        isYou={Boolean(myWallet) && row.wallet === myWallet}
                        onSelect={setSelected}
                      />
                    ))}
                  </ul>
                )
              ) : (
                <>
                  <p className="mb-3 flex items-center gap-1.5 px-1 text-[13px] text-ink-soft">
                    <IconTrophy className="h-3.5 w-3.5" color="var(--gold)" />
                    Season-long champion pick. Persists through the tournament.
                  </p>
                  <BracketBoard id={id} myWallet={myWallet} />
                </>
              )}
            </section>
          </motion.div>
        )}
      </div>
      <AnimatePresence>
        {selected ? (
          <PlayerPopover key={selected.wallet} row={selected} onClose={() => setSelected(null)} />
        ) : null}
      </AnimatePresence>
    </AppShell>
  );
}
