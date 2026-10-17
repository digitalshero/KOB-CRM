import { supabase } from "@/integrations/supabase/client";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

// Parallel RDS/JWT auth (AUTH_BACKEND=hybrid|rds): a user authenticated via
// the new /api/auth/login RDS path has no Supabase session at all, so their
// backend-issued JWT is kept here instead. Supabase users are completely
// unaffected — the primary token source below is always checked first and
// this is only a fallback for when no Supabase session exists.
const RDS_TOKEN_KEY = "kob_rds_token";
export function setRdsToken(token: string) {
  try { window.localStorage.setItem(RDS_TOKEN_KEY, token); } catch { /* ignore */ }
}
export function getRdsToken(): string | null {
  try { return window.localStorage.getItem(RDS_TOKEN_KEY); } catch { return null; }
}
export function clearRdsToken() {
  try { window.localStorage.removeItem(RDS_TOKEN_KEY); } catch { /* ignore */ }
}

// Explicit active-auth-provider marker. A browser that has ever completed a
// real Supabase email+password login (e.g. during earlier hybrid-migration
// testing) keeps that session cached and auto-refreshing in localStorage.
// Without this marker, request() below had to GUESS which token to send by
// always preferring any cached Supabase session over the RDS JWT — so a
// fresh RDS login could silently keep being overridden by a stale Supabase
// identity from a different account, causing spurious 403s on super_admin
// actions. The marker is set deterministically at the moment of a
// successful login (see auth.tsx) and is the sole source of truth for which
// token request() sends; it is cleared on sign-out together with both
// credential stores so no cross-provider identity can linger.
const ACTIVE_AUTH_KEY = "kob_active_auth_backend";
export type ActiveAuthBackend = "rds" | "supabase";
export function setActiveAuthBackend(backend: ActiveAuthBackend) {
  try { window.localStorage.setItem(ACTIVE_AUTH_KEY, backend); } catch { /* ignore */ }
}
export function getActiveAuthBackend(): ActiveAuthBackend | null {
  try {
    const v = window.localStorage.getItem(ACTIVE_AUTH_KEY);
    return v === "rds" || v === "supabase" ? v : null;
  } catch { return null; }
}
export function clearActiveAuthBackend() {
  try { window.localStorage.removeItem(ACTIVE_AUTH_KEY); } catch { /* ignore */ }
}

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const activeBackend = getActiveAuthBackend();

  let token: string | undefined;
  if (activeBackend === "rds") {
    // Deterministic: once RDS is the active provider, a stale/cached
    // Supabase session (from a different account) must never be sent.
    token = getRdsToken() ?? undefined;
  } else if (activeBackend === "supabase") {
    const { data: sessionData } = await supabase.auth.getSession();
    token = sessionData?.session?.access_token ?? undefined;
  } else {
    // No marker yet (session predates this fix, or page loaded without a
    // fresh login this run) — fall back to the original best-effort order
    // so an already-logged-in user isn't signed out by this change.
    const { data: sessionData } = await supabase.auth.getSession();
    token = sessionData?.session?.access_token ?? getRdsToken() ?? undefined;
  }

  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = `HTTP Error ${response.status}: ${response.statusText}`;
    let errData: any = null;
    try {
      errData = await response.json();
      if (errData?.message) errorMsg = errData.message;
      else if (errData?.error) errorMsg = errData.error;
    } catch {
      // Body not JSON
    }
    throw new ApiError(errorMsg, response.status, errData);
  }

  return response.json();
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
