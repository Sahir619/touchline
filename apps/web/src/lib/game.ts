// Game API: odds, picks, leaderboard.
import { workerFetch, authedFetch } from "./worker";

export interface MarketOdds {
  fixtureId: number;
  superOddsType: string;
  marketParameters: string | null;
  marketPeriod: string | null;
  priceNames: string[] | null;
  prices: number[] | null;
  pct: string[] | null;
  inRunning: boolean;
}

export interface FixtureRow {
  fixtureId: number;
  competition: string;
  startTime: number;
  participant1: string;
  participant2: string;
  participant1IsHome: boolean;
}

export type Selection = "part1" | "draw" | "part2";

export interface Pick {
  id: number;
  fixtureId: number;
  market: string;
  selection: Selection;
  selectionLabel: "1" | "X" | "2";
  oddsAtLock: number;
  status: "open" | "won" | "lost" | "void";
  points: number;
  lockedAt: number;
  resolvedAt: number | null;
  fixture?: FixtureRow | null;
  // Beat the Line (SAH) — the market's closing snapshot at kickoff vs. the at-lock
  // line. All null until the worker stamps them at close. `beatLine` true => the
  // market moved toward this call before kickoff (the sharp signal).
  oddsAtClose?: number | null;
  pctAtClose?: number | null;
  clv?: number | null;
  beatLine?: boolean | null;
}

export interface LeaderRow {
  rank: number;
  wallet: string;
  displayName: string | null;
  nation: string | null;
  xp: number;
  level: number;
  trophies: number;
  streak: number;
  /** Beat the Line (SAH) — the sharp signals. `sharpScore` is the running skill
   *  rating; `linesBeaten` counts calls where the market moved toward them at close.
   *  Default to 0 for rows the worker hasn't stamped yet. */
  sharpScore?: number;
  linesBeaten?: number;
  /** SAH-74: true for seeded Demo League sample players — surfaces badge this DEMO. */
  demo?: boolean;
  /** SAH-74: most-recent-call context for demo rows, e.g. "Called Japan — landed ✓". */
  recentCall?: string | null;
}

export async function getFixture(id: number): Promise<{ fixture: FixtureRow; state: unknown } | null> {
  const r = await workerFetch(`/api/fixtures/${id}`);
  if (!r.ok) return null;
  return r.json();
}

export async function getFixtureOdds(id: number): Promise<MarketOdds[]> {
  const r = await workerFetch(`/api/fixtures/${id}/odds`);
  if (!r.ok) return [];
  return r.json();
}

/**
 * Lock a pick. `market` is optional and defaults to '1X2_PARTICIPANT_RESULT' server-side
 * (backward compatible with every pre-existing call site). `selection` is widened to
 * `string` so the same function can also lock the new Over/Under ('over'|'under') and
 * correct-score (a scoreline like '2-1') picks (W7/SAH-35) — the return type stays `Pick`
 * for source compatibility with the existing 1X2 call site; secondary-market callers only
 * read `.oddsAtLock`/`.points` off it, never `.selection`.
 */
