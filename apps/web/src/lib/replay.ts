"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WORKER_URL, workerFetch } from "./worker";

/* ============================================================================
   Match Replay — client feed + catalog.

   MIRROR of the worker's replay frame protocol (apps/worker/src/replay.ts).
   The web must NOT import from the worker package, so the ReplayFrame union is
   duplicated here by hand and kept in lockstep with that module (the WS envelope
   is { type:'replay', payload: ReplayFrame }). The worker is the source of truth.

   The hook opens its OWN WebSocket (never the shared useLiveFeed socket) and only
   ever reads type:'replay' frames, so replay traffic can never leak onto the live
   feed and a live viewer can never receive a replay frame.
   ========================================================================== */

export type ReplayIncident = "goal" | "own_goal" | "card" | "var" | "sub";

export type ReplayFrame =
  | {
      kind: "init";
      fixtureId: number;
      participant1: string;
      participant2: string;
      competition: string;
      speed: number;
      /** Single static 1X2 snapshot (decimal odds). Shown ONCE, labelled reference-only. */
      refOdds: { label: "1" | "X" | "2"; price: number }[] | null;
      refOddsNote: "snapshot";
      totalIncidents: number;
    }
  | {
      kind: "tick";
      seq: number;
      minute: number | null;
      p1: number;
      p2: number;
      statusLabel: string;
      incident: ReplayIncident;
      side: 1 | 2 | null;
      player: string | null;
      line: string;
    }
  | { kind: "clock"; minute: number | null; p1: number; p2: number; statusLabel: string }
  | { kind: "end"; p1: number; p2: number; finalStatus: string };

/** A row of GET /api/replays (worker `ReplayableFixture`). */
export interface ReplayCatalogRow {
  fixtureId: number;
  participant1: string;
  participant2: string;
  competition: string;
  p1: number;
  p2: number;
  finalStatus: string;
}

/** Fetch the public replay catalog. Returns [] on any non-OK / error (guest-safe). */
export async function getReplays(): Promise<ReplayCatalogRow[]> {
  try {
    const res = await workerFetch("/api/replays");
    if (!res.ok) return [];
    return (await res.json()) as ReplayCatalogRow[];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------- hook types */

export interface ReplayMeta {
  fixtureId: number;
  participant1: string;
  participant2: string;
  competition: string;
  speed: number;
  totalIncidents: number;
}

export interface ReplayScore {
  p1: number;
  p2: number;
  minute: number | null;
  statusLabel: string;
}

export type RefOdds = { label: "1" | "X" | "2"; price: number }[] | null;

/** A pundit-style line derived from a replay tick (template text from the engine). */
export interface ReplayLine {
  id: number;
  seq: number;
  minute: number | null;
  incident: ReplayIncident;
  player: string | null;
  line: string;
}

export interface ReplayFeed {
  connected: boolean;
  meta: ReplayMeta | null;
  score: ReplayScore;
  refOdds: RefOdds;
  lines: ReplayLine[];
  goalBurst: boolean;
  done: boolean;
  restart: () => void;
}

const LINES_CAP = 60;
const EMPTY_SCORE: ReplayScore = { p1: 0, p2: 0, minute: null, statusLabel: "" };

/**
 * Drive one match replay over a dedicated WebSocket.
 *
 * Opens its OWN socket (mirroring lib/ws.ts's connect pattern), sends
 * `replay:start` on open, and reduces the init/tick/clock/end frames into a
 * scoreboard + pundit-line feed. Reads ONLY type:'replay' frames — any real live
 * event on the wire is ignored. On unmount it sends `replay:stop` (if OPEN) and
 * closes the socket, freeing the worker-side session. `restart()` tears down and
 * reopens for a fresh run. A null `fixtureId` opens no socket.
 */
export function useReplayFeed(fixtureId: number | null, opts?: { speed?: number }): ReplayFeed {
  const speed = opts?.speed;
  const [connected, setConnected] = useState(false);
  const [meta, setMeta] = useState<ReplayMeta | null>(null);
  const [score, setScore] = useState<ReplayScore>(EMPTY_SCORE);
  const [refOdds, setRefOdds] = useState<RefOdds>(null);
  const [lines, setLines] = useState<ReplayLine[]>([]);
  const [goalBurst, setGoalBurst] = useState(false);
  const [done, setDone] = useState(false);
  // Bumped by restart() to force the effect to close the old socket and open a fresh one.
  const [epoch, setEpoch] = useState(0);

  const lineSeq = useRef(0);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const restart = useCallback(() => setEpoch((e) => e + 1), []);

  useEffect(() => {
    if (fixtureId == null) return;

    // Fresh session: reset all derived state before (re)connecting.
    setConnected(false);
    setMeta(null);
    setScore(EMPTY_SCORE);
    setRefOdds(null);
    setLines([]);
    setGoalBurst(false);
    setDone(false);
    lineSeq.current = 0;

    let closed = false;
    let ws: WebSocket | null = null;
    const url = WORKER_URL.replace(/^http/, "ws");

    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }

    ws.onopen = () => {
      if (closed) return;
      setConnected(true);
      ws?.send(JSON.stringify({ type: "replay:start", fixtureId, speed }));
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => ws?.close();
    ws.onmessage = (e) => {
      let msg: { type?: string; payload?: ReplayFrame };
      try {
        msg = JSON.parse(e.data) as { type?: string; payload?: ReplayFrame };
      } catch {
        return; // ignore malformed
      }
      // Only ever read replay frames — real live events on the wire are ignored.
      if (msg.type !== "replay" || !msg.payload) return;
      const frame = msg.payload;
      switch (frame.kind) {
        case "init":
          setMeta({
            fixtureId: frame.fixtureId,
            participant1: frame.participant1,
            participant2: frame.participant2,
            competition: frame.competition,
            speed: frame.speed,
            totalIncidents: frame.totalIncidents,
          });
          setRefOdds(frame.refOdds);
          setScore({ p1: 0, p2: 0, minute: null, statusLabel: "" });
          setLines([]);
          setDone(false);
          break;
        case "tick": {
          setScore({ p1: frame.p1, p2: frame.p2, minute: frame.minute, statusLabel: frame.statusLabel });
          const entry: ReplayLine = {
            id: ++lineSeq.current,
            seq: frame.seq,
            minute: frame.minute,
            incident: frame.incident,
            player: frame.player,
            line: frame.line,
          };
          setLines((prev) => [entry, ...prev].slice(0, LINES_CAP));
          // A goal (real or own) changes the scoreline → a transient celebratory burst.
          if (frame.incident === "goal" || frame.incident === "own_goal") {
            clearTimeout(burstTimer.current);
            setGoalBurst(true);
            burstTimer.current = setTimeout(() => setGoalBurst(false), 1700);
          }
          break;
        }
        case "clock":
          // Liveness heartbeat — advance minute + echo running score, no new line.
          setScore({ p1: frame.p1, p2: frame.p2, minute: frame.minute, statusLabel: frame.statusLabel });
          break;
        case "end":
          setScore((prev) => ({ ...prev, p1: frame.p1, p2: frame.p2, statusLabel: frame.finalStatus }));
          setDone(true);
          break;
      }
    };

    return () => {
      closed = true;
      clearTimeout(burstTimer.current);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "replay:stop" }));
        } catch {
          /* socket already gone */
        }
      }
      ws?.close();
    };
  }, [fixtureId, speed, epoch]);

  return { connected, meta, score, refOdds, lines, goalBurst, done, restart };
}
