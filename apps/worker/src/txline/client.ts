// TxLineClient — typed read + SSE access to the TxLINE data API.
// Every request sends BOTH auth headers (Authorization: Bearer <jwt> AND X-Api-Token).
// SSE is consumed server-side via fetch + getReader (NOT EventSource, which can't set headers).

import {
  FixtureSchema,
  OddsPayloadSchema,
  ScoreEventSchema,
  WORLD_CUP_COMPETITION_ID,
  type Fixture,
  type OddsPayload,
  type ScoreEvent,
} from '@touchline/shared';
import { z } from 'zod';

export interface StreamOptions {
  /** Filter to one fixture (the only filter TxLINE's stream supports). */
  fixtureId?: number;
  /** Stop the stream. */
  signal?: AbortSignal;
  /** Reconnect backoff in ms (default 2000). */
  reconnectMs?: number;
}

export class TxLineClient {
  constructor(
    private readonly jwt: string,
    private readonly apiToken: string,
    private readonly dataHost: string,
  ) {}

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.jwt}`,
      'X-Api-Token': this.apiToken,
      ...extra,
    };
  }

  private async getArray<T>(path: string, schema: z.ZodTypeAny): Promise<T[]> {
    const res = await fetch(`${this.dataHost}${path}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return [];
    const out: T[] = [];
    let dropped = 0;
    let sampleKeys: string[] | null = null;
    for (const item of body) {
      const parsed = schema.safeParse(item);
      if (parsed.success) {
        out.push(parsed.data as T);
      } else {
        dropped++;
        if (!sampleKeys && item && typeof item === 'object') {
          sampleKeys = Object.keys(item as Record<string, unknown>).slice(0, 20);
        }
      }
    }
    // Observability: a silent schema-drop bug (PascalCase wire vs camelCase schema) once
    // dropped 100% of live scores invisibly. Never again — surface the count + ONE sample's
    // top-level keys (never full payloads) so a shape drift is caught at a glance.
    if (dropped > 0) {
      console.warn(
        `[txline] GET ${path}: dropped ${dropped}/${body.length} items failing schema validation. ` +
          `Sample item keys: ${sampleKeys ? sampleKeys.join(',') : 'n/a'}`,
      );
    }
    return out;
  }

  /** Latest fixtures snapshot, filtered to a competition (default: World Cup = 72). */
  getFixtures(competitionId: number = WORLD_CUP_COMPETITION_ID): Promise<Fixture[]> {
    return this.getArray<Fixture>(
      `/api/fixtures/snapshot?competitionId=${competitionId}`,
      FixtureSchema,
    );
  }

  /** Latest odds for a fixture; pass `asOf` (epoch ms) to snapshot the line at lock time. */
  getOddsSnapshot(fixtureId: number, asOf?: number): Promise<OddsPayload[]> {
    const q = asOf != null ? `?asOf=${asOf}` : '';
    return this.getArray<OddsPayload>(`/api/odds/snapshot/${fixtureId}${q}`, OddsPayloadSchema);
  }

  /** Latest score events for a fixture (per-action snapshots). */
  getScoresSnapshot(fixtureId: number): Promise<ScoreEvent[]> {
    return this.getArray<ScoreEvent>(`/api/scores/snapshot/${fixtureId}`, ScoreEventSchema);
  }

  /** Live odds stream (auto-reconnecting via Last-Event-ID). */
  streamOdds(opts: StreamOptions = {}): AsyncGenerator<OddsPayload> {
    return this.stream<OddsPayload>('/api/odds/stream', OddsPayloadSchema, opts);
  }

  /** Live scores stream (auto-reconnecting via Last-Event-ID). */
  streamScores(opts: StreamOptions = {}): AsyncGenerator<ScoreEvent> {
    return this.stream<ScoreEvent>('/api/scores/stream', ScoreEventSchema, opts);
  }

  /**
   * Generic SSE consumer: reconnects on stream end/error, resuming from the last event id.
   * Each TxLINE event is `data: {json}` then `id: <ts>:<idx>`; heartbeats carry `event:`.
   */
  private async *stream<T>(
    path: string,
    schema: z.ZodTypeAny,
    opts: StreamOptions,
  ): AsyncGenerator<T> {
    const { fixtureId, signal, reconnectMs = 2000 } = opts;
    const url = `${this.dataHost}${path}${fixtureId != null ? `?fixtureId=${fixtureId}` : ''}`;
    let lastEventId: string | undefined;

    while (!signal?.aborted) {
      try {
        const headers = this.authHeaders({ Accept: 'text/event-stream' });
        if (lastEventId) headers['Last-Event-ID'] = lastEventId;

        const res = await fetch(url, { headers, signal });
        if (!res.ok || !res.body) {
          throw new Error(`SSE ${path} ${res.status}: ${await res.text()}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        // Per-session schema-drop tally (see getArray for why this exists). Warned ONCE per
        // stream-session so a silent shape drift on the live wire can never recur invisibly.
        let dropped = 0;
        let sampleKeys: string[] | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const frames = buf.split('\n\n');
          buf = frames.pop() ?? '';

          for (const frame of frames) {
            if (!frame.trim()) continue;
            let dataStr = '';
            let eventType = '';
            for (const line of frame.split('\n')) {
              if (line.startsWith('data:')) dataStr += line.slice(5).trim();
              else if (line.startsWith('id:')) lastEventId = line.slice(3).trim();
              else if (line.startsWith('event:')) eventType = line.slice(6).trim();
            }
            if (eventType === 'heartbeat' || !dataStr) continue;
            let raw: unknown;
            try {
              raw = JSON.parse(dataStr);
            } catch {
              continue; // skip malformed frame (not a schema drop)
            }
            const parsed = schema.safeParse(raw);
            if (parsed.success) {
              yield parsed.data as T;
            } else {
              dropped++;
              if (!sampleKeys && raw && typeof raw === 'object') {
                sampleKeys = Object.keys(raw as Record<string, unknown>).slice(0, 20);
              }
            }
          }
        }
        if (dropped > 0) {
          console.warn(
            `[txline] ${path} stream session dropped ${dropped} events failing schema validation. ` +
              `Sample event keys: ${sampleKeys ? sampleKeys.join(',') : 'n/a'}`,
          );
        }
      } catch (err) {
        if (signal?.aborted) return;
        console.warn(`[txline] ${path} stream dropped, reconnecting:`, (err as Error).message);
      }
      if (signal?.aborted) return;
      await new Promise((r) => setTimeout(r, reconnectMs));
    }
  }
}
