"use client";

// League invite deep-link — where a shared /join/<code> link lands. A guest
// gets routed through /connect (and onboarding, for brand-new profiles)
// before the code is redeemed; a signed-in user is joined immediately.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { FieldBackground } from "@/components/FieldBackground";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/lib/session";
import { joinLeague, stashPendingJoin } from "@/lib/game";

function Logo() {
  return (
    <span className="inline-flex select-none flex-col items-center leading-none">
      <span className="font-display text-[40px] font-bold lowercase tracking-tight text-ink">
        touchline
      </span>
      <svg viewBox="0 0 200 12" className="-mt-1 h-3 w-[200px]" aria-hidden fill="none">
        <defs>
          <linearGradient id="tl-join-line" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--ink)" />
            <stop offset="62%" stopColor="var(--ink)" />
            <stop offset="100%" stopColor="var(--cyan)" />
          </linearGradient>
        </defs>
        <line x1="3" y1="7" x2="197" y2="7" stroke="url(#tl-join-line)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="180" cy="6" r="4.5" fill="var(--emerald)" />
      </svg>
    </span>
  );
}

export default function JoinLeaguePage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();
  const router = useRouter();
  const token = useSession((s) => s.token);
  const hydrated = useSession((s) => s.hydrated);

  const [status, setStatus] = useState<"working" | "error">("working");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || !code) return;

    if (!token) {
      // Stash the code so /connect (or onboarding, for a brand-new profile)
      // can redeem it once a session exists.
      stashPendingJoin(code);
      router.replace("/connect");
      return;
    }

    let active = true;
    joinLeague(token, code)
      .then((league) => {
        if (!active) return;
        router.replace(`/leagues/${league.id}`);
      })
      .catch((e: Error) => {
        if (!active) return;
        setStatus("error");
        setError(e.message || "Couldn't join that league.");
      });
    return () => {
      active = false;
    };
  }, [hydrated, token, code, router]);

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
        {status === "working" ? (
          <>
            <p className="mx-auto mt-6 max-w-[17rem] text-[18px] font-medium leading-snug text-ink">
              Joining the league…
            </p>
            {code && (
              <p className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 text-[12px] font-medium text-ink-soft">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft/70">
                  Invite
                </span>
                <span className="font-display font-semibold text-emerald-deep">{code}</span>
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mx-auto mt-6 max-w-[17rem] text-[18px] font-medium leading-snug text-ink">
              Couldn&apos;t join that league
            </p>
            <p className="mt-3 text-[15px] leading-snug text-ink-soft">{error}</p>
            <Button onClick={() => router.replace("/leaderboard")} size="lg" className="mt-7 w-full">
              Back to leaderboard
            </Button>
          </>
        )}
      </motion.div>
    </main>
  );
}
