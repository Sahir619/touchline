// Referral codes — a deterministic short code derived from the player's wallet,
// so a shared moment always carries the same `/r/<code>` invite link. Pure and
// client-safe: no backend round-trip. This is the W10 stub of the K-factor loop
// (the loop must be *visible*, not a full attribution pipeline yet).

// No ambiguous characters (0/O, 1/I) — codes get read aloud and re-typed.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A stable 6-char referral code for a wallet address, or null if unknown. */
export function referralCodeFor(wallet?: string | null): string | null {
  if (!wallet) return null;
  let code = "";
  // One FNV-1a pass per output char, seeded by position → stable + well spread.
  for (let i = 0; i < 6; i++) {
    let h = (0x811c9dc5 ^ i) >>> 0;
    for (let j = 0; j < wallet.length; j++) {
      h ^= wallet.charCodeAt(j);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    code += ALPHABET[h % ALPHABET.length];
  }
  return code;
}
