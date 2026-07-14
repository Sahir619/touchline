"use client";

import { useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import { IconTrophy } from "@/components/icons";
import { ShareCard } from "@/components/ShareCard";
import { shareSnippet } from "@/lib/share";
import { blinkUrl } from "@/lib/blink";
import {
  backedOutcome,
  edgeBeatenLine,
  winTrophy,
  type WinReturn,
} from "@/lib/winReturn";

export interface WinReturnHeroProps {
  /** The selected hero win + how many other wins rolled in. */
  win: WinReturn;
  /** The user's backed nation, for the ShareCard footer. */
  nation?: string | null;
  /** Referral code, appended to shared links so friends who join lift the user's rank. */
  referralCode?: string | null;
  /** Dismiss the payoff (it's already marked seen — this just closes it). */
  onDismiss: () => void;
}

/* ---------------------------------------------------------------- win burst */
// The same spray language as the SAH-67 lock PickBurst (the `tl-goalfly` keyframe,
// brand-token dots) so lock and win read as one system — scaled a touch wider for
// the return-visit "landed" beat. motion-safe only; reduced motion never renders it.
const BURST_COUNT = 11;
const BURST_COLORS = ["var(--emerald)", "var(--cyan)", "var(--gold)"];
const BURST_PARTICLES = Array.from({ length: BURST_COUNT }, (_, i) => {
  const angle = (i / BURST_COUNT) * Math.PI * 2 + Math.PI / 9;
  const dist = 48 + (i % 3) * 20;
  return {
    color: BURST_COLORS[i % BURST_COLORS.length]!,
    gx: Math.round(Math.cos(angle) * dist),
    gy: Math.round(Math.sin(angle) * dist) - 14,
    size: 5 + (i % 3) * 2,
    delay: (i % 4) * 45,
  };
});

function WinBurst() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      {BURST_PARTICLES.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full motion-safe:animate-[tl-goalfly_1000ms_ease-out_both]"
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

/**
 * WinReturnHero — the Peak–End return payoff (SAH-69). When a call landed since the
 * user's last visit, this celebratory hero greets them above the recap: the big
 * outcome word, "YOUR CALL LANDED +431", the edge it beat, and a one-tap Share the
 * win (opens the existing ShareCard) plus a secondary Challenge-a-friend Blink.
 *
 * Copy carries no bet/wager/stake/gamble framing — a called result, earned and free.
 * Motion is a tasteful entrance (respects reduced motion), never confetti spam.
 */
export function WinReturnHero({ win, nation, referralCode, onDismiss }: WinReturnHeroProps) {
  const reduce = useReducedMotion();
  const [shareOpen, setShareOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { pick, extraCount } = win;
  const outcome = backedOutcome(pick);
  const edge = edgeBeatenLine(pick.oddsAtLock);
  const trophy = winTrophy(pick);

  function flash(msg: string) {
    setFeedback(msg);
    window.setTimeout(() => setFeedback((cur) => (cur === msg ? null : cur)), 2400);
  }

  async function onChallenge() {
    if (busy) return;
    setBusy(true);
    try {
      const outcomeResult = await shareSnippet(
        `I called ${outcome.replace(/^THE /, "").toLowerCase() === "draw" ? "the draw" : outcome} on Touchline and it landed. Think you can read the game?`,
        "Touchline challenge",
        blinkUrl(pick.fixtureId),
      );
      if (outcomeResult === "shared") flash("Challenge sent");
      else if (outcomeResult === "copied") flash("Challenge link copied. Paste it anywhere");
      else flash("Couldn't share. Try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.42, ease: [0.2, 0.7, 0.3, 1] }}
        className="relative overflow-hidden rounded-[var(--radius-lg,20px)]"
        role="status"
      >
        {/* on-chain gradient hero — an earned moment, matching the ShareCard language */}
        <div className="on-chain relative overflow-hidden px-5 pb-5 pt-6">
          {!reduce && <WinBurst />}

          {/* dismiss */}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-[rgba(0,0,0,0.22)] text-on-emerald/80 transition-colors hover:text-on-emerald focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-emerald"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          <div className="relative z-10 flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[rgba(255,255,255,0.9)] motion-safe:animate-[tl-coin_700ms_var(--ease-soft-settle,ease-out)_both]"
            >
              <IconTrophy className="h-6 w-6" color="var(--emerald-deep)" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-on-emerald/85">
                You called it. It landed.
              </p>
              {/* big outcome word */}
              <p className="font-display text-[30px] font-bold uppercase leading-[1.02] tracking-tight text-on-emerald">
                {outcome}
              </p>
              {/* YOUR CALL LANDED +431 */}
              <p className="tnum mt-1 font-display text-[22px] font-bold leading-none text-on-emerald">
                <span className="text-on-emerald/85">+</span>
                {pick.points}
                <span className="ml-1.5 align-middle text-[13px] font-semibold uppercase tracking-wide text-on-emerald/80">
                  pts
                </span>
              </p>
              {/* edge beaten */}
              <p className="mt-1.5 text-[13.5px] font-medium leading-snug text-on-emerald/90">
                {edge}
              </p>
              {/* braggable-vs-friends payoff (SAH-73) */}
              <p className="mt-1 text-[13px] font-medium leading-snug text-on-emerald/90">
                That&rsquo;s on record now. Go let the group chat know who called it.
              </p>
            </div>
          </div>
        </div>

        {/* reading footer — actions on a dark solid surface, mirrors ShareCard */}
        <div className="bg-[var(--solid-bg,#131B27)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className={cn(
                "on-chain inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-[var(--radius-pill)] px-4",
                "font-display text-[14px] font-semibold uppercase tracking-wide text-on-emerald",
                "transition-[filter] hover:brightness-[1.04]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--solid-bg,#131B27)]",
              )}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M8 6l4-4 4 4" />
              </svg>
              Rub it in ▸
            </button>
            <button
              type="button"
              onClick={onChallenge}
              disabled={busy}
              className={cn(
                "inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] px-4",
                "border border-[rgba(0,217,130,0.32)] bg-[rgba(0,217,130,0.06)]",
                "font-display text-[13px] font-semibold tracking-wide text-emerald-deep transition-colors",
                "hover:bg-[rgba(0,217,130,0.12)] disabled:opacity-60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
              )}
            >
              {busy ? (
                <span className="h-3.5 w-3.5 rounded-full border-2 border-emerald-deep/30 border-t-emerald-deep motion-safe:animate-[tl-spin_0.7s_linear_infinite]" aria-hidden />
              ) : (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" />
                </svg>
              )}
              Challenge a mate
            </button>
          </div>

          {/* live feedback for assistive tech + everyone */}
          <p
            aria-live="polite"
            className={cn(
              "min-h-[16px] text-[12.5px] font-medium text-emerald-deep transition-opacity",
              feedback ? "mt-2 opacity-100" : "opacity-0",
            )}
          >
            {feedback ?? " "}
          </p>

          {/* +N more landed — rolls into the recap below */}
          {extraCount > 0 ? (
            <p className="mt-1.5 text-[12.5px] font-medium leading-snug text-ink-soft">
              +{extraCount} more {extraCount === 1 ? "call" : "calls"} landed. See them in your recap below.
            </p>
          ) : null}
        </div>
      </motion.div>

      <AnimatePresence>
        {shareOpen ? (
          <ShareCard
            trophy={trophy}
            nation={nation}
            referralCode={referralCode}
            onClose={() => setShareOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

export default WinReturnHero;
