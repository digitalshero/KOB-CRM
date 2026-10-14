import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";

/**
 * STAGE 10F — direct-RDS repository for low-risk, non-lead admin/config
 * writes. Every function here takes a `PoolClient` already inside an
 * active `withTransaction(req.userId, ...)` call (see db/transaction.ts) —
 * never a bare Pool — so the business write and its audit_logs insert
 * (see insertAuditLog below) always commit or roll back together, and
 * `request.jwt.claim.sub` is set for the duration of both (required for
 * triggers such as enforce_kob_configuration_manager_scope to see the
 * correct auth.uid()).
 *
 * All SQL is parameterized. Column/table names are hardcoded literals
 * from this file, never built from request input, with the one necessary
 * exception of updateConfig()'s column allowlist, which is checked against
 * a fixed Set before being interpolated (never raw user text).
 */

/** Mirrors the shared logAudit() shape used throughout the Supabase path. */
export async function insertAuditLog(
  client: PoolClient,
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  meta: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, meta) VALUES ($1, $2, $3, $4, $5)`,
    [actorId, action, entity, entityId, meta === undefined ? null : JSON.stringify(meta)],
  );
}

export interface KpiTargetUpsert { metric: string; period: string; target_value: number; effective_from: string }
export async function upsertKpiTarget(client: PoolClient, row: KpiTargetUpsert): Promise<void> {
  await client.query(
    `INSERT INTO public.kpi_targets (metric, period, target_value, effective_from)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (metric, period, effective_from) DO UPDATE SET target_value = EXCLUDED.target_value`,
    [row.metric, row.period, row.target_value, row.effective_from],
  );
}

export async function deleteKpiTarget(client: PoolClient, id: string): Promise<void> {
  await client.query(`DELETE FROM public.kpi_targets WHERE id = $1`, [id]);
}

export interface MarketingTargetUpsert { metric: string; target_value: number; period: string }
export async function upsertMarketingTarget(client: PoolClient, row: MarketingTargetUpsert): Promise<void> {
  await client.query(
    `INSERT INTO public.marketing_kpi_targets (metric, target_value, period)
     VALUES ($1, $2, $3)
     ON CONFLICT (metric, period) DO UPDATE SET target_value = EXCLUDED.target_value`,
    [row.metric, row.target_value, row.period],
  );
}

/**
 * Every real, non-PK column of kob_configuration (Stage 10A schema audit).
 * The Supabase path accepts any column PostgREST/Postgres itself would
 * accept for an UPDATE (it passes req.body straight through); this set
 * mirrors that exactly, minus the primary key `id`.
 */
const KOB_CONFIGURATION_COLUMNS = new Set([
  "native_multiplier", "other_multiplier", "incentive_slab_a", "incentive_slab_b", "incentive_slab_c",
  "incentive_slab_d", "rt_no_days", "rt_no_attempts", "rt_later_first_days", "rt_later_first_attempts",
  "rt_later_then_days", "rt_noresp_first_days", "rt_noresp_first_attempts", "rt_noresp_second_days",
  "rt_noresp_second_attempts", "rt_noresp_final_days", "updated_at", "native_brand_multiplier",
  "other_brand_multiplier", "default_mode", "auto_mode_killswitch", "incentive_amount",
]);

export class UnknownConfigColumnError extends Error {
  constructor(public column: string) { super(`Unknown kob_configuration column: ${column}`); }
}

/**
 * Updates kob_configuration. Column names come from the request body and
 * cannot be parameterized as values, so they are validated against the
 * fixed allowlist above before being interpolated into the SQL text; any
 * unrecognized key throws UnknownConfigColumnError instead of being used.
 *
 * Does NOT re-implement enforce_kob_configuration_manager_scope's per-field
 * kob_manager restriction — that trigger runs unchanged on RDS and is the
 * single source of truth for it, exactly as on the Supabase path. This
 * function only performs the role gate the table's own RLS policy applies
 * (super_admin OR kob_manager), checked by the caller before this runs.
 */
export async function updateConfig(client: PoolClient, patch: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(patch);
  for (const k of keys) if (!KOB_CONFIGURATION_COLUMNS.has(k)) throw new UnknownConfigColumnError(k);
  if (keys.length === 0) return;
  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
  const params = keys.map((k) => patch[k]);
  await client.query(`UPDATE public.kob_configuration SET ${setClauses.join(", ")} WHERE id = 1`, params);
}

export interface IncentiveRulePatch { label: string; min_score: number; max_score: number; incentive_pct: number }
export async function updateIncentiveRule(client: PoolClient, id: string, patch: IncentiveRulePatch): Promise<void> {
  await client.query(
    `UPDATE public.incentive_rules SET label = $1, min_score = $2, max_score = $3, incentive_pct = $4 WHERE id = $5`,
    [patch.label, patch.min_score, patch.max_score, patch.incentive_pct, id],
  );
}

export interface ScvRulesPatch {
  weight_conversion: number; weight_tat: number; weight_eoi1_webinar: number;
  weight_eoi2_payment: number; weight_crm_discipline: number;
}
export async function updateScvRules(client: PoolClient, patch: ScvRulesPatch): Promise<void> {
  await client.query(
    `UPDATE public.scv_rules SET weight_conversion = $1, weight_tat = $2, weight_eoi1_webinar = $3,
            weight_eoi2_payment = $4, weight_crm_discipline = $5 WHERE id = 1`,
    [patch.weight_conversion, patch.weight_tat, patch.weight_eoi1_webinar, patch.weight_eoi2_payment, patch.weight_crm_discipline],
  );
}

export interface BrandInsert { code: string; name: string; is_shero: boolean; active: boolean }
export async function createBrand(client: PoolClient, row: BrandInsert): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO public.brands (code, name, is_shero, active) VALUES ($1, $2, $3, $4) RETURNING id`,
    [row.code, row.name, row.is_shero, row.active],
  );
  return rows[0];
}

