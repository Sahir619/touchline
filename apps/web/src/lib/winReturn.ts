// Last-seen resolved WIN, persisted per wallet in localStorage. Powers the
// Peak–End Win-Return payoff (SAH-69): on each return to /play we surface the
// user's most significant winning pick that resolved since this surface was last
// shown, then mark it seen so it never re-fires on subsequent loads. Deliberately
// local-only — no backend, no cross-device sync (acceptable for this local PWA,
// per spec; the return-side twin of the SAH-67 lock payoff).

import { useCallback, useEffect, useState } from "react";
import {
  impliedProbabilityPhrase,
  probabilityArticle,
  isAgainstMarket,
  trophyTier,
} from "@touchline/shared";
import type { Pick, Trophy } from "./game";

const WIN_KEY_PREFIX = "touchline.lastSeenWin:";

// On a first-ever visit (no marker stored yet) we only celebrate wins that
// resolved within this window, so a returning user isn't blasted with their whole
// season history the moment the feature ships. Once a win has been shown, the
// stored marker takes over as the "since last visit" boundary.
const FIRST_VISIT_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/** The last resolved win this surface showed — id (spec) + its resolve time (boundary). */
export interface SeenWin {
  id: number;
  resolvedAt: number;
}

export function getLastSeenWin(wallet: string): SeenWin | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WIN_KEY_PREFIX + wallet);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as Partial<SeenWin>;
    if (typeof parsed.id === "number" && typeof parsed.resolvedAt === "number") {
      return { id: parsed.id, resolvedAt: parsed.resolvedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export function setLastSeenWin(wallet: string, seen: SeenWin): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(WIN_KEY_PREFIX + wallet, JSON.stringify(seen));
  } catch {
    /* private mode / quota — the payoff just won't persist, which is acceptable */
  }
}

export interface WinReturn {
  /** The most significant winning pick not yet celebrated on this surface. */
  pick: Pick;
  /** How many *other* new wins also landed (rolls into the recap as "+N more"). */
  extraCount: number;
  /** The marker to persist once this surface is shown — advances past every fresh win. */
  marker: SeenWin;
}

/**
 * Pick the Win-Return hero from the user's picks. Pure + deterministic (all
 * clock/storage access lives in the hook below) so it's unit-testable.
 *
 * "Most significant" = highest points, tie-break on longest odds. `fresh` = wins
 * resolved strictly after the last-seen boundary (and never the exact last-seen id).
 * Returns null when there's nothing new to celebrate — which also covers guests
 * (no picks), fresh accounts (no wins), and an off day.
 */
export function selectWinReturn(
  picks: Pick[],
  now: number,
  lastSeen: SeenWin | null,
): WinReturn | null {
  const wins = picks.filter(
    (p): p is Pick & { resolvedAt: number } =>
      p.status === "won" && p.resolvedAt != null,
  );
  if (wins.length === 0) return null;

  const boundary = lastSeen ? lastSeen.resolvedAt : now - FIRST_VISIT_GRACE_MS;
  const fresh = wins.filter((p) => p.resolvedAt > boundary && p.id !== lastSeen?.id);
  if (fresh.length === 0) return null;

  const hero = [...fresh].sort(
    (a, b) => b.points - a.points || b.oddsAtLock - a.oddsAtLock,
  )[0]!;

  // Advance the boundary past *every* fresh win so none re-fire next load.
  const maxResolvedAt = fresh.reduce((m, p) => Math.max(m, p.resolvedAt), 0);

  return {
    pick: hero,
    extraCount: fresh.length - 1,
    marker: { id: hero.id, resolvedAt: maxResolvedAt },
  };
}

/** The team/outcome the user backed, for the big hero word (e.g. "JAPAN"). Never fabricates. */
export function backedOutcome(pick: Pick): string {
  if (pick.selection === "draw") return "THE DRAW";
  const fx = pick.fixture;
  if (fx) return pick.selection === "part1" ? fx.participant1 : fx.participant2;
  // No fixture join — fall back to a neutral label rather than invent a team name.
  return pick.selectionLabel === "1" ? "YOUR CALL" : pick.selectionLabel === "2" ? "YOUR CALL" : "THE DRAW";
}

/** Plain-language edge beaten: "you backed a 1-in-5 shot — against the market" (SAH-47 helpers). */
export function edgeBeatenLine(oddsAtLock: number): string {
  const phrase = impliedProbabilityPhrase(oddsAtLock);
  const article = probabilityArticle(phrase);
  const against = isAgainstMarket(oddsAtLock) ? ", against the market" : "";
  return `you backed ${article} ${phrase} shot${against}`;
}

/**
 * A ShareCard-shaped trophy for a winning pick — so the Win-Return payoff reuses the
 * existing ShareCard / share / PNG plumbing unchanged. Never fabricates: `oddsBeaten`
 * is the real locked price, and sub-3.0 favourites fall back to a neutral "Called it"
 * framing rather than claiming an underdog tier they didn't earn.
 */
export function winTrophy(pick: Pick): Trophy {
  const t = trophyTier(pick.oddsAtLock);
  return {
    id: pick.id,
    fixtureId: pick.fixtureId,
    tier: t.tier ?? "bronze",
    name: t.name ?? "Called it",
    oddsBeaten: pick.oddsAtLock,
    market: pick.market ?? null,
    selectionLabel: pick.selectionLabel ?? null,
    mintAddress: null,
    createdAt: pick.resolvedAt ?? pick.lockedAt,
    mintedAt: null,
  };
}

/**
 * useWinReturn — the return-visit celebration signal. Computes the hero from the
 * caller's already-fetched picks, then marks it seen the moment it's shown so it
 * never re-fires on refresh. Renders nothing (win === null) for guests (no wallet),
 * fresh accounts, or when no new win resolved since the last visit.
 */
export function useWinReturn(
  picks: Pick[],
  wallet: string | undefined | null,
): { win: WinReturn | null; dismiss: () => void } {
  const [win, setWin] = useState<WinReturn | null>(null);

  useEffect(() => {
    if (!wallet) {
      setWin(null);
      return;
    }
    const next = selectWinReturn(picks, Date.now(), getLastSeenWin(wallet));
    setWin(next);
    // Mark seen on show — this is what makes it "dismiss once seen": a refresh
    // won't re-fire it. Dismiss/act below just hides the (already-consumed) hero.
    if (next) setLastSeenWin(wallet, next.marker);
  }, [picks, wallet]);

  const dismiss = useCallback(() => setWin(null), []);

  return { win, dismiss };
}
