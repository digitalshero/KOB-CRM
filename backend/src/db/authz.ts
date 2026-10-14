import type { QueryResultRow } from "pg";
import { getPool } from "./pool.js";

/**
 * Accepts either a Pool or a PoolClient. The role-lookup functions below are
 * plain read-only SELECTs with no transaction/actor-context requirement
 * (same rationale as reference/config repositories in Stage 10C), so they
 * may run directly against the pool instead of requiring a checked-out
 * client. STAGE 10E1.
 */
type Queryable = { query<T extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<{ rows: T[] }> };

/**
 * Authorization foundation for the direct-RDS path.
 *
 * STAGE 10B — ADDITIVE ONLY. Not wired into any controller yet.
 *
 * `kob_app_user` owns every RDS table, so PostgreSQL RLS does not restrict
 * it (Stage 9). These helpers exist to let a future endpoint reproduce,
 * in Express, the exact same scoping the existing Supabase RLS policies
 * enforce today (audited in Stage 10A). They introduce NO new rules:
 *
 *   kob_leads            SELECT/UPDATE: executive -> assigned_to = self
 *                                        team_leader/kob_manager/super_admin -> all
 *                         INSERT:        team_leader -> team_leader_id = self
 *                                        kob_manager/super_admin -> all
 *   incentives           SELECT: executive -> user_id = self; others -> all (managers write)
 *   scv_manual_ratings   SELECT: executive -> user_id = self; managers -> all
 *   user_roles           SELECT: self, or any role for manager/super_admin/team_leader
 *   lead_events, retargeting *_sends, audit_logs (read): team_leader and above only
 *   lead_stage_history, lead_activities, webinar_attendance, profiles (read):
 *                         open to any signed-in user
 */

export type Role = "super_admin" | "kob_manager" | "team_leader" | "executive";

const ROLE_PRIORITY: Role[] = ["super_admin", "kob_manager", "team_leader", "executive"];

/**
 * Mirrors public.get_user_role(_user_id): the highest-priority role for a
 * user, or null if they have no row in user_roles. Reads from user_roles
 * directly rather than calling the Postgres RPC, since kob_app_user's own
 * session has no caller JWT for RLS to apply to in the first place.
 */
export async function resolveActorRole(client: Queryable, userId: string): Promise<Role | null> {
  const { rows } = await client.query<{ role: Role }>(
    `SELECT role FROM public.user_roles WHERE user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return null;
  const roles = new Set(rows.map((r) => r.role));
  for (const role of ROLE_PRIORITY) if (roles.has(role)) return role;
  return null;
}

/** Mirrors public.has_role(_user_id, _role). */
export async function actorHasRole(client: Queryable, userId: string, role: Role): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = $2) AS exists`,
    [userId, role],
  );
  return rows[0]?.exists ?? false;
}

/**
 * Row-level scope for kob_leads (and tables keyed the same way) matching
 * today's RLS: only "executive" is restricted to their own assigned rows.
 */
export type LeadScope = { kind: "all" } | { kind: "assigned_to"; userId: string };

export function leadScopeFor(role: Role | null, userId: string): LeadScope {
  if (role === "executive" || role === null) return { kind: "assigned_to", userId };
  return { kind: "all" };
}

/**
 * Builds the SQL fragment + params for applying a LeadScope as a WHERE
 * clause fragment, e.g. `WHERE 1=1 AND ${sql}`. paramIndex is the next
 * free $n placeholder number in the caller's query.
 */
export function leadScopeSql(scope: LeadScope, paramIndex: number): { sql: string; params: unknown[] } {
  return columnScopeSql(scope, "assigned_to", paramIndex);
}

/**
 * STAGE 10E3: generic version of leadScopeSql for columns other than
 * kob_leads.assigned_to — e.g. user_roles.user_id, which is how
 * getExecutiveStageSummary/getTLOverview-family endpoints actually derive
 * an executive's self-scope today (their own RLS-restricted read of
 * user_roles, NOT a kob_leads filter). `column` is always a fixed literal
 * supplied by the calling repository function, never user input.
 */
export function columnScopeSql(scope: LeadScope, column: string, paramIndex: number): { sql: string; params: unknown[] } {
  if (scope.kind === "all") return { sql: "TRUE", params: [] };
  return { sql: `${column} = $${paramIndex}`, params: [scope.userId] };
}

/** True for roles whose RLS grants organisation-wide (non-self-scoped) access. */
export function isOrgWideRole(role: Role | null): boolean {
  return role === "team_leader" || role === "kob_manager" || role === "super_admin";
}

/** True for roles that may insert into kob_leads under any team_leader_id/unrestricted. */
export function canInsertLeadAs(role: Role | null, teamLeaderId: string | null, userId: string): boolean {
  if (role === "kob_manager" || role === "super_admin") return true;
  if (role === "team_leader") return teamLeaderId === userId;
  return false;
}

/**
 * STAGE 10E1/10E2 shared helper: resolves a caller's server-controlled
 * LeadScope for the RDS path, or null if they have no role at all.
 *
 * Unlike the Supabase path (which defaults an unresolvable role to
 * "executive" — see e.g. listLeads/getOrgReadClient), a user with NO role
 * row is explicitly DENIED by every RDS-migrated analytics/lead endpoint.
 * This is strictly more restrictive than the Supabase path, never less.
 */
/**
 * STAGE 10F: generic role-gate for non-lead admin/config writes, mirroring
 * the RLS policy each target table already enforces on the Supabase path
 * (e.g. `brands`/`incentive_rules`/`scv_rules` -> super_admin only;
 * `kob_configuration`/`kpi_targets`/`marketing_kpi_targets`/`lead_sources`/
 * `state_native_brand`/`gallabox_templates` -> super_admin OR kob_manager).
 * `kob_app_user` owns these tables, so RLS does not apply to it on RDS —
 * this check is what stands in for it. Returns the resolved role on
 * success, or null if the caller has no role, or a role not in `allowed`.
 */
export async function requireRoleOrDeny(userId: string, allowed: Role[]): Promise<Role | null> {
  const role = await resolveActorRole(getPool(), userId);
  if (role === null || !allowed.includes(role)) return null;
  return role;
}

export async function resolveLeadScopeOrDeny(userId: string): Promise<LeadScope | null> {
  const role = await resolveActorRole(getPool(), userId);
  if (role === null) return null;
  return leadScopeFor(role, userId);
}
