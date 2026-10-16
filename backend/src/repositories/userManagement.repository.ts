import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";
import type { Role } from "../db/authz.js";
import { insertAuditLog } from "./admin.repository.js";

/**
 * Username as an additive application identity layered on top of the
 * existing Supabase Auth user (profiles.id stays the Auth user id,
 * unchanged — see drizzle/migrations/0007_add_username.sql). Supabase
 * Auth itself is untouched; this only adds a username<->user_id mapping
 * and a synthetic internal email for Auth's own compatibility needs.
 */

const USERNAME_RE = /^[a-zA-Z0-9._]{3,32}$/;

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!USERNAME_RE.test(trimmed)) return null;
  return trimmed;
}

export function syntheticEmailFor(username: string): string {
  return `${username.toLowerCase()}@users.shero.internal`;
}

/** Looks up the email behind a username — used ONLY server-side for login; never returned to a client. */
export async function findAuthEmailByUsername(username: string): Promise<{ id: string; email: string } | null> {
  const { rows } = await getPool().query<{ id: string; email: string }>(
    `SELECT id, email FROM public.profiles WHERE lower(username) = lower($1) LIMIT 1`,
    [username],
  );
  return rows[0] ?? null;
}

export async function isUsernameTaken(username: string, excludeUserId?: string): Promise<boolean> {
  const params: unknown[] = [username];
  let sql = `SELECT 1 FROM public.profiles WHERE lower(username) = lower($1)`;
  if (excludeUserId) {
    params.push(excludeUserId);
    sql += ` AND id <> $2`;
  }
  const { rows } = await getPool().query(sql, params);
  return rows.length > 0;
}

export interface NewUserProfile {
  id: string;
  username: string;
  full_name: string;
  email: string;
}

export async function insertUserProfile(client: PoolClient, row: NewUserProfile): Promise<void> {
  await client.query(
    `INSERT INTO public.profiles (id, username, full_name, email) VALUES ($1, $2, $3, $4)`,
    [row.id, row.username, row.full_name, row.email],
  );
}

export async function updateProfileFields(
  client: PoolClient,
  userId: string,
  patch: { username?: string; full_name?: string },
): Promise<void> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length === 0) return;
  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
  const params = keys.map((k) => patch[k]);
  await client.query(`UPDATE public.profiles SET ${setClauses.join(", ")} WHERE id = $${keys.length + 1}`, [...params, userId]);
}

/** Replaces a user's role set with exactly one role — this app treats role as singular per user. */
export async function replaceUserRole(client: PoolClient, userId: string, role: Role): Promise<void> {
  await client.query(`DELETE FROM public.user_roles WHERE user_id = $1`, [userId]);
  await client.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2)`, [userId, role]);
}

export async function getProfileById(userId: string): Promise<{ id: string; username: string | null; full_name: string; email: string | null } | null> {
  const { rows } = await getPool().query(
    `SELECT id, username, full_name, email FROM public.profiles WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function auditUserChange(
  client: PoolClient,
  actorId: string,
  action: string,
  targetUserId: string,
  meta: unknown,
): Promise<void> {
  await insertAuditLog(client, actorId, action, "profiles", targetUserId, meta);
}
