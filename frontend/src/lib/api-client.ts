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
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token ?? getRdsToken() ?? undefined;

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
