"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { getTrophies, mintTrophy, type Trophy } from "@/lib/game";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { ShareCard } from "@/components/ShareCard";
import { referralCodeFor } from "@/lib/referral";
import { IconTrophy } from "@/components/icons";
import { cn } from "@/lib/cn";

const TIER_RING: Record<Trophy["tier"], string> = {
  bronze: "var(--bronze)",
  silver: "var(--silver)",
  gold: "var(--gold)",
};

function explorerUrl(mintAddress: string) {
  return `https://explorer.solana.com/address/${mintAddress}?cluster=devnet`;
}

/* ============================================================================
   ParticleBurst — sparse confetti spray on the mint peak. Eight particles fan
   out from the coin centre on fixed radial angles (deterministic, no layout
   jump) and fade via the `tl-particle` keyframe. motion-safe only.
   ========================================================================== */
const BURST = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
  const dist = 30 + (i % 3) * 7;
  return {
    tx: Math.round(Math.cos(angle) * dist),
    ty: Math.round(Math.sin(angle) * dist),
    color: i % 3 === 0 ? "var(--gold)" : i % 3 === 1 ? "#2BE5FF" : "#00E08A",
    delay: (i % 4) * 40,
  };
});

function ParticleBurst() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
      {BURST.map((p, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full motion-safe:animate-[tl-particle_720ms_ease-out_both]"
          style={
            {
              background: p.color,
              "--tx": `${p.tx}px`,
              "--ty": `${p.ty}px`,
              animationDelay: `${p.delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

/* ============================================================================
   Trophy coin — circular, tier-tinted. Gold (Oracle) wears the on-chain frame.
   `justMinted` triggers the celebratory spring pop + emerald→cyan sweep.
   ========================================================================== */
function TrophyCoin({ trophy, justMinted }: { trophy: Trophy; justMinted: boolean }) {
  const isGold = trophy.tier === "gold";
  return (
    <div className="relative mx-auto grid h-[72px] w-[72px] place-items-center">
      <motion.span
        key={justMinted ? "minted" : "rest"}
        initial={justMinted ? { scale: 0.3, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 16 }}
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{
          background: isGold ? "var(--on-chain)" : TIER_RING[trophy.tier],
          boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
        }}
      >
      </motion.span>
      <span className="absolute inset-[5px] rounded-full bg-[rgba(255,255,255,0.92)]" />
      <IconTrophy className="relative h-[30px] w-[30px]" color={TIER_RING[trophy.tier]} />
      {justMinted ? <ParticleBurst /> : null}
    </div>
  );
}

/* ============================================================================
   Verified-on-Solana badge + explorer link — the on-chain confirmation.
   ========================================================================== */
function VerifiedBadge({ mintAddress, pop }: { mintAddress: string; pop: boolean }) {
  return (
    <motion.a
      href={explorerUrl(mintAddress)}
      target="_blank"
      rel="noreferrer"
      initial={pop ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      // Follow-beat: the on-chain confirmation lands after the coin spring +
      // sweep peak (~0.45s), so it reads as "…and it's verified", not concurrent.
      transition={{ duration: 0.24, ease: [0.2, 0.7, 0.3, 1], delay: pop ? 0.45 : 0 }}
      className={cn(
        "on-chain inline-flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-pill)] px-3",
        "font-display text-[11px] font-semibold uppercase tracking-wide text-on-emerald",
        "transition-[filter] hover:brightness-[1.04]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
      )}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 12.5l5 5L20 6" />
      </svg>
      Verified on Solana ↗
    </motion.a>
  );
}

export interface TrophyCabinetProps {
  token: string;
}

/**
 * TrophyCabinet — the user's earned long-shot trophies. Each coin can be minted
 * to Solana (the celebratory peak) and shared as a moment card.
 */
export function TrophyCabinet({ token }: TrophyCabinetProps) {
  const reduce = useReducedMotion();
  const nation = useSession((s) => s.profile?.nation ?? null);
  const wallet = useSession((s) => s.profile?.wallet ?? null);

  const [trophies, setTrophies] = useState<Trophy[] | null>(null);
  const [minting, setMinting] = useState<number | null>(null);
  const [justMinted, setJustMinted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareOf, setShareOf] = useState<Trophy | null>(null);

  useEffect(() => {
    let alive = true;
    getTrophies(token).then((t) => {
      if (alive) setTrophies(t);
    });
    return () => {
      alive = false;
    };
  }, [token]);

  async function handleMint(id: number) {
    setError(null);
    setMinting(id);
    try {
      const { mintAddress } = await mintTrophy(token, id);
      setTrophies((prev) =>
        (prev ?? []).map((t) =>
          t.id === id ? { ...t, mintAddress, mintedAt: Date.now() } : t,
        ),
      );
      setJustMinted(id);
      window.setTimeout(() => setJustMinted((cur) => (cur === id ? null : cur)), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setMinting(null);
    }
  }

  /* ---- loading ---- */
  if (trophies === null) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="solid h-[188px] animate-pulse bg-[rgba(255,255,255,0.06)]"
          />
        ))}
      </div>
    );
  }

  /* ---- empty ---- */
  if (trophies.length === 0) {
    return (
      <div className="solid grid place-items-center px-6 py-10 text-center">
        <div className="grid h-[64px] w-[64px] place-items-center rounded-full bg-[rgba(255,255,255,0.05)]" aria-hidden>
          <IconTrophy className="h-7 w-7" color="var(--ink-soft)" />
        </div>
        <p className="mt-4 font-display text-[17px] font-semibold text-ink">
          No trophies yet
        </p>
        <p className="mt-1 max-w-[260px] text-[15px] leading-snug text-ink-soft">
          Win a long-shot to earn your first trophy.
        </p>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <p className="mb-3 rounded-[var(--radius-sm)] bg-[rgba(255,106,77,0.08)] px-3 py-2 text-[14px] font-medium text-coral">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {trophies.map((t, i) => {
          const minted = t.mintAddress != null;
          const isMinting = minting === t.id;
          const odds = t.oddsBeaten != null ? t.oddsBeaten.toFixed(2) : null;

          return (
            <motion.div
              key={t.id}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.36, ease: [0.2, 0.7, 0.3, 1], delay: i * 0.04 }}
              className={cn(
                "solid flex flex-col items-center p-4 text-center",
                t.tier === "gold" && "ring-1 ring-[rgba(3,225,255,0.35)]",
              )}
            >
              <TrophyCoin trophy={t} justMinted={justMinted === t.id} />

              <p className="mt-3 font-display text-[16px] font-semibold tracking-tight text-ink">
                {t.name}
                {t.edition ? <span className="ml-1 text-ink-soft">#{t.edition}</span> : null}
              </p>
              {odds ? (
                <p className="tnum mt-0.5 text-[13px] font-medium text-ink-soft">
                  Beat <span className="font-semibold text-emerald-deep">{odds}×</span>
                </p>
              ) : null}

              {/* on-chain state */}
              <div className="mt-3 flex min-h-[36px] items-center justify-center">
                {minted ? (
                  <VerifiedBadge mintAddress={t.mintAddress!} pop={justMinted === t.id} />
                ) : (
                  <Button
                    variant="gradient"
                    size="md"
                    onClick={() => handleMint(t.id)}
                    disabled={isMinting}
                    className="min-h-[36px] px-4 text-[12px]"
                  >
                    {isMinting ? (
                      <>
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-on-emerald/40 border-t-on-emerald motion-safe:animate-[tl-spin_0.7s_linear_infinite]" aria-hidden />
                        Claiming…
                      </>
                    ) : (
                      "Claim, it's free"
                    )}
                  </Button>
                )}
              </div>
              {!minted ? (
                <p className="mt-1.5 max-w-[160px] text-[11px] leading-snug text-ink-soft">
                  A real Solana NFT, yours to keep. No cost, ever.
                </p>
              ) : null}

              {/* share */}
              <button
                type="button"
                onClick={() => setShareOf(t)}
                className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-ink-soft underline-offset-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:underline"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M8 6l4-4 4 4" />
                </svg>
                Share
              </button>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {shareOf ? (
          <ShareCard
            key={shareOf.id}
            trophy={shareOf}
            nation={nation}
            referralCode={referralCodeFor(wallet)}
            onClose={() => setShareOf(null)}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

export default TrophyCabinet;
