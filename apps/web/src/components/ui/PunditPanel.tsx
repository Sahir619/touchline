"use client";

// PunditPanel (SAH-77) — the live pundit is otherwise ephemeral: lines fan out over the
// WebSocket one-by-one and scroll away. This adds a persistent pundit chip (latest line +
// unread badge) that opens a drawer with the FULL running log — every past line, re-readable,
// live-updating as new ones land. Lines are accumulated client-side (nothing is lost during
// the session) and backfilled from GET /api/pundit/history on open so the panel is populated
// immediately even for a mid-match join. Stadium Night, mobile-first.
//
// The drawer can also EXPAND to a full-viewport reading surface (solid, not glass) with the
// running feed large and an Ask input pinned at the bottom, so it reads as "the pundit is
// talking with you". Collapse (or Esc) returns to the drawer.
//
// Motion discipline (fixes the "entrance freezes mid-open" bug): the drawer container owns the
// entrance spring; the backfilled history lines are STATIC (AnimatePresence initial={false}),
// with per-line entrance reserved for NEW lines arriving while the panel is open. Crucially the
// list items carry NO `layout` prop — a `layout` item inside a container that is being
// transformed (the entrance) or hard-scrolled (the open snap) tries to FLIP-animate its whole
// positional delta, which is exactly what stalled the stagger. Auto-scroll now runs AFTER the
// entrance settles (onAnimationComplete), never during it.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { personaById } from "@touchline/shared";
import { IconPundit } from "@/components/icons";
import { getPunditHistory, type PunditHistoryLine } from "@/lib/game";
import { shareSnippet } from "@/lib/share";
import { cn } from "@/lib/cn";
import { AskPundit, type AskReply } from "@/components/ui/AskPundit";

/** The minimal shape the panel needs from a pundit line (live WS lines or history). */
export interface FeedLine {
  line: string;
  persona: string;
  kind: string;
  ts: number;
}

/* Kind → a short, on-brand tag + tint. Mirrors the worker's Kind union. */
const KIND_META: Record<string, { label: string; tone: string }> = {
  goal: { label: "Goal", tone: "text-emerald-deep" },
  card: { label: "Card", tone: "text-gold" },
  swing: { label: "Odds", tone: "text-cyan" },
  "result-win": { label: "Won", tone: "text-emerald-deep" },
  "result-loss": { label: "Result", tone: "text-coral" },
};

/** "just now" / "3m" / "1h" — short relative time, recomputed on a light interval. */
function relTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

const keyOf = (l: FeedLine) => `${l.ts}::${l.line}`;

export interface PunditPanelProps {
  fixtureId: number;
  token: string | null;
  /** Live lines accumulated by the parent as they arrive over WS (any order). */
  liveLines: FeedLine[];
  /** Persona display name for the header, when known. */
  personaName?: string | null;
  /** Wire the expanded-view Ask input into the page feed. Both must be present to render it. */
  onAskQuestion?: (text: string) => void;
  onAskReply?: (reply: AskReply) => void;
}

