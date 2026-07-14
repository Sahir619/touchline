// Last-seen leaderboard rank, persisted per wallet in localStorage. Powers the
// loss-aversion RankNudge (SAH-70): on each return to /play (or /you) we compare
// the rank this visit to the one recorded last visit and, if it slipped, prompt a
// reclaim. This is a deliberately local, single-device signal — server-side
// rank-history and cross-device sync are explicitly out of scope for R2.

import { useCallback, useEffect, useState } from "react";
import type { LeaderRow } from "./game";

const RANK_KEY_PREFIX = "touchline.lastRank:";

export function getLastSeenRank(wallet: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(RANK_KEY_PREFIX + wallet);
    if (raw == null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function setLastSeenRank(wallet: string, rank: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RANK_KEY_PREFIX + wallet, String(rank));
  } catch {
    /* private mode / quota — the nudge just won't fire, which is acceptable */
  }
}

export interface RankDrop {
  /** The user's current (worse) rank. */
  rank: number;
  /** Display name of the player now directly ahead, when derivable from the rows. */
  passedBy: string | null;
}

/**
 * useRankNudge — the loss-aversion return signal.
 *
 * Compares the wallet's current leaderboard rank to the rank stored from the last
 * visit. Returns a `drop` only when the rank got WORSE (higher number) and a prior
 * rank was stored. On a climb / unchanged / first-ever visit it silently records the
 * current rank so it never nags. `acknowledge()` (dismiss or act on the CTA) records
 * the current rank, so the nudge re-arms only on a *new* drop.
 *
 * Renders nothing (drop === null) when: rank unchanged/improved, no prior rank stored,
 * guest (no wallet), or the wallet isn't on the leaderboard.
 */
export function useRankNudge(
  board: LeaderRow[] | null,
  wallet: string | undefined | null,
): { drop: RankDrop | null; acknowledge: () => void } {
  const [drop, setDrop] = useState<RankDrop | null>(null);
  // The current rank pinned alongside the drop, so acknowledge() can persist it.
  const [current, setCurrent] = useState<number | null>(null);

  useEffect(() => {
    if (!wallet || !board) {
      setDrop(null);
      setCurrent(null);
      return;
    }
    const myRow = board.find((r) => r.wallet === wallet);
    if (!myRow) {
      // Not on the leaderboard — nothing to compare, nothing to persist.
      setDrop(null);
      setCurrent(null);
      return;
    }
    const cur = myRow.rank;
    setCurrent(cur);
    const prev = getLastSeenRank(wallet);

    if (prev != null && cur > prev) {
      // Slipped. Whoever now sits directly ahead is the one who passed you.
      const ahead = board.find((r) => r.rank === cur - 1);
      const passedBy = ahead?.displayName?.trim() ? ahead.displayName : null;
      setDrop({ rank: cur, passedBy });
      // Do NOT record yet — keep the nudge live across refreshes until it's
      // acknowledged (dismissed or acted on).
    } else {
      // Climb, unchanged, or first-ever visit — record silently, no nudge.
      setLastSeenRank(wallet, cur);
      setDrop(null);
    }
  }, [board, wallet]);

  const acknowledge = useCallback(() => {
    if (wallet && current != null) setLastSeenRank(wallet, current);
    setDrop(null);
  }, [wallet, current]);

  return { drop, acknowledge };
}
