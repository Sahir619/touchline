"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  decimalOdds,
  personaById,
  trophyTier,
  impliedProbabilityPct,
  impliedProbabilityPhrase,
  probabilityArticle,
  isAgainstMarket,
  type OddsPayload,
  type ScoreEvent,
} from "@touchline/shared";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { ShareCard } from "@/components/ShareCard";
import { TriviaCard } from "@/components/ui/TriviaCard";
import { PunditPanel } from "@/components/ui/PunditPanel";
import { AskPundit, type AskReply } from "@/components/ui/AskPundit";
import { useSession } from "@/lib/session";
import { useLiveFeed, type LiveMessage, type ClvPayload } from "@/lib/ws";
import { shareSnippet } from "@/lib/share";
import { referralCodeFor } from "@/lib/referral";
import { cn } from "@/lib/cn";
import {
  getFixture,
  getMyPicks,
  getMyPicksAllMarkets,
  getLeaderboard,
  getRoomPicks,
  STAR_MAN_MARKET,
  type Selection,
  type Pick,
  type LeaderRow,
  type FixtureRow,
  type RoomPick,
  type Trophy,
} from "@/lib/game";

/* ---------------------------------------------------------------- helpers */

const SEL_INDEX: Record<Selection, number> = { part1: 0, draw: 1, part2: 2 };

interface LiveState {
  p1: number;
  p2: number;
  statusSoccerId: string | null;
  clockSeconds: number | null;
}

function deriveLive(state: unknown): LiveState {
  const s = state as
    | {
        scoreSoccer?: {
          Participant1?: { Total?: { Goals?: number } };
          Participant2?: { Total?: { Goals?: number } };
        };
        statusSoccerId?: string | null;
        clock?: { seconds?: number | null };
      }
    | null
    | undefined;
  return {
    p1: s?.scoreSoccer?.Participant1?.Total?.Goals ?? 0,
    p2: s?.scoreSoccer?.Participant2?.Total?.Goals ?? 0,
    statusSoccerId: s?.statusSoccerId ?? null,
    clockSeconds: s?.clock?.seconds ?? null,
  };
}

interface StatusInfo {
  label: string;
  minute: string | null;
  live: boolean;
  finished: boolean;
}

function statusInfo(statusId: string | null, clockSeconds: number | null): StatusInfo {
  const code = (statusId ?? "").toUpperCase();
  const minute = clockSeconds != null ? `${Math.floor(clockSeconds / 60)}'` : null;
  if (!code || code === "NS") return { label: "Kicks off soon", minute: null, live: false, finished: false };
  if (code.startsWith("HT")) return { label: "Half-time", minute: null, live: true, finished: false };
  if (code.startsWith("H1")) return { label: "1st half", minute, live: true, finished: false };
  if (code.startsWith("H2")) return { label: "2nd half", minute, live: true, finished: false };
  if (code.startsWith("ET") || code.startsWith("FET")) return { label: "Extra time", minute, live: true, finished: false };
  if (code.startsWith("PE") || code.startsWith("FPE")) return { label: "Penalties", minute: null, live: true, finished: false };
  if (code === "F" || code.startsWith("TXC")) return { label: "Full time", minute: null, live: false, finished: true };
  if (["A", "C", "P", "I"].includes(code)) return { label: "Suspended", minute: null, live: false, finished: false };
  return { label: "Live", minute, live: true, finished: false };
}

/** Who is currently ahead, as a 1X2 selection. */
function leaderSelection(p1: number, p2: number): Selection {
  if (p1 > p2) return "part1";
  if (p2 > p1) return "part2";
  return "draw";
}

interface PunditLine {
  id: number;
  line: string;
  persona: string;
  kind: string;
  /** Worker emit time — the stable identity used to backfill/merge with GET /api/pundit/history. */
  ts: number;
}

interface ResultBanner {
  correct: boolean;
  points: number;
  streak: number;
  /** Decimal odds locked on the resolved pick — powers the "beat the bookies" framing. */
  oddsAtLock: number | null;
}

/* ----------------------------------------------------------------- screen */

