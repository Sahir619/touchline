"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  NATIONS,
  PERSONAS,
  nationByCode,
  personaById,
  impliedProbabilityPhrase,
  probabilityArticle,
  isAgainstMarket,
} from "@touchline/shared";
import { AppShell } from "@/components/AppShell";
import { StreakChip } from "@/components/ui/StreakChip";
import { BeatLineChip } from "@/components/ui/BeatLineChip";
import { TrophyCabinet } from "@/components/TrophyCabinet";
import { RankNudge } from "@/components/ui/RankNudge";
import { Button } from "@/components/ui/Button";
import {
  getLeaderboard,
  getMyPicks,
  getSharpStats,
  type LeaderRow,
  type Pick,
  type SharpStats,
} from "@/lib/game";
import { useRankNudge } from "@/lib/rank";
import { patchMe } from "@/lib/account";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/cn";

const pickDateFmt = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });

const PICK_STATUS: Record<Pick["status"], { label: string; cls: string }> = {
  won: { label: "Won", cls: "border-emerald/35 bg-[rgba(0,217,130,0.10)] text-emerald-deep" },
  lost: { label: "Lost", cls: "border-coral/35 bg-[rgba(255,106,77,0.08)] text-coral" },
  open: { label: "Pending", cls: "border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.05)] text-ink-soft" },
  void: { label: "Void", cls: "border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.05)] text-ink-soft" },
};

function PickHistoryRow({ pick, index }: { pick: Pick; index: number }) {
  const fx = pick.fixture;
  const matchup = fx ? `${fx.participant1} vs ${fx.participant2}` : `Fixture #${pick.fixtureId}`;
  const status = PICK_STATUS[pick.status];
  const decided = pick.status === "won" || pick.status === "lost";
  const phrase = impliedProbabilityPhrase(pick.oddsAtLock);
  const article = probabilityArticle(phrase);
  const against = pick.status === "won" && isAgainstMarket(pick.oddsAtLock);
  // Beat the Line (SAH): the row carries pctAtClose (a [0,1] fraction) + clv (percentage
  // points). Convert the fraction to percent BEFORE subtracting clv, so pctAtLock = pctAtClose%
  // − clv. Both values are passed to BeatLineChip already in percent (0–100) for display.
  const beatLine =
    pick.beatLine === true && pick.pctAtClose != null && pick.clv != null;
  const pctAtClose = (pick.pctAtClose ?? 0) * 100;
  const pctAtLock = pctAtClose - (pick.clv ?? 0);

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.035, 0.4) }}
      className="flex items-center justify-between gap-3 py-3"
    >
      <div className="min-w-0">
        <p className="truncate font-display text-[15px] font-semibold text-ink">{matchup}</p>
        <p className="tnum mt-0.5 text-[13px] text-ink-soft">
          Pick {pick.selectionLabel}
          {decided ? (
            <>
              {" "}
              · about {article} {phrase} shot{" "}
              <span className="text-ink-soft/70">({pick.oddsAtLock.toFixed(2)}×)</span>
            </>
          ) : (
            <> · {pick.oddsAtLock.toFixed(2)}×</>
          )}{" "}
          · {pickDateFmt.format(pick.lockedAt)}
        </p>
        {beatLine && (
          <div className="mt-1.5">
            <BeatLineChip pctAtLock={pctAtLock} pctAtClose={pctAtClose} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {against && (
          <span className="rounded-[var(--radius-pill)] border border-coral/35 bg-[rgba(255,106,77,0.08)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-coral">
            Against the market
          </span>
        )}
        {pick.status === "won" && pick.points > 0 && (
          <span className="tnum text-[13px] font-semibold text-emerald-deep">+{pick.points}</span>
        )}
        <span
          className={cn(
            "rounded-[var(--radius-pill)] border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
            status.cls,
          )}
        >
          {status.label}
        </span>
      </div>
    </motion.li>
  );
}

