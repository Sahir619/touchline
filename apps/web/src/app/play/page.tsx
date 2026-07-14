"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { MatchCard, type MatchOutcome } from "@/components/ui/MatchCard";
import { StreakChip } from "@/components/ui/StreakChip";
import { MatchdayStatus } from "@/components/ui/MatchdayStatus";
import { DailyChallenges } from "@/components/ui/DailyChallenges";
import { AtRiskPrompt } from "@/components/ui/AtRiskPrompt";
import { ChampionPrompt } from "@/components/ui/ChampionPrompt";
import { RankNudge } from "@/components/ui/RankNudge";
import { RecapStrip } from "@/components/ui/RecapStrip";
import { WinReturnHero } from "@/components/ui/WinReturnHero";
import { ActivityFeed } from "@/components/ui/ActivityFeed";
import { CompetitionFilter } from "@/components/ui/CompetitionFilter";
import { Button } from "@/components/ui/Button";
import { nationByCode } from "@touchline/shared";
import { getSlate, toDisplayFixtures, type DisplayFixture } from "@/lib/api";
import { getLeaderboard, getMyPicks, getBracket, type LeaderRow, type Pick } from "@/lib/game";
import { useRankNudge } from "@/lib/rank";
import { useWinReturn } from "@/lib/winReturn";
import { referralCodeFor } from "@/lib/referral";
import {
  buildDailyChallenges,
  dayIndex,
  nationFixtureToday,
  type ChallengeContext,
} from "@/lib/challenges";
import { useSession } from "@/lib/session";

/* Fallback slate shown if the worker isn't reachable (e.g. static build / worker down). */
const FALLBACK: DisplayFixture[] = [
  { id: -1, home: "Brazil", away: "Serbia", kickoff: "14:00", group: "World Cup",
    outcomes: [{ label: "1", odds: 1.62, longShot: false }, { label: "X", odds: 3.8, longShot: false }, { label: "2", odds: 8.2, longShot: true }] },
  { id: -2, home: "France", away: "Tunisia", kickoff: "17:00", group: "World Cup",
    outcomes: [{ label: "1", odds: 1.45, longShot: false }, { label: "X", odds: 4.2, longShot: false }, { label: "2", odds: 9.5, longShot: true }] },
  { id: -3, home: "Japan", away: "Spain", kickoff: "20:00", group: "World Cup",
    outcomes: [{ label: "1", odds: 5.4, longShot: true }, { label: "X", odds: 3.6, longShot: false }, { label: "2", odds: 1.7, longShot: false }] },
];

function toMatchOutcomes(f: DisplayFixture): [MatchOutcome, MatchOutcome, MatchOutcome] {
  return f.outcomes.map((o) => ({
    label: o.label,
    odds: o.odds,
    variant: o.longShot ? ("long-shot" as const) : ("default" as const),
  })) as [MatchOutcome, MatchOutcome, MatchOutcome];
}

/** Friendly caption for a tapped outcome key. */
function pickCaption(f: DisplayFixture, label: string): string {
  if (label === "1") return f.home;
  if (label === "2") return f.away;
  return "the draw";
}

