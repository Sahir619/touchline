# Touchline — running & verifying

A free-to-play World Cup prediction game on Solana, powered by TxLINE. Monorepo: `apps/web` (Next.js), `apps/worker` (live engine), `packages/shared`.

## Prereqs
- Node 20+ (built on 24), pnpm 11, a Solana **devnet** wallet with a little test SOL.
- `apps/worker/.env` already holds a funded devnet app wallet (`TXLINE_WALLET_SECRET`) for the TxLINE subscription + trophy minting. Optional: set `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` (a `:free` model id) to swap the pundit from template lines to a live LLM. Never set `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` — board directive, SAH-55.

## Install & run
```bash
pnpm install                                   # patches @noble/hashes for mpl-core (automatic)
pnpm --filter @touchline/worker start          # terminal 1 → API+WS on :8787, ingests live WC data
pnpm --filter @touchline/web dev               # terminal 2 → app on :3000
```
Open http://localhost:3000. Connect Phantom/Solflare (set the wallet to **devnet**), sign in (free signature), onboard (nation + pundit), then make a pick.

## What runs where
- **Worker** (`:8787`) owns everything server-side: one-time on-chain `subscribe()`+activate to TxLINE, SSE consumers → normalize → Postgres (embedded PGlite; swap to Supabase via `DATABASE_URL`), scoring/resolution, the AI pundit, the WS gateway, and trophy minting. TxLINE/LLM/mint secrets never leave it.
- **Web** (`:3000`) is the Next.js PWA: wallet auth, Today slate, match pick/lock, live screen, leaderboard, profile + trophy cabinet, leagues.

## Routes
`/` Today · `/match/[id]` pick · `/live` + `/live/[id]` live · `/leaderboard` · `/leagues` + `/leagues/[id]` · `/you` profile · `/connect` · `/onboarding`

## API (worker)
- Auth: `POST /api/auth/nonce|verify`, `GET|PATCH /api/me`
- Data: `GET /api/slate`, `/api/fixtures`, `/api/fixtures/:id[/odds|/state]`
- Game: `POST|GET /api/picks`, `GET /api/leaderboard`, `POST /api/dev/resolve/:id` (dev)
- Trophies: `GET /api/trophies`, `POST /api/trophies/:id/mint`, `GET /api/trophies/:id/metadata|image`
- Leagues: `POST /api/leagues`, `POST /api/leagues/:id/join`, `GET /api/leagues`, `GET /api/leagues/:id`
- WS `ws://:8787` → `{type: odds|score|resolved|pundit|fixtures, payload}`

## Verified end-to-end (devnet, real data)
- Live ingestion: 19 WC fixtures (competitionId 72) + live odds via SSE writing to Postgres.
- Auth: sign-in-with-Solana → session JWT → profile + onboarding.
- Pick'em: lock @ odds_at_lock → idempotent resolution → odds-weighted points, streak, XP, leaderboard.
- Pundit: persona line delivered over WebSocket on resolve / odds swing.
- Trophy: long-shot win → Gold "Oracle" → **minted on devnet** (e.g. `DfJZhe6KBxLS82a3H2oKqjmpxdaQWqio8K5X2GKaiLcu`).
- Leagues: create + scoped leaderboard.

## Notes / known gaps
- DB is in-memory PGlite (resets on worker restart) — set `PGLITE_DATA_DIR` to persist, or `DATABASE_URL` for Supabase.
- Scores SSE was quiet on devnet during testing (no goals firing in the sim window); odds SSE proves the identical live path. Live-match resolution triggers automatically on `statusSoccerId` F/FET/FPE; `/api/dev/resolve` forces it for demos.
- `apps/worker/.env` is gitignored — it carries the devnet wallet secret (test SOL only).