export async function postPick(
  token: string,
  fixtureId: number,
  selection: string,
  market?: string,
): Promise<{ pick: Pick; potentialPoints: number }> {
  const r = await authedFetch(token, "/api/picks", {
    method: "POST",
    body: JSON.stringify(market ? { fixtureId, selection, market } : { fixtureId, selection }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error ?? "Couldn't lock pick");
  return body;
}

/** 1X2-only, newest first — the existing contract /live/[id] and /you depend on structurally. */
export async function getMyPicks(token: string): Promise<Pick[]> {
  const r = await authedFetch(token, "/api/picks");
  if (!r.ok) return [];
  return r.json();
}

/** A pick in any market (1X2, Over/Under, or correct-score) — `selection`/`selectionLabel`
 *  are plain strings here (not the narrow `Selection` union) since a secondary-market pick's
 *  selection is 'over'|'under' or a scoreline like '2-1', not part1|draw|part2. */
export interface AnyPick {
  id: number;
  fixtureId: number;
  market: string;
  selection: string;
  selectionLabel: string;
  oddsAtLock: number;
  status: "open" | "won" | "lost" | "void";
  points: number;
  lockedAt: number;
  resolvedAt: number | null;
  fixture?: FixtureRow | null;
  // Beat the Line (SAH) — see `Pick`. Null until the worker stamps them at close.
  oddsAtClose?: number | null;
  pctAtClose?: number | null;
  clv?: number | null;
  beatLine?: boolean | null;
  // Star Man only (STAR_MAN_GOAL). `potentialPoints` mirrors the at-lock number the
  // server returned from postPick (bench/underdog/stage multipliers baked in), so a
  // reloaded receipt matches it instead of the flat base implied by oddsAtLock. `scored`
  // is true once the called player has found the net (legitimate, non-own goal), so the
  // live room can reflect a Star Man who scored before the viewer joined. Absent on every
  // other market.
  potentialPoints?: number;
  scored?: boolean;
}

/** Every one of the caller's picks, across every market. Powers only the new secondary-market
 *  UI (W7/SAH-35) — kept separate from `getMyPicks`/`Pick` so existing structurally-typed
 *  callers (the live room, /you) are untouched. */
export async function getMyPicksAllMarkets(token: string): Promise<AnyPick[]> {
  const r = await authedFetch(token, "/api/picks/all");
  if (!r.ok) return [];
  return r.json();
}

/* ============================================================================
   Star Man (SAH) — before kickoff, name ONE player from either team's official
   lineup as your Star Man. If he scores (own goals never count), the call wins;
   the reward scales with how unlikely he was to feature/score (bench + underdog
   multipliers, resolved server-side). Rides the EXISTING picks table via
   `postPick` with a new market string, so /you and recap need no changes
   (selectionLabel is the player's display name). The market constant is kept
   web-local (NOT imported from @touchline/shared) so the web typechecks
   independently of the worker's parallel scoring build.
   ========================================================================== */
export const STAR_MAN_MARKET = "STAR_MAN_GOAL";

export interface LineupPlayer {
  /** player.normativeId — the stable numeric id goal events carry as dataSoccer.PlayerId. */
  playerId: number;
  /** Server-formatted display name ("A. Amenda" style). */
  name: string;
  rosterNumber: string | null;
  starter: boolean;
}

export interface LineupTeam {
  teamId: number;
  team: string;
  players: LineupPlayer[];
}

/** Published lineups for a fixture, one entry per team. Empty array until the feed
 *  delivers lineups (about an hour before kickoff) — the match page shows a quiet
 *  teaser until then. Public (mirrors the other fixture reads). */
export async function getLineups(fixtureId: number): Promise<LineupTeam[]> {
  const r = await workerFetch(`/api/fixtures/${fixtureId}/lineups`);
  if (!r.ok) return [];
  const body = (await r.json().catch(() => null)) as { teams?: LineupTeam[] } | null;
  return body?.teams ?? [];
}

/** Short display form of a lineup name. Handles the wire's "Lastname, Firstname"
 *  ("Amenda, Aurele" -> "A. Amenda") and passes an already-short name through
 *  unchanged, so a chip reads cleanly whatever shape the API sends. */
export function shortPlayerName(raw: string): string {
  const s = raw.trim();
  if (!s.includes(",")) return s;
  const [last, first] = s.split(",").map((part) => part.trim());
  const initial = first && first.length > 0 ? `${first[0]!.toUpperCase()}. ` : "";
  return `${initial}${last ?? s}`.trim();
}

// --- pending guest pick ---
// A guest's lock doesn't hit the server (no wallet yet); stash it so the
// /connect sign-in flow can resubmit it once a token exists, instead of
// silently dropping it.
const PENDING_PICK_KEY = "touchline.pendingPick";

export interface PendingPick {
  fixtureId: number;
  selection: Selection;
  label: string;
  odds: number;
  points: number;
}

export function stashPendingPick(pick: PendingPick): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PENDING_PICK_KEY, JSON.stringify(pick));
}

export function getPendingPick(): PendingPick | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PENDING_PICK_KEY);
    return raw ? (JSON.parse(raw) as PendingPick) : null;
  } catch {
    return null;
  }
}

export function clearPendingPick(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PENDING_PICK_KEY);
}

// One-shot flag so the match page can show a "signed in, pick carried over"
// confirmation after /connect resubmits a stashed guest pick and navigates back.
const RESUMED_PICK_KEY = "touchline.resumedPick";

export function markPickResumed(fixtureId: number): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(RESUMED_PICK_KEY, String(fixtureId));
}

export function consumeResumedFlag(fixtureId: number): boolean {
  if (typeof window === "undefined") return false;
  const raw = sessionStorage.getItem(RESUMED_PICK_KEY);
  if (raw !== String(fixtureId)) return false;
  sessionStorage.removeItem(RESUMED_PICK_KEY);
  return true;
}

// --- pending league join ---
// A guest tapping a /join/[code] deep-link doesn't have a session yet; stash
// the code so /connect (and onboarding, for brand-new profiles) can auto-join
// once a token exists, instead of dropping the invite on the floor.
const PENDING_JOIN_KEY = "touchline.pendingJoin";

