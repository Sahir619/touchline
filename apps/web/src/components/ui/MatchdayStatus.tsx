"use client";

import { cn } from "@/lib/cn";
import { IconFlame, IconTarget, IconClock } from "@/components/icons";

export interface MatchdayStatusProps {
  /** Current live streak (correct-call run). */
  streak: number;
  /** Calls the user has locked on today's slate. */
  callsMade: number;
  /** Fixtures on today's slate. */
  callsTotal: number;
  /** Epoch ms of the next upcoming kickoff, or null if none upcoming / preview. */
  nextKickoff: number | null;
  /** True when the live slate hasn't loaded (offline/fallback). */
  preview: boolean;
  /** Shared ticking clock (epoch ms) so the countdown updates live. */
  now: number;
}

/** "2h 14m" / "14m" / "under a minute" from ms remaining. */
function formatCountdown(ms: number): string {
  if (ms <= 0) return "kicking off";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "under a minute";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Stat({
  icon,
  label,
  value,
  tone = "ink",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: "ink" | "coral" | "emerald";
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          "tnum font-display text-[22px] font-bold leading-none tracking-tight",
          tone === "coral" && "text-coral",
          tone === "emerald" && "text-emerald-deep",
          tone === "ink" && "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * MatchdayStatus — the day's return-loop status at a glance: the live streak, how many
 * calls are in of how many matches, and a live countdown to the next kickoff. This is
 * the card that answers "what's my situation right now?" every time you open the app.
 */
export function MatchdayStatus({
  streak,
  callsMade,
  callsTotal,
  nextKickoff,
  preview,
  now,
}: MatchdayStatusProps) {
  const remaining = nextKickoff != null ? nextKickoff - now : null;
  const kickoffValue = preview
    ? "-"
    : remaining == null
      ? "underway"
      : formatCountdown(remaining);
  const kickoffLabel = remaining != null && remaining > 0 ? "Kicks off in" : "Kickoff";

  const pct = callsTotal > 0 ? Math.round((callsMade / callsTotal) * 100) : 0;
  const allIn = callsTotal > 0 && callsMade >= callsTotal;

  return (
    <div className="solid p-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat
          icon={<IconFlame className="h-3.5 w-3.5" color="var(--coral)" />}
          label="Streak"
          value={preview ? "-" : streak}
          tone={streak > 0 ? "coral" : "ink"}
        />
        <Stat
          icon={<IconTarget className="h-3.5 w-3.5" color="var(--emerald-deep)" />}
          label="Calls made"
          value={preview ? "-" : `${callsMade}/${callsTotal}`}
          tone={allIn ? "emerald" : "ink"}
        />
        <Stat
          icon={<IconClock className="h-3.5 w-3.5" color="var(--coral)" />}
          label={kickoffLabel}
          value={kickoffValue}
          tone={
            !preview && remaining != null && remaining > 0 && remaining < 3_600_000
              ? "coral"
              : "ink"
          }
        />
      </div>

      {/* Call-progress bar — fills as the slate gets called. */}
      {!preview && callsTotal > 0 && (
        <div className="mt-4">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={callsTotal}
            aria-valuenow={callsMade}
            aria-label={`${callsMade} of ${callsTotal} calls made`}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500 ease-out",
                allIn ? "bg-emerald" : "bg-coral",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default MatchdayStatus;
