"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { nationByCode } from "@touchline/shared";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { IconFlame, IconTrophy, IconStadium } from "@/components/icons";
import { useSession } from "@/lib/session";
import {
  getLeaderboard,
  getLeagues,
  createLeague,
  joinLeague,
  getUserStats,
  shareInvite,
  type LeaderRow as LeaderRowT,
  type League,
  type UserStats,
} from "@/lib/game";

/* ============================================================================
   Helpers
   ========================================================================== */
function shortWallet(w: string) {
  return w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "··";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

const rankAccent: Record<number, string> = {
  1: "text-gold",
  2: "text-silver",
  3: "text-bronze",
};

/* ============================================================================
   LeaderRow — the one consistent ranked-row visual. Reused by the Global tab
   and by every league board. Solid white reading surface.
   ========================================================================== */
export function LeaderRow({
  row,
  isYou,
  index,
  onSelect,
}: {
  row: LeaderRowT;
  isYou: boolean;
  index: number;
  onSelect?: (row: LeaderRowT) => void;
}) {
  const nation = nationByCode(row.nation);
  const name = row.displayName || shortWallet(row.wallet);

  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.32,
        delay: Math.min(index * 0.035, 0.5),
        ease: [0.2, 0.7, 0.3, 1],
      }}
    >
      <button
        type="button"
        onClick={onSelect ? () => onSelect(row) : undefined}
        disabled={!onSelect}
        aria-haspopup={onSelect ? "dialog" : undefined}
        className={cn(
          "solid flex w-full items-center gap-3 px-3 py-3 text-left sm:gap-4 sm:px-4",
          "disabled:cursor-default",
          onSelect &&
            "cursor-pointer transition-colors hover:border-emerald/40 hover:bg-[rgba(0,217,130,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
          isYou && "ring-2 ring-emerald ring-offset-2 ring-offset-canvas",
        )}
      >
      {/* rank */}
      <span
        className={cn(
          "tnum w-7 shrink-0 text-center font-display text-[18px] font-bold leading-none sm:w-8",
          rankAccent[row.rank] ?? "text-ink-soft",
        )}
      >
        {row.rank}
      </span>

      {/* avatar — nation flag if set, else initials */}
      <span
        aria-hidden
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full text-[20px]",
          "bg-[rgba(0,217,130,0.10)] font-display text-[14px] font-bold text-emerald-deep",
        )}
      >
        {nation ? nation.flag : initials(name)}
      </span>

      {/* name + meta */}
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
          {row.demo && !isYou && (
            <span className="shrink-0 rounded-[var(--radius-pill)] border border-[rgba(255,106,77,0.4)] bg-[rgba(255,106,77,0.12)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-coral">
              Demo
            </span>
          )}
        </span>
        <span className="tnum mt-0.5 flex items-center gap-2.5 text-[13px] text-ink-soft">
          {row.streak > 0 && (
            <span className="inline-flex items-center gap-1">
              <IconFlame className="h-3.5 w-3.5" color="var(--coral)" />
              {row.streak}
            </span>
          )}
          {row.trophies > 0 && (
            <span className="inline-flex items-center gap-1">
              <IconTrophy className="h-3.5 w-3.5" color="var(--gold)" />
              {row.trophies}
            </span>
          )}
          {(row.linesBeaten ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-1 text-emerald-deep"
              title="Lines beaten: calls the market moved toward before kickoff"
            >
              <span aria-hidden>⚡</span>
              {row.linesBeaten}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            Lv{row.level}
          </span>
        </span>
        {row.demo && row.recentCall && (
          <span className="mt-0.5 truncate text-[12px] text-ink-soft/80">{row.recentCall}</span>
        )}
      </span>

      {/* points */}
      <span className="ml-auto shrink-0 text-right">
        <span className="tnum block font-display text-[18px] font-bold leading-none text-ink">
          {row.xp.toLocaleString()}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          pts
        </span>
      </span>
      </button>
    </motion.li>
  );
}

/* ============================================================================
   PlayerPopover — a minimal profile card opened by tapping a leaderboard row.
   Shows the row's already-known headline stats plus an accuracy figure fetched
   from the wallet's public pick record.
   ========================================================================== */