export function stashPendingJoin(code: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PENDING_JOIN_KEY, code);
}

export function getPendingJoin(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PENDING_JOIN_KEY);
}

export function clearPendingJoin(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PENDING_JOIN_KEY);
}

export async function getLeaderboard(): Promise<LeaderRow[]> {
  const r = await workerFetch("/api/leaderboard");
  if (!r.ok) return [];
  return r.json();
}

export interface UserStats {
  wallet: string;
  open: number;
  won: number;
  lost: number;
  void: number;
  decided: number;
  hitRate: number | null;
}

/** Public accuracy stats for any wallet — powers the leaderboard row popover and /you. */
export async function getUserStats(wallet: string): Promise<UserStats | null> {
  const r = await workerFetch(`/api/users/${encodeURIComponent(wallet)}/stats`);
  if (!r.ok) return null;
  return r.json();
}

/** Beat the Line (SAH) — the signed-in user's sharp rating. `sharpScore` is the
 *  running skill number; `linesBeaten` counts calls the market moved toward before
 *  kickoff. Read off GET /api/me (kept separate from the shared `Profile` type so
 *  the web typechecks whether or not the worker has stamped these yet). */
export interface SharpStats {
  sharpScore: number;
  linesBeaten: number;
}

export async function getSharpStats(token: string): Promise<SharpStats | null> {
  const r = await authedFetch(token, "/api/me");
  if (!r.ok) return null;
  const body = (await r.json().catch(() => null)) as
    | { sharpScore?: unknown; linesBeaten?: unknown }
    | null;
  if (!body) return null;
  return {
    sharpScore: typeof body.sharpScore === "number" ? body.sharpScore : 0,
    linesBeaten: typeof body.linesBeaten === "number" ? body.linesBeaten : 0,
  };
}

/** A league-mate's call on a given fixture — powers the live-room "in the room" board. */
export interface RoomPick {
  wallet: string;
  displayName: string | null;
  nation: string | null;
  selection: Selection;
  selectionLabel: "1" | "X" | "2";
  oddsAtLock: number;
  status: "open" | "won" | "lost" | "void";
}

/** League-mates (across all the user's leagues) who have called this fixture. */
export async function getRoomPicks(token: string, fixtureId: number): Promise<RoomPick[]> {
  const r = await authedFetch(token, `/api/fixtures/${fixtureId}/room`);
  if (!r.ok) return [];
  return r.json();
}

// --- pundit scrollback (SAH-77) ---
// One line of the live pundit's running commentary. `ts` is the worker emit time and is
// the stable identity used to merge server history with lines already received over WS.
export interface PunditHistoryLine {
  seq: number;
  wallet: string;
  fixtureId: number;
  line: string;
  persona: string;
  kind: string;
  ts: number;
}

/** Recent pundit lines for this user on a fixture (per-session, oldest→newest). Backfills
 *  the Pundit Feed panel on open so it's populated even for a mid-match join. */
export async function getPunditHistory(token: string, fixtureId: number): Promise<PunditHistoryLine[]> {
  const r = await authedFetch(token, `/api/pundit/history?fixtureId=${fixtureId}`);
  if (!r.ok) return [];
  return r.json();
}

// --- trophies ---
export interface Trophy {
  id: number;
  fixtureId: number | null;
  tier: "bronze" | "silver" | "gold";
  name: string;
  oddsBeaten: number | null;
  market: string | null;
  selectionLabel: string | null;
  mintAddress: string | null;
  createdAt: number;
  mintedAt: number | null;
  /** This trophy's position among all minted trophies of the same tier+name (e.g. the 7th Oracle). Null until minted. */
  edition?: number | null;
}

export async function getTrophies(token: string): Promise<Trophy[]> {
  const r = await authedFetch(token, "/api/trophies");
  if (!r.ok) return [];
  return r.json();
}

