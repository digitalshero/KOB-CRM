import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";
import { insertAuditLog } from "./admin.repository.js";
import { PAGE_KEY_SET } from "../pageRegistry.js";

/**
 * CEO-controlled per-user page access (additive feature — see
 * drizzle/migrations/0006_user_page_permissions.sql).
 *
 * Backward compatibility: a user with ZERO rows in user_page_permissions is
 * UNRESTRICTED (today's exact pre-feature behavior) — getAllowedPageKeys
 * returns null as the "unrestricted" sentinel in that case. Restriction for
 * a given user only begins once a CEO explicitly saves a grant set for them
 * (at least one row then exists). super_admin (CEO) is always unconditionally
 * unrestricted regardless of rows, enforced here in the application layer.
 */

/** null = unrestricted (no rows yet, or role is super_admin). */
export async function getAllowedPageKeys(userId: string, role: string | null): Promise<string[] | null> {
  if (role === "super_admin") return null;
  const { rows } = await getPool().query<{ page_key: string }>(
    `SELECT page_key FROM public.user_page_permissions WHERE user_id = $1 AND allowed = true`,
    [userId],
  );
  const { rows: anyRows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM public.user_page_permissions WHERE user_id = $1`,
    [userId],
  );
  const hasAnyRecord = Number(anyRows[0]?.count ?? "0") > 0;
  if (!hasAnyRecord) return null;
  return rows.map((r) => r.page_key);
}

export interface UserPageAccessRow { page_key: string; allowed: boolean }

/** Raw grant rows for a user (CEO management screen) — empty array if none set yet (= unrestricted). */
export async function getUserPageAccessRows(userId: string): Promise<UserPageAccessRow[]> {
  const { rows } = await getPool().query<UserPageAccessRow>(
    `SELECT page_key, allowed FROM public.user_page_permissions WHERE user_id = $1`,
    [userId],
  );
  return rows;
}

/**
 * Transactionally replaces a user's full grant set and writes an audit log
 * entry recording previous/new state. Caller (controller) must have already
 * verified the actor is CEO-authorized and must run this inside
 * withTransaction(actorId, ...).
 */
export async function setUserPageAccess(
  client: PoolClient,
  targetUserId: string,
  actorId: string,
  grants: { page_key: string; allowed: boolean }[],
): Promise<void> {
  const invalid = grants.filter((g) => !PAGE_KEY_SET.has(g.page_key));
  if (invalid.length > 0) {
    throw new Error(`Unknown page_key(s): ${invalid.map((g) => g.page_key).join(", ")}`);
  }

  const { rows: previousRows } = await client.query<UserPageAccessRow>(
    `SELECT page_key, allowed FROM public.user_page_permissions WHERE user_id = $1`,
    [targetUserId],
  );

  for (const g of grants) {
    await client.query(
      `INSERT INTO public.user_page_permissions (user_id, page_key, allowed, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, page_key) DO UPDATE SET allowed = EXCLUDED.allowed, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [targetUserId, g.page_key, g.allowed, actorId],
    );
  }

  await insertAuditLog(client, actorId, "page_access.updated", "user_page_permissions", targetUserId, {
    previous: previousRows,
    new: grants,
  });
}
