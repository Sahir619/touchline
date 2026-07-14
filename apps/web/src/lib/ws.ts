"use client";

import { useEffect, useRef, useState } from "react";
import { WORKER_URL } from "./worker";

export interface LiveMessage {
  type: "odds" | "score" | "resolved" | "pundit" | "fixtures" | "clv";
  payload: unknown;
}

/**
 * "Beat the Line" (SAH) — emitted by the worker ONLY when a locked call beat the
 * market: the closing implied probability moved toward the user's selection by at
 * least the sharp threshold before kickoff. Carries the at-lock → at-close swing
 * for the celebratory live moment. `wallet`/`fixtureId` scope it to the recipient.
 */
export interface ClvPayload {
  wallet: string;
  fixtureId: number;
  market: string;
  selectionLabel: string;
  pctAtLock: number;
  pctAtClose: number;
  clv: number;
  beatLine: boolean;
}

/**
 * Subscribe to the worker's WebSocket gateway. Calls `onMessage` for every event
 * (odds / score / pundit / resolved / fixtures). Auto-reconnects. Returns connected state.
 */
export function useLiveFeed(onMessage: (msg: LiveMessage) => void): boolean {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const url = WORKER_URL.replace(/^http/, "ws");

    const connect = () => {
      try {
        ws = new WebSocket(url);
      } catch {
        retry = setTimeout(connect, 2500);
        return;
      }
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2500);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (e) => {
        try {
          handler.current(JSON.parse(e.data) as LiveMessage);
        } catch {
          /* ignore malformed */
        }
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return connected;
}
