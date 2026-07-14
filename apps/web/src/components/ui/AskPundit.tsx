"use client";

// AskPundit (SAH) — makes the live pundit CONVERSATIONAL. The fan taps one of three preset
// questions or types their own (<=140 chars) and the pundit replies in-persona. The question
// renders right-aligned + quiet in the feed; the reply lands in the pundit's own voice (it also
// arrives over the WS 'pundit' feed, deduped by ts upstream).
//
// Every ask is a real LLM call the fan is spending tokens on, so it is throttled hard, per the
// server contract (POST /api/pundit/ask): ONE ask per wallet+fixture per 300s, capped at 5 asks
// per fixture for the life of the match. The UI mirrors that: it shows the asks left ("3 of 5
// left"), a live mm:ss cooldown while the gate is closed, and a calm terminal state once the five
// are spent (input hidden). Guests see the chips disabled with a sign-in hint. Stadium Night,
// mobile-first, reduced-motion aware.

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { authedFetch } from "@/lib/worker";
import { cn } from "@/lib/cn";

// The three preset questions the fan can tap, plus free text (<=140 chars). Mirrors the
// worker's ASK_PRESETS / ASK_MAX_LEN (POST /api/pundit/ask). The reply is returned by the
// call AND fanned out over the WS 'pundit' feed (kind 'ask'), deduped by ts on the page.
const ASK_PRESETS = [
  { id: "hows_my_call", label: "How's my call?" },
  { id: "what_happened", label: "What just happened?" },
  { id: "settle_my_nerves", label: "Settle my nerves" },
] as const;

export const ASK_MAX_LEN = 140;
/** Lifetime cap on asks per wallet+fixture (mirrors the worker contract). */
export const ASK_CAP = 5;
/** Cooldown between asks, in seconds (mirrors the worker contract). */
const ASK_COOLDOWN = 300;

export interface AskReply {
  line: string;
  persona: string;
  kind: string;
  ts: number;
}

type AskResult =
  | { ok: true; reply: AskReply; remaining: number }
  | { ok: false; status: number; error: string; retryAfter?: number; remaining?: number };

/** Put a question to the pundit. `question` is a preset id or free text. */
async function postAsk(token: string, fixtureId: number, question: string): Promise<AskResult> {
  const r = await authedFetch(token, "/api/pundit/ask", {
    method: "POST",
    body: JSON.stringify({ fixtureId, question }),
  });
  const body = await r.json().catch(() => ({} as Record<string, unknown>));
  const remaining = typeof body?.remaining === "number" ? body.remaining : undefined;
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      error: typeof body?.error === "string" ? body.error : "Couldn't reach the pundit",
      retryAfter: typeof body?.retryAfter === "number" ? body.retryAfter : undefined,
      remaining,
    };
  }
  return { ok: true, reply: body as AskReply, remaining: remaining ?? 0 };
}

