/* ============================================================================
   Touchline line-icon set — single-stroke, currentColor by default, in the same
   broadcast vocabulary as the landing page (IconOdds / IconPundit / IconTrophy).
   These replace the emoji chrome (🔥 🏆 🎯 🏟️) so the in-app screens hold the
   monochrome + one-accent system instead of full-colour cartoon glyphs.
   Tint via `color` (currentColor) or the `style`/`className` prop.
   ========================================================================== */

export interface IconProps {
  className?: string;
  /** explicit stroke colour; defaults to currentColor */
  color?: string;
}

const common = {
  fill: "none",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Flame — streaks, long-shots. Tint with --coral. */
export function IconFlame({ className = "h-4 w-4", color = "currentColor" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} stroke={color} {...common} aria-hidden>
      <path d="M12 3c.6 2.6-.8 4-2.2 5.4C8.2 9.9 7 11.3 7 13.6A5 5 0 0 0 17 14c0-2-1-3.6-2.2-5 .4 1 .2 2-.6 2.7.3-2-.7-4.2-2.2-5.2.5 1.8-.2 3-1.1 3.9C9.5 8.3 11 5.6 12 3Z" />
    </svg>
  );
}

/** Trophy — wins, cabinet. Tint by tier token. */
export function IconTrophy({ className = "h-4 w-4", color = "currentColor" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} stroke={color} {...common} aria-hidden>
      <path d="M7 4.5h10v4a5 5 0 0 1-10 0v-4Z" />
      <path d="M7 6H4.5v1.5A3 3 0 0 0 7 10.4M17 6h2.5v1.5A3 3 0 0 1 17 10.4M9.5 14.4 9 18h6l-.5-3.6M7.5 21h9" />
    </svg>
  );
}

/** Target — the daily challenge / call-an-upset. Tint with --coral. */
export function IconTarget({ className = "h-4 w-4", color = "currentColor" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} stroke={color} {...common} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1" fill={color} stroke="none" />
    </svg>
  );
}

/** Pundit — the live AI commentator bubble. Tint with --cyan. */
export function IconPundit({ className = "h-4 w-4", color = "currentColor" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} stroke={color} {...common} aria-hidden>
      <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 16.5H9.5L5 20.5V16.5H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5Z" />
      <path d="M7.5 10.5h9M7.5 13h5.5" />
    </svg>
  );
}

/** Clock — kickoff countdown. Tint with --coral for urgency. */
export function IconClock({ className = "h-4 w-4", color = "currentColor" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} stroke={color} {...common} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}

/** Check — a completed daily challenge. Tint with --emerald-deep. */
export function IconCheck({ className = "h-4 w-4", color = "currentColor" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} stroke={color} {...common} aria-hidden>
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

/** Stadium — private leagues. */
export function IconStadium({ className = "h-4 w-4", color = "currentColor" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} stroke={color} {...common} aria-hidden>
      <path d="M3 8.5c0-1.7 4-3 9-3s9 1.3 9 3-4 3-9 3-9-1.3-9-3Z" />
      <path d="M3 8.5v5c0 1.7 4 3 9 3s9-1.3 9-3v-5" />
      <path d="M8 11.5v5M16 11.5v5" />
    </svg>
  );
}

/** Bulb — trivia / "did you know" filler. Tint with --gold. */
export function IconBulb({ className = "h-4 w-4", color = "currentColor" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} stroke={color} {...common} aria-hidden>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.45 1 1.15 1 1.9V17h5v-1.2c0-.75.4-1.45 1-1.9A6 6 0 0 0 12 3Z" />
    </svg>
  );
}
