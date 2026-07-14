"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  decimalOdds,
  impliedProbabilityPhrase,
  probabilityArticle,
  parseOverUnderLine,
  isPartialPeriod,
  OVERUNDER_TARGET_LINE,
  CORRECT_SCORE_MARKET,
  CORRECT_SCORE_OPTIONS,
  CORRECT_SCORE_POINTS,
} from "@touchline/shared";
import { AppShell } from "@/components/AppShell";
import { OddsPill, type OddsVariant } from "@/components/ui/OddsPill";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";
import { TriviaCard } from "@/components/ui/TriviaCard";
import { StarManSection } from "@/components/ui/StarManSection";
import { IconPundit, IconFlame } from "@/components/icons";
import { useSession } from "@/lib/session";
import { firstPickLine } from "@/lib/pundit";
import { shareSnippet } from "@/lib/share";
import { blinkUrl } from "@/lib/blink";
import { cn } from "@/lib/cn";
import {
  consumeResumedFlag,
  getFixture,
  getFixtureOdds,
  getMyPicks,
  getMyPicksAllMarkets,
  postPick,
  stashPendingPick,
  type Selection,
  type MarketOdds,
  type FixtureRow,
} from "@/lib/game";

const SEL_INDEX: Record<Selection, number> = { part1: 0, draw: 1, part2: 2 };
const SEL_LABEL: Record<Selection, "1" | "X" | "2"> = { part1: "1", draw: "X", part2: "2" };
const timeFmt = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });

/* ============================================================================
   PickRow — the call is the hero here too: outcome name + odds-weighted points,
   decimal odds demoted to quiet tabular fine print. Mirrors MatchCard's
   OutcomeRow hierarchy so the pick screen doesn't read as a bookmaker's 1X2
   coupon (P0-3 / SAH-36). No pulse — this page never shows more than one
   match, so there's nothing to cap.
   ========================================================================== */
