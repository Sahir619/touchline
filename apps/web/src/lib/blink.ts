// Blink link-building — turns a fixture into a shareable Solana Action URL. Reuses the
// same origin resolution as lib/share.ts so it works in dev, preview, and prod alike.

/** Public site origin — env first, then the live origin, then localhost. */
function siteOrigin(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}

/** The raw Solana Action endpoint for a fixture's pick challenge. */
export function actionUrl(fixtureId: number, by?: string | null): string {
  const origin = siteOrigin();
  const q = by ? `?by=${encodeURIComponent(by)}` : "";
  return `${origin}/api/actions/pick/${fixtureId}${q}`;
}

/**
 * A universal Blink link — the dial.to interstitial renders the interactive card for
 * any client that doesn't natively unfurl Actions yet (most of X/Discord today), while
 * Action-aware wallets/clients resolve straight through.
 */
export function blinkUrl(fixtureId: number, by?: string | null): string {
  const action = actionUrl(fixtureId, by);
  return `https://dial.to/?action=solana-action:${encodeURIComponent(action)}&cluster=devnet`;
}
