"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { useSession } from "@/lib/session";
import { getNonce, verifySignIn } from "@/lib/account";

/** Sign-in-with-Solana: request nonce → sign message → verify → store session. */
export function useSignIn() {
  const { publicKey, signMessage } = useWallet();
  const setSession = useSession((s) => s.setSession);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setError("Connect a wallet first.");
      return null;
    }
    setPending(true);
    setError(null);
    try {
      const wallet = publicKey.toBase58();
      const { message, nonce } = await getNonce(wallet);
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      const res = await verifySignIn(wallet, nonce, signature);
      setSession(res.token, res.profile);
      return res;
    } catch (e) {
      setError((e as Error).message || "Couldn't sign in. Try again.");
      return null;
    } finally {
      setPending(false);
    }
  }, [publicKey, signMessage, setSession]);

  return { signIn, pending, error };
}
