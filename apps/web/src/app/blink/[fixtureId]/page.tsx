"use client";

// Local Blink preview/driver — renders the exact GET metadata a Blink client (X,
// Discord, dial.to, Phantom) would unfurl for /api/actions/pick/[fixtureId], and lets
// you actually run the POST → sign → send round trip against devnet, right here. This
// is the demo surface for a domain that isn't publicly unfurl-able yet: same endpoints,
// same wire format, just rendered inline instead of by a third-party client.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import { AppShell } from "@/components/AppShell";
import { Wordmark } from "@/components/Wordmark";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { isUserRejection } from "@/lib/walletErrors";

interface LinkedAction {
  label: string;
  href: string;
}

interface ActionMeta {
  title: string;
  description: string;
  label: string;
  disabled?: boolean;
  links?: { actions: LinkedAction[] };
  error?: { message: string };
}

export default function BlinkPreviewPage() {
  const params = useParams<{ fixtureId: string }>();
  const fixtureId = params.fixtureId;
  const { publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();

  const [meta, setMeta] = useState<ActionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [result, setResult] = useState<{ label: string; signature: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch(`/api/actions/pick/${fixtureId}`);
        const j = (await r.json()) as ActionMeta;
        if (!active) return;
        if (!r.ok) throw new Error((j as unknown as { message?: string }).message ?? "Couldn't load this challenge.");
        setMeta(j);
      } catch (e) {
        if (active) setLoadError((e as Error).message || "Couldn't load this challenge.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fixtureId]);

  const act = useCallback(
    async (action: LinkedAction) => {
      setActError(null);
      setCancelled(false);
      if (!publicKey) {
        setVisible(true);
        return;
      }
      setBusyHref(action.href);
      try {
        const r = await fetch(action.href, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: publicKey.toBase58() }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.message ?? "Couldn't build the transaction.");
        const tx = Transaction.from(Buffer.from(j.transaction as string, "base64"));
        const signature = await sendTransaction(tx, connection);
        await connection.confirmTransaction(signature, "confirmed");
        setResult({ label: action.label, signature });
      } catch (e) {
        // Declining the wallet prompt is a cancel, not a failure — show a calm
        // "try again" state, never a red error or a console crash.
        if (isUserRejection(e)) {
          setCancelled(true);
        } else {
          setActError((e as Error).message || "Couldn't sign. Try again.");
        }
      } finally {
        setBusyHref(null);
      }
    },
    [publicKey, sendTransaction, connection, setVisible],
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-sm px-4 pb-20 pt-2">
        <p className="mt-2 font-display text-[12px] font-semibold uppercase tracking-[0.16em] text-cyan">
          Solana Blink · Devnet preview
        </p>

        {loading ? (
          <p className="mt-6 text-[15px] text-ink-soft">Loading challenge…</p>
        ) : loadError || !meta ? (
          <p className="mt-6 text-[15px] font-medium text-coral">{loadError ?? "Couldn't load this challenge."}</p>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32 }} className="mt-4">
            <GlassCard className="overflow-hidden p-0">
              <div className="on-chain px-6 pb-6 pt-7 text-center">
                <Wordmark size="sm" />
                <p className="mt-4 font-display text-[22px] font-bold leading-tight text-on-emerald">{meta.title}</p>
              </div>
              <div className="bg-[var(--solid-bg)] p-5">
                <p className="text-[14px] leading-snug text-ink-soft">{meta.description}</p>

                {result ? (
                  <div className="mt-4 rounded-[var(--radius-sm)] bg-[rgba(0,217,130,0.10)] p-4">
                    <p className="font-display text-[15px] font-semibold text-emerald-deep">
                      Signed on-chain ✓ · {result.label}
                    </p>
                    <a
                      href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-block text-[13px] font-medium text-cyan hover:underline"
                    >
                      View on Solana Explorer ↗
                    </a>
                  </div>
                ) : (
                  <div className="mt-4 grid gap-2">
                    {meta.links?.actions.map((a) => (
                      <Button
                        key={a.href}
                        variant="gradient"
                        onClick={() => act(a)}
                        disabled={meta.disabled || busyHref != null}
                        className="w-full"
                      >
                        {busyHref === a.href ? "Signing…" : a.label}
                      </Button>
                    ))}
                  </div>
                )}

                {cancelled && !result && (
                  <p className="mt-3 text-[13px] font-medium text-ink-soft">
                    Signing cancelled. No charge, no pick. Tap a button above to try again.
                  </p>
                )}

                {actError && <p className="mt-3 text-[13px] font-medium text-coral">{actError}</p>}
              </div>
            </GlassCard>
            <p className="mt-4 text-center text-[12px] leading-relaxed text-ink-soft">
              This is what unfurls as an interactive card in X, Discord, or any Blink
              client, using the same GET/POST Action endpoints, rendered inline here. No
              app install, no session. Just a connected wallet.
            </p>
          </motion.div>
        )}
      </div>
    </AppShell>
  );
}