export default function Play() {
  const reduce = useReducedMotion();
  const router = useRouter();
  const profile = useSession((s) => s.profile);
  const token = useSession((s) => s.token);
  const [fixtures, setFixtures] = useState<DisplayFixture[]>(FALLBACK);
  const [live, setLive] = useState(false);
  const [streak, setStreak] = useState(0);
  const [board, setBoard] = useState<LeaderRow[] | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [atRiskDismissed, setAtRiskDismissed] = useState<number | null>(null);
  const [demoPick, setDemoPick] = useState<{ home: string; away: string; call: string } | null>(null);
  const [showChampionPrompt, setShowChampionPrompt] = useState(false);
  const [championDismissed, setChampionDismissed] = useState(false);
  const [competition, setCompetition] = useState<string | null>(null);

  // Live clock — powers the kickoff countdown + at-risk phrasing.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;
    getSlate()
      .then((slate) => {
        if (!active) return;
        const display = toDisplayFixtures(slate);
        if (display.length) {
          setFixtures(display);
          setLive(true);
        }
      })
      .catch(() => {/* keep fallback */});
    return () => {
      active = false;
    };
  }, []);

  // Real streak from the leaderboard row for this wallet — 0 for a fresh/guest account.
  useEffect(() => {
    let active = true;
    const wallet = profile?.wallet;
    if (!wallet) {
      setStreak(0);
      setBoard(null);
      return;
    }
    getLeaderboard()
      .then((rows) => {
        if (!active) return;
        setBoard(rows);
        setStreak(rows.find((r) => r.wallet === wallet)?.streak ?? 0);
      })
      .catch(() => {/* keep 0 */});
    return () => {
      active = false;
    };
  }, [profile?.wallet]);

  // The user's locked picks — powers call-count + challenge done-states.
  useEffect(() => {
    if (!token) {
      setPicks([]);
      return;
    }
    let active = true;
    getMyPicks(token)
      .then((p) => {
        if (active) setPicks(p);
      })
      .catch(() => {/* keep empty */});
    return () => {
      active = false;
    };
  }, [token]);

  // One-time season-long champion pick (SAH-60) — surface a nudge on /play until
  // the wallet has made a call or the pool locks at kickoff.
  useEffect(() => {
    if (!token) {
      setShowChampionPrompt(false);
      return;
    }
    let active = true;
    getBracket(token)
      .then((s) => {
        if (!active || !s) return;
        setShowChampionPrompt(!s.locked && !s.pick);
      })
      .catch(() => {/* keep hidden */});
    return () => {
      active = false;
    };
  }, [token]);

  // The daily-challenge hero is the first fixture carrying a long shot.
  const heroLongShotIndex = fixtures.findIndex((f) =>
    f.outcomes.some((o) => o.longShot),
  );

  // Loss-aversion return nudge (SAH-70): did this wallet's leaderboard rank slip
  // since last visit? Reuses the leaderboard fetch above — no extra request.
  const { drop: rankDrop, acknowledge: ackRankDrop } = useRankNudge(board, profile?.wallet);

  // Peak–End win-return payoff (SAH-69): the most significant call that landed since
  // the user's last visit — celebrated above the recap, then marked seen. Derives from
  // the picks already fetched above; renders nothing for guests / fresh / no-new-win.
  const { win: winReturn, dismiss: dismissWin } = useWinReturn(picks, profile?.wallet);
  // Reclaim CTA target — the daily-challenge hero long shot, else the first real
  // fixture on the slate. Null when only the offline fallback is loaded.
  const reclaimFixture = useMemo(() => {
    const hero = heroLongShotIndex >= 0 ? fixtures[heroLongShotIndex] : undefined;
    if (hero && hero.id > 0) return hero;
    return fixtures.find((f) => f.id > 0) ?? null;
  }, [fixtures, heroLongShotIndex]);

  // --- Matchday derived state -------------------------------------------------
  const preview = !live; // live slate hasn't loaded → offline/fallback
  const slateIds = useMemo(
    () => new Set(fixtures.filter((f) => f.id > 0).map((f) => f.id)),
    [fixtures],
  );
  const callsMade = useMemo(
    () => new Set(picks.filter((p) => slateIds.has(p.fixtureId)).map((p) => p.fixtureId)).size,
    [picks, slateIds],
  );
  // Next upcoming kickoff (min startTime still in the future).
  const nextKickoff = useMemo(() => {
    const upcoming = fixtures
      .map((f) => f.startTime)
      .filter((t): t is number => typeof t === "number" && t > now);
    return upcoming.length ? Math.min(...upcoming) : null;
  }, [fixtures, now]);

  const challengeCtx: ChallengeContext = useMemo(
    () => ({ slate: fixtures.filter((f) => f.id > 0), picks, nation: profile?.nation ?? null, preview }),
    [fixtures, picks, profile?.nation, preview],
  );
  // Rebuild only when the day rolls over (rotation) or the inputs change — not every tick.
  const today = dayIndex(now);
  const challenges = useMemo(
    () => buildDailyChallenges(challengeCtx, today * 86_400_000),
    [challengeCtx, today],
  );

  // At-risk return prompt: the user's nation is on today's slate and uncalled.
  const natFx = useMemo(() => nationFixtureToday(challengeCtx), [challengeCtx]);
  const nationName = nationByCode(profile?.nation)?.name ?? null;
  const nationCalled = natFx ? picks.some((p) => p.fixtureId === natFx.id) : false;
  const showAtRisk =
    !preview && natFx != null && nationName != null && !nationCalled && atRiskDismissed !== natFx.id;

  // Distinct competitions across the REAL slate (id > 0), first-seen order preserved.
  // The chip row only surfaces when 2+ are present, so a single-competition slate
  // (and the offline fallback) is byte-identical to today.
  const competitions = useMemo(() => {
    const seen: string[] = [];
    for (const f of fixtures) {
      if (f.id > 0 && f.group && !seen.includes(f.group)) seen.push(f.group);
    }
    return seen;
  }, [fixtures]);

  // Grid source: the full slate at default (All), else only fixtures in the picked
  // competition. Order is preserved from `fixtures`, so All === today's list/order.
  const shownFixtures = useMemo(
    () => (competition ? fixtures.filter((f) => f.group === competition) : fixtures),
    [fixtures, competition],
  );

  const item = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.36, ease: [0.2, 0.7, 0.3, 1] as const, delay: reduce ? 0 : i * 0.04 },
  });

  return (
    <AppShell>
      {/* Header row */}
      <motion.div {...item(0)} className="flex items-end justify-between gap-3 pt-1">
        <div>
          <h1 className="font-display text-[34px] font-bold leading-none tracking-tight text-ink">
            Today
          </h1>
          <p className="mt-1 text-[14px] font-medium text-ink-soft">
            Matchday&rsquo;s live. Here&rsquo;s who&rsquo;s calling what.
          </p>
          <p className="tnum mt-1.5 flex items-center gap-2 text-[13px] font-medium uppercase tracking-wide text-ink-soft">
            {fixtures.length} {fixtures.length === 1 ? "match" : "matches"}
            {live && (
              <span className="inline-flex items-center gap-1 text-emerald-deep">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald" /> live odds
              </span>
            )}
          </p>
        </div>
        <StreakChip count={streak} />
      </motion.div>

      {/* Win-Return payoff (SAH-69) — a celebratory hero when a call landed since the
          last visit. Sits ABOVE the recap and absorbs that win's quiet recap line;
          siblings roll into the recap below via `excludePickId`. */}
      <AnimatePresence>
        {winReturn && (
          <motion.div
            {...item(1)}
            className="mt-4"
            exit={reduce ? undefined : { opacity: 0, height: 0, marginTop: 0 }}
          >
            <WinReturnHero
              win={winReturn}
              nation={profile?.nation ?? null}
              referralCode={referralCodeFor(profile?.wallet)}
              onDismiss={dismissWin}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Yesterday's calls — lightweight post-resolution recap. Hidden entirely
          when there's nothing resolved from the previous day (guest, fresh
          account, or an off day). */}
      <motion.div {...item(1)} className="mt-4">
        <RecapStrip picks={picks} now={now} excludePickId={winReturn?.pick.id} />
      </motion.div>

      {/* Matchday status — streak + calls made + live kickoff countdown */}
      <motion.div {...item(2)} className="mt-5">
        <MatchdayStatus
          streak={streak}
          callsMade={callsMade}
          callsTotal={slateIds.size}
          nextKickoff={nextKickoff}
          preview={preview}
          now={now}
        />
      </motion.div>

      {/* Activity feed (SAH-74) — the "walking into a busy group chat" surface: mates'
          recent calls, streaks, live-room presence. Demo-badged. Also carries a proactive
          Demo-League rank nudge for signed-in users. Renders nothing until seeded. */}
      <motion.div {...item(2)} className="mt-4">
        <ActivityFeed token={token} wallet={profile?.wallet ?? null} />
      </motion.div>

      {/* Rank loss-aversion nudge — your leaderboard rank slipped since last visit.
          Loss-aversion only (no climb variant); CTA deep-links to today's marquee
          pick. Renders nothing for guests, first visits, climbs, or off-board. */}
      <AnimatePresence>
        {rankDrop && reclaimFixture && (
          <motion.div
            {...item(3)}
            className="mt-4"
            exit={reduce ? undefined : { opacity: 0, height: 0, marginTop: 0 }}
          >
            <RankNudge
              drop={rankDrop}
              onReclaim={() => {
                ackRankDrop();
                router.push(`/match/${reclaimFixture.id}`);
              }}
              onDismiss={ackRankDrop}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Season-long champion pick nudge — signed-in, unclaimed, pool still open. */}
      <AnimatePresence>
        {showChampionPrompt && !championDismissed && (
          <motion.div
            {...item(3)}
            className="mt-4"
            exit={reduce ? undefined : { opacity: 0, height: 0, marginTop: 0 }}
          >
            <ChampionPrompt
              onPick={() => router.push("/bracket")}
              onDismiss={() => setChampionDismissed(true)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* At-risk return prompt — your team plays today and you haven't called it yet.
          In-app only; browser/PWA push is deferred (W6 scope). */}
      <AnimatePresence>
        {showAtRisk && natFx && nationName && (
          <motion.div
            {...item(3)}
            className="mt-4"
            exit={reduce ? undefined : { opacity: 0, height: 0, marginTop: 0 }}
          >
            <AtRiskPrompt
              fixture={natFx}
              nationName={nationName}
              now={now}
              onCall={() => router.push(`/match/${natFx.id}`)}
              onDismiss={() => setAtRiskDismissed(natFx.id)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Daily challenges — rotating 2–3, each with a real done-state */}
      <motion.div {...item(4)} className="mt-5">
        <DailyChallenges challenges={challenges} />
      </motion.div>

      {/* Competition filter — additive; renders only when 2+ competitions are on the
          real slate. At default (All) the grid below is unchanged, so today's
          single-competition view is byte-identical. */}
      {competitions.length > 1 && (
        <motion.div {...item(4)} className="mt-5">
          <CompetitionFilter
            competitions={competitions}
            value={competition}
            onChange={setCompetition}
          />
        </motion.div>
      )}

      {/* Match cards — 1 col phone, 2–3 col desktop */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shownFixtures.map((f, i) => (
          <motion.div key={f.id} {...item(4 + i)}>
            <MatchCard
              home={f.home}
              away={f.away}
              kickoff={f.kickoff}
              group={f.group}
              outcomes={toMatchOutcomes(f)}
              // Only the first long-shot on the slate (the daily-challenge hero)
              // pulses — the rest stay static coral. Identity-based so the hero
              // stays correct when the grid is filtered.
              pulseLongShot={heroLongShotIndex >= 0 && f.id === fixtures[heroLongShotIndex].id}
              onPick={
                f.id > 0
                  ? () => router.push(`/match/${f.id}`)
                  : (label) =>
                      setDemoPick({ home: f.home, away: f.away, call: pickCaption(f, label) })
              }
            />
          </motion.div>
        ))}
      </div>

      {/* Demo-pick confirmation — shown for the offline fallback slate (id < 0) so a
          pick still responds and the flow proceeds instead of dead-ending. Clearly
          labelled as a preview; real picks + streak begin once the live slate loads. */}
      <AnimatePresence>
        {demoPick && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setDemoPick(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Demo pick"
          >
            <div className="absolute inset-0 bg-[rgba(0,0,0,0.55)] backdrop-blur-sm" />
            <motion.div
              className="relative w-full max-w-sm"
              initial={reduce ? false : { opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.28, ease: [0.2, 0.7, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <GlassCard className="p-6 text-center">
                <p className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-coral">
                  Preview slate
                </p>
                <p className="mt-2 font-display text-[20px] font-bold leading-tight tracking-tight text-ink">
                  You called {demoPick.call}
                </p>
                <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">
                  {demoPick.home} v {demoPick.away} is a sample match shown while live odds
                  load. Your real picks and streak begin the moment the slate is live.
                </p>
                <Button onClick={() => setDemoPick(null)} className="mt-5 w-full">
                  Got it
                </Button>
              </GlassCard>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
