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
import { Reveal, Stagger, StaggerItem, Parallax } from "@/components/marketing/motion";

/* ============================================================================
   Why Touchline — the positioning page. Against pick'em (they score luck; we
   score foresight vs a live consensus market), against fantasy (no squads, 30
   seconds a day), and the on-chain-receipts angle (provable, not screenshots).
   Closes on the TxLINE live-data credibility beat.
   ========================================================================== */

function IconOdds() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="var(--emerald-deep)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
    </svg>
  );
}
function IconChip() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
      <path d="M9.5 3.5v2M14.5 3.5v2M9.5 18.5v2M14.5 18.5v2M3.5 9.5h2M3.5 14.5h2M18.5 9.5h2M18.5 14.5h2" />
    </svg>
  );
}
function IconTrophy() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 4.5h10v4a5 5 0 0 1-10 0v-4Z" />
      <path d="M7 6H4.5v1.5A3 3 0 0 0 7 10.4M17 6h2.5v1.5A3 3 0 0 1 17 10.4M9.5 14.4 9 18h6l-.5-3.6M7.5 21h9" />
    </svg>
  );
}

/* The three positioning contrasts — one clean line of separation each. */
const COMPARE = [
  {
    them: "Pick'em apps",
    they: "Everyone picks the same favourites, so it comes down to luck on the day, a coin-flip dressed up as a contest.",
    us: "Your call is scored against a live consensus market. Being right early, before the odds move, is the skill, and it's the whole game.",
  },
  {
    them: "Fantasy",
    they: "Draft a squad, manage it for a whole season, and wait months to find out if you were right.",
    us: "No squads, no season-long grind. One match, one call, one result: 30 seconds a day and you're in.",
  },
  {
    them: "The group chat",
    they: "Your hot take scrolls away by full-time, and the screenshot proves nothing. Anyone can crop a win.",
    us: "Your best calls are signed on-chain. Provable receipts, not screenshots: a record no one can crop, delete or argue with.",
  },
];

const TRIO = [
  {
    icon: <IconOdds />,
    title: "Foresight, not luck",
    body: "Points scale with the odds you beat and the line you move. Reading the game early is measurable, and it's the only thing that scores.",
  },
  {
    icon: <IconChip />,
    title: "A live, personal pundit",
    body: "A commentator that reacts to your pick in real time, not the broadcast feed, not the scoreboard. The one voice actually watching your call.",
  },
  {
    icon: <IconTrophy />,
    title: "An earned on-chain record",
    body: "Trophies you win, not buy: minted free on Solana, proven on-chain. A receipt for the calls you got right that lives forever.",
  },
];