export function PlayerPopover({
  row,
  onClose,
}: {
  row: LeaderRowT;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const [stats, setStats] = useState<UserStats | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    getUserStats(row.wallet).then((s) => active && setStats(s));
    return () => {
      active = false;
    };
  }, [row.wallet]);

  const nation = nationByCode(row.nation);
  const name = row.displayName || shortWallet(row.wallet);
  const hitRatePct = stats?.hitRate != null ? Math.round(stats.hitRate * 100) : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${name}'s profile`}
    >
      {/* backdrop */}
      <motion.button
        type="button"
        aria-label="Close"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 cursor-default bg-[rgba(4,7,12,0.6)] backdrop-blur-[2px]"
      />

      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="glass relative z-10 w-full max-w-xs overflow-hidden p-5"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close profile"
          className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-[rgba(0,0,0,0.28)] text-ink/80 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[rgba(0,217,130,0.10)] text-[26px] font-display font-bold text-emerald-deep"
          >
            {nation ? nation.flag : initials(name)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-[18px] font-bold text-ink">{name}</p>
            <p className="tnum text-[13px] text-ink-soft">
              Rank #{row.rank} · Lv{row.level}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="tnum font-display text-[20px] font-bold leading-none text-ink">
              {row.xp.toLocaleString()}
            </p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-ink-soft">Points</p>
          </div>
          <div>
            <p className="tnum font-display text-[20px] font-bold leading-none text-ink">{row.streak}</p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-ink-soft">Streak</p>
          </div>
          <div>
            <p className="tnum font-display text-[20px] font-bold leading-none text-ink">{row.trophies}</p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-ink-soft">Trophies</p>
          </div>
        </div>

        <div className="solid mt-5 p-4 text-center">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Accuracy</p>
          {stats === undefined ? (
            <div className="mx-auto mt-3 h-8 w-16 animate-pulse rounded bg-[rgba(255,255,255,0.08)]" />
          ) : stats && hitRatePct != null ? (
            <>
              <p className="tnum mt-1 font-display text-[32px] font-bold text-emerald-deep">
                {hitRatePct}%
              </p>
              <p className="mt-1 text-[13px] text-ink-soft">
                {stats.won}W · {stats.lost}L
                {stats.open > 0 ? ` · ${stats.open} pending` : ""}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[14px] text-ink-soft">No settled picks yet</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ============================================================================
   Skeleton + empty state
   ========================================================================== */
function RowSkeleton() {
  return (
    <li className="solid flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
      <span className="h-5 w-6 animate-pulse rounded bg-[rgba(255,255,255,0.08)]" />
      <span className="h-10 w-10 animate-pulse rounded-full bg-[rgba(255,255,255,0.08)]" />
      <span className="flex flex-1 flex-col gap-2">
        <span className="h-4 w-1/3 animate-pulse rounded bg-[rgba(255,255,255,0.08)]" />
        <span className="h-3 w-1/4 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
      </span>
      <span className="h-6 w-12 animate-pulse rounded bg-[rgba(255,255,255,0.08)]" />
    </li>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="solid mt-2 px-6 py-12 text-center">
      <p className="font-display text-[18px] font-bold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-[15px] text-ink-soft">{body}</p>
    </div>
  );
}

/* ============================================================================
   YourRankCard — desktop side panel. Surfaces the signed-in player's own
   position next to the board instead of leaving the wide lg+ column empty.
   ========================================================================== */
function YourRankCard() {
  const token = useSession((s) => s.token);
  const wallet = useSession((s) => s.profile?.wallet);
  const router = useRouter();
  const [row, setRow] = useState<LeaderRowT | null | undefined>(undefined);

  useEffect(() => {
    if (!wallet) {
      setRow(null);
      return;
    }
    let active = true;
    getLeaderboard().then((rows) => {
      if (active) setRow(rows.find((r) => r.wallet === wallet) ?? null);
    });
    return () => {
      active = false;
    };
  }, [wallet]);

  if (!token) {
    return (
      <div className="solid p-5 text-center">
        <p className="font-display text-[16px] font-bold text-ink">Where do you rank?</p>
        <p className="mt-1 text-[14px] text-ink-soft">
          Connect your wallet to see your position on the board.
        </p>
        <Button onClick={() => router.push("/connect")} className="mt-4 w-full">
          Connect wallet
        </Button>
      </div>
    );
  }

  if (row === undefined) {
    return <div className="solid h-[184px] animate-pulse" />;
  }

  if (row === null) {
    return (
      <div className="solid p-5 text-center">
        <p className="font-display text-[16px] font-bold text-ink">Not ranked yet</p>
        <p className="mt-1 text-[14px] text-ink-soft">
          Lock a pick today to join the board.
        </p>
        <Button onClick={() => router.push("/play")} className="mt-4 w-full">
          Make a call
        </Button>
      </div>
    );
  }

  return (
    <div className="solid p-5">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
        Your position
      </p>
      <p className="tnum mt-1 font-display text-[36px] font-bold leading-none text-emerald-deep">
        #{row.rank}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-center">
        <div className="rounded-[var(--radius-sm)] bg-[rgba(255,255,255,0.04)] py-3">
          <p className="tnum font-display text-[20px] font-bold leading-none text-ink">
            {row.xp.toLocaleString()}
          </p>
          <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-ink-soft">
            Points
          </p>
        </div>
        <div className="rounded-[var(--radius-sm)] bg-[rgba(255,255,255,0.04)] py-3">
          <p className="tnum font-display text-[20px] font-bold leading-none text-ink">
            {row.streak}
          </p>
          <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-ink-soft">
            Streak
          </p>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   Segmented control
   ========================================================================== */
type Tab = "global" | "friends";

function Segmented({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "global", label: "Global" },
    { id: "friends", label: "Friends" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Leaderboard scope"
      className="glass mb-5 flex gap-1 p-1"
    >
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
                layoutId="lb-seg"
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
   Global tab
   ========================================================================== */
function GlobalBoard() {
  const myWallet = useSession((s) => s.profile?.wallet);
  const [rows, setRows] = useState<LeaderRowT[] | null>(null);
  const [selected, setSelected] = useState<LeaderRowT | null>(null);

  useEffect(() => {
    let active = true;
    getLeaderboard().then((r) => active && setRows(r));
    return () => {
      active = false;
    };
  }, []);

  if (rows === null) {
    return (
      <ul className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </ul>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No table yet"
        body="Be the first to lock a pick and climb the global board."
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <LeaderRow
            key={row.wallet}
            row={row}
            index={i}
            isYou={Boolean(myWallet) && row.wallet === myWallet}
            onSelect={setSelected}
          />
        ))}
      </ul>
      <AnimatePresence>
        {selected ? (
          <PlayerPopover key={selected.wallet} row={selected} onClose={() => setSelected(null)} />
        ) : null}
      </AnimatePresence>
    </>
  );
}

/* ============================================================================
   Friends tab — leagues + create + join-by-code
   ========================================================================== */
function FriendsBoard() {
  const router = useRouter();
  const token = useSession((s) => s.token);

  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareBanner, setShareBanner] = useState<{ name: string } | null>(null);

  const refresh = useMemo(
    () => async () => {
      if (!token) return;
      const ls = await getLeagues(token);
      setLeagues(ls);
    },
    [token],
  );

  useEffect(() => {
    if (!token) {
      setLeagues(null);
      return;
    }
    let active = true;
    getLeagues(token).then((ls) => active && setLeagues(ls));
    return () => {
      active = false;
    };
  }, [token]);

  if (!token) {
    return (
      <div className="solid px-6 py-12 text-center">
        <p className="font-display text-[18px] font-bold text-ink">
          Play with your friends
        </p>
        <p className="mx-auto mt-1 max-w-xs text-[15px] text-ink-soft">
          Connect your wallet to create private leagues and compare picks.
        </p>
        <Button onClick={() => router.push("/connect")} className="mt-5" size="lg">
          Connect wallet
        </Button>
      </div>
    );
  }

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || busy) return;
    setBusy("create");
    setError(null);
    setShareBanner(null);
    try {
      const league = await createLeague(token, newName.trim());
      setNewName("");
      await refresh();
      // Real share moment instead of a silent refresh: native share sheet
      // where available, else a copy-link with a visible confirmation.
      const result = await shareInvite(league.name, league.inviteCode);
      if (result === "copied") {
        setShareBanner({ name: league.name });
        setTimeout(() => setShareBanner(null), 3200);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim() || busy) return;
    setBusy("join");
    setError(null);
    try {
      const res = await joinLeague(token, joinCode.trim().toUpperCase());
      setJoinCode("");
      await refresh();
      if (res?.id) router.push(`/leagues/${res.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const inputCls =
    "min-h-[44px] w-full rounded-[var(--radius-sm)] border border-[rgba(255,255,255,0.12)] " +
    "bg-[rgba(255,255,255,0.04)] px-3.5 text-[16px] text-ink placeholder:text-ink-soft/70 " +
    "focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/30";

  return (
    <div className="flex flex-col gap-5">
      {/* your leagues */}
      <section>
        <h2 className="mb-2 px-1 font-display text-[13px] font-semibold uppercase tracking-wide text-ink-soft">
          Your leagues
        </h2>
        {leagues === null ? (
          <ul className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="solid h-[64px] animate-pulse bg-[rgba(255,255,255,0.05)]"
              />
            ))}
          </ul>
        ) : leagues.length === 0 ? (
          <div className="solid px-5 py-8 text-center text-[15px] text-ink-soft">
            You haven&apos;t joined a league yet. Create one below or join with a
            code.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {leagues.map((lg, i) => (
              <motion.li
                key={lg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(i * 0.04, 0.3) }}
              >
                <Link
                  href={`/leagues/${lg.id}`}
                  className={cn(
                    "solid flex items-center gap-3 px-4 py-4",
                    "transition-colors hover:border-emerald/40 hover:bg-[rgba(0,217,130,0.04)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
                  )}
                >
                  <span
                    aria-hidden
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[rgba(0,217,130,0.10)]"
                  >
                    <IconStadium className="h-5 w-5" color="var(--emerald-deep)" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-display text-[16px] font-semibold text-ink">
                        {lg.name}
                      </span>
                      {lg.isDemo && (
                        <span className="shrink-0 rounded-[var(--radius-pill)] border border-[rgba(255,106,77,0.4)] bg-[rgba(255,106,77,0.12)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-coral">
                          Demo
                        </span>
                      )}
                    </span>
                    <span className="text-[13px] text-ink-soft">
                      {lg.isDemo ? "Sample players, see it full of life" : "View standings"}
                    </span>
                  </span>
                  <span aria-hidden className="text-ink-soft">
                    ›
                  </span>
                </Link>
              </motion.li>
            ))}
          </ul>
        )}
      </section>

      {/* create */}
      <form onSubmit={onCreate} className="solid flex flex-col gap-3 p-4">
        <label
          htmlFor="lg-create"
          className="font-display text-[16px] font-semibold text-ink"
        >
          Create a league
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="lg-create"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="League name"
            maxLength={40}
            className={inputCls}
          />
          <Button
            type="submit"
            disabled={!newName.trim() || busy === "create"}
            className="shrink-0 sm:w-auto"
          >
            {busy === "create" ? "Creating…" : "Create"}
          </Button>
        </div>
        {shareBanner && (
          <p className="text-[13px] font-medium text-emerald-deep">
            Invite link copied. Share it to add players to {shareBanner.name}.
          </p>
        )}
      </form>

      {/* join */}
      <form onSubmit={onJoin} className="solid flex flex-col gap-3 p-4">
        <label
          htmlFor="lg-join"
          className="font-display text-[16px] font-semibold text-ink"
        >
          Join by code
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="lg-join"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="INVITE CODE"
            maxLength={12}
            className={cn(inputCls, "tnum uppercase tracking-[0.15em]")}
          />
          <Button
            type="submit"
            variant="ghost"
            disabled={!joinCode.trim() || busy === "join"}
            className="shrink-0 sm:w-auto"
          >
            {busy === "join" ? "Joining…" : "Join"}
          </Button>
        </div>
      </form>

      {error && (
        <p className="px-1 text-[14px] font-medium text-coral">{error}</p>
      )}
    </div>
  );
}

/* ============================================================================
   Page
   ========================================================================== */
export default function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>("global");

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl lg:max-w-none lg:grid lg:grid-cols-[1fr_300px] lg:items-start lg:gap-6">
        <div className="min-w-0">
          <h1 className="mb-4 font-display text-[28px] font-bold tracking-tight text-ink">
            Leaderboard
          </h1>

          <Segmented tab={tab} onChange={setTab} />

          {tab === "global" ? <GlobalBoard /> : <FriendsBoard />}
        </div>

        <aside className="mt-6 lg:mt-[52px] lg:sticky lg:top-[92px]">
          <YourRankCard />
        </aside>
      </div>
    </AppShell>
  );
}
