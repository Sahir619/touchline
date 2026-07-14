// Per-session pundit scrollback (SAH-77). The live AI pundit is otherwise ephemeral —
// lines fan out over WS and are gone. This keeps a small in-memory ring buffer of the
// most recent lines per fixture so the web "Pundit Feed" panel can backfill history the
// instant it opens (e.g. a user who joins /live mid-match, or reconnects), not just show
// lines that happened to arrive after their socket connected.
//
// Scope (per the board's stated assumption on SAH-77): per-match/SESSION only. This is
// deliberately in-memory — it resets on worker restart, and persist-across-sessions is a
// documented follow-on. No DB migration, no schema change. Lines are per-wallet (the
// pundit only fires for a wallet holding an open pick), so reads are wallet-scoped.

import { bus } from './bus.ts';

export interface PunditHistoryLine {
  seq: number;
  wallet: string;
  fixtureId: number;
  line: string;
  persona: string;
  kind: string;
  ts: number;
}

// Keep the last N lines per fixture across ALL wallets on that fixture; reads then
// filter to the requesting wallet. Comfortably covers a full 90'+ match of one user's
// commentary while bounding memory for a demo-scale dataset.
const MAX_PER_FIXTURE = 80;

const byFixture = new Map<number, PunditHistoryLine[]>();
let seq = 0;
let started = false;

/** Subscribe the buffer to the pundit bus. Idempotent; call once at boot. */
export function startPunditHistory(): void {
  if (started) return;
  started = true;
  bus.on('pundit', (p) => {
    const list = byFixture.get(p.fixtureId) ?? [];
    list.push({
      seq: ++seq,
      wallet: p.wallet,
      fixtureId: p.fixtureId,
      line: p.line,
      persona: p.persona,
      kind: p.kind,
      ts: p.ts,
    });
    // Trim to the cap from the front (oldest out) so memory stays bounded.
    if (list.length > MAX_PER_FIXTURE) list.splice(0, list.length - MAX_PER_FIXTURE);
    byFixture.set(p.fixtureId, list);
  });
}

/** Recent pundit lines for one wallet on one fixture, oldest→newest (running-log order). */
export function getPunditHistory(fixtureId: number, wallet: string, limit = 60): PunditHistoryLine[] {
  const list = byFixture.get(fixtureId) ?? [];
  const mine = list.filter((l) => l.wallet === wallet);
  return mine.slice(-limit);
}