/** mm:ss for the cooldown readout. */
function fmtCountdown(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.max(0, s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export interface AskPunditProps {
  fixtureId: number;
  /** Session token; null for a guest (chips disabled + sign-in hint). */
  token: string | null;
  /** Append the fan's question to the feed (right-aligned bubble). */
  onQuestion: (text: string) => void;
  /** Deliver the pundit's reply into the feed (deduped by ts against the live WS feed). */
  onReply: (reply: AskReply) => void;
}

export function AskPundit({ fixtureId, token, onQuestion, onReply }: AskPunditProps) {
  const reduce = useReducedMotion();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0); // seconds until the next ask is allowed
  const [remaining, setRemaining] = useState<number | null>(null); // asks left; null until first response
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isGuest = !token;
  const outOfQuestions = remaining === 0; // the five are spent — terminal state
  const busy = pending || cooldown > 0;
  const disabled = isGuest || busy || outOfQuestions;

  // Live countdown for the rate-limit window.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  async function ask(question: string, display: string) {
    if (!token || busy || outOfQuestions) return;
    setError(null);
    setPending(true);
    const res = await postAsk(token, fixtureId, question);
    setPending(false);
    if (res.ok) {
      // Show the question first, then the reply, so they read as a Q to A pair.
      onQuestion(display);
      onReply(res.reply);
      setRemaining(res.remaining);
      // Only arm the cooldown when there's another ask left to wait for; a spent
      // allowance drops straight into the terminal state instead of a dead timer.
      if (res.remaining > 0) setCooldown(ASK_COOLDOWN);
    } else if (res.status === 429) {
      // 'slow down' (asks left) or 'out of questions' (remaining 0, retryAfter 0).
      if (typeof res.remaining === "number") setRemaining(res.remaining);
      setCooldown(res.retryAfter && res.retryAfter > 0 ? res.retryAfter : 0);
    } else if (res.status === 401) {
      setError("Sign in to talk to the pundit.");
    } else {
      setError(res.error || "The pundit went quiet. Try again.");
    }
  }

  function submitFreeText() {
    const q = text.replace(/[\r\n]+/g, " ").trim();
    if (!q) return;
    setText("");
    void ask(q, q);
    inputRef.current?.blur();
  }

  const remainingShown = remaining ?? ASK_CAP;

  return (
    <div className="glass mb-2 p-3">
      <div className="flex items-center justify-between px-0.5">
        <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          Ask the pundit
        </p>
        {!isGuest && busy ? (
          <span aria-live="polite" className="tnum text-[11px] font-medium text-cyan">
            {pending ? "Thinking…" : `Wait ${fmtCountdown(cooldown)}`}
          </span>
        ) : !isGuest && !outOfQuestions ? (
          <span className="tnum text-[11px] font-medium text-ink-soft/70">
            {remainingShown} of {ASK_CAP} left
          </span>
        ) : null}
      </div>

      {outOfQuestions ? (
        // Terminal state: the five asks are spent. Calm, no scolding, no input.
        <p aria-live="polite" className="mt-2 px-0.5 text-[13px] leading-snug text-ink-soft">
          That&apos;s all five questions for this match. Your pundit keeps calling it live in the feed.
        </p>
      ) : (
        <>
          {/* preset chips */}
          <div className="mt-2 flex flex-wrap gap-2">
            {ASK_PRESETS.map((preset) => (
              <motion.button
                key={preset.id}
                type="button"
                onClick={() => ask(preset.id, preset.label)}
                disabled={disabled}
                whileTap={reduce || disabled ? undefined : { scale: 0.96 }}
                className={cn(
                  "inline-flex items-center rounded-[var(--radius-pill)] border px-3 py-1.5 font-display text-[13px] font-semibold tracking-tight transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                  disabled
                    ? "cursor-not-allowed border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] text-ink-soft/50"
                    : "border-[rgba(43,229,255,0.28)] bg-[rgba(43,229,255,0.08)] text-cyan hover:bg-[rgba(43,229,255,0.14)]",
                )}
              >
                {preset.label}
              </motion.button>
            ))}
          </div>

          {/* free-text ask */}
          <div className="mt-2.5 flex items-center gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, ASK_MAX_LEN))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitFreeText();
                  }
                }}
                disabled={disabled}
                maxLength={ASK_MAX_LEN}
                aria-label="Ask the pundit a question"
                placeholder={isGuest ? "Sign in to talk to the pundit" : "Ask your own question…"}
                className={cn(
                  "w-full rounded-[var(--radius-pill)] border border-[rgba(255,255,255,0.12)] bg-[rgba(0,0,0,0.28)] py-2 pl-3.5 pr-12 text-[14px] text-ink placeholder:text-ink-soft/60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              />
              {text.length > 0 && (
                <span className="tnum pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-ink-soft/60">
                  {ASK_MAX_LEN - text.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={submitFreeText}
              disabled={disabled || text.trim().length === 0}
              aria-label="Send question to the pundit"
              className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
                disabled || text.trim().length === 0
                  ? "cursor-not-allowed bg-[rgba(255,255,255,0.04)] text-ink-soft/40"
                  : "bg-emerald text-canvas hover:brightness-110",
              )}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </>
      )}

      {isGuest ? (
        <p className="mt-2 px-0.5 text-[12px] leading-snug text-ink-soft">
          Sign in to talk to the pundit. Ask how your call&apos;s looking, or what just happened.
        </p>
      ) : error ? (
        <p className="mt-2 px-0.5 text-[12px] font-medium text-coral">{error}</p>
      ) : null}
    </div>
  );
}

export default AskPundit;