function shortWallet(addr: string | null | undefined) {
  if (!addr) return "";
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function YouPage() {
  const router = useRouter();
  const { disconnect } = useWallet();
  const token = useSession((s) => s.token);
  const profile = useSession((s) => s.profile);
  const hydrated = useSession((s) => s.hydrated);
  const setProfile = useSession((s) => s.setProfile);
  const clear = useSession((s) => s.clear);

  const [board, setBoard] = useState<LeaderRow[] | null>(null);
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [sharp, setSharp] = useState<SharpStats | null>(null);

  // settings draft
  const [editing, setEditing] = useState(false);
  const [draftNation, setDraftNation] = useState<string | null>(null);
  const [draftPersona, setDraftPersona] = useState<string>("hype");
  const [saving, setSaving] = useState(false);

  /* ---- auth gate ---- */
  useEffect(() => {
    if (hydrated && !token) router.replace("/connect");
  }, [hydrated, token, router]);

  /* ---- leaderboard → rank + streak ---- */
  useEffect(() => {
    getLeaderboard().then(setBoard);
  }, []);

  /* ---- pick history → hit-rate ---- */
  useEffect(() => {
    if (!token) return;
    let active = true;
    getMyPicks(token).then((p) => active && setPicks(p));
    getSharpStats(token).then((s) => active && setSharp(s));
    return () => {
      active = false;
    };
  }, [token]);

  const pickStats = useMemo(() => {
    if (!picks) return null;
    const won = picks.filter((p) => p.status === "won").length;
    const lost = picks.filter((p) => p.status === "lost").length;
    const open = picks.filter((p) => p.status === "open").length;
    const decided = won + lost;
    const hitRate = decided > 0 ? Math.round((won / decided) * 100) : null;
    return { won, lost, open, hitRate };
  }, [picks]);

  /* ---- seed draft from profile ---- */
  useEffect(() => {
    if (profile) {
      setDraftNation(profile.nation);
      setDraftPersona(profile.persona);
    }
  }, [profile]);

  const myRow = useMemo(
    () => board?.find((r) => r.wallet === profile?.wallet) ?? null,
    [board, profile?.wallet],
  );

  // Loss-aversion "defend your rank" line (SAH-70) — same signal as /play, compact
  // form. Reuses the leaderboard fetch above; reclaim routes back to today's slate.
  const { drop: rankDrop, acknowledge: ackRankDrop } = useRankNudge(board, profile?.wallet);

  if (!hydrated || !token || !profile) {
    return (
      <AppShell>
        <div className="mx-auto mt-16 h-8 w-8 rounded-full border-2 border-[rgba(255,255,255,0.12)] border-t-emerald motion-safe:animate-[tl-spin_0.8s_linear_infinite]" />
      </AppShell>
    );
  }

  const nation = nationByCode(profile.nation);
  const persona = personaById(profile.persona);
  const xp = profile.xp;
  const level = profile.level;
  const progress = ((xp % 100) + 100) % 100; // 0..99
  const streak = myRow?.streak ?? 0;
  const rank = myRow?.rank ?? null;
  const dirty = draftNation !== profile.nation || draftPersona !== profile.persona;

  async function save() {
    if (!token || !dirty) return;
    setSaving(true);
    try {
      const next = await patchMe(token, {
        nation: draftNation ?? undefined,
        persona: draftPersona,
      });
      setProfile(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function disconnectWallet() {
    try {
      await disconnect();
    } catch {
      /* wallet may already be detached */
    }
    clear();
    router.push("/connect");
  }

  const section = (i: number) => ({
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.4, ease: [0.2, 0.7, 0.3, 1] as const, delay: i * 0.06 },
  });

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl space-y-5">
        {/* ---- Identity ---- */}
        <motion.section {...section(0)} className="solid p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div
              className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[rgba(0,217,130,0.10)] text-[34px] leading-none"
              aria-hidden
            >
              {nation ? nation.flag : "🌍"}
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[24px] font-bold tracking-tight text-ink">
                {profile.displayName || shortWallet(profile.wallet)}
              </h1>
              <p className="mt-0.5 text-[15px] text-ink-soft">
                {nation ? nation.name : "No nation yet"}
                {persona ? <span className="text-ink-soft/70"> · {persona.name}</span> : null}
              </p>
              <p className="tnum mt-1 inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[rgba(255,255,255,0.05)] px-2.5 py-1 text-[12px] font-medium text-ink-soft">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald" />
                {shortWallet(profile.wallet)}
              </p>
            </div>
          </div>
        </motion.section>

        {/* ---- Headline stats ---- */}
        <motion.section {...section(1)} className="solid p-5 sm:p-6">
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            <div>
              <p className="tnum font-display text-[30px] font-bold leading-none text-ink">
                {xp.toLocaleString()}
              </p>
              <p className="mt-1 text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                Points
              </p>
            </div>
            <div className="flex flex-col items-center justify-start">
              <StreakChip count={streak} />
              <p className="mt-1 text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                Streak
              </p>
            </div>
            <div>
              <p className="tnum font-display text-[30px] font-bold leading-none text-ink">
                {rank != null ? `#${rank}` : "-"}
              </p>
              <p className="mt-1 text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                Rank
              </p>
            </div>
            {/* Beat the Line (SAH) — the sharp rating sits alongside its siblings: the
                running skill number, with lines-beaten as its caption. Emerald signals
                the app's signature "right before the market" skill. */}
            <div>
              <p className="tnum font-display text-[30px] font-bold leading-none text-emerald-deep">
                {sharp ? sharp.sharpScore.toFixed(1) : "-"}
              </p>
              <p className="mt-1 text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                {sharp && sharp.linesBeaten > 0 ? `Sharp · ${sharp.linesBeaten} beaten` : "Sharp"}
              </p>
            </div>
          </div>

          {/* level + XP progress */}
          <div className="mt-5">
            <div className="flex items-baseline justify-between">
              <p className="font-display text-[15px] font-semibold text-ink">
                Level <span className="tnum text-emerald-deep">{level}</span>
              </p>
              <p className="tnum text-[13px] font-medium text-ink-soft">
                {progress}/100 XP
              </p>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
              <motion.div
                className="h-full rounded-full bg-emerald glow-emerald"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.7, ease: [0.2, 0.7, 0.3, 1] }}
              />
            </div>
          </div>
        </motion.section>

        {/* ---- Defend-your-rank line (SAH-70) — only when the rank slipped ---- */}
        {rankDrop && (
          <motion.div {...section(2)}>
            <RankNudge
              drop={rankDrop}
              variant="compact"
              onReclaim={() => {
                ackRankDrop();
                router.push("/play");
              }}
              onDismiss={ackRankDrop}
            />
          </motion.div>
        )}

        {/* ---- Pick record: hit-rate + history ---- */}
        <motion.section {...section(2)} className="solid p-5 sm:p-6">
          <h2 className="mb-4 font-display text-[18px] font-bold tracking-tight text-ink">
            Pick record
          </h2>

          {pickStats === null ? (
            <div className="h-16 animate-pulse rounded-[var(--radius-sm)] bg-[rgba(255,255,255,0.06)]" />
          ) : (
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="tnum font-display text-[26px] font-bold leading-none text-emerald-deep">
                  {pickStats.hitRate != null ? `${pickStats.hitRate}%` : "-"}
                </p>
                <p className="mt-1 text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                  Hit rate
                </p>
              </div>
              <div>
                <p className="tnum font-display text-[26px] font-bold leading-none text-ink">
                  {pickStats.won}-{pickStats.lost}
                </p>
                <p className="mt-1 text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                  Won / Lost
                </p>
              </div>
              <div>
                <p className="tnum font-display text-[26px] font-bold leading-none text-ink">
                  {pickStats.open}
                </p>
                <p className="mt-1 text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                  Pending
                </p>
              </div>
            </div>
          )}

          <div className="mt-5 border-t border-[rgba(255,255,255,0.08)]">
            {picks === null ? (
              <div className="divide-y divide-[rgba(255,255,255,0.08)]">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-[52px] animate-pulse py-3">
                    <div className="h-full w-full rounded bg-[rgba(255,255,255,0.06)]" />
                  </div>
                ))}
              </div>
            ) : picks.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-ink-soft">
                No picks yet. Lock one on today&apos;s matches.
              </p>
            ) : (
              <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
                {picks.map((p, i) => (
                  <PickHistoryRow key={p.id} pick={p} index={i} />
                ))}
              </ul>
            )}
          </div>
        </motion.section>

        {/* ---- Trophy cabinet ---- */}
        <motion.section {...section(3)}>
          <h2 className="mb-3 px-1 font-display text-[18px] font-bold tracking-tight text-ink">
            Trophy cabinet
          </h2>
          <TrophyCabinet token={token} />
        </motion.section>

        {/* ---- Settings ---- */}
        <motion.section {...section(4)} className="solid p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[18px] font-bold tracking-tight text-ink">
              Settings
            </h2>
            <button
              type="button"
              onClick={() => {
                setDraftNation(profile.nation);
                setDraftPersona(profile.persona);
                setEditing((e) => !e);
              }}
              className="text-[14px] font-semibold text-emerald-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline"
            >
              {editing ? "Cancel" : "Edit"}
            </button>
          </div>

          {editing ? (
            <div className="mt-4 space-y-5">
              {/* nation */}
              <div>
                <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-soft">
                  Allegiance
                </p>
                <div className="grid max-h-[40vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                  {NATIONS.map((n) => {
                    const selected = draftNation === n.code;
                    return (
                      <button
                        key={n.code}
                        type="button"
                        onClick={() => setDraftNation(n.code)}
                        className={cn(
                          "flex min-h-[48px] items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors",
                          selected
                            ? "border-emerald bg-[rgba(0,217,130,0.12)]"
                            : "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.24)]",
                        )}
                      >
                        <span className="text-[20px] leading-none" aria-hidden>{n.flag}</span>
                        <span className="min-w-0 truncate font-display text-[14px] font-semibold text-ink">
                          {n.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* persona */}
              <div>
                <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-soft">
                  Your pundit
                </p>
                <div className="grid gap-2">
                  {PERSONAS.map((p) => {
                    const selected = draftPersona === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setDraftPersona(p.id)}
                        className={cn(
                          "rounded-[var(--radius-sm)] border px-4 py-3 text-left transition-colors",
                          selected
                            ? "border-emerald bg-[rgba(0,217,130,0.10)]"
                            : "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.24)]",
                        )}
                      >
                        <p className="font-display text-[15px] font-semibold text-ink">{p.name}</p>
                        <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">{p.blurb}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button onClick={save} disabled={!dirty || saving} className="w-full">
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          ) : (
            <dl className="mt-4 divide-y divide-[rgba(255,255,255,0.08)]">
              <div className="flex items-center justify-between py-3">
                <dt className="text-[15px] text-ink-soft">Nation</dt>
                <dd className="inline-flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
                  {nation ? (
                    <>
                      <span className="text-[18px] leading-none" aria-hidden>{nation.flag}</span>
                      {nation.name}
                    </>
                  ) : (
                    "Not set"
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="text-[15px] text-ink-soft">Pundit</dt>
                <dd className="font-display text-[15px] font-semibold text-ink">
                  {persona ? persona.name : "Not set"}
                </dd>
              </div>
            </dl>
          )}

          {/* disconnect */}
          <div className="mt-5 border-t border-[rgba(255,255,255,0.08)] pt-4">
            <Button variant="ghost" onClick={disconnectWallet} className="w-full">
              Disconnect wallet
            </Button>
          </div>
        </motion.section>
      </div>
    </AppShell>
  );
}
