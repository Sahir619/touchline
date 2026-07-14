// Tiny typed in-process pub/sub. The ingestion layer publishes deltas; the WS gateway
// (and later the scoring/pundit engines) subscribe. Swap for Redis pub/sub when scaling
// to multiple worker instances.

import { EventEmitter } from 'node:events';
import type { OddsPayload, ScoreEvent } from '@touchline/shared';

export interface BusEvents {
  odds: OddsPayload;
  score: ScoreEvent;
  fixtures: { count: number };
  resolved: { wallet: string; fixtureId: number; correct: boolean; points: number; streak: number };
  pundit: { wallet: string; fixtureId: number; line: string; persona: string; kind: string; ts: number };
  bracketResolved: { wallet: string; championId: number; correct: boolean; points: number };
  // Beat the Line — emitted ONLY when a pick beat the closing line (beatLine === true).
  // pctAtLock/pctAtClose are implied-probability fractions [0,1] (mirroring the DB);
  // clv is percentage points toward the pick.
  clv: {
    wallet: string;
    fixtureId: number;
    market: string;
    selectionLabel: string;
    pctAtLock: number | null;
    pctAtClose: number | null;
    clv: number;
    beatLine: boolean;
  };
}

class TypedBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // many WS clients + engines may listen
    this.emitter.setMaxListeners(0);
  }

  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]): void {
    this.emitter.emit(type, payload);
  }

  on<K extends keyof BusEvents>(type: K, handler: (payload: BusEvents[K]) => void): () => void {
    this.emitter.on(type, handler as (p: unknown) => void);
    return () => this.emitter.off(type, handler as (p: unknown) => void);
  }
}

export const bus = new TypedBus();
