"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { FieldBackground } from "@/components/FieldBackground";
import { Wordmark } from "@/components/Wordmark";
import { GlassCard } from "@/components/ui/GlassCard";
import { MatchCard } from "@/components/ui/MatchCard";
import { StreakChip } from "@/components/ui/StreakChip";
import { LineMove } from "@/components/marketing/LineMove";
import { DemoLeague } from "@/components/marketing/DemoLeague";

/* ============================================================================
   Touchline marketing landing — the public front door (no wallet).

   Narrative spine: BEAT THE LINE. Every fan thinks they read the game better
   than the bookies; Touchline is where you prove it — on-chain, not a sportsbook.
   Hero = the proven-right hook + the "market came to you" money shot (LineMove).
   Then three acts: call it before the market does → watch the pundit sweat it
   live → get proven right on-chain. Closes on the Demo League (social proof).

   Stadium Night, mobile-first, broadcast. Motion: hero children fade+rise
   (stagger), scroll-triggered section reveals, one signature moment (LineMove),
   hover micro on cards, full prefers-reduced-motion fallbacks.
   ========================================================================== */

const CTA_PRIMARY =
  "inline-flex items-center justify-center gap-2 select-none font-display font-semibold uppercase tracking-wide " +
  "rounded-[var(--radius-sm)] min-h-[52px] px-7 text-base bg-emerald text-on-emerald glow-emerald " +
  "transition-[transform,background-color] duration-[var(--dur-micro)] hover:bg-emerald-deep active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

const CTA_GHOST =
  "inline-flex items-center justify-center gap-2 select-none font-display font-semibold uppercase tracking-wide " +
  "rounded-[var(--radius-sm)] min-h-[52px] px-6 text-base text-ink border border-[rgba(255,255,255,0.16)] " +
  "transition-colors duration-[var(--dur-micro)] hover:border-emerald/70 hover:text-emerald-deep " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/* The pundit cycles a few ambient reactions until a visitor taps a call in Act 2. */
const PUNDIT_LINES = [
  "Backing Japan at 5.40, bold. The bookies give them a 1-in-5 shot.",
  "If this one lands, it's the biggest call of your tournament.",
  "Spain are pushing, but your underdog is still alive. Hold your nerve.",
];

/* Mini interactive pick (Act 2) — the actual live mechanic, in the page.
   Tap a call and the pundit reacts to *your* pick, not a scripted line. */
type DemoPick = "1" | "X" | "2";

const DEMO_OUTCOMES: Record<DemoPick, { odds: number; tag: string; line: string }> = {
  "1": {
    odds: 5.4,
    tag: "Long shot",
    line: "Backing Japan at 5.40, bold. The bookies give them about a 1-in-5 shot. If the line moves your way, you beat it.",
  },
  X: {
    odds: 3.6,
    tag: "Hedge",
    line: "Calling the draw at 3.60. Safer than the long shot, and the market barely rates it a coin-flip.",
  },
  "2": {
    odds: 1.7,
    tag: "Favourite",
    line: "Spain to win at 1.70, the safe money. The market already agrees, so there's little line left to beat.",
  },
};

/* ---- Line icons (no emoji) ---- */
function IconOdds() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="var(--emerald-deep)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
    </svg>
  );
}
function IconPundit() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 16.5H9.5L5 20.5V16.5H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5Z" />
      <path d="M7.5 10.5h9M7.5 13h5.5" />
    </svg>
  );
}
function IconTrophy() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 4.5h10v4a5 5 0 0 1-10 0v-4Z" />
      <path d="M7 6H4.5v1.5A3 3 0 0 0 7 10.4M17 6h2.5v1.5A3 3 0 0 1 17 10.4M9.5 14.4 9 18h6l-.5-3.6M7.5 21h9" />
    </svg>
  );
}

/* Act 3 payoff ledger — how "proven right" is scored. */
const PROOF = [
  {
    k: "Points",
    t: "Odds-weighted points",
    d: "Longer the odds you called, bigger the score. Reading the game is the whole game. Never luck, never money down.",
    accent: "text-emerald-deep",
  },
  {
    k: "+25%",
    t: "Sharp bonus",
    d: "Land a call the market moved toward and you beat the line, a +25% bonus on top. That's the sharp read, pure skill.",
    accent: "text-emerald-deep",
  },
  {
    k: "Rating",
    t: "Your Sharp Rating",
    d: "Every call is graded against the closing line and rolled into one number. Foresight, tracked over the tournament, not a lucky night.",
    accent: "text-cyan",
  },
  {
    k: "Trophy",
    t: "On-chain receipts",
    d: "Read a long shot right and the moment mints an on-chain trophy on Solana, free, never bought. Proof you called it, that no one can argue with.",
    accent: "text-gold",
  },
];