export default function LiveMatchPage() {
  const params = useParams<{ id: string }>();
  const fixtureId = Number(params.id);
  const router = useRouter();
  const reduce = useReducedMotion();

  const token = useSession((s) => s.token);
  const profile = useSession((s) => s.profile);
  const hydrated = useSession((s) => s.hydrated);
  const wallet = profile?.wallet ?? null;

  const [fixture, setFixture] = useState<FixtureRow | null>(null);
  const [live, setLive] = useState<LiveState>({ p1: 0, p2: 0, statusSoccerId: null, clockSeconds: null });
  const [picks, setPicks] = useState<Pick[]>([]);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [room, setRoom] = useState<RoomPick[]>([]);
  const [punditLines, setPunditLines] = useState<PunditLine[]>([]);
  const [sharedId, setSharedId] = useState<number | null>(null);
  const [livePrices, setLivePrices] = useState<number[] | null>(null);
  const [result, setResult] = useState<ResultBanner | null>(null);
  // Beat the Line (SAH) — the celebratory "the market came to you" moment, set when a
  // clv WS event lands for this wallet + fixture (worker only emits it when beatLine).
  const [clvMoment, setClvMoment] = useState<ClvPayload | null>(null);
  const [goalBurst, setGoalBurst] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  // Star Man (SAH) — the signed-in user's Star Man call on this fixture, if any.
  // Lives in a DIFFERENT market than the 1X2 `picks` above (STAR_MAN_MARKET), so
  // it's read from GET /api/picks/all, kept fully separate from the 1X2 contract.
  const [starPick, setStarPick] = useState<{ playerId: number; name: string } | null>(null);
  // The TALISMAN moment — set when this user's Star Man scores, detected purely
  // client-side off the existing 'score' WS events (no new WS event type). This drives
  // the one-shot celebration overlay and is only ever set from a LIVE goal.
  const [talisman, setTalisman] = useState<{ name: string } | null>(null);
  // Whether this user's Star Man has already found the net — hydrated on load from the
  // server (picks/all `scored`), so a viewer who joins AFTER the goal (or after the
  // fixture resolved) sees the chip reflect it. Kept separate from `talisman` so a fresh
  // load reflects the scored state on the chip WITHOUT replaying the live celebration.
  const [starScored, setStarScored] = useState(false);

  const punditSeq = useRef(0);
  const prevGoals = useRef<number | null>(null);
  // Goal `score` events already fired (by seq) so a repeated/replayed frame never
  // re-triggers the TALISMAN moment for the same goal.
  const seenStarGoals = useRef<Set<number>>(new Set());
  const goalTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shareTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // auth gate
  useEffect(() => {
    if (hydrated && !token) router.replace("/connect");
  }, [hydrated, token, router]);

  // initial load
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      const [f, myPicks, allPicks, lb, roomPicks] = await Promise.all([
        getFixture(fixtureId),
        getMyPicks(token),
        getMyPicksAllMarkets(token),
        getLeaderboard(),
        getRoomPicks(token, fixtureId),
      ]);
      if (!active) return;
      setFixture(f?.fixture ?? null);
      setLive(deriveLive(f?.state ?? null));
      setPicks(myPicks.filter((p) => p.fixtureId === fixtureId));
      const star = allPicks.find((p) => p.fixtureId === fixtureId && p.market === STAR_MAN_MARKET);
      if (star) {
        setStarPick({ playerId: Number(star.selection), name: star.selectionLabel });
        // `scored` (server-derived) covers both a live goal that landed before this viewer
        // joined and a resolved winning call, so the chip shows the emerald "scored" state
        // instead of staying stuck on the neutral "star man" gold.
        if (star.scored || star.status === "won") setStarScored(true);
      }
      setBoard(lb);
      setRoom(roomPicks);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [fixtureId, token]);

  // Append a pundit line to the running feed, deduped by ts+text so a line delivered
  // twice (e.g. an ask reply from both the HTTP response and the WS) only lands once.
  const addPunditLine = (l: { line: string; persona: string; kind: string; ts: number }) => {
    setPunditLines((prev) =>
      prev.some((x) => x.ts === l.ts && x.line === l.line)
        ? prev
        : [{ id: ++punditSeq.current, line: l.line, persona: l.persona, kind: l.kind, ts: l.ts }, ...prev],
    );
  };

  // Ask the Pundit — the fan's question renders right-aligned + quiet (kind 'question');
  // the reply lands in the pundit's own voice (also arrives over WS, deduped above).
  const onAskQuestion = (text: string) =>
    addPunditLine({ line: text, persona: "", kind: "question", ts: Date.now() });
  const onAskReply = (reply: AskReply) =>
    addPunditLine({ line: reply.line, persona: reply.persona, kind: reply.kind, ts: reply.ts });

  // live feed
  const connected = useLiveFeed((msg: LiveMessage) => {
    switch (msg.type) {
      case "score": {
        const p = msg.payload as ScoreEvent;
        if (p.fixtureId !== fixtureId) return;
        setLive((prev) => ({
          p1: p.scoreSoccer?.Participant1?.Total?.Goals ?? prev.p1,
          p2: p.scoreSoccer?.Participant2?.Total?.Goals ?? prev.p2,
          statusSoccerId: p.statusSoccerId ?? prev.statusSoccerId,
          clockSeconds: (p as { clock?: { seconds?: number } }).clock?.seconds ?? prev.clockSeconds,
        }));
        // TALISMAN — my Star Man scored. Detected here off the existing 'score' event:
        // a confirmed 'goal' action whose scorer is my pick, excluding own goals.
        // Deduped by event seq so a replayed frame fires the moment only once.
        if (
          starPick &&
          p.action === "goal" &&
          p.dataSoccer?.PlayerId === starPick.playerId &&
          p.dataSoccer?.GoalType !== "Own" &&
          !seenStarGoals.current.has(p.seq)
        ) {
          seenStarGoals.current.add(p.seq);
          setTalisman({ name: starPick.name });
          // Keep the chip's scored state independent of the dismissible overlay.
          setStarScored(true);
        }
        break;
      }
      case "odds": {
        const o = msg.payload as OddsPayload;
        if (o.FixtureId !== fixtureId) return;
        if (o.SuperOddsType !== "1X2_PARTICIPANT_RESULT") return;
        if (o.Prices && o.Prices.length === 3) setLivePrices(o.Prices.map(decimalOdds));
        break;
      }
      case "pundit": {
        const p = msg.payload as { wallet: string; fixtureId: number; line: string; persona: string; kind: string; ts?: number };
        if (p.wallet !== wallet || p.fixtureId !== fixtureId) return;
        // Uncapped: keep the full running commentary so nothing scrolls out of
        // reach — each line stays individually shareable (W5). The same lines also
        // feed the PunditPanel scrollback drawer (SAH-77). Conversational "Ask the
        // Pundit" replies (kind 'ask') arrive here too — dedup by ts so the reply
        // returned by the ask HTTP call and the one delivered over the WS don't double.
        addPunditLine({ line: p.line, persona: p.persona, kind: p.kind, ts: p.ts ?? Date.now() });
        break;
      }
      case "clv": {
        const c = msg.payload as ClvPayload;
        if (c.wallet !== wallet || c.fixtureId !== fixtureId || !c.beatLine) return;
        setClvMoment(c);
        // Reflect the beat onto the matching "Your call" chip so it carries the swing too.
        setPicks((prev) =>
          prev.map((pk) =>
            pk.market === c.market && pk.selectionLabel === c.selectionLabel
              ? { ...pk, beatLine: true, pctAtClose: c.pctAtClose, clv: c.clv }
              : pk,
          ),
        );
        break;
      }
      case "resolved": {
        const r = msg.payload as { wallet: string; fixtureId: number; correct: boolean; points: number; streak: number };
        if (r.wallet !== wallet || r.fixtureId !== fixtureId) return;
        const resolvedPick = picks.find((pk) => pk.status === "open") ?? picks[0] ?? null;
        setResult({ correct: r.correct, points: r.points, streak: r.streak, oddsAtLock: resolvedPick?.oddsAtLock ?? null });
        // reflect resolution on the user's chips
        setPicks((prev) => prev.map((pk) => ({ ...pk, status: r.correct ? "won" : "lost", points: r.points })));
        break;
      }
    }
  });

  // Goal → reaction burst. Fire only on a genuine increase in total goals (never
  // on first load / reconnect state sync). The very first observed total seeds
  // the baseline silently.
  useEffect(() => {
    if (loading) return;
    const total = live.p1 + live.p2;
    if (prevGoals.current === null) {
      prevGoals.current = total;
      return;
    }
    if (total > prevGoals.current) {
      clearTimeout(goalTimer.current);
      setGoalBurst(true);
      goalTimer.current = setTimeout(() => setGoalBurst(false), 1700);
    }
    prevGoals.current = total;
  }, [live.p1, live.p2, loading]);

  // clear any pending timers on unmount
  useEffect(
    () => () => {
      clearTimeout(goalTimer.current);
      clearTimeout(shareTimer.current);
    },
    [],
  );

  const sharePundit = async (p: PunditLine) => {
    const name = personaById(p.persona)?.name;
    const who = name ? `via ${name}, my pundit on Touchline` : "via my pundit on Touchline";
    const outcome = await shareSnippet(`“${p.line}” ${who}`);
    if (outcome !== "failed") {
      setSharedId(p.id);
      clearTimeout(shareTimer.current);
      shareTimer.current = setTimeout(() => setSharedId((cur) => (cur === p.id ? null : cur)), 1800);
    }
  };

  const status = statusInfo(live.statusSoccerId, live.clockSeconds);
  const leader = leaderSelection(live.p1, live.p2);

  const labelForSel = (sel: Selection): string => {
    if (!fixture) return sel === "part1" ? "1" : sel === "part2" ? "2" : "Draw";
    return sel === "part1" ? fixture.participant1 : sel === "part2" ? fixture.participant2 : "Draw";
  };

  const myRow = useMemo(() => board.find((r) => r.wallet === wallet) ?? null, [board, wallet]);
  const top3 = board.slice(0, 3);
  const latestVoice = punditLines.find((p) => p.kind !== "question");
  const personaName = latestVoice ? personaById(latestVoice.persona)?.name : null;

  // The shareable "moment" for this resolved match — built from the best won
  // call (highest odds beaten). Not minted here, so `mintAddress` is null; the
  // ShareCard still shares the moment (OS sheet / copy / PNG). Minting stays on
  // the trophy cabinet (/you).
  const shareTrophy = useMemo<Trophy | null>(() => {
    const won = picks.filter((p) => p.status === "won");
    if (won.length === 0) return null;
    const best = won.reduce((a, b) => (b.oddsAtLock > a.oddsAtLock ? b : a));
    const t = trophyTier(best.oddsAtLock);
    return {
      id: best.id,
      fixtureId,
      tier: t.tier ?? "bronze",
      name: t.name ?? "Called it",
      oddsBeaten: best.oddsAtLock,
      market: best.market,
      selectionLabel: labelForSel(best.selection),
      mintAddress: null,
      createdAt: best.lockedAt ?? 0,
      mintedAt: null,
    };
    // labelForSel derives from `fixture`; recompute when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, fixtureId, fixture]);

  const enter = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.36, ease: [0.2, 0.7, 0.3, 1] as const, delay: reduce ? 0 : i * 0.05 },
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={() => router.push("/live")}
          className="mb-3 inline-flex min-h-[40px] items-center gap-1 font-display text-[15px] font-semibold text-ink-soft hover:text-ink"
        >
          ‹ Live
        </button>

        {loading ? (
          <div className="solid h-64 animate-pulse" />
        ) : !fixture ? (
          <div className="solid p-6 text-center text-[16px] text-ink-soft">Couldn&apos;t load this match.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* ---- Scoreboard (solid reading surface) ---- */}
            <motion.section {...enter(0)} className="solid relative overflow-hidden p-5">
              {goalBurst && <GoalBurst reduce={!!reduce} />}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      status.live ? "bg-coral motion-safe:animate-[tl-heart_1.1s_ease-in-out_infinite]" : "bg-ink-soft/40",
                    )}
                  />
                  <span className="font-display text-[12px] font-semibold uppercase tracking-wide text-coral">
                    {status.live ? "Live" : status.finished ? "Full time" : "Pre-match"}
                  </span>
                </span>
                <span className="tnum text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                  {status.label}
                  {status.minute ? <span className="ml-1.5 text-ink">{status.minute}</span> : null}
                  {!connected && <span className="ml-2 text-coral/70">reconnecting…</span>}
                </span>
              </div>

              {/* score line */}
              <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="min-w-0 text-right">
                  <p className="font-display text-[18px] font-semibold leading-tight tracking-tight text-ink sm:text-[20px]">
                    {fixture.participant1}
                  </p>
                </div>
                <p className="tnum font-display text-[44px] font-bold leading-none tracking-tight text-ink sm:text-[56px]">
                  {live.p1}
                  <span className="mx-2 text-ink-soft/50">-</span>
                  {live.p2}
                </p>
                <div className="min-w-0 text-left">
                  <p className="font-display text-[18px] font-semibold leading-tight tracking-tight text-ink sm:text-[20px]">
                    {fixture.participant2}
                  </p>
                </div>
              </div>

              <p className="tnum mt-3 text-center text-[12px] font-medium uppercase tracking-wide text-ink-soft">
                {fixture.competition}
              </p>

              {/* live 1X2 odds tick — odometer roll + ▲/▼ tint flash on change */}
              {livePrices && (
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[rgba(255,255,255,0.08)] pt-4">
                  {(["part1", "draw", "part2"] as Selection[]).map((sel) => (
                    <OddsTick
                      key={sel}
                      label={sel === "part1" ? "1" : sel === "part2" ? "2" : "X"}
                      value={livePrices[SEL_INDEX[sel]]!}
                      reduce={!!reduce}
                    />
                  ))}
                </div>
              )}
            </motion.section>

            {/* ---- Your call chips ---- */}
            {(picks.length > 0 || starPick) && (
              <motion.section {...enter(1)} className="solid p-5">
                <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Your call</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {/* Star Man call — a compact star chip beside the 1X2 call chips. Emerald
                      once he's scored (live goal OR hydrated on load for a late viewer),
                      neutral otherwise. */}
                  {starPick && (
                    <div
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-2",
                        talisman || starScored
                          ? "border-emerald/40 bg-[rgba(0,217,130,0.10)] text-emerald-deep"
                          : "border-gold/40 bg-[rgba(242,179,60,0.08)] text-ink",
                      )}
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-gold" fill="currentColor" aria-hidden>
                        <path d="M12 2.6l2.7 5.6 6.1.85-4.45 4.3 1.06 6.05L12 20.6l-5.42 2.85 1.06-6.05L3.2 9.05l6.1-.85z" />
                      </svg>
                      <span className="font-display text-[15px] font-semibold tracking-tight">{starPick.name}</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
                        {talisman || starScored ? "scored" : "star man"}
                      </span>
                    </div>
                  )}
                  {picks.map((pk) => {
                    const won = pk.status === "won";
                    const lost = pk.status === "lost";
                    const winning = pk.status === "open" && status.live && pk.selection === leader;
                    const losing = pk.status === "open" && status.live && pk.selection !== leader;
                    const tone =
                      won || winning
                        ? "border-emerald/40 bg-[rgba(0,217,130,0.10)] text-emerald-deep"
                        : lost || losing
                          ? "border-coral/40 bg-[rgba(255,106,77,0.08)] text-coral"
                          : "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-ink";
                    const tag = won ? "won" : lost ? "lost" : winning ? "ahead" : losing ? "behind" : "open";
                    return (
                      <div
                        key={pk.id}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-[var(--radius-pill)] border px-3 py-2",
                          tone,
                        )}
                      >
                        <span className="font-display text-[15px] font-semibold tracking-tight">
                          {labelForSel(pk.selection)}
                        </span>
                        <span className="tnum font-display text-[14px] font-semibold">@ {pk.oddsAtLock.toFixed(2)}</span>
                        {pk.beatLine === true && (
                          <span aria-hidden title="Beat the line" className="text-emerald-deep">⚡</span>
                        )}
                        <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">{tag}</span>
                      </div>
                    );
                  })}
                </div>
              </motion.section>
            )}

            {/* ---- Result banner ---- */}
            <AnimatePresence>
              {result && (
                <motion.section
                  initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.36, ease: [0.2, 0.7, 0.3, 1] }}
                  className={cn(
                    "solid p-5",
                    result.correct ? "ring-2 ring-emerald/40" : "ring-2 ring-coral/30",
                  )}
                >
                  <p
                    className={cn(
                      "font-display text-[13px] font-semibold uppercase tracking-wide",
                      result.correct ? "text-emerald-deep" : "text-coral",
                    )}
                  >
                    {result.correct ? "Called it" : "Not this time"}
                  </p>
                  {result.oddsAtLock != null &&
                    (() => {
                      const phrase = impliedProbabilityPhrase(result.oddsAtLock);
                      const article = probabilityArticle(phrase);
                      const pct = Math.round(impliedProbabilityPct(result.oddsAtLock));
                      const against = result.correct && isAgainstMarket(result.oddsAtLock);
                      return (
                        <div className="mt-1.5">
                          {against && (
                            <span className="mb-1.5 inline-flex items-center rounded-[var(--radius-pill)] border border-coral/35 bg-[rgba(255,106,77,0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-coral">
                              Against the market
                            </span>
                          )}
                          <p className="text-[15px] font-medium text-ink">
                            {result.correct
                              ? `Bookies gave it ${article} ${phrase} shot`
                              : `The bookies had you at ${article} ${phrase} shot`}
                            <span className="tnum ml-1.5 text-[12px] font-medium text-ink-soft">
                              ({pct}% implied · {result.oddsAtLock.toFixed(2)}× decimal)
                            </span>
                          </p>
                        </div>
                      );
                    })()}
                  <p className="mt-2 font-display text-[26px] font-bold leading-tight tracking-tight text-ink">
                    {result.correct ? (
                      <>
                        <span className="tnum">+{result.points}</span> pts
                      </>
                    ) : (
                      "0 pts"
                    )}
                  </p>
                  <p className="mt-0.5 text-[15px] text-ink-soft">
                    {result.correct
                      ? `Streak at ${result.streak}. Lock in the trophy or share the call.`
                      : "The board moves on. There's always the next call."}
                  </p>
                  <Button
                    onClick={() => {
                      if (result.correct && shareTrophy) setShareOpen(true);
                      else router.push("/you");
                    }}
                    size="lg"
                    className="mt-4 w-full"
                  >
                    {result.correct ? "Mint & share ▸" : "Back to your profile ▸"}
                  </Button>
                </motion.section>
              )}
            </AnimatePresence>

            {/* ---- Beat the Line moment (SAH) — "the market came to you" ---- */}
            <AnimatePresence>
              {clvMoment && (
                <motion.section
                  initial={reduce ? false : { opacity: 0, scale: 0.94, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 480, damping: 24, mass: 0.7 }
                  }
                  className="solid relative overflow-hidden p-5 ring-2 ring-emerald/40"
                >
                  <button
                    type="button"
                    onClick={() => setClvMoment(null)}
                    aria-label="Dismiss"
                    className="absolute right-2.5 top-2.5 z-10 grid h-8 w-8 place-items-center rounded-full text-ink-soft transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                  <p className="relative font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald">
                    <span aria-hidden>⚡</span> Beat the line
                  </p>
                  <p className="relative mt-1.5 font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
                    The market came to you.
                  </p>
                  <p className="tnum relative mt-1.5 font-display text-[18px] font-semibold text-emerald-deep">
                    {(clvMoment.pctAtLock * 100).toFixed(1)}% → {(clvMoment.pctAtClose * 100).toFixed(1)}%
                  </p>
                  <p className="relative mt-1 text-[14px] leading-snug text-ink-soft">
                    Your call moved the sharp way before kickoff. The line came in by{" "}
                    <span className="tnum font-semibold text-ink">{clvMoment.clv.toFixed(1)} pts</span>.
                  </p>
                </motion.section>
              )}
            </AnimatePresence>

            {/* ---- TALISMAN moment (SAH) — "your Star Man scored" ---- */}
            <AnimatePresence>
              {talisman && (
                <motion.section
                  initial={reduce ? false : { opacity: 0, scale: 0.94, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 24, mass: 0.7 }}
                  className="solid relative overflow-hidden p-5 ring-2 ring-emerald/40"
                >
                  <button
                    type="button"
                    onClick={() => setTalisman(null)}
                    aria-label="Dismiss"
                    className="absolute right-2.5 top-2.5 z-10 grid h-8 w-8 place-items-center rounded-full text-ink-soft transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                  <p className="relative inline-flex items-center gap-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-gold" fill="currentColor" aria-hidden>
                      <path d="M12 2.6l2.7 5.6 6.1.85-4.45 4.3 1.06 6.05L12 20.6l-5.42 2.85 1.06-6.05L3.2 9.05l6.1-.85z" />
                    </svg>
                    Talisman
                  </p>
                  <p className="relative mt-1.5 font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
                    Your Star Man delivered.
                  </p>
                  <p className="relative mt-1.5 font-display text-[18px] font-semibold text-emerald-deep">
                    {talisman.name} scored.
                  </p>
                  <p className="relative mt-1 text-[14px] leading-snug text-ink-soft">
                    You named him before kickoff and he found the net. That call is on the board.
                  </p>
                </motion.section>
              )}
            </AnimatePresence>

            {/* ---- Pundit feed (glass bubbles) ---- */}
            <motion.section {...enter(2)}>
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                  Your pundit
                </p>
                {personaName && <span className="text-[12px] font-medium text-emerald-deep">{personaName}</span>}
              </div>

              {/* Ask the pundit — preset chips + free-text (SAH) */}
              <AskPundit fixtureId={fixtureId} token={token} onQuestion={onAskQuestion} onReply={onAskReply} />

              {punditLines.length === 0 ? (
                <div className="flex flex-col gap-3">
                  <div className="glass p-4 text-[15px] text-ink-soft">Your pundit is watching…</div>
                  {/* Between-moments dead-air filler — gone the instant commentary
                      starts landing above; never blocks the live core loop. */}
                  <TriviaCard seed={`live-${fixtureId}`} />
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  <AnimatePresence initial={false}>
                    {punditLines.map((p) => {
                      // The fan's own question — right-aligned, quiet, no share affordance.
                      if (p.kind === "question") {
                        return (
                          <motion.li
                            key={p.id}
                            layout={!reduce}
                            initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3, ease: [0.2, 0.7, 0.3, 1] }}
                            className="flex justify-end"
                          >
                            <div className="max-w-[85%] rounded-[var(--radius-md)] rounded-br-[4px] border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.05)] px-3.5 py-2">
                              <span className="mb-0.5 block text-right font-display text-[10px] font-semibold uppercase tracking-wide text-ink-soft/70">
                                You asked
                              </span>
                              <p className="text-[14px] leading-snug text-ink-soft">{p.line}</p>
                            </div>
                          </motion.li>
                        );
                      }
                      return (
                      <motion.li
                        key={p.id}
                        layout={!reduce}
                        initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.2, 0.7, 0.3, 1] }}
                        className="glass relative overflow-hidden p-4"
                      >
                        <p className="relative pr-9 text-[16px] leading-snug text-ink">{p.line}</p>
                        <button
                          type="button"
                          onClick={() => sharePundit(p)}
                          aria-label={sharedId === p.id ? "Shared" : "Share this line"}
                          className={cn(
                            "absolute right-2.5 top-2.5 z-10 grid h-8 w-8 place-items-center rounded-full transition-colors",
                            "text-ink-soft hover:bg-[rgba(255,255,255,0.06)] hover:text-ink",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
                            sharedId === p.id && "text-emerald-deep",
                          )}
                        >
                          {sharedId === p.id ? (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M4 12.5l5 5L20 6" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                              <path d="M12 3v13M8 7l4-4 4 4" />
                            </svg>
                          )}
                        </button>
                      </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </motion.section>

            {/* ---- Live rank peek + friends in the room (solid reading surface) ---- */}
            <motion.section {...enter(3)} className="solid p-5">
              <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Live table</p>
              {board.length === 0 ? (
                <p className="mt-3 text-[15px] text-ink-soft">No standings yet.</p>
              ) : (
                <ul className="mt-3 flex flex-col">
                  {top3.map((r) => (
                    <RankRow key={r.wallet} row={r} me={r.wallet === wallet} reduce={!!reduce} />
                  ))}
                  {myRow && myRow.rank > 3 && (
                    <>
                      <li aria-hidden className="my-1 text-center text-[12px] text-ink-soft/60">⋯</li>
                      <RankRow row={myRow} me reduce={!!reduce} />
                    </>
                  )}
                </ul>
              )}

              {/* friends in the room — league-mates' live calls on this match */}
              <div className="mt-4 border-t border-[rgba(255,255,255,0.08)] pt-4">
                <div className="flex items-center justify-between">
                  <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                    In the room
                  </p>
                  {room.length > 0 && (
                    <span className="tnum text-[12px] font-medium text-ink-soft/70">
                      {room.length} {room.length === 1 ? "league-mate" : "league-mates"}
                    </span>
                  )}
                </div>
                {room.length === 0 ? (
                  <p className="mt-2 text-[14px] leading-snug text-ink-soft">
                    No league-mates on this one yet. Invite your league and their calls show up here.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {room.map((f) => (
                      <RoomChip key={f.wallet} pick={f} leader={leader} live={status.live} label={labelForSel(f.selection)} />
                    ))}
                  </div>
                )}
              </div>
            </motion.section>
          </div>
        )}
      </div>

      {/* ---- Persistent pundit chip + scrollback drawer (SAH-77) ---- */}
      {!loading && fixture && token && (
        <PunditPanel
          fixtureId={fixtureId}
          token={token}
          liveLines={punditLines.filter((l) => l.kind !== "question")}
          personaName={personaName}
          onAskQuestion={onAskQuestion}
          onAskReply={onAskReply}
        />
      )}

      {/* ---- Share the moment (from "Mint & share") ---- */}
      <AnimatePresence>
        {shareOpen && shareTrophy ? (
          <ShareCard
            trophy={shareTrophy}
            nation={profile?.nation ?? null}
            referralCode={referralCodeFor(wallet)}
            onClose={() => setShareOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </AppShell>
  );
}

/* ----------------------------------------------------------- odds tick */
/**
 * A single live 1X2 price tile (spec §5.2). When the price changes the new
 * value rolls in from above (tl-odds) and the tile flashes emerald (drift down
 * = shorter = "more likely") or coral (drift up = longer) with a ▲/▼ marker.
 * prefers-reduced-motion → the value just swaps to its final state.
 */
function OddsTick({ label, value, reduce }: { label: string; value: number; reduce: boolean }) {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const [roll, setRoll] = useState(0); // bump to re-key the roll animation

  useEffect(() => {
    const before = prev.current;
    if (value !== before) {
      // odds DOWN = shorter price = backed more heavily → emerald
      setDir(value < before ? "down" : "up");
      setRoll((r) => r + 1);
      prev.current = value;
      const t = window.setTimeout(() => setDir(null), 900);
      return () => window.clearTimeout(t);
    }
  }, [value]);

  const flash = dir === "down" ? "text-emerald-deep" : dir === "up" ? "text-coral" : "text-ink";

  return (
    <div className="relative flex flex-col items-center gap-0.5 overflow-hidden rounded-[var(--radius-sm)] bg-[rgba(255,255,255,0.04)] py-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-soft">{label}</span>
      <span className="relative inline-flex items-center">
        <span
          key={reduce ? "static" : roll}
          className={cn(
            "tnum font-display text-[16px] font-semibold transition-colors duration-300",
            flash,
            !reduce && dir != null && "motion-safe:animate-[tl-odds_300ms_var(--ease-soft-settle)]",
          )}
        >
          {value.toFixed(2)}
        </span>
        {dir && !reduce ? (
          <span
            aria-hidden
            className={cn(
              "absolute -right-3 text-[11px] leading-none",
              dir === "down"
                ? "text-emerald-deep motion-safe:animate-[tl-arrowdn_900ms_ease-out]"
                : "text-coral motion-safe:animate-[tl-arrowup_900ms_ease-out]",
            )}
          >
            {dir === "down" ? "▼" : "▲"}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- rank row */

/**
 * RankRow — P1-1 tail. When the live board updates, the XP value counts up to
 * its new total and a ▲/▼ marker flashes if the rank moved (up = climbed). The
 * row briefly tints emerald on a climb. prefers-reduced-motion → instant final.
 */
function RankRow({ row, me, reduce }: { row: LeaderRow; me: boolean; reduce: boolean }) {
  const [xp, setXp] = useState(row.xp);
  const prevXp = useRef(row.xp);
  const prevRank = useRef(row.rank);
  const [rankDelta, setRankDelta] = useState<"up" | "down" | null>(null);

  // count-up XP on change (animated path only; reduced motion renders row.xp directly)
  useEffect(() => {
    if (reduce) return;
    const from = prevXp.current;
    const to = row.xp;
    if (from === to) return;
    prevXp.current = to;
    const start = performance.now();
    const dur = 600;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setXp(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [row.xp, reduce]);

  // rank-change marker (lower rank number = climbed)
  useEffect(() => {
    const before = prevRank.current;
    if (row.rank !== before) {
      setRankDelta(row.rank < before ? "up" : "down");
      prevRank.current = row.rank;
      const t = window.setTimeout(() => setRankDelta(null), 1100);
      return () => window.clearTimeout(t);
    }
  }, [row.rank]);

  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2.5 transition-colors duration-500",
        me && "bg-[rgba(0,217,130,0.08)]",
        rankDelta === "up" && !reduce && "bg-[rgba(0,217,130,0.12)]",
      )}
    >
      <span className="relative inline-flex w-7 items-center justify-center">
        <span className="tnum font-display text-[16px] font-bold text-ink-soft">{row.rank}</span>
        {rankDelta && !reduce ? (
          <span
            aria-hidden
            className={cn(
              "absolute -right-2 text-[11px] leading-none",
              rankDelta === "up"
                ? "text-emerald-deep motion-safe:animate-[tl-arrowup_1100ms_ease-out]"
                : "text-coral motion-safe:animate-[tl-arrowdn_1100ms_ease-out]",
            )}
          >
            {rankDelta === "up" ? "▲" : "▼"}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate font-display text-[16px] font-semibold tracking-tight text-ink">
        {row.displayName || `${row.wallet.slice(0, 4)}…${row.wallet.slice(-4)}`}
        {me && <span className="ml-2 text-[12px] font-medium uppercase tracking-wide text-emerald-deep">you</span>}
      </span>
      <span className="tnum font-display text-[16px] font-semibold text-ink">{(reduce ? row.xp : xp).toLocaleString()}</span>
    </li>
  );
}

/* -------------------------------------------------------------- room chip */

/**
 * RoomChip — a league-mate's live call on this match. Mirrors the "Your call"
 * chip language: emerald when their pick is ahead / has landed, coral when it's
 * behind / lost, neutral pre-match. Tint derives from the running score, so the
 * mini-board reads live even though the picks were locked pre-kickoff.
 */
function RoomChip({
  pick,
  leader,
  live,
  label,
}: {
  pick: RoomPick;
  leader: Selection;
  live: boolean;
  label: string;
}) {
  const won = pick.status === "won";
  const lost = pick.status === "lost";
  const open = pick.status === "open" || pick.status === "void";
  const ahead = open && live && pick.selection === leader;
  const behind = open && live && pick.selection !== leader;
  const tone =
    won || ahead
      ? "border-emerald/40 bg-[rgba(0,217,130,0.10)]"
      : lost || behind
        ? "border-coral/40 bg-[rgba(255,106,77,0.08)]"
        : "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)]";
  const tagTone = won || ahead ? "text-emerald-deep" : lost || behind ? "text-coral" : "text-ink-soft";
  const tag = won ? "won" : lost ? "lost" : ahead ? "ahead" : behind ? "behind" : "in";
  const name = pick.displayName || `${pick.wallet.slice(0, 4)}…${pick.wallet.slice(-4)}`;
  return (
    <div className={cn("inline-flex max-w-full items-center gap-2 rounded-[var(--radius-pill)] border px-3 py-2", tone)}>
      <span className="max-w-[7.5rem] truncate font-display text-[14px] font-semibold tracking-tight text-ink">
        {name}
      </span>
      <span className={cn("truncate font-display text-[14px] font-semibold", tagTone)}>{label}</span>
      <span className={cn("text-[10px] font-medium uppercase tracking-wide opacity-80", tagTone)}>{tag}</span>
    </div>
  );
}

/* ------------------------------------------------------------- goal burst */

// Brand-token dots, not emoji confetti — keeps the celebratory spray inside
// the monochrome + one-accent system instead of full-colour cartoon glyphs
// (SAH-36 de-emoji sweep). Same radial trajectory math as before.
const GOAL_PARTICLE_COUNT = 12;
const GOAL_COLORS = ["var(--emerald)", "var(--cyan)", "var(--gold)", "var(--coral)"];
const GOAL_PARTICLES = Array.from({ length: GOAL_PARTICLE_COUNT }, (_, i) => {
  const angle = (i / GOAL_PARTICLE_COUNT) * Math.PI * 2 + Math.PI / 6;
  const dist = 78 + (i % 4) * 26;
  return {
    color: GOAL_COLORS[i % GOAL_COLORS.length]!,
    gx: Math.round(Math.cos(angle) * dist),
    gy: Math.round(Math.sin(angle) * dist) - 26, // bias the spray upward
    size: 7 + (i % 3) * 3,
    delay: (i % 5) * 45,
  };
});

/**
 * GoalBurst — the shared-moment reaction when the room's match scores. A spray
 * of brand-tone dot particles fans out from the scoreboard centre behind a
 * "GOAL!" cry. motion-safe only; reduced motion gets a static, non-animated
 * badge that still reads.
 */
function GoalBurst({ reduce }: { reduce: boolean }) {
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
