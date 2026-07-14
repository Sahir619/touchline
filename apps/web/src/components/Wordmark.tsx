import { cn } from "@/lib/cn";

/* ============================================================================
   Wordmark — lowercase "touchline" with the chalk touchline running under the
   whole word and the ball resting on the line; the line tips ink→cyan at its
   right (on-chain) end. Never recolour the word itself into the gradient.
   ========================================================================== */
export function Wordmark({ size = "lg" }: { size?: "sm" | "lg" }) {
  const lg = size === "lg";
  const w = lg ? 132 : 112;
  const ballCx = lg ? 118 : 99;
  const gid = `tl-wordmark-${size}`;

  return (
    <span className="inline-flex select-none flex-col leading-none">
      <span
        className={cn(
          "font-display font-bold lowercase tracking-tight text-ink",
          lg ? "text-[26px]" : "text-[22px]",
        )}
      >
        touchline
      </span>
      <svg
        viewBox={`0 0 ${w} 12`}
        className={cn("-mt-0.5 h-3", lg ? "w-[132px]" : "w-[112px]")}
        aria-hidden
        fill="none"
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2={w} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--ink)" />
            <stop offset="62%" stopColor="var(--ink)" />
            <stop offset="100%" stopColor="var(--cyan)" />
          </linearGradient>
        </defs>
        {/* the chalk line */}
        <line x1="2" y1="7" x2={w - 2} y2="7" stroke={`url(#${gid})`} strokeWidth="2.5" strokeLinecap="round" />
        {/* the ball resting on the line, near the ink→cyan end */}
        <circle cx={ballCx} cy="6" r="4.5" fill="var(--emerald)" />
      </svg>
    </span>
  );
}

export default Wordmark;
