// Detect when a wallet operation failed because the user declined the prompt
// (Phantom/Solflare "User rejected the request", EIP-1193 code 4001). This is
// normal UX — a cancel, not a crash — so callers can render a friendly "try
// again" state and the WalletProvider can skip console noise.
export function isUserRejection(error: unknown): boolean {
  if (!error) return false;

  const err = error as {
    name?: string;
    message?: string;
    code?: number;
    error?: { code?: number };
  };

  if (err.code === 4001 || err.error?.code === 4001) return true;

  const msg = (err.message ?? "").toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user declined") ||
    msg.includes("request rejected") ||
    msg.includes("rejected the request")
  );
}
