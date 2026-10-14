import { getPool } from "../db/pool.js";
import type { LeadScope } from "../db/authz.js";
import { leadScopeSql, columnScopeSql } from "../db/authz.js";

/**
 * STAGE 10E3 — direct-RDS repository for the getOrgReadClient-pattern
 * analytics endpoints (State Summary, TL Overview family, Executive Stage
 * Summary, Metric Drilldown). Only raw, lead-scoped rows are fetched here;
 * all aggregation/business-formula logic stays in the controller and is
 * reused UNCHANGED from the Supabase path's own shared helpers
 * (fetchScopedLeads, fetchExecRoster, budgetedSpendForRange, metricPred).
 */

export interface DateRange { from?: string; to?: string }

function scopeWhere(scope: LeadScope, range: DateRange, dateCol = "created_at", column = "assigned_to"): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const s = columnScopeSql(scope, column, params.length + 1);
  if (s.sql !== "TRUE") { conditions.push(s.sql); params.push(...s.params); }
  if (range.from) { params.push(range.from); conditions.push(`${dateCol} >= $${params.length}`); }
  if (range.to) { params.push(range.to); conditions.push(`${dateCol} <= $${params.length}`); }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

// ---- getKpiSnapshot (STAGE 10I-C: org-wide, no role check in the Supabase
// path either — requireAuth only, reads via supabaseAdmin/req.supabase with
// no assigned_to filter, so the RDS path stays unscoped too) ----

export async function getKpiSnapshotView(): Promise<Record<string, unknown>[]> {
  const { rows } = await getPool().query(`SELECT * FROM public.v_kpi_snapshot`);
  return rows;
}

export async function getLeadsForKpiSnapshot(range: DateRange): Promise<{ id: string; stage: string; created_at: string; updated_at: string }[]> {
  const { where, params } = scopeWhere({ kind: "all" }, range);
  const { rows } = await getPool().query(
    `SELECT id, stage::text AS stage, created_at, updated_at FROM public.kob_leads ${where} ORDER BY created_at ASC`,
    params,
  );
  return rows;
}

export async function getLeadIdStageFireHistory(leadIds: string[]): Promise<{ lead_id: string; to_stage: string }[]> {
  if (leadIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT lead_id, to_stage::text AS to_stage FROM public.lead_stage_history
     WHERE lead_id = ANY($1::uuid[]) AND (to_stage)::text = ANY($2::text[]) LIMIT 2000`,
    [leadIds, ["AUTO_FIRED", "FAILED_FIRE"]],
  );
  return rows;
}

export async function getKpiTargetsInRange(fromMonth: string, toMonth: string): Promise<{ metric: string; target_value: number; effective_from: string }[]> {
  const { rows } = await getPool().query(
    `SELECT metric, target_value::float8 AS target_value, effective_from::text AS effective_from
     FROM public.kpi_targets WHERE effective_from >= $1 AND effective_from <= $2 ORDER BY effective_from DESC`,
    [fromMonth, toMonth],
  );
  return rows;
}

// ---- getTATBreachDetailed (STAGE 10I-C: org-wide, no role check today) ----

export async function getAllLeadsForTatBreach(): Promise<{ id: string; code: string; full_name: string; stage: string; created_at: string; updated_at: string; last_activity_at: string | null; assigned_to: string | null }[]> {
  const { rows } = await getPool().query(
    `SELECT id, code, full_name, stage::text AS stage, created_at, updated_at, last_activity_at, assigned_to FROM public.kob_leads`,
  );
  return rows;
}

export async function getStageHistoryForLeads(leadIds: string[]): Promise<{ lead_id: string; from_stage: string | null; to_stage: string; changed_at: string }[]> {
  if (leadIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT lead_id, from_stage::text AS from_stage, to_stage::text AS to_stage, changed_at
     FROM public.lead_stage_history WHERE lead_id = ANY($1::uuid[]) ORDER BY changed_at`,
    [leadIds],
  );
  return rows;
}

export async function getActivitiesForLeads(leadIds: string[]): Promise<{ lead_id: string; created_at: string }[]> {
  if (leadIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT lead_id, created_at FROM public.lead_activities WHERE lead_id = ANY($1::uuid[]) ORDER BY created_at`,
    [leadIds],
  );
  return rows;
}

export async function getRetargetingScheduleForLeads(leadIds: string[]): Promise<{ lead_id: string; next_touch_at: string | null; attempts_done: number; bucket: string | null; is_dead: boolean }[]> {
  if (leadIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT lead_id, next_touch_at, attempts_done, bucket::text AS bucket, is_dead
     FROM public.retargeting_schedule WHERE lead_id = ANY($1::uuid[])`,
    [leadIds],
  );
  return rows;
}

