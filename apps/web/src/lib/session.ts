"use client";

import { create } from "zustand";
import type { Profile } from "@touchline/shared";

const KEY = "touchline.session";

// Presence-only cookie mirroring sign-in state — the wallet-gate proxy reads
// this server-side to redirect signed-out visitors before an app route
// renders. It carries no token; the worker Bearer token stays in localStorage.
const SESSION_COOKIE = "tl_session";
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days — mirrors the localStorage session's no-expiry intent

interface SessionState {
  token: string | null;
  profile: Profile | null;
  hydrated: boolean;
  setSession: (token: string, profile: Profile | null) => void;
  setProfile: (profile: Profile) => void;
  clear: () => void;
  hydrate: () => void;
}

function setSessionCookie(signedIn: boolean) {
  const secure = window.location.protocol === "https:" ? " secure;" : "";
  if (signedIn) {
    document.cookie = `${SESSION_COOKIE}=1; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; samesite=lax;${secure}`;
  } else {
    document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; samesite=lax;${secure}`;
  }
}

function persist(token: string | null, profile: Profile | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(KEY, JSON.stringify({ token, profile }));
  else localStorage.removeItem(KEY);
  setSessionCookie(Boolean(token));
}

export const useSession = create<SessionState>((set, get) => ({
  token: null,
  profile: null,
  hydrated: false,
  setSession: (token, profile) => {
    persist(token, profile);
    set({ token, profile });
  },
  setProfile: (profile) => {
    persist(get().token, profile);
    set({ profile });
  },
  clear: () => {
    persist(null, null);
    set({ token: null, profile: null });
  },
  hydrate: () => {
    if (get().hydrated) return;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
      if (raw) {
        const { token, profile } = JSON.parse(raw) as { token: string; profile: Profile | null };
        // Resync the gate cookie for sessions created before it existed, or if
        // it was cleared independently of localStorage (e.g. cookie-only clear).
        setSessionCookie(Boolean(token));
        set({ token, profile, hydrated: true });
        return;
      }
    } catch {
      /* ignore corrupt storage */
    }
    set({ hydrated: true });
  },
}));