export default function WhyTouchline() {
  return (
    <div className="relative min-h-dvh">
      <FieldBackground />

      <div className="mx-auto w-full max-w-[1100px] px-5 pb-6 sm:px-8">
        <MarketingNav />

        {/* ============================ HERO ============================ */}
        <section className="grid items-center gap-10 pb-14 pt-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:pt-16">
          <div className="max-w-[36rem]">
            <Reveal as="p" className="font-display text-[13px] font-semibold uppercase tracking-wide text-emerald-deep">
              Why Touchline
            </Reveal>
            <Reveal
              as="h1"
              delay={0.05}
              className="mt-3 font-display text-[clamp(2.4rem,6.2vw,3.4rem)] font-bold leading-[1] tracking-tight text-ink"
            >
              Every fan thinks they know better than the bookies.{" "}
              <span className="text-emerald">Here you prove it.</span>
            </Reveal>
            <Reveal as="p" delay={0.12} className="mt-5 text-[18px] leading-relaxed text-ink-soft">
              Not a sportsbook. Not fantasy. Not another pick&rsquo;em coin-flip. Touchline
              scores your read against a live consensus market and signs your best calls
              on-chain, so being right isn&rsquo;t a claim, it&rsquo;s a{" "}
              <span className="text-ink">receipt</span>.
            </Reveal>
            <Reveal delay={0.18} className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/play" className={CTA_PRIMARY}>
                Play free <span aria-hidden>▸</span>
              </Link>
              <Link href="/how-it-works" className={CTA_GHOST}>
                How it works
              </Link>
            </Reveal>
          </div>

          <Parallax className="mx-auto w-full max-w-[380px]" distance={24}>
            <GlassCard className="p-5">
              <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                Matchday group chat
              </p>
              <div className="mt-4 flex flex-col gap-3">
                <div className="max-w-[85%] rounded-[var(--radius-md)] rounded-tl-sm bg-[rgba(255,255,255,0.05)] px-3.5 py-2.5 text-[14px] leading-snug text-ink">
                  Japan are cooked, no chance
                </div>
                <div className="ml-auto max-w-[88%] rounded-[var(--radius-md)] rounded-tr-sm border border-emerald/40 bg-[rgba(0,224,138,0.10)] px-3.5 py-2.5 text-[14px] leading-snug text-ink">
                  Called Japan at 5.40. Market&rsquo;s already moved to me.{" "}
                  <span className="text-emerald-deep">On record, on-chain ✍️</span>
                </div>
                <div className="max-w-[85%] rounded-[var(--radius-md)] rounded-tl-sm bg-[rgba(255,255,255,0.05)] px-3.5 py-2.5 text-[14px] leading-snug text-ink">
                  wait how do I get in
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-[rgba(255,255,255,0.08)] pt-3">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-coral" />
                <p className="text-[12px] font-medium text-ink-soft">
                  Every shared moment carries an invite. Friends who join lift your rank.
                </p>
              </div>
            </GlassCard>
          </Parallax>
        </section>

        {/* ============================ THE CONTRASTS ============================ */}
        <section className="border-t border-[rgba(255,255,255,0.06)] py-14">
          <Reveal as="h2" className="max-w-[30rem] font-display text-[clamp(1.75rem,4vw,2.25rem)] font-bold leading-tight tracking-tight text-ink">
            Everything else scores luck, a season, or nothing at all.
          </Reveal>
          <Reveal as="p" delay={0.05} className="mt-3 max-w-[46ch] text-[15px] leading-relaxed text-ink-soft">
            Touchline scores the one thing that actually reflects how well you read the
            game: being right before the market catches up.
          </Reveal>
          <Stagger className="mt-9 flex flex-col gap-3" gap={0.07}>
            {COMPARE.map((row) => (
              <StaggerItem key={row.them}>
                <div className="grid gap-4 rounded-[var(--radius-md)] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-5 transition-colors duration-[var(--dur-short)] hover:border-[rgba(255,255,255,0.16)] sm:grid-cols-[10rem_1fr_1fr] sm:items-start sm:gap-6">
                  <p className="font-display text-[16px] font-semibold tracking-tight text-ink">{row.them}</p>
                  <p className="text-[14px] leading-relaxed text-ink-soft">{row.they}</p>
                  <p className="flex items-start gap-2 text-[14px] leading-relaxed text-ink">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald glow-emerald" />
                    <span><span className="font-semibold text-emerald-deep">Touchline:</span> {row.us}</span>
                  </p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ============================ THE TRIO ============================ */}
        <section className="border-t border-[rgba(255,255,255,0.06)] py-14">
          <Reveal as="h2" className="max-w-[32rem] font-display text-[clamp(1.75rem,4vw,2.25rem)] font-bold leading-tight tracking-tight text-ink">
            Three things no one else puts together.
          </Reveal>
          <Stagger className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-3" gap={0.08}>
            {TRIO.map((t) => (
              <StaggerItem key={t.title} className="flex flex-col gap-3 border-t border-[rgba(255,255,255,0.10)] pt-5">
                <span className="shrink-0">{t.icon}</span>
                <h3 className="font-display text-[20px] font-semibold tracking-tight text-ink">{t.title}</h3>
                <p className="text-[15px] leading-relaxed text-ink-soft">{t.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ============================ RECEIPTS, NOT SCREENSHOTS ============================ */}
        <section className="border-t border-[rgba(255,255,255,0.06)] py-14">
          <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-12">
            <Reveal>
              <p className="font-display text-[13px] font-semibold uppercase tracking-wide text-cyan">
                Receipts, not screenshots
              </p>
              <h2 className="mt-2 font-display text-[clamp(1.6rem,3.8vw,2.1rem)] font-bold leading-tight tracking-tight text-ink">
                Your best calls become something you can&rsquo;t fake.
              </h2>
              <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-ink-soft">
                Anyone can crop a screenshot after the fact. A Touchline trophy is minted
                the moment a real call lands: the fixture, the odds you beat, and the
                result are signed on Solana and settled against verifiable on-chain data.
                It&rsquo;s the difference between saying you called it and being able to prove it.
              </p>
              <p className="mt-4 inline-flex items-center gap-2 text-[13px] font-medium text-ink">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-cyan" />
                Free to mint, never bought. Won by being right, kept forever.
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <GlassCard className="p-5">
                <div className="flex items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.08)] pb-3">
                  <span className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink">
                    Trophy · signed on-chain
                  </span>
                  <span className="rounded-[var(--radius-pill)] border border-cyan/40 bg-[rgba(43,229,255,0.10)] px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-wide text-cyan">
                    Verified
                  </span>
                </div>
                <dl className="mt-4 flex flex-col gap-2.5 text-[13px]">
                  {[
                    ["Fixture", "Japan v Spain · World Cup"],
                    ["Your call", "Japan to win"],
                    ["Odds you beat", "5.40 · a 1-in-5 shot"],
                    ["Line move", "22% → 31% · you beat the line"],
                    ["Result", "Japan 2-1 · called it"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-4 border-b border-[rgba(255,255,255,0.05)] pb-2 last:border-b-0 last:pb-0">
                      <dt className="text-ink-soft">{k}</dt>
                      <dd className="tnum text-right font-medium text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-[11px] leading-relaxed text-ink-soft">
                  Illustrative: every field is settled from verifiable TxLINE data at
                  full-time, then signed to the trophy.
                </p>
              </GlassCard>
            </Reveal>
          </div>
        </section>

        {/* ============================ SOCIAL / LEAGUES ============================ */}
        <section className="border-t border-[rgba(255,255,255,0.06)] py-14">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
            <Reveal>
              <p className="font-display text-[13px] font-semibold uppercase tracking-wide text-emerald-deep">
                Better with your people
              </p>
              <h2 className="mt-2 font-display text-[clamp(1.6rem,3.8vw,2.1rem)] font-bold leading-tight tracking-tight text-ink">
                A tournament-long rivalry, not a one-off.
              </h2>
              <p className="mt-4 max-w-[44ch] text-[15px] leading-relaxed text-ink-soft">
                Spin up a private league for the group chat, the office, or the five-a-side
                team. Everyone&rsquo;s calls, one table, ranked by who actually reads the
                game. The banter writes itself and the receipts settle the arguments.
              </p>
            </Reveal>
            <Stagger className="grid gap-4 sm:grid-cols-2" gap={0.07}>
              {[
                { t: "Private leagues", d: "One code, one table. Your people, ranked by foresight, not luck." },
                { t: "Share carries an invite", d: "Every moment card links back, so friends join in two taps and lift your rank." },
                { t: "Live leaderboard", d: "Positions move on the final whistle. Bragging rights earned in real time." },
                { t: "Streaks on the line", d: "A cold call can end a run everyone can see. The pressure is social, never financial." },
              ].map((c) => (
                <StaggerItem key={c.t}>
                  <GlassCard className="h-full p-5 transition-colors duration-[var(--dur-short)] hover:border-emerald/30">
                    <h3 className="font-display text-[16px] font-semibold tracking-tight text-ink">{c.t}</h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{c.d}</p>
                  </GlassCard>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* ============================ TXLINE CREDIBILITY BEAT ============================ */}
        <section className="border-t border-[rgba(255,255,255,0.06)] py-14">
          <Reveal>
            <GlassCard className="flex flex-col gap-5 p-6 sm:p-8">
              <div className="flex items-center gap-2">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald glow-emerald" />
                <p className="font-display text-[13px] font-semibold uppercase tracking-wide text-emerald-deep">
                  Powered by TxLINE, on Solana
                </p>
              </div>
              <h2 className="max-w-[30ch] font-display text-[clamp(1.6rem,3.8vw,2.1rem)] font-bold leading-tight tracking-tight text-ink">
                Real odds. Real results. Provable at the source.
              </h2>
              <p className="max-w-[62ch] text-[15px] leading-relaxed text-ink-soft">
                Every price you call on and every result you&rsquo;re scored against comes
                live from TxLINE, TxODDS&rsquo; on-chain sports data, the same market feed
                the industry runs on, streamed in real time and settled from data that&rsquo;s
                verifiable on-chain. Your closing line isn&rsquo;t our number; it&rsquo;s the
                market&rsquo;s, stamped at kickoff. That&rsquo;s what makes &ldquo;you beat
                the line&rdquo; a fact, not a flourish.
              </p>
              <Stagger className="grid gap-4 sm:grid-cols-3" gap={0.06}>
                {[
                  { t: "Live market odds", d: "Streamed from TxLINE as the price moves, the same consensus the market trusts." },
                  { t: "Settled on real data", d: "Results resolve from verifiable on-chain match data, not a self-reported score." },
                  { t: "Stamped at kickoff", d: "The closing line is snapshotted on server time, the same line for everyone." },
                ].map((c) => (
                  <StaggerItem key={c.t} className="border-t border-[rgba(255,255,255,0.10)] pt-4">
                    <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink">{c.t}</h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{c.d}</p>
                  </StaggerItem>
                ))}
              </Stagger>
            </GlassCard>
          </Reveal>
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
                  Free to play. Free to mint. Always.
                </p>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
                  No money in, no money out, not now, not as a catch later. The free core
                  stays free forever. On-chain means proof-of-skill, a verified record of the
                  calls you got right, never a market to speculate on.
                </p>
              </div>
            </GlassCard>
          </Reveal>
        </section>

        {/* ============================ FINAL CTA ============================ */}
        <section className="py-14 text-center">
          <Reveal as="h2" className="mx-auto max-w-[26rem] font-display text-[clamp(2rem,6vw,2.75rem)] font-bold leading-[1.02] tracking-tight text-ink">
            So, do you know better?
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