export async function mintTrophy(token: string, id: number): Promise<{ mintAddress: string; explorer: string }> {
  const r = await authedFetch(token, `/api/trophies/${id}/mint`, { method: "POST" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error ?? "Mint failed");
  return body;
}

// --- SAH-74 activity feed (derived demo populace) ---
export interface FeedEvent {
  id: string;
  type: "called-upset" | "landed" | "streak" | "watching" | "minted";
  name: string;
  nation: string | null;
  demo: true;
  fixture: string;
  outcome: string;
  odds: number | null;
  shot: string | null;
  n: number | null;
  points: number | null;
  ts: number;
}

/** The derived Demo-League activity feed. Public (works for guests). Empty until seeded. */
export async function getFeed(): Promise<FeedEvent[]> {
  const r = await workerFetch("/api/feed");
  if (!r.ok) return [];
  return r.json();
}

// --- leagues ---
export interface League {
  id: string;
  name: string;
  owner?: string;
  /** SAH-74: true for the seeded "Demo League" — surfaces badge it as a sample league. */
  isDemo?: boolean;
}

export async function getLeagues(token: string): Promise<League[]> {
  const r = await authedFetch(token, "/api/leagues");
  if (!r.ok) return [];
  return r.json();
}

export async function createLeague(token: string, name: string): Promise<{ id: string; name: string; inviteCode: string }> {
  const r = await authedFetch(token, "/api/leagues", { method: "POST", body: JSON.stringify({ name }) });
  if (!r.ok) throw new Error("Couldn't create league");
  return r.json();
}

export async function joinLeague(token: string, code: string): Promise<{ id: string; name: string }> {
  const r = await authedFetch(token, `/api/leagues/${code}/join`, { method: "POST" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error ?? "Couldn't join league");
  return body;
}

/** Shareable deep-link that lands a friend on /join/[code], not just the raw code. */
export function inviteJoinUrl(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/join/${code}`;
}

export type InviteShareResult = "shared" | "copied" | "cancelled" | "failed";

/**
 * Open a real share moment for a league invite: native share sheet where
 * available, falling back to a clipboard copy of the /join/[code] deep-link.
 */
export async function shareInvite(leagueName: string, code: string): Promise<InviteShareResult> {
  const url = inviteJoinUrl(code);
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: `Join ${leagueName} on Touchline`, text: `Join my Touchline league: ${leagueName}`, url });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
      // fall through to clipboard fallback
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

export async function getLeague(token: string, id: string): Promise<{ league: League; board: LeaderRow[] } | null> {
  const r = await authedFetch(token, `/api/leagues/${id}`);
  if (!r.ok) return null;
  return r.json();
}

// --- bracket / champion pool (SAH-58/SAH-60) ---
// A one-time, season-long champion (+ optional runner-up) call — separate
// from and additive to the per-match pick'em loop above.
export interface Team {
  id: number;
  name: string;
}

export interface BracketPick {
  wallet: string;
  championId: number;
  championName: string;
  runnerUpId: number | null;
  runnerUpName: string | null;
  status: "open" | "resolved";
  points: number;
  lockedAt: number;
  resolvedAt: number | null;
}

export interface BracketState {
  pick: BracketPick | null;
  lockAt: number | null;
  locked: boolean;
}

/** Distinct teams from ingested fixtures — powers the champion/runner-up picker. */
export async function getTournamentTeams(): Promise<Team[]> {
  const r = await workerFetch("/api/tournament/teams");
  if (!r.ok) return [];
  return r.json();
}

/** The caller's bracket pick + whether the pool is still open. */
export async function getBracket(token: string): Promise<BracketState | null> {
  const r = await authedFetch(token, "/api/bracket");
  if (!r.ok) return null;
  return r.json();
}

/** Submit or update the caller's champion (+ optional runner-up) pick. */
export async function postBracket(
  token: string,
  championId: number,
  championName: string,
  runnerUpId?: number | null,
  runnerUpName?: string | null,
): Promise<{ pick: BracketPick }> {
  const r = await authedFetch(token, "/api/bracket", {
    method: "POST",
    body: JSON.stringify({ championId, championName, runnerUpId, runnerUpName }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error ?? "Couldn't save your pick");
  return body;
}

export interface BracketPoolRow {
  championId: number;
  championName: string;
  count: number;
}

/** Aggregate "who's backing whom" — champion pick counts across all wallets. */
export async function getBracketPool(): Promise<BracketPoolRow[]> {
  const r = await workerFetch("/api/bracket/pool");
  if (!r.ok) return [];
  return r.json();
}

export interface LeagueBracketRow {
  wallet: string;
  displayName: string | null;
  nation: string | null;
  championName: string;
  runnerUpName: string | null;
  status: "open" | "resolved";
  bracketPoints: number;
}

/** Bracket standings scoped to a private league — the persistent private-pool leaderboard. */
export async function getLeagueBracket(
  token: string,
  id: string,
): Promise<{ league: League; board: LeagueBracketRow[] } | null> {
  const r = await authedFetch(token, `/api/leagues/${id}/bracket`);
  if (!r.ok) return null;
  return r.json();
}
