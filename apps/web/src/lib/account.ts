// Auth + profile API against the worker.
import type { Profile } from "@touchline/shared";
import { workerFetch, authedFetch } from "./worker";

export async function getNonce(wallet: string): Promise<{ message: string; nonce: string }> {
  const r = await workerFetch(`/api/auth/nonce?wallet=${wallet}`);
  if (!r.ok) throw new Error("Could not start sign-in");
  return r.json();
}

export async function verifySignIn(
  wallet: string,
  nonce: string,
  signature: string,
): Promise<{ token: string; profile: Profile | null; isNew: boolean }> {
  const r = await workerFetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, nonce, signature }),
  });
  if (!r.ok) throw new Error("Sign-in failed");
  return r.json();
}

export async function getMe(token: string): Promise<Profile> {
  const r = await authedFetch(token, "/api/me");
  if (!r.ok) throw new Error("Could not load profile");
  return r.json();
}

export async function patchMe(
  token: string,
  patch: { displayName?: string; nation?: string; persona?: string },
): Promise<Profile> {
  const r = await authedFetch(token, "/api/me", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error("Could not save profile");
  return r.json();
}
