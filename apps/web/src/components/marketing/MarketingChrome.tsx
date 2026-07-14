"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/cn";

/* ============================================================================
   Marketing chrome — the shared nav + footer + CTA classes for every public
   marketing page (landing, how-it-works, why-touchline). One front door, one
   voice. Stadium Night, mobile-first.
   ========================================================================== */

export const CTA_PRIMARY =
  "inline-flex items-center justify-center gap-2 select-none font-display font-semibold uppercase tracking-wide " +
  "rounded-[var(--radius-sm)] min-h-[52px] px-7 text-base bg-emerald text-on-emerald glow-emerald " +
  "transition-[transform,background-color] duration-[var(--dur-micro)] hover:bg-emerald-deep active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export const CTA_GHOST =
  "inline-flex items-center justify-center gap-2 select-none font-display font-semibold uppercase tracking-wide " +
  "rounded-[var(--radius-sm)] min-h-[52px] px-6 text-base text-ink border border-[rgba(255,255,255,0.16)] " +
  "transition-colors duration-[var(--dur-micro)] hover:border-emerald/70 hover:text-emerald-deep " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/why-touchline", label: "Why Touchline" },
];

/* Sticky glass nav. Floating overlay → glass is the correct surface here. */
export function MarketingNav() {
  const pathname = usePathname();
  return (
    <div className="sticky top-0 z-40 -mx-5 px-5 sm:-mx-8 sm:px-8">
      <div className="glass mx-auto mt-3 flex max-w-[1100px] items-center justify-between gap-3 rounded-[var(--radius-lg)] px-4 py-2.5 sm:px-5">
        <Link href="/" aria-label="Touchline home" className="shrink-0">
          <Wordmark size="sm" />
        </Link>

        <nav className="hidden items-center gap-1 sm:flex" aria-label="Marketing">
          {NAV_LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-[var(--radius-sm)] px-3 py-2 font-display text-[14px] font-semibold uppercase tracking-wide transition-colors duration-[var(--dur-micro)]",
                  active
                    ? "text-emerald-deep"
                    : "text-ink-soft hover:text-ink",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <Link href="/play" className={`${CTA_GHOST} min-h-[42px] px-4 text-[14px]`}>
          Play free
        </Link>
      </div>

      {/* mobile link row — nav links live below the bar on small screens */}
      <div className="mx-auto mt-2 flex max-w-[1100px] items-center gap-2 sm:hidden">
        {NAV_LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-[var(--radius-pill)] border px-3 py-1.5 font-display text-[12px] font-semibold uppercase tracking-wide transition-colors duration-[var(--dur-micro)]",
                active
                  ? "border-emerald/50 bg-[rgba(0,224,138,0.10)] text-emerald-deep"
                  : "border-[rgba(255,255,255,0.12)] text-ink-soft",
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function MarketingFooter() {
  return (
    <footer className="mt-4 flex flex-col items-center justify-between gap-4 border-t border-[rgba(255,255,255,0.06)] py-8 sm:flex-row">
      <div className="flex items-center gap-5">
        <Wordmark size="sm" />
        <nav className="flex items-center gap-4" aria-label="Footer">
          <Link href="/how-it-works" className="text-[13px] font-medium text-ink-soft transition-colors hover:text-ink">
            How it works
          </Link>
          <Link href="/why-touchline" className="text-[13px] font-medium text-ink-soft transition-colors hover:text-ink">
            Why Touchline
          </Link>
          <Link href="/play" className="text-[13px] font-medium text-emerald-deep transition-colors hover:text-emerald">
            Play free
          </Link>
        </nav>
      </div>
      <p className="text-center text-[12px] leading-relaxed text-ink-soft sm:text-right">
        Powered by <span className="text-ink">TxLINE</span> live football data ·
        Trophies on <span className="text-ink">Solana</span> (devnet) ·
        Built for the TxODDS World Cup hackathon.
      </p>
    </footer>
  );
}
