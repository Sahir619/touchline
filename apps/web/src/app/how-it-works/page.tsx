"use client";

import Link from "next/link";
import { FieldBackground } from "@/components/FieldBackground";
import { GlassCard } from "@/components/ui/GlassCard";
import {
  MarketingNav,
  MarketingFooter,
  CTA_PRIMARY,
  CTA_GHOST,
} from "@/components/marketing/MarketingChrome";
import { Reveal, Stagger, StaggerItem } from "@/components/marketing/motion";
import { LineMove } from "@/components/marketing/LineMove";

/* ============================================================================
   How it works — the fan-simple four-step walk. Pick → Lock at kickoff → Live
   with the pundit → Proven right. Number-light, screenshot-free, plain English.
   One sidebar unpacks "beat the line" in a single concrete example.
   Public marketing page (no wallet). Stadium Night, mobile-first.
   ========================================================================== */

function IconTrophy() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 4.5h10v4a5 5 0 0 1-10 0v-4Z" />
      <path d="M7 6H4.5v1.5A3 3 0 0 0 7 10.4M17 6h2.5v1.5A3 3 0 0 1 17 10.4M9.5 14.4 9 18h6l-.5-3.6M7.5 21h9" />
    </svg>
  );
}

const STEPS = [
  {
    n: "1",
    kicker: "Pick",
    accent: "text-emerald-deep",
    title: "Make your calls",
    body: "Open the day's card and call a winner on the matches you fancy, priced on live World Cup odds from TxLINE. Back the favourite for a safe, small score, or a long shot for a big one. It takes two taps, and guests don't need a wallet.",
    aside: "Points reward how well you read the game. Never luck, never money down.",
  },
  {
    n: "2",
    kicker: "Lock at kickoff",
    accent: "text-coral",
    title: "The whistle locks it in",
    body: "At kickoff your call is locked and we stamp the market's closing line, the last, sharpest price before the game. That snapshot is what your call gets measured against. No editing, no hindsight: your read is on the record from the first whistle.",
    aside: "Locked on server time at kickoff, the same line for everyone.",
  },
  {
    n: "3",
    kicker: "Live with the pundit",
    accent: "text-cyan",
    title: "Your commentator takes over",
    body: "As the match runs, your own AI pundit narrates your pick, reacting to goals, cards, and the odds swinging for or against you. It's not the scoreboard read back. It's the one voice in the room actually watching your call.",
    aside: "One tap to the group chat: screenshot the moment, share the link.",
  },
  {
    n: "4",
    kicker: "Proven right",
    accent: "text-gold",
    title: "Points, streaks, rating, trophies",
    body: "On the final whistle your call settles against that closing line. Win and you score odds-weighted points; beat the line and a +25% sharp bonus stacks on top. Your Sharp Rating climbs, your streak extends, and a big long-shot win mints an on-chain trophy, free, and yours to keep.",
    aside: "The trophy's just the receipt: proof you called it, that no one can argue with.",
  },
];

