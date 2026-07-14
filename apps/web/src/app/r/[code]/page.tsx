"use client";

// Referral landing (W10 stub) — where a shared `/r/<code>` invite link lands.
// This closes the K-factor loop so it's demoable end-to-end: a friend opens the
// link, sees the invite, and is one tap from playing. The code is stashed in
// sessionStorage as a light attribution hook (no backend pipeline yet).

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { FieldBackground } from "@/components/FieldBackground";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/lib/session";

function Logo() {
  return (
    <span className="inline-flex select-none flex-col items-center leading-none">
      <span className="font-display text-[40px] font-bold lowercase tracking-tight text-ink">
        touchline
      </span>
      <svg viewBox="0 0 200 12" className="-mt-1 h-3 w-[200px]" aria-hidden fill="none">
        <defs>
          <linearGradient id="tl-ref-line" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--ink)" />
            <stop offset="62%" stopColor="var(--ink)" />
            <stop offset="100%" stopColor="var(--cyan)" />
          </linearGradient>
        </defs>
        <line x1="3" y1="7" x2="197" y2="7" stroke="url(#tl-ref-line)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="180" cy="6" r="4.5" fill="var(--emerald)" />
      </svg>
    </span>
  );
}

export default function ReferralLandingPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();
  const router = useRouter();
  const token = useSession((s) => s.token);
  const hydrated = useSession((s) => s.hydrated);

  // Stash the invite code so it can be attributed after sign-in (stub hook).
  useEffect(() => {
    if (code && typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem("tl_ref", code);
      } catch {
        /* storage optional */
      }
    }
  }, [code]);

  const go = () => {
    // Already signed in → straight into play; otherwise connect first.
    router.push(hydrated && token ? "/play" : "/connect");
  };

  return (
    <main className="relative grid min-h-dvh place-items-center px-6">
      <FieldBackground />
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.3, 1] }}
        className="glass w-full max-w-sm p-8 text-center"
      >
        <Logo />
        <p className="mx-auto mt-6 max-w-[17rem] text-[18px] font-medium leading-snug text-ink">
          A mate thinks you can&apos;t read the game better than them.
        </p>
        <p className="mt-3 text-[15px] leading-snug text-ink-soft">
          Prove it. Call the matches, climb the table, and put it on record. Free to play.
        </p>
        {code ? (
          <p className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 text-[12px] font-medium text-ink-soft">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft/70">
              Invite
            </span>
            <span className="font-display font-semibold text-emerald-deep">{code}</span>
          </p>
        ) : null}
        <Button onClick={go} size="lg" className="mt-7 w-full">
          Accept the challenge
        </Button>
      </motion.div>
    </main>
  );
}