export function PunditPanel({
  fixtureId,
  token,
  liveLines,
  personaName,
  onAskQuestion,
  onAskReply,
}: PunditPanelProps) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The drawer entrance has settled — gates auto-scroll so it never runs mid-transition.
  const [entered, setEntered] = useState(false);
  const [history, setHistory] = useState<FeedLine[]>([]);
  const [seenTs, setSeenTs] = useState(0);
  const [sharedKey, setSharedKey] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const drawerScrollRef = useRef<HTMLDivElement | null>(null);
  const expandScrollRef = useRef<HTMLDivElement | null>(null);
  const shareTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const canAsk = Boolean(onAskQuestion && onAskReply);

  // Backfill session history once we have a token+fixture, so the panel is populated the
  // instant it opens even if lines fired before this client connected. Best-effort: on any
  // failure the live WS lines still carry the panel.
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      const rows = await getPunditHistory(token, fixtureId);
      if (!active) return;
      setHistory(rows.map((r: PunditHistoryLine) => ({ line: r.line, persona: r.persona, kind: r.kind, ts: r.ts })));
    })();
    return () => {
      active = false;
    };
  }, [token, fixtureId]);

  // Merge history + live lines, dedupe on ts+text, order oldest→newest (running-log order).
  const lines = useMemo(() => {
    const map = new Map<string, FeedLine>();
    for (const l of history) map.set(keyOf(l), l);
    for (const l of liveLines) map.set(keyOf(l), l);
    return [...map.values()].sort((a, b) => a.ts - b.ts || a.line.localeCompare(b.line));
  }, [history, liveLines]);

  const latest = lines.length ? lines[lines.length - 1]! : null;
  const persona = personaName ?? (latest ? personaById(latest.persona)?.name : null) ?? "Your pundit";
  const unread = useMemo(() => lines.filter((l) => l.ts > seenTs).length, [lines, seenTs]);

  const close = useCallback(() => {
    setOpen(false);
    setExpanded(false);
  }, []);

  // Scroll whichever surface is currently on screen to its newest line.
  const scrollToBottom = useCallback(
    (smooth: boolean) => {
      const el = expanded ? expandScrollRef.current : drawerScrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? "smooth" : "auto" });
    },
    [expanded, reduce],
  );

  // Tick relative times only while the panel is open (cheap; avoids a background timer).
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(id);
  }, [open]);

  // Reset transient panel state whenever it closes.
  useEffect(() => {
    if (open) return;
    setEntered(false);
    setExpanded(false);
  }, [open]);

  // Mark everything seen while the panel is open, so the chip's unread badge stays clear.
  useEffect(() => {
    if (open && latest) setSeenTs(latest.ts);
  }, [open, latest]);

  // Keep pinned to the newest line as fresh commentary lands — but only AFTER the entrance
  // has settled, so a new line can never yank the container mid-transition.
  useEffect(() => {
    if (!open || !entered) return;
    scrollToBottom(true);
  }, [lines.length, open, entered, scrollToBottom]);

  // Snap to the newest line when switching between the drawer and the expanded surface
  // (the newly mounted container needs a frame before its scrollHeight is real).
  useEffect(() => {
    if (!open || !entered) return;
    const id = requestAnimationFrame(() => scrollToBottom(false));
    return () => cancelAnimationFrame(id);
  }, [expanded, open, entered, scrollToBottom]);

  // Esc collapses the expanded view first, then closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (expanded) setExpanded(false);
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, expanded, close]);

  // Lock body scroll while the pundit is over the whole screen.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  useEffect(() => () => clearTimeout(shareTimer.current), []);

  const share = useCallback(async (l: FeedLine) => {
    const name = personaById(l.persona)?.name;
    const who = name ? `via ${name}, my pundit on Touchline` : "via my pundit on Touchline";
    const outcome = await shareSnippet(`“${l.line}” ${who}`);
    if (outcome !== "failed") {
      const k = keyOf(l);
      setSharedKey(k);
      clearTimeout(shareTimer.current);
      shareTimer.current = setTimeout(() => setSharedKey((cur) => (cur === k ? null : cur)), 1800);
    }
  }, []);

  return (
    <>
      {/* ---- Persistent pundit chip: latest line + unread badge ---- */}
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={latest ? `Open pundit feed, latest: ${latest.line}` : "Open pundit feed"}
        aria-haspopup="dialog"
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          "glass fixed right-4 z-40 flex max-w-[min(20rem,calc(100vw-2rem))] items-center gap-2.5 rounded-[var(--radius-pill)] py-2 pl-2.5 pr-4 text-left",
          "bottom-[calc(88px+env(safe-area-inset-bottom))] lg:bottom-8",
          "transition-transform active:scale-[0.98] hover:brightness-[1.06]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        <span
          aria-hidden
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-[rgba(43,229,255,0.12)]"
        >
          <IconPundit className="h-5 w-5" color="var(--cyan)" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-coral px-1 font-display text-[11px] font-bold leading-none text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block font-display text-[10px] font-semibold uppercase tracking-wide text-cyan">
            {persona}
          </span>
          <span className="block truncate text-[13px] leading-snug text-ink">
            {latest ? latest.line : "Watching your call…"}
          </span>
        </span>
      </motion.button>

      {/* ---- Overlay: drawer <-> full-viewport expanded view ---- */}
      <AnimatePresence>
        {open && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Pundit feed"
          >
            <motion.button
              type="button"
              aria-label="Close pundit feed"
              onClick={close}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 cursor-default bg-[rgba(4,7,12,0.6)] backdrop-blur-[2px]"
            />

            <AnimatePresence>
              {expanded ? (
                /* ---- Expanded: the pundit over the whole screen (solid reading surface) ---- */
                <motion.div
                  key="expanded"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                  transition={reduce ? { duration: 0.12 } : { type: "spring", stiffness: 300, damping: 30 }}
                  className="solid absolute inset-0 z-10 flex flex-col overflow-hidden rounded-none"
                >
                  <PanelHeader
                    persona={persona}
                    expanded
                    onToggleExpand={() => setExpanded(false)}
                    onClose={close}
                  />
                  <FeedBody
                    lines={lines}
                    now={now}
                    scrollRef={expandScrollRef}
                    onShare={share}
                    sharedKey={sharedKey}
                    reduce={!!reduce}
                    large
                  />
                  {canAsk && (
                    <div className="shrink-0 border-t border-[rgba(255,255,255,0.08)] px-3 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
                      <AskPundit
                        fixtureId={fixtureId}
                        token={token}
                        onQuestion={onAskQuestion!}
                        onReply={onAskReply!}
                      />
                    </div>
                  )}
                </motion.div>
              ) : (
                /* ---- Drawer: full running log with scrollback ---- */
                <motion.div
                  key="drawer"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 48 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: 32 }}
                  transition={{ type: "spring", stiffness: 320, damping: 30 }}
                  onAnimationComplete={() => {
                    setEntered(true);
                    scrollToBottom(false);
                  }}
                  className="glass relative z-10 flex max-h-[82dvh] w-full max-w-md flex-col overflow-hidden rounded-b-none rounded-t-[var(--radius-lg)] sm:max-h-[80dvh] sm:rounded-[var(--radius-lg)]"
                >
                  <PanelHeader
                    persona={persona}
                    expanded={false}
                    onToggleExpand={() => setExpanded(true)}
                    onClose={close}
                  />
                  <FeedBody
                    lines={lines}
                    now={now}
                    scrollRef={drawerScrollRef}
                    onShare={share}
                    sharedKey={sharedKey}
                    reduce={!!reduce}
                    large={false}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ------------------------------------------------------------------ header */

function PanelHeader({
  persona,
  expanded,
  onToggleExpand,
  onClose,
}: {
  persona: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.08)] px-5 py-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-[rgba(43,229,255,0.12)]"
        >
          <IconPundit className="h-5 w-5" color="var(--cyan)" />
        </span>
        <div className="min-w-0">
          <p className={cn("font-display font-bold tracking-tight text-ink", expanded ? "text-[17px]" : "text-[15px]")}>
            Pundit feed
          </p>
          <p className="truncate text-[12px] font-medium text-cyan">{persona}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? "Collapse pundit view" : "Expand pundit to full screen"}
          className="grid h-9 w-9 place-items-center rounded-full bg-[rgba(0,0,0,0.28)] text-ink/80 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald"
        >
          {expanded ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 9h-5V4M15 9l5-5" />
              <path d="M4 15h5v5M9 15l-5 5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 4h5v5M20 4l-6 6" />
              <path d="M9 20H4v-5M4 20l6-6" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close pundit feed"
          className="grid h-9 w-9 place-items-center rounded-full bg-[rgba(0,0,0,0.28)] text-ink/80 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- feed body */

/**
 * The running log itself. Shared by the drawer and the expanded view (`large` bumps the
 * reading size). The history present when the panel opened is STATIC — `AnimatePresence
 * initial={false}` skips the entrance for that first batch, so a mid-match join reads
 * instantly instead of stampeding. NEW lines that arrive while the panel is open DO animate
 * in. No `layout` on the items by design: it would FLIP-animate against the open scroll snap.
 */
function FeedBody({
  lines,
  now,
  scrollRef,
  onShare,
  sharedKey,
  reduce,
  large,
}: {
  lines: FeedLine[];
  now: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  onShare: (l: FeedLine) => void;
  sharedKey: string | null;
  reduce: boolean;
  large: boolean;
}) {
  return (
    <div
      ref={scrollRef}
      className={cn("flex-1 overflow-y-auto overscroll-contain", large ? "px-4 py-5 sm:px-6" : "px-4 py-4")}
    >
      {lines.length === 0 ? (
        <div className="grid h-full min-h-[160px] place-items-center px-6 text-center">
          <div>
            <p className="text-[15px] font-medium text-ink">Your pundit is watching…</p>
            <p className="mt-1 text-[13px] leading-snug text-ink-soft">
              Every take on your call lands here: goals, odds swings and the final word. Re-read them any time.
            </p>
          </div>
        </div>
      ) : (
        <ul className={cn("flex flex-col gap-2", large && "mx-auto max-w-2xl")}>
          <AnimatePresence initial={false}>
            {lines.map((l) => {
              const meta = KIND_META[l.kind];
              const k = keyOf(l);
              return (
                <motion.li
                  key={k}
                  initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.3, ease: [0.2, 0.7, 0.3, 1] }}
                  className={cn("glass relative overflow-hidden", large ? "p-4" : "p-3.5")}
                >
                  <div className="relative flex items-center justify-between gap-2">
                    <span className={cn("font-display text-[10px] font-semibold uppercase tracking-wide", meta?.tone ?? "text-ink-soft")}>
                      {meta?.label ?? "Live"}
                    </span>
                    <span className="tnum text-[11px] font-medium text-ink-soft/70">{relTime(l.ts, now || l.ts)}</span>
                  </div>
                  <p className={cn("relative mt-1 pr-9 leading-snug text-ink", large ? "text-[17px]" : "text-[15px]")}>
                    {l.line}
                  </p>
                  <button
                    type="button"
                    onClick={() => onShare(l)}
                    aria-label={sharedKey === k ? "Shared" : "Share this line"}
                    className={cn(
                      "absolute bottom-2.5 right-2.5 z-10 grid h-8 w-8 place-items-center rounded-full transition-colors",
                      "text-ink-soft hover:bg-[rgba(255,255,255,0.06)] hover:text-ink",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
                      sharedKey === k && "text-emerald-deep",
                    )}
                  >
                    {sharedKey === k ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M4 12.5l5 5L20 6" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                        <path d="M12 3v13M8 7l4-4 4 4" />
                      </svg>
                    )}
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

export default PunditPanel;
