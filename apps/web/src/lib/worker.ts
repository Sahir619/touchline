// Single place for the worker base URL + fetch helpers (auth header injection).
export const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "http://localhost:8787";

export function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${WORKER_URL}${path}`, { cache: "no-store", ...init });
}

export function authedFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${WORKER_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}
