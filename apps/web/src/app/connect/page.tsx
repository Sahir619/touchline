"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { FieldBackground } from "@/components/FieldBackground";
import { Button } from "@/components/ui/Button";
import { useSignIn } from "@/hooks/useAuth";
import { useSession } from "@/lib/session";
import {
  clearPendingJoin,
  clearPendingPick,
  getPendingJoin,
  getPendingPick,
  joinLeague,
  markPickResumed,
  postPick,
} from "@/lib/game";

function Logo() {
  return (
    <span className="inline-flex select-none flex-col items-center leading-none">
      <span className="font-display text-[40px] font-bold lowercase tracking-tight text-ink">
        touchline
      </span>
      <svg viewBox="0 0 200 12" className="-mt-1 h-3 w-[200px]" aria-hidden fill="none">
        <defs>
          <linearGradient id="tl-connect-line" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--ink)" />
            <stop offset="62%" stopColor="var(--ink)" />
            <stop offset="100%" stopColor="var(--cyan)" />
          </linearGradient>
        </defs>
        <line x1="3" y1="7" x2="197" y2="7" stroke="url(#tl-connect-line)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="180" cy="6" r="4.5" fill="var(--emerald)" />
      </svg>
    </span>
  );
}

// Only follow `next` back to an internal app route — never off-site, and
// never back into /connect itself.
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/connect")) return null;
  return raw;
}

export default function ConnectPage() {
  return (
    <Suspense fallback={null}>
      <ConnectPageInner />
    </Suspense>
  );
}

function ConnectPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const { connected, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const { signIn, pending, error } = useSignIn();
  const token = useSession((s) => s.token);
  const hydrated = useSession((s) => s.hydrated);
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // already signed in → into the app (unless we're resolving/reporting a
  // stashed guest pick or league invite below — those flows own navigation)
  useEffect(() => {
    if (hydrated && token && !getPendingPick() && !getPendingJoin() && !resubmitError && !joinError) {
      router.replace(next ?? "/play");
    }
  }, [hydrated, token, router, resubmitError, joinError, next]);

  const handle = async () => {
    if (!connected) {
      setVisible(true);
      return;
    }
    const res = await signIn();
    if (!res) return;

    // A guest lock stashes the pick before routing here — resubmit it now
    // that we have a token, instead of silently landing on /play as if
    // nothing happened.
    const pendingPick = getPendingPick();
    if (pendingPick) {
      setResubmitting(true);
      try {
        await postPick(res.token, pendingPick.fixtureId, pendingPick.selection);
        clearPendingPick();
        markPickResumed(pendingPick.fixtureId);
        router.replace(`/match/${pendingPick.fixtureId}`);
      } catch (e) {
        setResubmitError(
          `Couldn't save your ${pendingPick.label} pick: ${(e as Error).message}. It hasn't been lost; head to Play to try again.`,
        );
      } finally {
        setResubmitting(false);
      }
      return;
    }

    // A /join/[code] deep-link stashes the invite code before routing here.
    // New profiles go through onboarding first — it redeems the code once
    // that finishes. Existing profiles can be joined right away.
    const pendingJoin = getPendingJoin();
    if (pendingJoin && !res.isNew) {
      setJoining(true);
      try {
        const league = await joinLeague(res.token, pendingJoin);
        clearPendingJoin();
        router.replace(`/leagues/${league.id}`);
      } catch (e) {
        setJoinError(`Couldn't join that league: ${(e as Error).message}.`);
      } finally {
        setJoining(false);
      }
      return;
    }

    router.replace(res.isNew ? "/onboarding" : (next ?? "/play"));
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
        <p className="mx-auto mt-5 max-w-[16rem] text-[18px] font-medium leading-snug text-ink">
          Watch every match like it&apos;s yours.
        </p>
        <Button
          onClick={handle}
          size="lg"
          disabled={pending || resubmitting || joining || connecting}
          className="mt-7 w-full"
        >
          {pending
            ? "Signing in…"
            : resubmitting
              ? "Saving your pick…"
              : joining
                ? "Joining league…"
                : connected
                  ? "Sign in"
                  : "Connect wallet"}
        </Button>
        <p className="mt-3 text-[12px] font-medium uppercase tracking-wide text-ink-soft">
          Phantom · Solflare · Free to play. No stake.
        </p>
        {error && <p className="mt-3 text-[14px] font-medium text-coral">{error}</p>}
        {resubmitError && (
          <div className="mt-4">
            <p className="text-[14px] font-medium text-coral">{resubmitError}</p>
            <Button
              variant="ghost"
              onClick={() => {
                clearPendingPick();
                router.replace("/play");
              }}
              className="mt-3 w-full"
            >
              Continue to Play
            </Button>
          </div>
        )}
        {joinError && (
          <div className="mt-4">
            <p className="text-[14px] font-medium text-coral">{joinError}</p>
            <Button
              variant="ghost"
              onClick={() => {
                clearPendingJoin();
                router.replace("/play");
              }}
              className="mt-3 w-full"
            >
              Continue to Play
            </Button>
          </div>
        )}
      </motion.div>
    </main>
  );
}