// ---- getMarketingKpis (STAGE 10I-C) ----

/** Mirrors getMarketingKpis()'s computeMarketingTotals() embed: `.select("stage, lead_sources(cost_per_lead)")`. */
export async function getLeadsStageWithSourceCost(fromIso: string, toIso: string): Promise<{ stage: string; cost_per_lead: number | null }[]> {
  const { rows } = await getPool().query(
    `SELECT l.stage::text AS stage, s.cost_per_lead::float8 AS cost_per_lead
     FROM public.kob_leads l LEFT JOIN public.lead_sources s ON s.id = l.source_id
     WHERE l.created_at >= $1 AND l.created_at < $2`,
    [fromIso, toIso],
  );
  return rows;
}

// ---- getAbandonedLeads (STAGE 10I-C) ----

export interface AbandonedLeadRow {
  lead_id: string; code: string; full_name: string; stage: string; assigned_to: string | null;
  team_leader_id: string | null; brand_id: string | null; brand_name: string | null; language: string | null;
  stage_entered_at: string; days_in_stage: number; is_abandoned: boolean;
}

export async function getAbandonedLeadsView(scope: LeadScope): Promise<AbandonedLeadRow[]> {
  const params: unknown[] = [];
  const s = columnScopeSql(scope, "assigned_to", 1);
  const extra = s.sql !== "TRUE" ? `AND ${s.sql}` : "";
  if (s.sql !== "TRUE") params.push(...s.params);
  const { rows } = await getPool().query(
    `SELECT lead_id, code, full_name, stage::text AS stage, assigned_to, team_leader_id, brand_id, brand_name,
            language::text AS language, stage_entered_at, days_in_stage, is_abandoned
     FROM public.v_abandoned_leads WHERE is_abandoned = true ${extra}
     ORDER BY days_in_stage DESC LIMIT 1000`,
    params,
  );
  return rows;
}

export async function getProfileFullNamesByIds(ids: string[]): Promise<{ id: string; full_name: string }[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query(`SELECT id, full_name FROM public.profiles WHERE id = ANY($1::uuid[])`, [ids]);
  return rows;
}

// ---- getStateSummary ----

export async function listStatesForSummary(): Promise<{ id: string; name: string; code: string | null; active: boolean }[]> {
  const { rows } = await getPool().query(`SELECT id, name, code, active FROM public.india_states`);
  return rows;
}

export async function getScopedLeadsStateStageCreated(scope: LeadScope, range: DateRange): Promise<{ state_id: string | null; stage: string; created_at: string }[]> {
  const { where, params } = scopeWhere(scope, range);
  const { rows } = await getPool().query(`SELECT state_id, stage::text AS stage, created_at FROM public.kob_leads ${where}`, params);
  return rows;
}

export async function getCityScopeForStateSummary(): Promise<{ state_id: string; native_kitchen_scope: number | null; other_kitchen_scope: number | null; city_active: boolean; state_active: boolean; district_active: boolean }[]> {
  const { rows } = await getPool().query(
    `SELECT state_id, native_kitchen_scope::float8 AS native_kitchen_scope, other_kitchen_scope::float8 AS other_kitchen_scope,
            city_active, state_active, district_active
     FROM public.v_city_scope`,
  );
  return rows;
}

// ---- fetchScopedLeads (shared by the TL* family) ----

export interface ScopedLeadRich {
  id: string; code: string; full_name: string; phone: string | null; stage: string; mode: string;
  language: string | null; assigned_to: string | null; team_leader_id: string | null;
  brand_id: string | null; source_id: string | null; state_id: string | null; city_id: string | null;
  scv_score: number | null; created_at: string; updated_at: string; converted_at: string | null; last_activity_at: string | null;
  brands: { name: string; code: string } | null;
  lead_sources: { name: string; cost_per_lead: number | null } | null;
  india_states: { name: string } | null;
}

/**
 * Mirrors fetchScopedLeads(): the shared rich-column kob_leads fetch used by
 * getTLOverview/getTLExecutivePerformance/getTLBrandPerformance/
 * getTLLanguagePerformance/getTLTATBreach/getTLRetargeting. The Supabase
 * path pages in 1000-row chunks purely to work around PostgREST's cap —
 * Postgres has no such cap, so one query with no LIMIT produces the
 * identical result set (same simplification precedent as Stage 10C/10E2).
 */
