import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Wallet gate (board request, SAH-51): everything except the public landing
// (`/`) and its own pre-auth entry points (`/connect`, `/onboarding`,
// `/join/[code]`, `/r/[code]`) requires a signed-in wallet session. The
// worker Bearer token lives in localStorage (cross-origin, invisible here);
// `tl_session` is a presence-only cookie set by `lib/session.ts` alongside
// it, purely so this proxy can gate the initial route render.
const SESSION_COOKIE = "tl_session";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const url = new URL("/connect", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/play/:path*",
    "/match/:path*",
    "/live/:path*",
    "/leaderboard/:path*",
    "/leagues/:path*",
    "/you/:path*",
  ],
};
