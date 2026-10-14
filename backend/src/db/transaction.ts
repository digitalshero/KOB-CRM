import type { PoolClient, QueryResultRow } from "pg";
import { getPool } from "./pool.js";

/**
 * Direct PostgreSQL/RDS transaction helper.
 *
 * STAGE 10B — ADDITIVE ONLY. Not called from any controller yet.
 *
 * `kob_app_user` owns every table on RDS, so PostgreSQL RLS does not apply
 * to it (see Stage 9/10A). The `auth.uid()` compatibility function instead
 * reads `request.jwt.claim.sub` from the PostgreSQL session/transaction
 * config, which several restored trigger functions rely on (stage history
 * `changed_by`, SCV weight-change log, the kob_configuration manager-scope
 * guard, retargeting audit log rows). withTransaction() is the only place
 * that is allowed to set this value, and it does so LOCAL to the
 * transaction (`set_config(..., true)`), never session-wide — the setting
 * disappears automatically on COMMIT/ROLLBACK, so pooled connections can
 * never leak one caller's identity into another caller's transaction.
 *
 * actorId:
 *   - a user id (uuid string) for user-initiated writes -> triggers see
 *     that user via auth.uid(), exactly like a caller-JWT PostgREST request.
 *   - null for system/webhook writes (e.g. Gallabox/public webhook paths)
 *     -> auth.uid() returns NULL, matching today's service-role writes.
 */
export async function withTransaction<T>(
  actorId: string | null,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (actorId !== null) {
      // $3 = true -> transaction-local (SET LOCAL semantics), cleared at
      // COMMIT/ROLLBACK. Parameterized to avoid any injection concern even
      // though actorId is expected to be a uuid.
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [actorId]);
    }
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Swallow rollback errors (e.g. connection already closed) — the
      // original error is what matters and is rethrown below.
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Convenience wrapper for a single parameterized query inside a transaction. */
export async function queryInTransaction<R extends QueryResultRow = QueryResultRow>(
  actorId: string | null,
  text: string,
  params: unknown[] = [],
): Promise<R[]> {
  return withTransaction(actorId, async (client) => {
    const res = await client.query<R>(text, params);
    return res.rows;
  });
}
