"use client";

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import type { WalletError } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";
import { isUserRejection } from "@/lib/walletErrors";
import { useSession } from "@/lib/session";
import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: ReactNode }) {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl("devnet"),
    [],
  );
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  const hydrate = useSession((s) => s.hydrate);

  // restore the saved session on first mount
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // The wallet adapter emits an 'error' event (and by default console.errors it)
  // even when the caller catches the rejected promise. A user declining the wallet
  // prompt is expected UX, not a crash — swallow those; log anything genuinely wrong.
  const onError = useCallback((error: WalletError) => {
    if (isUserRejection(error)) return;
    console.error(error);
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