export default function Landing() {
  const reduce = useReducedMotion();
  const [line, setLine] = useState(0);
  const [demoPick, setDemoPick] = useState<DemoPick | null>(null);

  // Ambient pundit chatter — pauses the moment a visitor tries the Act 2 pick.
  useEffect(() => {
    if (reduce || demoPick) return;
    const t = setInterval(() => setLine((l) => (l + 1) % PUNDIT_LINES.length), 3400);
    return () => clearInterval(t);
  }, [reduce, demoPick]);

  // Scroll-reveal helper — one soft-settle rise per section child.
  const rise = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-70px" } as const,
    transition: { duration: 0.5, ease: [0.2, 0.7, 0.3, 1] as const, delay: reduce ? 0 : i * 0.06 },
  });

  return (
    <div className="relative min-h-dvh">
      <FieldBackground />

      <div className="mx-auto w-full max-w-[1100px] px-5 sm:px-8">
        {/* ---- Top bar ---- */}
        <header className="flex items-center justify-between gap-3 py-5">
          <Wordmark size="sm" />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <nav className="hidden items-center gap-1 sm:flex" aria-label="Marketing">
              <Link
                href="/how-it-works"
                className="rounded-[var(--radius-sm)] px-3 py-2 font-display text-[14px] font-semibold uppercase tracking-wide text-ink-soft transition-colors duration-[var(--dur-micro)] hover:text-ink"
              >
                How it works
              </Link>
              <Link
                href="/why-touchline"
                className="rounded-[var(--radius-sm)] px-3 py-2 font-display text-[14px] font-semibold uppercase tracking-wide text-ink-soft transition-colors duration-[var(--dur-micro)] hover:text-ink"
              >
                Why Touchline
              </Link>
            </nav>
            <Link href="/play" className={`${CTA_GHOST} min-h-[44px] px-4 text-[14px]`}>
              Play free
            </Link>
          </div>
        </header>

        {/* ============================ HERO ============================ */}
        <section className="grid items-center gap-10 pt-6 pb-16 lg:grid-cols-[1.02fr_0.98fr] lg:gap-12 lg:pt-12">
          {/* Copy — the proven-right hook */}
          <div className="max-w-[34rem]">
            <motion.p
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.2, 0.7, 0.3, 1] }}
              className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald glow-emerald" />
              World Cup 2026 · Free · Powered by TxLINE
            </motion.p>

            <motion.h1
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.2, 0.7, 0.3, 1], delay: 0.05 }}
              className="mt-5 font-display text-[clamp(2.5rem,6.6vw,3.6rem)] font-bold leading-[1] tracking-tight text-ink"
            >
              You think you know better
              <br />
              than the bookies.{" "}
              <span className="text-emerald">Prove it.</span>
            </motion.h1>

            <motion.p
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.2, 0.7, 0.3, 1], delay: 0.12 }}
              className="mt-5 text-[18px] leading-relaxed text-ink-soft"
            >
              Touchline scores every call against the live market itself. Make
              your pick, and at kickoff we stamp the closing line. If the market moved{" "}
              <span className="text-ink">your</span> way, you beat it.{" "}
              <span className="text-ink">It&rsquo;s not a sportsbook. It&rsquo;s being proven right, on the record.</span>
            </motion.p>

            <motion.div
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.2, 0.7, 0.3, 1], delay: 0.18 }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Link href="/play" className={CTA_PRIMARY}>
                Play free <span aria-hidden>▸</span>
              </Link>
              <a href="#act1" className={CTA_GHOST}>
                How it works
              </a>
            </motion.div>

            <motion.p
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.28 }}
              className="mt-5 text-[13px] font-medium text-ink-soft"
            >
              No money down, no sign-up wall. Big calls earn an on-chain trophy,{" "}
              <span className="text-ink">the receipt that proves you called it.</span> Live data by{" "}
              <span className="text-ink">TxLINE</span>, on{" "}
              <span className="text-ink font-semibold">Solana</span>.
            </motion.p>
          </div>

          {/* The money shot — Beat the Line, enacted */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.2, 0.7, 0.3, 1], delay: 0.18 }}
            className="relative mx-auto w-full max-w-[440px]"
          >
            <div className="absolute -top-4 right-1 z-20">
              <StreakChip count={6} />
            </div>
            <LineMove team="Japan" from={22} to={31} loop />
            <p className="mt-3 px-1 text-[13px] leading-relaxed text-ink-soft">
              <span className="text-ink">The market came to you.</span> You said 22%,
              by kickoff it said 31%. That gap is your edge, scored and on record.
            </p>
          </motion.div>
        </section>

        {/* ==================== ACT 1 — CALL IT BEFORE THE MARKET ==================== */}
        <section id="act1" className="scroll-mt-20 border-t border-[rgba(255,255,255,0.06)] py-16">
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12">
            <div>
              <motion.p {...rise(0)} className="font-display text-[13px] font-semibold uppercase tracking-wide text-emerald-deep">
                Act one · foresight
              </motion.p>
              <motion.h2 {...rise(1)} className="mt-2 max-w-[22ch] font-display text-[clamp(1.9rem,4.4vw,2.5rem)] font-bold leading-[1.05] tracking-tight text-ink">
                Call it before the market does.
              </motion.h2>
              <motion.p {...rise(2)} className="mt-4 max-w-[46ch] text-[16px] leading-relaxed text-ink-soft">
                Anyone can call the favourite once the odds are short. The skill is
                seeing it early, backing a call the market hasn&rsquo;t caught up to yet.
                Points scale with the odds you beat, so a long shot that lands scores big.
                You&rsquo;re not playing the game. You&rsquo;re racing the market to the truth.
              </motion.p>
              <motion.p {...rise(3)} className="mt-4 inline-flex items-center gap-2 text-[13px] font-medium text-ink">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald glow-emerald" />
                No money in. No sign-up wall. Guests can call it in two taps.
              </motion.p>
            </div>

            {/* a call, made — static supporting card */}
            <motion.div {...rise(2)} className="relative mx-auto w-full max-w-[400px]">
              <div className="absolute -top-3 left-4 z-10 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-coral/50 bg-[rgba(255,106,77,0.10)] px-3 py-1.5 font-display text-[12px] font-semibold uppercase tracking-wide text-coral">
                Long shot · +54 pts
              </div>
              <MatchCard
                home="Japan"
                away="Spain"
                kickoff="20:00"
                group="World Cup · Group E"
                outcomes={[
                  { label: "1", odds: 5.4, variant: "selected" },
                  { label: "X", odds: 3.6, variant: "default" },
                  { label: "2", odds: 1.7, variant: "default" },
                ]}
              />
            </motion.div>
          </div>
        </section>

        {/* ==================== ACT 2 — THE PUNDIT SWEATS IT WITH YOU ==================== */}
        <section className="border-t border-[rgba(255,255,255,0.06)] py-16">
          <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-12">
            {/* interactive: tap a call, the pundit reacts to *yours* */}
            <motion.div {...rise(1)} className="relative order-2 mx-auto w-full max-w-[440px] lg:order-1">
              <div className="absolute -top-3 left-4 z-20">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={demoPick ?? "idle"}
                    initial={reduce ? false : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className={
                      "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5 " +
                      "font-display text-[12px] font-semibold uppercase tracking-wide " +
                      (demoPick
                        ? "border-emerald/50 bg-[rgba(0,224,138,0.12)] text-emerald-deep"
                        : "border-coral/40 bg-[rgba(255,106,77,0.10)] text-coral")
                    }
                  >
                    {demoPick ? DEMO_OUTCOMES[demoPick].tag : "Tap a call ↓"}
                  </motion.span>
                </AnimatePresence>
              </div>

              <MatchCard
                home="Japan"
                away="Spain"
                kickoff="20:00"
                group="World Cup · Group E"
                outcomes={[
                  { label: "1", odds: 5.4, variant: demoPick === "1" ? "selected" : demoPick ? "default" : "long-shot" },
                  { label: "X", odds: 3.6, variant: demoPick === "X" ? "selected" : "default" },
                  { label: "2", odds: 1.7, variant: demoPick === "2" ? "selected" : "default" },
                ]}
                onPick={(label) =>
                  setDemoPick((cur) => (cur === label ? null : (label as DemoPick)))
                }
              />

              <GlassCard className="relative z-10 -mt-3 ml-4 mr-2 flex items-start gap-3 p-3.5">
                <span
                  aria-hidden
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-[rgba(43,229,255,0.12)] text-cyan"
                >
                  <IconPundit />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="font-display text-[10px] font-semibold uppercase tracking-wide text-cyan">
                    Your pundit · live
                  </p>
                  <div className="relative mt-1 min-h-[3.25rem]">
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={demoPick ?? line}
                        initial={reduce ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduce ? undefined : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.32, ease: [0.2, 0.7, 0.3, 1] }}
                        className="text-[14px] leading-snug text-ink"
                      >
                        {demoPick ? DEMO_OUTCOMES[demoPick].line : PUNDIT_LINES[line]}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                </div>
              </GlassCard>
            </motion.div>

            <div className="order-1 lg:order-2">
              <motion.p {...rise(0)} className="font-display text-[13px] font-semibold uppercase tracking-wide text-cyan">
                Act two · the room
              </motion.p>
              <motion.h2 {...rise(1)} className="mt-2 max-w-[22ch] font-display text-[clamp(1.9rem,4.4vw,2.5rem)] font-bold leading-[1.05] tracking-tight text-ink">
                Watch the pundit sweat it live with you.
              </motion.h2>
              <motion.p {...rise(2)} className="mt-4 max-w-[46ch] text-[16px] leading-relaxed text-ink-soft">
                The second you lock a call, your own AI commentator takes over,
                narrating <span className="text-ink">your</span> pick as the match swings,
                reacting to goals, cards and the odds moving against you or coming to you.
                It&rsquo;s not the score read back. It&rsquo;s a match narrated around your call.
              </motion.p>
              <motion.p {...rise(3)} className="mt-4 text-[13px] font-medium text-ink-soft">
                Tap a call on the card and the pundit reacts to what you picked, right here.
              </motion.p>
            </div>
          </div>
        </section>

        {/* ==================== ACT 3 — GET PROVEN RIGHT ON-CHAIN ==================== */}
        <section className="border-t border-[rgba(255,255,255,0.06)] py-16">
          <motion.p {...rise(0)} className="font-display text-[13px] font-semibold uppercase tracking-wide text-gold">
            Act three · the payoff
          </motion.p>
          <motion.h2 {...rise(1)} className="mt-2 max-w-[24ch] font-display text-[clamp(1.9rem,4.4vw,2.5rem)] font-bold leading-[1.05] tracking-tight text-ink">
            Get proven right, on-chain.
          </motion.h2>
          <motion.p {...rise(2)} className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-ink-soft">
            Picks settle on the final whistle, scored against the closing line. Beat it
            and you don&rsquo;t just win points, you build a record no one can wave away.
          </motion.p>

          <div className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2">
            {PROOF.map((p, i) => (
              <motion.div
                key={p.t}
                {...rise(i + 2)}
                className="group flex flex-col gap-2 border-t border-[rgba(255,255,255,0.10)] pt-5 transition-colors duration-[var(--dur-short)] hover:border-emerald/40"
              >
                <div className="flex items-baseline gap-3">
                  <span className={`font-display text-[15px] font-bold uppercase tracking-wide ${p.accent} tnum`}>
                    {p.k}
                  </span>
                  <h3 className="font-display text-[19px] font-semibold tracking-tight text-ink">{p.t}</h3>
                </div>
                <p className="text-[15px] leading-relaxed text-ink-soft">{p.d}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ============================ DEMO LEAGUE (social proof) ============================ */}
        <DemoLeague />

        {/* ============================ NOT A SPORTSBOOK ============================ */}
        <section className="py-10">
          <motion.div {...rise(0)}>
            <GlassCard className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-7">
              <p className="font-display text-[20px] font-semibold leading-tight tracking-tight text-ink sm:shrink-0">
                The rewards are emotional, never financial.
              </p>
              <p className="text-[15px] leading-relaxed text-ink-soft">
                No money in, no money out. You play for the streak, the rank, the Sharp
                Rating and the trophy: a fan companion, not a sportsbook. Nothing to lose
                but bragging rights.
              </p>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============================ FINAL CTA ============================ */}
        <section className="py-16 text-center">
          <motion.h2 {...rise(0)} className="mx-auto max-w-[26rem] font-display text-[clamp(2rem,6vw,2.75rem)] font-bold leading-[1.02] tracking-tight text-ink">
            Think you read it better?
          </motion.h2>
          <motion.p {...rise(1)} className="mx-auto mt-3 max-w-[30rem] text-[15px] leading-relaxed text-ink-soft">
            One call is all it takes to find out. Free, no wallet to start.
          </motion.p>
          <motion.div {...rise(2)} className="mt-7 flex justify-center">
            <Link href="/play" className={CTA_PRIMARY}>
              Play free <span aria-hidden>▸</span>
            </Link>
          </motion.div>
          <motion.p {...rise(3)} className="mt-4 text-[13px] font-medium text-ink-soft">
            Free forever · Beat the line · Prove you called it
          </motion.p>
        </section>

        {/* ============================ FOOTER ============================ */}
        <footer className="flex flex-col items-center justify-between gap-4 border-t border-[rgba(255,255,255,0.06)] py-8 sm:flex-row">
          <div className="flex items-center gap-5">
            <Wordmark size="sm" />
            <nav className="flex items-center gap-4" aria-label="Footer">
              <Link href="/how-it-works" className="text-[13px] font-medium text-ink-soft transition-colors hover:text-ink">
                How it works
              </Link>
              <Link href="/why-touchline" className="text-[13px] font-medium text-ink-soft transition-colors hover:text-ink">
                Why Touchline
              </Link>
            </nav>
          </div>
          <p className="text-center text-[12px] leading-relaxed text-ink-soft sm:text-right">
            Powered by <span className="text-ink">TxLINE</span> live football data ·
            Trophies on <span className="text-ink">Solana</span> (devnet) ·
            Built for the TxODDS World Cup hackathon.
          </p>
        </footer>
      </div>
    </div>
  );
}
