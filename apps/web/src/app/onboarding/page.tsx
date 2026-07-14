"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { NATIONS, PERSONAS } from "@touchline/shared";
import { FieldBackground } from "@/components/FieldBackground";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { patchMe } from "@/lib/account";
import { clearPendingJoin, getPendingJoin, joinLeague } from "@/lib/game";

export default function OnboardingPage() {
  const router = useRouter();
  const token = useSession((s) => s.token);
  const hydrated = useSession((s) => s.hydrated);
  const setProfile = useSession((s) => s.setProfile);

  const [step, setStep] = useState<0 | 1>(0);
  const [nation, setNation] = useState<string | null>(null);
  const [persona, setPersona] = useState<string>("hype");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (hydrated && !token) router.replace("/connect");
  }, [hydrated, token, router]);

  const finish = async (withNation: string | null) => {
    if (!token) return;
    setSaving(true);
    try {
      const profile = await patchMe(token, {
        nation: withNation ?? undefined,
        persona,
      });
      setProfile(profile);

      // A /join/[code] deep-link stashes an invite for brand-new profiles —
      // redeem it now that onboarding (and the token) are in place.
      const pendingJoin = getPendingJoin();
      if (pendingJoin) {
        try {
          const league = await joinLeague(token, pendingJoin);
          clearPendingJoin();
          router.replace(`/leagues/${league.id}`);
          return;
        } catch {
          clearPendingJoin();
        }
      }

      router.replace("/play");
    } catch {
      router.replace("/play");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="relative grid min-h-dvh place-items-center px-5 py-10">
      <FieldBackground />
      <motion.div
        key={step}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.2, 0.7, 0.3, 1] }}
        className="glass w-full max-w-lg p-6 sm:p-8"
      >
        {/* progress */}
        <div className="mb-5 flex items-center gap-2">
          <span className={cn("h-1.5 flex-1 rounded-full", step >= 0 ? "bg-emerald" : "bg-[rgba(255,255,255,0.12)]")} />
          <span className={cn("h-1.5 flex-1 rounded-full", step >= 1 ? "bg-emerald" : "bg-[rgba(255,255,255,0.12)]")} />
        </div>
        <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-emerald-deep">
          Step {step + 1} of 2
        </p>

        {step === 0 ? (
          <>
            <h1 className="mt-1 font-display text-[26px] font-bold tracking-tight text-ink">
              Who are you backing?
            </h1>
            <div className="mt-5 grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {NATIONS.map((n) => {
                const selected = nation === n.code;
                return (
                  <button
                    key={n.code}
                    type="button"
                    onClick={() => setNation(n.code)}
                    className={cn(
                      "flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-3 text-left transition-colors",
                      "min-h-[52px]",
                      selected
                        ? "border-emerald bg-[rgba(0,217,130,0.12)]"
                        : "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.24)]",
                    )}
                  >
                    <span className="text-[22px] leading-none">{n.flag}</span>
                    <span className="min-w-0 truncate font-display text-[15px] font-semibold text-ink">
                      {n.name}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => finish(null)}
                className="text-[14px] font-medium text-ink-soft underline-offset-2 hover:underline"
              >
                Skip
              </button>
              <Button onClick={() => setStep(1)} disabled={!nation}>
                Continue ▸
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-1 font-display text-[26px] font-bold tracking-tight text-ink">
              Who&apos;s in your ear?
            </h1>
            <div className="mt-5 grid gap-2">
              {PERSONAS.map((p) => {
                const selected = persona === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPersona(p.id)}
                    className={cn(
                      "rounded-[var(--radius-sm)] border px-4 py-3 text-left transition-colors",
                      selected
                        ? "border-emerald bg-[rgba(0,217,130,0.10)]"
                        : "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.24)]",
                    )}
                  >
                    <p className="font-display text-[16px] font-semibold text-ink">{p.name}</p>
                    <p className="mt-0.5 text-[14px] leading-snug text-ink-soft">{p.blurb}</p>
                    <p className="mt-1.5 text-[13px] italic leading-snug text-emerald-deep">
                      “{p.sample}”
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep(0)}
                className="text-[14px] font-medium text-ink-soft underline-offset-2 hover:underline"
              >
                ‹ Back
              </button>
              <Button onClick={() => finish(nation)} disabled={saving}>
                {saving ? "Saving…" : "Start playing"}
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </main>
  );
}
