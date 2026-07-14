"use client";

import { useRouter, usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { cn } from "@/lib/cn";
import { FieldBackground } from "./FieldBackground";
import { Wordmark } from "./Wordmark";
import { useSession } from "@/lib/session";

/* ============================================================================
   Wallet chip — persistent, top-right. Reads "Connect" until wired to auth.
   Glass, because it floats over the field.
   ========================================================================== */
function WalletChip() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const token = useSession((s) => s.token);
  const profile = useSession((s) => s.profile);
  const hydrated = useSession((s) => s.hydrated);

  const signedIn = Boolean(token);
  const addr = publicKey?.toBase58();
  const short = addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : "";
  const label = signedIn ? profile?.displayName || short || "Profile" : "Connect";

  return (
    <button
      type="button"
      onClick={() => router.push(signedIn ? "/you" : "/connect")}
      className={cn(
        "glass inline-flex items-center gap-2 rounded-[var(--radius-pill)]",
        "min-h-[44px] px-4 cursor-pointer",
        "font-display text-[14px] font-semibold uppercase tracking-wide text-ink",
        "transition-transform active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        !hydrated && "opacity-0",
      )}
    >
      <span aria-hidden className="h-2 w-2 rounded-full bg-emerald glow-emerald" />
      {label}
    </button>
  );
}

/* ============================================================================
   Navigation model
   ========================================================================== */
type NavId = "today" | "live" | "replay" | "board" | "bracket" | "you";

const NAV: { id: NavId; label: string; href: string; icon: (active: boolean) => React.ReactNode }[] = [
  { id: "today", label: "Today", href: "/play", icon: (a) => <IconToday active={a} /> },
  { id: "live", label: "Live", href: "/live", icon: (a) => <IconLive active={a} /> },
  { id: "replay", label: "Replays", href: "/replay", icon: (a) => <IconReplay active={a} /> },
  { id: "board", label: "Board", href: "/leaderboard", icon: (a) => <IconBoard active={a} /> },
  { id: "bracket", label: "Champion", href: "/bracket", icon: (a) => <IconBracket active={a} /> },
  { id: "you", label: "You", href: "/you", icon: (a) => <IconYou active={a} /> },
];

/** Map the current pathname to the active nav id (deepest match wins; the app home is /play). */
function activeNavId(pathname: string): NavId {
  if (pathname === "/live" || pathname.startsWith("/live/")) return "live";
  if (pathname.startsWith("/replay")) return "replay";
  if (pathname.startsWith("/leaderboard")) return "board";
  if (pathname.startsWith("/bracket")) return "bracket";
  if (pathname.startsWith("/you")) return "you";
  return "today";
}

const iconBase = "h-[22px] w-[22px]";
const stroke = (a: boolean) => (a ? "var(--emerald-deep)" : "var(--ink-soft)");

function IconToday({ active }: { active: boolean }) {
  return (
    <svg className={iconBase} viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
      <path d="M3.5 9h17M8 3v3M16 3v3" />
    </svg>
  );
}
function IconReplay({ active }: { active: boolean }) {
  return (
    <svg className={iconBase} viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 2.6-6.3" />
      <path d="M3 4v4h4" />
      <path d="M10.5 9.5v5l4.5-2.5z" />
    </svg>
  );
}

function IconLive({ active }: { active: boolean }) {
  return (
    <svg className={iconBase} viewBox="0 0 24 24" fill="none" stroke={active ? "var(--coral)" : "var(--ink-soft)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" fill={active ? "var(--coral)" : "none"} />
      <path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
    </svg>
  );
}
function IconBoard({ active }: { active: boolean }) {
  return (
    <svg className={iconBase} viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 20V11M12 20V5M18 20v-6" />
    </svg>
  );
}
function IconYou({ active }: { active: boolean }) {
  return (
    <svg className={iconBase} viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}
function IconBracket({ active }: { active: boolean }) {
  return (
    <svg className={iconBase} viewBox="0 0 24 24" fill="none" stroke={active ? "var(--gold)" : "var(--ink-soft)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 4h10v3.5a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4Z" />
      <path d="M4.5 5.5h2.5M17 5.5h2.5M12 12.5v3M9 19.5h6" />
    </svg>
  );
}

/* ============================================================================
   AppShell — transparent top bar, centred ~1200px frame, glass bottom tab bar
   on phones that becomes a left side rail at >=1024px.
   ========================================================================== */
export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const active = activeNavId(pathname ?? "/");

  return (
    <div className="relative min-h-dvh">
      <FieldBackground />

      <div className="mx-auto flex min-h-dvh w-full max-w-[1200px] flex-col">
        {/* ---- Transparent top bar ---- */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Wordmark />
          <WalletChip />
        </header>

        {/* ---- Body: side rail (lg) + main scroll area ---- */}
        <div className="flex flex-1 gap-0 lg:gap-6 lg:px-8">
          {/* Left side rail — desktop only */}
          <nav
            aria-label="Primary"
            className="sticky top-[76px] hidden h-[calc(100dvh-92px)] w-[208px] shrink-0 lg:block"
          >
            <ul className="glass flex h-full flex-col gap-1 p-3">
              {NAV.map((item) => {
                const isActive = active === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => router.push(item.href)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3",
                        "min-h-[48px] cursor-pointer transition-colors",
                        "font-display text-[16px] font-semibold tracking-tight",
                        isActive
                          ? "bg-[rgba(0,217,130,0.12)] text-emerald-deep"
                          : "text-ink-soft hover:bg-[rgba(255,255,255,0.04)] hover:text-ink",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
                      )}
                    >
                      {item.icon(isActive)}
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Main scroll area */}
          <main className="min-w-0 flex-1 px-4 pb-28 pt-2 sm:px-6 lg:px-0 lg:pb-10">
            {children}
          </main>
        </div>

        {/* ---- Floating glass bottom tab bar — phones/tablets only ---- */}
        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(12px,env(safe-area-inset-bottom))] lg:hidden"
        >
          <ul className="glass mx-auto flex max-w-md items-stretch justify-between gap-1 p-1.5">
            {NAV.map((item) => {
              const isActive = active === item.id;
              return (
                <li key={item.id} className="flex-1">
                  <button
                    type="button"
                    onClick={() => router.push(item.href)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex w-full flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)]",
                      "min-h-[52px] cursor-pointer transition-colors",
                      "font-display text-[11px] font-semibold uppercase tracking-wide",
                      isActive
                        ? "bg-[rgba(0,217,130,0.12)] text-emerald-deep"
                        : "text-ink-soft",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald",
                    )}
                  >
                    {item.icon(isActive)}
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}

export default AppShell;