export async function fetchScopedLeadsRich(scope: LeadScope, range: DateRange = {}): Promise<ScopedLeadRich[]> {
  const { where, params } = scopeWhere(scope, range);
  const { rows } = await getPool().query<ScopedLeadRich>(
    `SELECT l.id, l.code, l.full_name, l.phone, l.stage::text AS stage, l.mode::text AS mode, l.language::text AS language,
            l.assigned_to, l.team_leader_id, l.brand_id, l.source_id, l.state_id, l.city_id, l.scv_score,
            l.created_at, l.updated_at, l.converted_at, l.last_activity_at,
            CASE WHEN br.id IS NULL THEN NULL ELSE jsonb_build_object('name', br.name, 'code', br.code) END AS brands,
            CASE WHEN src.id IS NULL THEN NULL ELSE jsonb_build_object('name', src.name, 'cost_per_lead', src.cost_per_lead::float8) END AS lead_sources,
            CASE WHEN st.id IS NULL THEN NULL ELSE jsonb_build_object('name', st.name) END AS india_states
     FROM public.kob_leads l
     LEFT JOIN public.brands br ON br.id = l.brand_id
     LEFT JOIN public.lead_sources src ON src.id = l.source_id
     LEFT JOIN public.india_states st ON st.id = l.state_id
     ${where}
     ORDER BY l.created_at DESC`,
    params,
  );
  return rows;
}

/**
 * Mirrors fetchExecRoster(): executives visible under the caller's scope.
 * For "all" scope: every executive in the system (matches org-wide roles'
 * unrestricted `user_roles` read). For "assigned_to" scope (executive):
 * ONLY themselves — this reproduces the REAL mechanism behind today's
 * executive self-scoping on this specific endpoint family, which is the
 * `user_roles self read: user_id = auth.uid()` RLS policy (NOT a kob_leads
 * filter) cascading through to restrict which executives' data is shown.
 */
export async function fetchExecRosterScoped(scope: LeadScope, cols: string[] = ["id", "full_name", "email", "phone"]): Promise<Record<string, unknown>[]> {
  const { sql, params } = columnScopeSql(scope, "user_id", 1);
  const roleWhere = sql === "TRUE" ? "role = 'executive'" : `role = 'executive' AND ${sql}`;
  const { rows: roleRows } = await getPool().query<{ user_id: string }>(`SELECT user_id FROM public.user_roles WHERE ${roleWhere}`, params);
  const ids = Array.from(new Set(roleRows.map((r) => r.user_id)));
  if (ids.length === 0) return [];
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const { rows } = await getPool().query(`SELECT ${colList} FROM public.profiles WHERE id = ANY($1::uuid[])`, [ids]);
  return rows;
}

// ---- budgetedSpendForRange ----

export async function getMarketingSpendByPeriods(periods: string[]): Promise<{ period: string; target_value: number }[]> {
  if (periods.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT period::text AS period, target_value::float8 AS target_value FROM public.marketing_kpi_targets WHERE metric = 'SPEND' AND period::text = ANY($1::text[])`,
    [periods],
  );
  return rows;
}

// ---- getTLOverview's extra reads ----

export async function countActiveStates(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(`SELECT count(*) FROM public.india_states WHERE active = true`);
  return Number(rows[0].count);
}
export async function countActiveCities(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(`SELECT count(*) FROM public.india_cities WHERE active = true`);
  return Number(rows[0].count);
}

/**
 * Mirrors `.from("v_city_scope").select("kitchen_scope")` — a PRE-EXISTING
 * bug in the Supabase path: v_city_scope has no `kitchen_scope` column
 * (only native_kitchen_scope/other_kitchen_scope). That query always errors
 * on Supabase too, but the error is never checked there, so `kitchenScope`
 * silently defaults to 0 on every call today. Reproduced exactly: this
 * always returns 0, without "fixing" behavior nobody asked to change.
 */
export async function getKitchenScopeTotalBuggyAsIs(): Promise<number> {
  return 0;
}

// ---- getTLTATBreach / getTLRetargeting (chunked .in() fetches by lead id) ----

export async function getLeadStageHistoryByLeadIds(leadIds: string[]): Promise<{ lead_id: string; from_stage: string | null; to_stage: string; changed_at: string }[]> {
  if (leadIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT lead_id, from_stage::text AS from_stage, to_stage::text AS to_stage, changed_at
     FROM public.lead_stage_history WHERE lead_id = ANY($1::uuid[]) ORDER BY changed_at`,
    [leadIds],
  );
  return rows;
}

