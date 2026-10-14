import { getPool } from "./pool.js";

/**
 * Internal RDS health check. STAGE 10B — ADDITIVE ONLY, UNUSED.
 *
 * Not wired into any route. The existing `GET /health` in app.ts is
 * explicitly documented as "strictly minimal, no DB, no auth" — changing
 * what it does would be an API behavior change, which this stage must not
 * make. This function is left here for a later stage to opt into (e.g. a
 * new internal-only route, or Stage 10C+ once an RDS-backed endpoint
 * actually exists to monitor).
 *
 * Runs only a read-only, side-effect-free query. Never exposes credentials.
 */
export async function checkDbHealth(): Promise<{ ok: true; database: string; user: string; now: string }> {
  const { rows } = await getPool().query<{ current_database: string; current_user: string; now: Date }>(
    "SELECT current_database(), current_user, now()",
  );
  const row = rows[0];
  return { ok: true, database: row.current_database, user: row.current_user, now: row.now.toISOString() };
}
