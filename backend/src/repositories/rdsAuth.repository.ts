import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";

/**
 * Parallel RDS/JWT auth credential store (see drizzle/migrations/0008_app_users.sql).
 * user_id always references an existing profiles.id — this file never
 * mints a new application identity on its own; it only stores the
 * password credential alongside an identity that already exists (or is
 * created together with it, in the same transaction, by the caller).
 */

export interface AppUserRow {
  user_id: string;
  username: string;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
}

export async function findAppUserByUsername(username: string): Promise<AppUserRow | null> {
  const { rows } = await getPool().query<AppUserRow>(
    `SELECT user_id, username, password_hash, is_active, must_change_password
     FROM public.app_users WHERE lower(username) = lower($1) LIMIT 1`,
    [username],
  );
  return rows[0] ?? null;
}

export async function findAppUserById(userId: string): Promise<AppUserRow | null> {
  const { rows } = await getPool().query<AppUserRow>(
    `SELECT user_id, username, password_hash, is_active, must_change_password
     FROM public.app_users WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function isAppUsernameTaken(username: string, excludeUserId?: string): Promise<boolean> {
  const params: unknown[] = [username];
  let sql = `SELECT 1 FROM public.app_users WHERE lower(username) = lower($1)`;
  if (excludeUserId) {
    params.push(excludeUserId);
    sql += ` AND user_id <> $2`;
  }
  const { rows } = await getPool().query(sql, params);
  return rows.length > 0;
}

export async function insertAppUser(
  client: PoolClient,
  row: { user_id: string; username: string; password_hash: string; must_change_password: boolean },
): Promise<void> {
  await client.query(
    `INSERT INTO public.app_users (user_id, username, password_hash, must_change_password, password_changed_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN NULL ELSE now() END)`,
    [row.user_id, row.username, row.password_hash, row.must_change_password],
  );
}

export async function updateAppUserPassword(
  client: PoolClient,
  userId: string,
  passwordHash: string,
  mustChangePassword: boolean,
): Promise<void> {
  await client.query(
    `UPDATE public.app_users
     SET password_hash = $2, must_change_password = $3, password_changed_at = CASE WHEN $3 THEN password_changed_at ELSE now() END, updated_at = now()
     WHERE user_id = $1`,
    [userId, passwordHash, mustChangePassword],
  );
}

export async function updateAppUserUsername(client: PoolClient, userId: string, username: string): Promise<void> {
  await client.query(`UPDATE public.app_users SET username = $2, updated_at = now() WHERE user_id = $1`, [userId, username]);
}

export async function setAppUserActive(client: PoolClient, userId: string, isActive: boolean): Promise<void> {
  await client.query(`UPDATE public.app_users SET is_active = $2, updated_at = now() WHERE user_id = $1`, [userId, isActive]);
}