function PickRow({
  label,
  odds,
  points,
  variant,
  onPick,
}: {
  label: string;
  odds: number;
  points: number;
  variant: OddsVariant;
  onPick: () => void;
}) {
  const longShot = variant === "long-shot";
  const selected = variant === "selected";
  const locked = variant === "locked";

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={locked}
      className={cn(
        "flex min-h-[44px] w-full items-center justify-between gap-3",
        "rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        locked
          ? "cursor-default border-dashed border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.03)] text-ink-soft"
          : selected
            ? "border-emerald bg-emerald text-on-emerald glow-emerald"
            : longShot
              ? "border-coral/60 bg-[rgba(255,106,77,0.05)] hover:bg-[rgba(255,106,77,0.09)]"
              : "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] hover:border-emerald/60 hover:bg-[rgba(255,255,255,0.06)]",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-display text-[15px] font-semibold tracking-tight",
          selected ? "text-on-emerald" : locked ? "text-ink-soft" : "text-ink",
        )}
      >
        {label}
        {longShot && !selected ? <IconFlame className="h-3.5 w-3.5" color="var(--coral)" /> : null}
      </span>

      <span className="flex items-baseline gap-2">
        <span
          className={cn(
            "tnum font-display text-[17px] font-bold leading-none",
            selected ? "text-on-emerald" : locked ? "text-ink-soft" : longShot ? "text-coral" : "text-emerald-deep",
          )}
        >
          +{points}
        </span>
        <span
          className={cn(
            "tnum text-[11px] font-medium tabular-nums",
            selected ? "text-on-emerald/80" : "text-ink-soft/80",
          )}
        >
          {odds.toFixed(2)}
        </span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ pick burst */

// The live room's GoalBurst spray (live/[id]/page.tsx), scaled down to pick-size:
// fewer, smaller brand-token dots, a tighter radius and a snappier 900ms throw so
// the lock reads as a personal beat, not a goal-scale room celebration. Reuses the
// exact tl-goalfly keyframe. motion-safe only — reduced motion never renders it (the
// text confirmation already reads); one-shot (both fill) so it never loops or lingers.
const PICK_PARTICLE_COUNT = 9;
const PICK_COLORS = ["var(--emerald)", "var(--cyan)", "var(--gold)"];
const PICK_PARTICLES = Array.from({ length: PICK_PARTICLE_COUNT }, (_, i) => {
  const angle = (i / PICK_PARTICLE_COUNT) * Math.PI * 2 + Math.PI / 7;
  const dist = 40 + (i % 3) * 16;
  return {
    color: PICK_COLORS[i % PICK_COLORS.length]!,
    gx: Math.round(Math.cos(angle) * dist),
    gy: Math.round(Math.sin(angle) * dist) - 12, // bias the spray gently upward
    size: 4 + (i % 3) * 2,
    delay: (i % 4) * 40,
  };
});

function PickBurst() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      {PICK_PARTICLES.map((p, i) => (
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

export default function MatchPage() {
  const params = useParams<{ id: string }>();
  const fixtureId = Number(params.id);
  const router = useRouter();
  const reduce = useReducedMotion();
  const token = useSession((s) => s.token);
  const persona = useSession((s) => s.profile?.persona);
  const wallet = useSession((s) => s.profile?.wallet);
  const [resumedPick, setResumedPick] = useState(false);
  const [challenging, setChallenging] = useState(false);
  const [challengeMsg, setChallengeMsg] = useState<string | null>(null);

  const [fixture, setFixture] = useState<FixtureRow | null>(null);
  const [markets, setMarkets] = useState<MarketOdds[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [locking, setLocking] = useState(false);
  const [locked, setLocked] = useState<{ label: string; odds: number; points: number; guest: boolean } | null>(null);
  // Distinguishes a pick locked *by this tap* (fire the celebration) from one already
  // open on load (useEffect below) — so the beat only ever plays on the real action.
  const [justLocked, setJustLocked] = useState(false);
  const [punditLine, setPunditLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Secondary markets (W7/SAH-35) — Over/Under + correct-score. Signed-in only (see the
  // section render below): kept as fully separate state from the primary 1X2 flow above
  // so nothing here can affect it.
  const [ouSelection, setOuSelection] = useState<"over" | "under" | null>(null);
  const [ouLocking, setOuLocking] = useState(false);
  const [ouLocked, setOuLocked] = useState<{ label: string; odds: number; points: number } | null>(null);
  const [ouError, setOuError] = useState<string | null>(null);

  const [csSelection, setCsSelection] = useState<string | null>(null);
  const [csLocking, setCsLocking] = useState(false);
  const [csLocked, setCsLocked] = useState<{ label: string; points: number } | null>(null);
  const [csError, setCsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [f, odds] = await Promise.all([getFixture(fixtureId), getFixtureOdds(fixtureId)]);
      if (!active) return;
      const fx = f?.fixture ?? null;
      setFixture(fx);
      setMarkets(odds);
      setLoading(false);
      if (consumeResumedFlag(fixtureId)) setResumedPick(true);

      // A signed-in user (including one who just resolved a resumed guest
      // pick via /connect) may already have an open pick on this fixture —
      // show it locked instead of re-asking for a selection.
      if (token && fx) {
        const myPicks = await getMyPicks(token);
        if (!active) return;
        const existing = myPicks.find((p) => p.fixtureId === fixtureId && p.status === "open");
        if (existing) {
          const label =
            existing.selection === "draw"
              ? "Draw"
              : existing.selection === "part1"
                ? fx.participant1
                : fx.participant2;
          setLocked({
            label,
            odds: existing.oddsAtLock,
            points: Math.round(existing.oddsAtLock * 100),
            guest: false,
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [fixtureId, token]);

  // Secondary markets (W7/SAH-35): separate fetch from the primary 1X2 lookup above —
  // GET /api/picks/all (not GET /api/picks) so it never touches the 1X2 contract.
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      const all = await getMyPicksAllMarkets(token);
      if (!active) return;
      const ou = all.find(
        (p) => p.fixtureId === fixtureId && p.market === "OVERUNDER_PARTICIPANT_GOALS" && p.status === "open",
      );
      if (ou) {
        setOuLocked({
          label: ou.selectionLabel === "O" ? "Over" : "Under",
          odds: ou.oddsAtLock,
          points: Math.round(ou.oddsAtLock * 100),
        });
      }
      const cs = all.find((p) => p.fixtureId === fixtureId && p.market === CORRECT_SCORE_MARKET && p.status === "open");
      if (cs) {
        setCsLocked({ label: cs.selection, points: Math.round(cs.oddsAtLock * 100) });
      }
    })();
    return () => {
      active = false;
    };
  }, [fixtureId, token]);

  const oneX2 = useMemo(
    () => markets.find((m) => m.superOddsType === "1X2_PARTICIPANT_RESULT" && m.prices?.length === 3) ?? null,
    [markets],
  );
  const prices = oneX2?.prices ?? null;
  const oddsFor = (sel: Selection) => (prices ? decimalOdds(prices[SEL_INDEX[sel]]!) : null);
  const potential = selection && oddsFor(selection) ? Math.round(oddsFor(selection)! * 100) : 0;

  // "Beat the bookies" — the implied probability behind the locked odds, in
  // plain language (e.g. "about a 1-in-5 shot").
  const shotPhrase = (odds: number) => {
    const phrase = impliedProbabilityPhrase(odds);
    return `about ${probabilityArticle(phrase)} ${phrase} shot`;
  };

  const longShotSel = useMemo<Selection | null>(() => {
    if (!prices) return null;
    const ds = (["part1", "draw", "part2"] as Selection[]).map((s) => ({ s, o: decimalOdds(prices[SEL_INDEX[s]]!) }));
    const max = ds.reduce((a, b) => (b.o > a.o ? b : a));
    return max.o >= 3 ? max.s : null;
  }, [prices]);

  const variantFor = (sel: Selection): OddsVariant => {
    if (locked) return "locked";
    if (selection === sel) return "selected";
    if (longShotSel === sel) return "long-shot";
    return "default";
  };

  const labels: Record<Selection, string> = fixture
    ? { part1: fixture.participant1, draw: "Draw", part2: fixture.participant2 }
    : { part1: "1", draw: "X", part2: "2" };

  // Secondary markets (W7/SAH-35). Over/Under: mirrors the worker's own
  // findOverUnderMarket selection (prefer a full-match MarketPeriod, pick whichever real
  // line is closest to OVERUNDER_TARGET_LINE) so the number shown here matches what
  // actually gets locked server-side. Never fabricates a line — null when the feed has
  // no Over/Under odds for this fixture yet.
  const ouMarket = useMemo(() => {
    const candidates = markets
      .filter((m) => m.superOddsType === "OVERUNDER_PARTICIPANT_GOALS" && m.prices?.length === 2 && m.marketParameters)
      .map((m) => ({
        m,
        line: parseOverUnderLine(m.marketParameters!),
        partial: isPartialPeriod(m.marketPeriod),
      }))
      .filter((cand): cand is typeof cand & { line: number } => cand.line != null);
    if (candidates.length === 0) return null;
    const fullMatch = candidates.filter((cand) => !cand.partial);
    const pool = fullMatch.length > 0 ? fullMatch : candidates;
    return pool.reduce((a, b) =>
      Math.abs(b.line - OVERUNDER_TARGET_LINE) < Math.abs(a.line - OVERUNDER_TARGET_LINE) ? b : a,
    );
  }, [markets]);

  const ouOddsFor = (sel: "over" | "under") =>
    ouMarket?.m.prices ? decimalOdds(ouMarket.m.prices[sel === "over" ? 0 : 1]!) : null;

  /** Fire the instant, persona-flavoured pundit line the moment a pick lands. */
  const firePundit = (sel: Selection, odds: number) => {
    const team = sel === "draw" ? "the draw" : labels[sel];
    setPunditLine(firstPickLine({ team, label: SEL_LABEL[sel], odds }, persona));
  };

  /** The one-time pick-lock payoff: arm the confirmation's motion beat + PickBurst
   *  and fire a short haptic tap where the browser supports it (mobile, no-op else). */
  const celebrateLock = () => {
    setJustLocked(true);
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(10);
    }
  };

  const lock = async () => {
    if (!selection) return;
    const odds = oddsFor(selection);
    if (odds == null) return;

    // Guest path: lock optimistically with no wallet — the aha must land in ~60s
    // with no connect, no live match. The wallet gate is deferred to trophy claim.
    // Stash the pick so /connect can resubmit it after sign-in instead of dropping it.
    if (!token) {
      setLocked({ label: labels[selection], odds, points: potential, guest: true });
      stashPendingPick({ fixtureId, selection, label: labels[selection], odds, points: potential });
      firePundit(selection, odds);
      celebrateLock();
      return;
    }

    // Signed-in path: persist the pick, then fire the (still-instant) line.
    // Use the local team-name label (not the backend's pool-code selectionLabel,
    // which pundit lines / trophy metadata / room picks rely on as "1"/"X"/"2").
    setLocking(true);
    setError(null);
    try {
      const res = await postPick(token, fixtureId, selection);
      setLocked({ label: labels[selection], odds: res.pick.oddsAtLock, points: res.potentialPoints, guest: false });
      firePundit(selection, res.pick.oddsAtLock);
      celebrateLock();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLocking(false);
    }
  };

  // Secondary markets (W7/SAH-35) — signed-in only, so no guest/pending-pick path here
  // (unlike `lock` above): the guest resume flow is single-slot / 1X2-only today, and
  // extending it is out of scope for this pass.
  const lockOu = async () => {
    if (!token || !ouSelection || !ouMarket) return;
    setOuLocking(true);
    setOuError(null);
    try {
      const res = await postPick(token, fixtureId, ouSelection, "OVERUNDER_PARTICIPANT_GOALS");
      setOuLocked({
        label: ouSelection === "over" ? "Over" : "Under",
        odds: res.pick.oddsAtLock,
        points: res.potentialPoints,
      });
    } catch (e) {
      setOuError((e as Error).message);
    } finally {
      setOuLocking(false);
    }
  };

  const lockCs = async () => {
    if (!token || !csSelection) return;
    setCsLocking(true);
    setCsError(null);
    try {
      const res = await postPick(token, fixtureId, csSelection, CORRECT_SCORE_MARKET);
      setCsLocked({ label: csSelection, points: res.potentialPoints });
    } catch (e) {
      setCsError((e as Error).message);
    } finally {
      setCsLocking(false);
    }
  };

  // "Challenge a friend" — a Solana Blink for this fixture. The link unfurls as an
  // interactive card (X/Discord/dial.to): a friend can make their own call and sign it
  // on-chain, right from the share, no app install. Reuses the same share plumbing as
  // the trophy ShareCard (shareSnippet), just pointed at the Blink link instead.
  const challenge = async () => {
    if (challenging || !locked) return;
    setChallenging(true);
    try {
      const link = blinkUrl(fixtureId, wallet ?? null);
      const outcome = await shareSnippet(
        `I called ${locked.label} on Touchline. Think you know better? Make your own call, sign it on-chain:`,
        "Touchline challenge",
        link,
      );
      setChallengeMsg(outcome === "failed" ? "Couldn't share. Try again" : "Challenge sent. Sign it on-chain to reply");
    } finally {
      setChallenging(false);
      window.setTimeout(() => setChallengeMsg(null), 3200);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-3 inline-flex min-h-[40px] items-center gap-1 font-display text-[15px] font-semibold text-ink-soft hover:text-ink"
        >
          ‹ Back
        </button>

        {loading ? (
          <div className="solid h-56 animate-pulse" />
        ) : !fixture ? (
          <div className="solid p-6 text-center text-ink-soft">Couldn&apos;t load this match.</div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36 }}>
            {/* header */}
            <div className="solid p-5">
              <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight text-ink">
                {fixture.participant1} <span className="font-normal text-ink-soft">v</span> {fixture.participant2}
              </h1>
              <p className="tnum mt-1 text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                {timeFmt.format(new Date(fixture.startTime))} · {fixture.competition}
              </p>
            </div>

            {/* market */}
            <div className="solid mt-4 p-5">
              <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                Make the call · points if you&apos;re right
              </p>
              {prices ? (
                <div className="mt-3 flex flex-col gap-1.5">
                  {(["part1", "draw", "part2"] as Selection[]).map((sel) => {
                    const price = oddsFor(sel);
                    if (price == null) return null;
                    return (
                      <PickRow
                        key={sel}
                        label={labels[sel]}
                        odds={price}
                        points={Math.round(price * 100)}
                        variant={variantFor(sel)}
                        onPick={() => !locked && setSelection(sel)}
                      />
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-[15px] text-ink-soft">No live odds for this match yet.</p>
              )}

              {!locked && selection && (
                <p className="tnum mt-4 text-[15px] font-medium text-ink">
                  Your call earns <span className="font-display text-emerald-deep">{potential}</span> pts if it hits.
                  The bookies make it {shotPhrase(oddsFor(selection)!)}.
                </p>
              )}

              {locked ? (
                <motion.div
                  // One-time pick-lock beat: a spring pop (overshoot) that reads distinctly
                  // different from every other card's linear duration-fade on this page. Only
                  // when locked by this tap (justLocked) and motion is allowed — an existing
                  // pick loaded on mount, or reduced motion, just appears with no beat.
                  initial={justLocked && !reduce ? { scale: 0.92, opacity: 0.5 } : false}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={
                    justLocked && !reduce
                      ? { type: "spring", stiffness: 520, damping: 22, mass: 0.7 }
                      : { duration: 0 }
                  }
                  className="relative mt-4 rounded-[var(--radius-sm)] bg-[rgba(0,217,130,0.10)] p-4"
                >
                  {justLocked && !reduce && <PickBurst />}
                  {resumedPick && (
                    <p className="mb-2 font-display text-[12px] font-semibold uppercase tracking-wide text-emerald-deep">
                      ✓ Signed in. Your call&rsquo;s on the board for keeps
                    </p>
                  )}
                  <p className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald">
                    Called it · on record
                  </p>
                  <p className="mt-1 font-display text-[16px] font-semibold text-emerald-deep">
                    You called {locked.label} at {locked.odds.toFixed(2)}.
                  </p>
                  <p className="tnum mt-0.5 text-[14px] text-ink-soft">
                    {locked.points} pts on the line, {shotPhrase(locked.odds)}. It&rsquo;s signed and on the board now. Prove you&rsquo;re right.
                  </p>

                  {/* Pundit reaction — the signature aha (no wallet, no live match
                      needed). It lands right under the lock headline, above the utility
                      CTAs below, so the pundit's take on THIS call is the first thing in
                      the viewport the instant Lock pick is tapped — zero scrolling, and
                      well ahead of the secondary markets / trivia further down the page. */}
                  <AnimatePresence>
                    {punditLine && (
                      <motion.div
                        initial={{ opacity: 0, y: 12, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.38, ease: [0.2, 0.7, 0.3, 1] }}
                        className="mt-3"
                      >
                        <GlassCard className="flex items-start gap-3 p-4">
                          <span
                            aria-hidden
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-[rgba(43,229,255,0.12)]"
                          >
                            <IconPundit className="h-5 w-5" color="var(--cyan)" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-display text-[10px] font-semibold uppercase tracking-wide text-cyan">
                              Your pundit · live
                            </p>
                            <p aria-live="polite" className="mt-1 text-[15px] leading-snug text-ink">
                              {punditLine}
                            </p>
                          </div>
                        </GlassCard>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button variant="ghost" onClick={() => router.push("/play")}>
                      Back to Today
                    </Button>
                    <Button variant="gradient" onClick={challenge} disabled={challenging}>
                      {challenging ? "Sharing…" : "Challenge a friend ⚡"}
                    </Button>
                  </div>
                  <p aria-live="polite" className="mt-2 min-h-[16px] text-[12px] font-medium text-emerald-deep">
                    {challengeMsg ?? " "}
                  </p>
                  <Link
                    href={`/blink/${fixtureId}`}
                    className="mt-1 inline-block text-[12px] font-medium text-cyan hover:underline"
                  >
                    Preview the Blink ↗
                  </Link>
                </motion.div>
              ) : (
                <Button onClick={lock} disabled={!selection || locking} className="mt-4 w-full" size="lg">
                  {locking ? "Locking…" : "Lock it in ✓"}
                </Button>
              )}

              {error && <p className="mt-3 text-[14px] font-medium text-coral">{error}</p>}
            </div>

            {/* Secondary markets (W7/SAH-35) — subordinate to the primary 1X2 call
                above, signed-in only. Guests never see this: the zero-friction guest
                1X2 flow (W1) stays completely untouched. */}
            {token && (
              <div className="mt-4 flex flex-col gap-4">
                {ouMarket && (
                  <div className="solid p-5">
                    <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                      Total goals · {ouMarket.line.toFixed(2)}
                      {ouMarket.partial ? " (1st half)" : ""}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <OddsPill
                        odds={ouOddsFor("over") ?? 0}
                        label="Over"
                        variant={ouLocked ? "locked" : ouSelection === "over" ? "selected" : "default"}
                        onClick={() => !ouLocked && setOuSelection("over")}
                        className="w-full"
                      />
                      <OddsPill
                        odds={ouOddsFor("under") ?? 0}
                        label="Under"
                        variant={ouLocked ? "locked" : ouSelection === "under" ? "selected" : "default"}
                        onClick={() => !ouLocked && setOuSelection("under")}
                        className="w-full"
                      />
                    </div>
                    {ouLocked ? (
                      <p className="tnum mt-3 text-[13px] font-medium text-ink-soft">
                        Locked: {ouLocked.label} {ouMarket.line.toFixed(2)} at {ouLocked.odds.toFixed(2)} ·{" "}
                        {ouLocked.points} pts on the line.
                      </p>
                    ) : (
                      <Button onClick={lockOu} disabled={!ouSelection || ouLocking} className="mt-3 w-full">
                        {ouLocking ? "Locking…" : "Lock Over/Under"}
                      </Button>
                    )}
                    {ouError && <p className="mt-2 text-[13px] font-medium text-coral">{ouError}</p>}
                  </div>
                )}

                <div className="solid p-5">
                  <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                    Correct score · couch guess, flat {CORRECT_SCORE_POINTS} pts
                  </p>
                  <p className="mt-1 text-[12px] text-ink-soft">
                    Not a bookmaker price. Every scoreline pays the same flat points.
                  </p>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {CORRECT_SCORE_OPTIONS.map((opt) => (
                      <OddsPill
                        key={opt}
                        odds={String(CORRECT_SCORE_POINTS)}
                        label={opt}
                        variant={csLocked ? "locked" : csSelection === opt ? "selected" : "default"}
                        onClick={() => !csLocked && setCsSelection(opt)}
                        className="w-full"
                      />
                    ))}
                  </div>
                  {csLocked ? (
                    <p className="tnum mt-3 text-[13px] font-medium text-ink-soft">
                      Locked: {csLocked.label} · {csLocked.points} flat pts on the line.
                    </p>
                  ) : (
                    <Button onClick={lockCs} disabled={!csSelection || csLocking} className="mt-3 w-full">
                      {csLocking ? "Locking…" : "Lock correct score"}
                    </Button>
                  )}
                  {csError && <p className="mt-2 text-[13px] font-medium text-coral">{csError}</p>}
                </div>
              </div>
            )}

            {/* Star Man (SAH) — the pre-kickoff "name a scorer" call. Sits AFTER the
                secondary markets above and BEFORE the trivia filler below, following
                the same own-state / own-lock pattern. Signed-in only, so guest
                behaviour matches the other secondary markets. */}
            {token && (
              <div className="mt-4">
                <StarManSection fixtureId={fixtureId} token={token} />
              </div>
            )}

            {/* Pre-match dead-air filler — fills the wait while the user decides,
                never blocks locking a pick. Gone once a pick is locked, ceding the
                viewport to the pundit reaction that now renders above this. */}
            {!locked && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36, delay: 0.08 }} className="mt-4">
                <TriviaCard seed={fixtureId} />
              </motion.div>
            )}

            {/* Guests keep playing freely; the wallet is only requested at claim. */}
            {locked?.guest && (
              <div className="mt-4 text-center">
                <Link
                  href="/connect"
                  className="inline-flex items-center gap-1 font-display text-[15px] font-semibold text-emerald-deep hover:underline"
                >
                  Sign in to watch it live ▸
                </Link>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                  Save your streak and claim trophies when your calls land.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </AppShell>
  );
}