export async function updateSourceCost(client: PoolClient, id: string, costPerLead: number): Promise<void> {
  await client.query(`UPDATE public.lead_sources SET cost_per_lead = $1 WHERE id = $2`, [costPerLead, id]);
}

export async function upsertStateNativeBrand(client: PoolClient, stateId: string, brandId: string): Promise<void> {
  await client.query(
    `INSERT INTO public.state_native_brand (state_id, brand_id) VALUES ($1, $2)
     ON CONFLICT (state_id) DO UPDATE SET brand_id = EXCLUDED.brand_id`,
    [stateId, brandId],
  );
}

/**
 * STAGE 10I-D — createExecutive provisioning.
 *
 * Supabase Auth remains the system of record for login (createUser/listUsers
 * stay on supabaseAdmin, unchanged). RDS keeps its own auth.users table only
 * as a local FK-compatibility mirror (see supabase/local-migration-compatibility.sql)
 * — profiles.id and user_roles.user_id reference it. After Supabase Auth
 * creates (or finds) the user, this mirrors the minimum compatible row here
 * so the profiles/user_roles inserts below don't violate that FK.
 */
export async function upsertAuthUserMirror(client: PoolClient, id: string, email: string): Promise<void> {
  await client.query(
    `INSERT INTO auth.users (id, email) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
    [id, email],
  );
}

export interface ExecutiveProfileUpsert {
  id: string; full_name: string; email: string; primary_language: string | null;
  secondary_language: string | null; team_leader_id: string | null;
}
export async function upsertExecutiveProfile(client: PoolClient, row: ExecutiveProfileUpsert): Promise<void> {
  await client.query(
    `INSERT INTO public.profiles (id, full_name, email, primary_language, secondary_language, team_leader_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email,
       primary_language = EXCLUDED.primary_language, secondary_language = EXCLUDED.secondary_language,
       team_leader_id = EXCLUDED.team_leader_id`,
    [row.id, row.full_name, row.email, row.primary_language, row.secondary_language, row.team_leader_id],
  );
}

export async function upsertExecutiveRole(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'executive')
     ON CONFLICT (user_id, role) DO NOTHING`,
    [userId],
  );
}

export async function getRolesForUser(userId: string): Promise<string[]> {
  const { rows } = await getPool().query(`SELECT role FROM public.user_roles WHERE user_id = $1`, [userId]);
  return rows.map((r: any) => r.role);
}

export interface GallaboxTemplateUpsert {
  id?: string; name: string; body: string; language: string; active: boolean;
  category: string; bucket: string | null; email_subject: string | null; email_body: string | null;
}
/**
 * Mirrors `.from("gallabox_templates").upsert(payload)` with no onConflict
 * target specified, which PostgREST resolves against the primary key (id).
 * When `id` is omitted, a new row is inserted and the table's own
 * `gen_random_uuid()` default assigns its id, exactly like an insert with
 * no PK supplied on the Supabase path.
 */
export async function upsertGallaboxTemplate(client: PoolClient, row: GallaboxTemplateUpsert): Promise<void> {
  if (row.id) {
    await client.query(
      `INSERT INTO public.gallabox_templates (id, name, body, language, active, category, bucket, email_subject, email_body)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, body = EXCLUDED.body, language = EXCLUDED.language,
         active = EXCLUDED.active, category = EXCLUDED.category, bucket = EXCLUDED.bucket,
         email_subject = EXCLUDED.email_subject, email_body = EXCLUDED.email_body, updated_at = now()`,
      [row.id, row.name, row.body, row.language, row.active, row.category, row.bucket, row.email_subject, row.email_body],
    );
  } else {
    await client.query(
      `INSERT INTO public.gallabox_templates (name, body, language, active, category, bucket, email_subject, email_body)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.name, row.body, row.language, row.active, row.category, row.bucket, row.email_subject, row.email_body],
    );
  }
}
