"use client";

import { Reveal, Stagger, StaggerItem } from "@/components/marketing/motion";
import { GlassCard } from "@/components/ui/GlassCard";

/* ============================================================================
   DemoLeague — the social-proof close. A sample matchday feed so a first-time
   visitor walks into a room that's already alive, not an empty lobby.

   HONESTY GUARDRAIL: every person and event here is a DEMO. The badge is
   non-negotiable — a board member glancing at this must read "populated
   sample," never "real users did these things." Cast + line templates are the
   locked Demo Cast (Maya / Daniel / Sam / Amara / Raj).
   ========================================================================== */

type Tone = "upset" | "landed" | "minted" | "live" | "rival";

const TONE: Record<Tone, { dot: string; ring: string }> = {
  upset: { dot: "bg-coral", ring: "border-coral/40 bg-[rgba(255,106,77,0.10)] text-coral" },
  landed: { dot: "bg-emerald", ring: "border-emerald/40 bg-[rgba(0,224,138,0.10)] text-emerald-deep" },
  minted: { dot: "bg-cyan", ring: "border-cyan/40 bg-[rgba(43,229,255,0.10)] text-cyan" },
  live: { dot: "bg-coral", ring: "border-coral/40 bg-[rgba(255,106,77,0.10)] text-coral" },
  rival: { dot: "bg-emerald", ring: "border-emerald/40 bg-[rgba(0,224,138,0.10)] text-emerald-deep" },
};

const FEED: {
  name: string;
  initial: string;
  tone: Tone;
  tag: string;
  line: string;
  when: string;
}[] = [
  {
    name: "Maya",
    initial: "M",
    tone: "upset",
    tag: "Long shot",
    line: "backed Japan at 5.40, a 1-in-5 shot, and she's on it.",
    when: "2m",
  },
  {
    name: "Daniel",
    initial: "D",
    tone: "landed",
    tag: "Beat the line",
    line: "read Brazil right. The market moved to him by kickoff. Sharp bonus banked.",
    when: "6m",
  },
  {
    name: "Amara",
    initial: "A",
    tone: "live",
    tag: "Watching live",
    line: "is in the room for Argentina v France, sweating the call.",
    when: "now",
  },
  {
    name: "Sam",
    initial: "S",
    tone: "minted",
    tag: "On record",
    line: "turned a landed long shot into a trophy, signed on-chain.",
    when: "12m",
  },
  {
    name: "Raj",
    initial: "R",
    tone: "rival",
    tag: "Your rival",
    line: "just passed you on the table. Your move.",
    when: "18m",
  },
];

export function DemoLeague() {
  return (
    <section className="border-t border-[rgba(255,255,255,0.06)] py-16">
      <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start lg:gap-12">
        <Reveal>
          <p className="font-display text-[13px] font-semibold uppercase tracking-wide text-emerald-deep">
            You&rsquo;re not alone in here
          </p>
          <h2 className="mt-2 font-display text-[clamp(1.75rem,4vw,2.25rem)] font-bold leading-tight tracking-tight text-ink">
            The room&rsquo;s already calling it.
          </h2>
          <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-ink-soft">
            Every call is on the record and ranked against the room. Beat the line,
            climb the table, and be the one who called it first. This is a live
            matchday, mid-tournament. Jump in and it fills up with your mates.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald glow-emerald" />
            <span className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
              Demo League · sample players
            </span>
          </div>
        </Reveal>

        <Reveal delay={0.06}>
          <GlassCard className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.08)] pb-3">
              <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-ink">
                Matchday activity
              </p>
              <span className="rounded-[var(--radius-pill)] border border-[rgba(255,255,255,0.16)] px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                Demo · sample players
              </span>
            </div>

            <Stagger className="mt-1 flex flex-col" gap={0.06}>
              {FEED.map((e) => (
                <StaggerItem
                  key={e.name}
                  className="flex items-start gap-3 border-b border-[rgba(255,255,255,0.05)] py-3 last:border-b-0"
                >
                  <span
                    aria-hidden
                    className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-[rgba(255,255,255,0.06)] font-display text-[14px] font-bold text-ink"
                  >
                    {e.initial}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ${TONE[e.tone].dot} ring-2 ring-[var(--solid-bg)]`}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-snug text-ink">
                      <span className="font-display font-semibold">{e.name}</span>{" "}
                      <span className="text-ink-soft">{e.line}</span>
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-[var(--radius-pill)] border px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wide ${TONE[e.tone].ring}`}
                      >
                        {e.tag}
                      </span>
                      <span className="tnum text-[11px] text-ink-soft/70">{e.when}</span>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>

            <p className="mt-3 border-t border-[rgba(255,255,255,0.08)] pt-3 text-[12px] leading-relaxed text-ink-soft">
              These are demo players showing how a live matchday feels. Invite real
              mates and this fills up for real.
            </p>
          </GlassCard>
        </Reveal>
      </div>
    </section>
  );
}

export default DemoLeague;