export default function HowItWorks() {
  return (
    <div className="relative min-h-dvh">
      <FieldBackground />

      <div className="mx-auto w-full max-w-[1100px] px-5 pb-6 sm:px-8">
        <MarketingNav />

        {/* ============================ HERO ============================ */}
        <section className="grid items-center gap-10 pb-14 pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:pt-16">
          <div className="max-w-[34rem]">
            <Reveal as="p" className="font-display text-[13px] font-semibold uppercase tracking-wide text-emerald-deep">
              How it works
            </Reveal>
            <Reveal
              as="h1"
              delay={0.05}
              className="mt-3 font-display text-[clamp(2.4rem,6.4vw,3.4rem)] font-bold leading-[1] tracking-tight text-ink"
            >
              Four taps to <span className="text-emerald">proven right.</span>
            </Reveal>
            <Reveal as="p" delay={0.12} className="mt-5 text-[18px] leading-relaxed text-ink-soft">
              Pick, lock at kickoff, watch it live with the pundit, and get proven
              right when the whistle blows.{" "}
              <span className="text-ink">Not a penny changes hands. It&rsquo;s not a sportsbook, it&rsquo;s being right on the record.</span>
            </Reveal>
            <Reveal delay={0.18} className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/play" className={CTA_PRIMARY}>
                Play free <span aria-hidden>▸</span>
              </Link>
              <a href="#steps" className={CTA_GHOST}>
                See the four steps
              </a>
            </Reveal>
          </div>

          {/* the money shot — beat the line, plays once in view */}
          <Reveal delay={0.14} className="mx-auto w-full max-w-[420px]">
            <LineMove team="Japan" from={22} to={31} loop={false} />
          </Reveal>
        </section>

        {/* ============================ FOUR STEPS ============================ */}
        <section id="steps" className="scroll-mt-24 border-t border-[rgba(255,255,255,0.06)] py-14">
          <Stagger className="flex flex-col gap-5" gap={0.09}>
            {STEPS.map((b) => (
              <StaggerItem key={b.n}>
                <GlassCard className="grid gap-5 p-6 transition-colors duration-[var(--dur-short)] hover:border-emerald/30 sm:grid-cols-[auto_1fr] sm:gap-7 sm:p-8">
                  <div className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-3">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[rgba(255,255,255,0.05)] font-display text-[28px] font-bold text-ink tnum">
                      {b.n}
                    </span>
                    <span className={`font-display text-[13px] font-semibold uppercase tracking-wide ${b.accent}`}>
                      {b.kicker}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-[clamp(1.4rem,3.4vw,1.85rem)] font-semibold leading-tight tracking-tight text-ink">
                      {b.title}
                    </h2>
                    <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-ink-soft">
                      {b.body}
                    </p>
                    <p className="mt-4 inline-flex items-start gap-2 border-t border-[rgba(255,255,255,0.08)] pt-4 text-[13px] font-medium text-ink">
                      <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald glow-emerald" />
                      {b.aside}
                    </p>
                  </div>
                </GlassCard>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ==================== "BEAT THE LINE" — PLAIN ENGLISH ==================== */}
        <section className="border-t border-[rgba(255,255,255,0.06)] py-14">
          <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-12">
            <Reveal>
              <p className="font-display text-[13px] font-semibold uppercase tracking-wide text-emerald-deep">
                In plain English
              </p>
              <h2 className="mt-2 max-w-[20ch] font-display text-[clamp(1.75rem,4vw,2.35rem)] font-bold leading-[1.05] tracking-tight text-ink">
                What &ldquo;beat the line&rdquo; actually means.
              </h2>
              <p className="mt-4 max-w-[48ch] text-[16px] leading-relaxed text-ink-soft">
                When you call a team, the market gives them a chance, say{" "}
                <span className="text-ink">22%</span>. If, by kickoff, everyone else has
                piled in and the market now rates them{" "}
                <span className="text-ink">31%</span>, the market moved{" "}
                <span className="text-ink">toward your call</span> after you made it.
              </p>
              <p className="mt-3 max-w-[48ch] text-[16px] leading-relaxed text-ink-soft">
                That&rsquo;s the whole idea: <span className="text-ink">the market came to you.</span>{" "}
                You saw it before the crowd did. Sharp traders call that closing-line value,
                the truest measure of skill, because it means you were right{" "}
                <span className="text-ink">early</span>. Touchline scores it for you, adds a
                sharp bonus when your call lands, and rolls it into your Sharp Rating.
                No money down, no sportsbook, just the record of a read that was ahead of the room.
              </p>
            </Reveal>

            <Reveal delay={0.08} className="mx-auto w-full max-w-[420px]">
              <LineMove team="Japan" from={22} to={31} loop />
            </Reveal>
          </div>
        </section>

        {/* ============================ NOT A SPORTSBOOK ============================ */}
        <section className="py-8">
          <Reveal>
            <GlassCard className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-7">
              <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[rgba(242,179,60,0.12)] text-gold">
                <IconTrophy />
              </span>
              <div>
                <p className="font-display text-[20px] font-semibold leading-tight tracking-tight text-ink">
                  The rewards are emotional, never financial.
                </p>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
                  No money in, no money out. You play for the streak, the rank, the Sharp
                  Rating and the trophy: a fan companion, not a sportsbook. Every trophy is
                  free to mint and proven on-chain: you win them by being right, you never buy them.
                </p>
              </div>
            </GlassCard>
          </Reveal>
        </section>

        {/* ============================ FINAL CTA ============================ */}
        <section className="py-14 text-center">
          <Reveal as="h2" className="mx-auto max-w-[26rem] font-display text-[clamp(2rem,6vw,2.75rem)] font-bold leading-[1.02] tracking-tight text-ink">
            Ready to make your first call?
          </Reveal>
          <Reveal delay={0.06} className="mt-7 flex justify-center">
            <Link href="/play" className={CTA_PRIMARY}>
              Play free <span aria-hidden>▸</span>
            </Link>
          </Reveal>
          <Reveal as="p" delay={0.12} className="mt-4 text-[13px] font-medium text-ink-soft">
            Free forever · No wallet needed to start
          </Reveal>
        </section>

        <MarketingFooter />
      </div>
    </div>
  );
}
