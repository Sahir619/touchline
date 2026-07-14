"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { nationByCode, impliedProbabilityPhrase, probabilityArticle } from "@touchline/shared";
import type { Trophy } from "@/lib/game";
import { cn } from "@/lib/cn";
import { IconTrophy } from "@/components/icons";
import { shareMoment, copyShareText, downloadMomentPng } from "@/lib/share";
import { activeSponsor } from "@/lib/sponsor";
import { blinkUrl } from "@/lib/blink";

/* ============================================================================
   Tier → coin styling. Gold (Oracle / Legendary) wears the on-chain gradient
   frame; bronze + silver wear their solid tier metal.
   ========================================================================== */
const TIER_RING: Record<Trophy["tier"], string> = {
  bronze: "var(--bronze)",
  silver: "var(--silver)",
  gold: "var(--gold)",
};

function explorerUrl(mintAddress: string) {
  return `https://explorer.solana.com/address/${mintAddress}?cluster=devnet`;
}


export interface ShareCardProps {
  trophy: Trophy;
  /** the user's backed nation (ISO-ish code) */
  nation?: string | null;
  /** optional referral code — appended as `/r/<code>` to the share link */
  referralCode?: string | null;
  onClose: () => void;
}

/**
 * ShareCard — the shareable "moment" card. A glass sheet over the field with an
 * on-chain gradient hero: the odds beaten (big), the trophy tier/name, the
 * user's nation, and a one-line caption. The mint coin sits front and centre.
 */