export async function getLeadActivitiesByLeadIds(leadIds: string[]): Promise<{ lead_id: string; created_at: string }[]> {
  if (leadIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT lead_id, created_at FROM public.lead_activities WHERE lead_id = ANY($1::uuid[]) ORDER BY created_at`,
    [leadIds],
  );
  return rows;
}

export async function getRetargetingScheduleByLeadIds(leadIds: string[]): Promise<Record<string, unknown>[]> {
  if (leadIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT * FROM public.retargeting_schedule WHERE lead_id = ANY($1::uuid[]) ORDER BY next_touch_at`,
    [leadIds],
  );
  return rows;
}

// ---- getExecutiveStageSummary ----

export async function getExecutiveRoleUserIdsScoped(scope: LeadScope): Promise<string[]> {
  const { sql, params } = columnScopeSql(scope, "user_id", 1);
  const where = sql === "TRUE" ? "role = 'executive'" : `role = 'executive' AND ${sql}`;
  const { rows } = await getPool().query<{ user_id: string }>(`SELECT user_id FROM public.user_roles WHERE ${where}`, params);
  return rows.map((r) => r.user_id);
}

export async function getProfilesForExecSummary(ids: string[]): Promise<{ id: string; full_name: string; email: string | null; team_leader_id: string | null; assignment_active: boolean | null }[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT id, full_name, email, team_leader_id, assignment_active FROM public.profiles WHERE id = ANY($1::uuid[]) ORDER BY full_name ASC`,
    [ids],
  );
  return rows;
}

export async function getLeadsByAssignedToStageEntered(execIds: string[], from?: string, to?: string): Promise<{ id: string; assigned_to: string; stage: string }[]> {
  if (execIds.length === 0) return [];
  const conditions = ["assigned_to = ANY($1::uuid[])"];
  const params: unknown[] = [execIds];
  if (from) { params.push(from); conditions.push(`stage_entered_at >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`stage_entered_at <= $${params.length}`); }
  const { rows } = await getPool().query(
    `SELECT id, assigned_to, stage::text AS stage FROM public.kob_leads WHERE ${conditions.join(" AND ")} ORDER BY id ASC`,
    params,
  );
  return rows;
}

// ---- getMetricDrilldown ----

export async function getScopedLeadsStageLangCityCreated(scope: LeadScope, range: DateRange): Promise<{ stage: string; language: string | null; city_id: string | null; created_at: string }[]> {
  const { where, params } = scopeWhere(scope, range);
  const { rows } = await getPool().query(`SELECT stage::text AS stage, language::text AS language, city_id, created_at FROM public.kob_leads ${where}`, params);
  return rows;
}

export async function getCityNamesByIds(ids: string[]): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query(`SELECT id, name FROM public.india_cities WHERE id = ANY($1::uuid[])`, [ids]);
  return rows;
}

// ---- getContractsCount / getDashboardKpis ----
// Both are ALWAYS org-wide on the Supabase path today (unconditional
// supabaseAdmin, no role check at all beyond requireAuth) — proven by
// frontend call sites (ceo.dashboard.tsx, mgr.reports.tsx, dashboard.tsx,
// KPICards.tsx), none of which pass a per-user/assigned_to filter. The RDS
// path below reproduces that exact "no scoping" behavior, not a narrower one.

export async function countContracts(from?: string, to?: string): Promise<number> {
  const conditions = ["stage = 'KTN_CS'"];
  const params: unknown[] = [];
  if (from) { params.push(from); conditions.push(`stage_entered_at >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`stage_entered_at <= $${params.length}`); }
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT count(*) FROM public.kob_leads WHERE ${conditions.join(" AND ")}`,
    params,
  );
  return Number(rows[0].count);
}

export interface DashboardKpiLeadRow { stage: string; mode: string; source_id: string | null; cost_per_lead: number | null }

export async function getAllLeadsForDashboardKpis(range: DateRange): Promise<DashboardKpiLeadRow[]> {
  const { where, params } = scopeWhere({ kind: "all" }, range);
  const { rows } = await getPool().query<DashboardKpiLeadRow>(
    `SELECT l.stage::text AS stage, l.mode::text AS mode, l.source_id, src.cost_per_lead::float8 AS cost_per_lead
     FROM public.kob_leads l LEFT JOIN public.lead_sources src ON src.id = l.source_id
     ${where}`,
    params,
  );
  return rows;
}

export async function getKitchenScopeTotal(): Promise<number> {
  const { rows } = await getPool().query<{ total: number }>(
    `SELECT COALESCE(SUM(native_kitchen_scope + other_kitchen_scope), 0)::float8 AS total
     FROM public.v_city_scope WHERE city_active AND state_active AND district_active`,
  );
  return Number(rows[0]?.total ?? 0);
}