export function ShareCard({ trophy, nation, referralCode, onClose }: ShareCardProps) {
  const reduce = useReducedMotion();
  const nat = nationByCode(nation);
  const isGold = trophy.tier === "gold";
  const odds = trophy.oddsBeaten != null ? trophy.oddsBeaten.toFixed(2) : null;
  const minted = trophy.mintAddress != null;
  const sponsor = activeSponsor();

  // Share action state — one transient feedback line, one "busy" guard for PNG.
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "share" | "copy" | "png" | "blink">(null);
  const trophyBlinkUrl = trophy.fixtureId != null ? blinkUrl(trophy.fixtureId) : null;

  function flash(msg: string) {
    setFeedback(msg);
    window.setTimeout(() => setFeedback((cur) => (cur === msg ? null : cur)), 2400);
  }

  async function onShare() {
    if (busy) return;
    setBusy("share");
    try {
      const outcome = await shareMoment(trophy, nation, referralCode);
      if (outcome === "copied") flash("Link copied. Paste it anywhere");
      else if (outcome === "failed") flash("Couldn't share. Try copy or save");
    } finally {
      setBusy(null);
    }
  }

  async function onCopy() {
    if (busy) return;
    setBusy("copy");
    try {
      const ok = await copyShareText(trophy, nation, referralCode);
      flash(ok ? "Copied to clipboard" : "Couldn't copy");
    } finally {
      setBusy(null);
    }
  }

  async function onDownload() {
    if (busy) return;
    setBusy("png");
    try {
      await downloadMomentPng(trophy, nation, sponsor);
      flash("Image saved");
    } catch {
      flash("Couldn't save image");
    } finally {
      setBusy(null);
    }
  }

  async function onBlink() {
    if (busy || !trophyBlinkUrl) return;
    setBusy("blink");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(trophyBlinkUrl);
        flash("Blink link copied. Paste into X or a Blink-aware wallet");
      } else {
        flash("Copy unsupported in this browser");
      }
    } catch {
      flash("Couldn't copy the Blink link");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Share ${trophy.name} trophy`}
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

      {/* the moment card */}
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="glass relative z-10 w-full max-w-sm overflow-hidden p-0"
      >
        {/* close affordance */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close share card"
          className="absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full bg-[rgba(0,0,0,0.28)] text-ink/80 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {/* on-chain gradient hero — an earned moment */}
        <div className="on-chain relative overflow-hidden px-6 pb-7 pt-9 text-center">
          {/* sweep sheen */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent)] motion-safe:animate-[tl-sweep_2.6s_ease-in-out_infinite]"
          />

          <p className="font-display text-[12px] font-semibold uppercase tracking-[0.18em] text-on-emerald/80">
            Beat the bookies
          </p>

          {/* the coin */}
          <div className="relative mx-auto mt-4 grid h-[104px] w-[104px] place-items-center">
            <span
              className="absolute inset-0 rounded-full motion-safe:animate-[tl-coin_700ms_var(--ease-soft-settle)_both]"
              style={{
                background: isGold ? "var(--on-chain)" : TIER_RING[trophy.tier],
                boxShadow: "0 8px 26px rgba(0,0,0,0.4)",
              }}
            />
            <span className="absolute inset-[6px] rounded-full bg-[rgba(255,255,255,0.92)]" />
            <IconTrophy className="relative h-11 w-11" color={TIER_RING[trophy.tier]} />
          </div>

          {/* odds beaten — big */}
          {odds ? (
            <div className="mt-5">
              <p className="font-display text-[12px] font-semibold uppercase tracking-[0.16em] text-on-emerald/80">
                Odds beaten
              </p>
              <p className="tnum font-display text-[56px] font-bold leading-none text-on-emerald">
                {odds}
                <span className="text-[30px]">×</span>
              </p>
              {trophy.oddsBeaten != null ? (
                <p className="mt-1 text-[13px] font-medium text-on-emerald/80">
                  {(() => {
                    const phrase = impliedProbabilityPhrase(trophy.oddsBeaten!);
                    return `You beat ${probabilityArticle(phrase)} ${phrase} shot`;
                  })()}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* reading footer — dark solid surface */}
        <div className="bg-[var(--solid-bg)] px-6 py-5 text-center">
          <div className="flex items-center justify-center gap-2">
            <span
              className="font-display text-[20px] font-bold tracking-tight text-ink"
            >
              {trophy.name}
            </span>
            <span
              className="rounded-[var(--radius-pill)] px-2.5 py-1 font-display text-[11px] font-semibold uppercase tracking-wide"
              style={{
                color: trophy.tier === "gold" ? "#7a5a12" : "#fff",
                background: TIER_RING[trophy.tier],
              }}
            >
              {trophy.tier}
            </span>
          </div>

          {nat ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[15px] font-medium text-ink-soft">
              <span className="text-[18px] leading-none" aria-hidden>{nat.flag}</span>
              Backing {nat.name}
            </p>
          ) : null}

          <p className="mt-3 text-[15px] leading-snug text-ink-soft">
            Beat the bookies on <span className="font-semibold text-emerald-deep">Touchline</span>.
          </p>

          {/* ---- sponsor-branded template (W10 monetization surface) ---- */}
          {sponsor ? (
            <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2.5 text-left">
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] font-display text-[13px] font-bold"
                style={{ background: sponsor.accent, color: "#1a1205" }}
              >
                {sponsor.monogram}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-soft/70">
                  Presented by
                </span>
                <span className="block truncate font-display text-[14px] font-semibold text-ink">
                  {sponsor.name}
                </span>
                <span className="block truncate text-[11px] text-ink-soft">{sponsor.tagline}</span>
              </span>
              <span className="shrink-0 rounded-[var(--radius-pill)] border border-[rgba(255,255,255,0.12)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-soft/70">
                Partner
              </span>
            </div>
          ) : null}

          {/* ---- share-out actions ---- */}
          <div className="mt-5">
            <button
              type="button"
              onClick={onShare}
              disabled={busy != null}
              className={cn(
                "on-chain inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] px-5",
                "font-display text-[14px] font-semibold uppercase tracking-wide text-on-emerald",
                "transition-[filter] hover:brightness-[1.04] disabled:opacity-60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--solid-bg)]",
              )}
            >
              {busy === "share" ? (
                <span className="h-4 w-4 rounded-full border-2 border-on-emerald/40 border-t-on-emerald motion-safe:animate-[tl-spin_0.7s_linear_infinite]" aria-hidden />
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M8 6l4-4 4 4" />
                </svg>
              )}
              Share this moment
            </button>

            <div className="mt-2.5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={onCopy}
                disabled={busy != null}
                className={cn(
                  "inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] px-3",
                  "border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)]",
                  "font-display text-[13px] font-semibold tracking-wide text-ink transition-colors",
                  "hover:bg-[rgba(255,255,255,0.07)] disabled:opacity-60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
                )}
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h8" />
                </svg>
                Copy text
              </button>
              <button
                type="button"
                onClick={onDownload}
                disabled={busy != null}
                className={cn(
                  "inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] px-3",
                  "border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)]",
                  "font-display text-[13px] font-semibold tracking-wide text-ink transition-colors",
                  "hover:bg-[rgba(255,255,255,0.07)] disabled:opacity-60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
                )}
              >
                {busy === "png" ? (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-ink/30 border-t-ink motion-safe:animate-[tl-spin_0.7s_linear_infinite]" aria-hidden />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 3v12M8 11l4 4 4-4M5 21h14" />
                  </svg>
                )}
                Save image
              </button>
            </div>

            {trophyBlinkUrl ? (
              <button
                type="button"
                onClick={onBlink}
                disabled={busy != null}
                className={cn(
                  "mt-2.5 inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-[var(--radius-pill)] px-3",
                  "border border-[rgba(0,217,130,0.32)] bg-[rgba(0,217,130,0.06)]",
                  "font-display text-[13px] font-semibold tracking-wide text-emerald-deep transition-colors",
                  "hover:bg-[rgba(0,217,130,0.12)] disabled:opacity-60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
                )}
              >
                {busy === "blink" ? (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-emerald-deep/30 border-t-emerald-deep motion-safe:animate-[tl-spin_0.7s_linear_infinite]" aria-hidden />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" />
                  </svg>
                )}
                Challenge on-chain (copy Blink)
              </button>
            ) : null}

            {/* live feedback for assistive tech + everyone */}
            <p
              aria-live="polite"
              className={cn(
                "mt-2 min-h-[18px] text-[13px] font-medium text-emerald-deep transition-opacity",
                feedback ? "opacity-100" : "opacity-0",
              )}
            >
              {feedback ?? " "}
            </p>
          </div>

          {/* ---- referral loop, made visible (W10) ---- */}
          {referralCode ? (
            <p className="mt-1 text-[12px] leading-snug text-ink-soft">
              Shares carry your invite link{" "}
              <span className="font-semibold text-emerald-deep">/r/{referralCode}</span> so friends
              who join lift your rank.
            </p>
          ) : null}

          {minted ? (
            <a
              href={explorerUrl(trophy.mintAddress!)}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "on-chain mt-2 inline-flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-pill)] px-4",
                "font-display text-[13px] font-semibold uppercase tracking-wide text-on-emerald",
                "transition-[filter] hover:brightness-[1.04]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--solid-bg)]",
              )}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 12.5l5 5L20 6" />
              </svg>
              Verified on Solana ↗
            </a>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}

export default ShareCard;
