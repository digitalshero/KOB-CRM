import { getPool } from "../db/pool.js";
import type { LeadScope } from "../db/authz.js";
import { leadScopeSql } from "../db/authz.js";

/**
 * STAGE 10E2 — direct-RDS repository for dashboard read endpoints
 * (getKpiTrend, getChannelConversion). See funnel.repository.ts for the
 * shared rationale: only raw, lead-scoped rows are fetched here; all
 * business-formula logic (bucketing, trend regression, channel mapping)
 * stays in the controller and is reused UNCHANGED across both backends.
 */

export interface DateRange { from?: string; to?: string }

function scopeAndRangeWhere(scope: LeadScope, range: DateRange, dateCol = "created_at"): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const scopeSql = leadScopeSql(scope, params.length + 1);
  if (scopeSql.sql !== "TRUE") { conditions.push(scopeSql.sql); params.push(...scopeSql.params); }
  if (range.from) { params.push(range.from); conditions.push(`${dateCol} >= $${params.length}`); }
  if (range.to) { params.push(range.to); conditions.push(`${dateCol} <= $${params.length}`); }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

/** Mirrors getKpiTrend()'s `.select("stage, mode, created_at").gte("created_at", earliest)`. */
export async function getLeadsStageModeCreatedSince(scope: LeadScope, since: string): Promise<{ stage: string; mode: string; created_at: string }[]> {
  const { where, params } = scopeAndRangeWhere(scope, { from: since });
  const { rows } = await getPool().query(
    `SELECT stage::text AS stage, mode::text AS mode, created_at FROM public.kob_leads ${where}`,
    params,
  );
  return rows;
}

/** Mirrors getChannelConversion()'s `.select("id, stage, source_id")` with optional from/to on created_at. */
export async function getLeadsIdStageSource(scope: LeadScope, range: DateRange): Promise<{ id: string; stage: string; source_id: string | null }[]> {
  const { where, params } = scopeAndRangeWhere(scope, range);
  const { rows } = await getPool().query(
    `SELECT id, stage::text AS stage, source_id FROM public.kob_leads ${where}`,
    params,
  );
  return rows;
}

/**
 * STAGE 10I-B — the remaining handlers below (getCombinedFunnel,
 * getLeadsTrend, getRetargetingFunnel/Split, getAbandonedFunnel/Split,
 * getBrandPerformance, getStateSpread, getFunnelStageLeads) all read via
 * `req.supabase` directly today with NO role resolution in the handler —
 * current behavior is already org-wide/unscoped (identical to how the
 * already-migrated getKpiTrend/getChannelConversion behaved for
 * team_leader/kob_manager/super_admin before scope was added — these never
 * had scope coded at all). Their RDS fetches below are therefore
 * deliberately unscoped too, to preserve exact current behavior rather
 * than inventing new restrictions.
 */
function unscopedRangeWhere(range: DateRange, dateCol = "created_at"): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (range.from) { params.push(range.from); conditions.push(`${dateCol} >= $${params.length}`); }
  if (range.to) { params.push(range.to); conditions.push(`${dateCol} <= $${params.length}`); }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

/** Mirrors getCombinedFunnel()'s `.select("id, stage")` lead fetch with optional created_at range. */
export async function getLeadsIdStage(range: DateRange): Promise<{ id: string; stage: string }[]> {
  const { where, params } = unscopedRangeWhere(range);
  const { rows } = await getPool().query(`SELECT id, stage::text AS stage FROM public.kob_leads ${where}`, params);
  return rows;
}

/** Mirrors getCombinedFunnel()'s chunked `.in("id", missingChunk)` lookup for leads outside the date range. */
export async function getLeadsIdStageByIds(ids: string[]): Promise<{ id: string; stage: string }[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT id, stage::text AS stage FROM public.kob_leads WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

/** Mirrors getLeadsTrend()'s `.select("id, created_at")` with from/to on created_at. */
export async function getLeadsIdCreatedAt(range: DateRange): Promise<{ id: string; created_at: string }[]> {
  const { where, params } = unscopedRangeWhere(range);
  const { rows } = await getPool().query(`SELECT id, created_at FROM public.kob_leads ${where}`, params);
  return rows;
}

/** Mirrors getLeadsTrend()'s `.select("lead_id, to_stage, created_at").eq("to_stage","KTN_CS")` with from/to on created_at. */
export async function getStageHistoryKtnCsEntries(range: DateRange): Promise<{ lead_id: string; to_stage: string; created_at: string }[]> {
  const { where, params } = unscopedRangeWhere(range);
  const extra = where ? `${where} AND to_stage = 'KTN_CS'` : "WHERE to_stage = 'KTN_CS'";
  const { rows } = await getPool().query(
    `SELECT lead_id, to_stage::text AS to_stage, created_at FROM public.lead_stage_history ${extra}`,
    params,
  );
  return rows;
}

/** Mirrors getRetargetingFunnel()/getRetargetingSplit()/getAbandonedFunnel()/getAbandonedSplit()'s lead_stage_history filters. */
export async function getStageHistoryByFromTo(
  fromStages: string[],
  toStages: string[],
  range: DateRange,
  dateOp: "range" | "lte" = "range",
): Promise<{ lead_id: string; from_stage: string | null; to_stage: string; created_at: string }[]> {
  const conditions: string[] = ["(from_stage)::text = ANY($1::text[])", "(to_stage)::text = ANY($2::text[])"];
  const params: unknown[] = [fromStages, toStages];
  if (dateOp === "range") {
    if (range.from) { params.push(range.from); conditions.push(`created_at >= $${params.length}`); }
    if (range.to) { params.push(range.to); conditions.push(`created_at <= $${params.length}`); }
  } else if (range.to) {
    params.push(range.to);
    conditions.push(`created_at <= $${params.length}`);
  }
  const { rows } = await getPool().query(
    `SELECT lead_id, from_stage::text AS from_stage, to_stage::text AS to_stage, created_at
     FROM public.lead_stage_history WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`,
    params,
  );
  return rows;
}

/** Mirrors getAbandonedFunnel()'s `.in("to_stage", TO).not("from_stage","is",null)` with optional from/to. */
export async function getAbandonedStageHistory(toStages: string[], range: DateRange): Promise<{ lead_id: string; to_stage: string; created_at: string }[]> {
  const conditions: string[] = ["(to_stage)::text = ANY($1::text[])", "from_stage IS NOT NULL"];
  const params: unknown[] = [toStages];
  if (range.from) { params.push(range.from); conditions.push(`created_at >= $${params.length}`); }
  if (range.to) { params.push(range.to); conditions.push(`created_at <= $${params.length}`); }
  const { rows } = await getPool().query(
    `SELECT lead_id, to_stage::text AS to_stage, created_at FROM public.lead_stage_history WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`,
    params,
  );
  return rows;
}

/** Mirrors getRetargetingSplit()'s `.in("from_stage",...).in("to_stage",...).lte("created_at", cutoff)` fetch. */
export async function getStageHistoryFromToUntil(fromStages: string[], toStages: string[], cutoff: string): Promise<{ lead_id: string; to_stage: string }[]> {
  const { rows } = await getPool().query(
    `SELECT lead_id, to_stage::text AS to_stage FROM public.lead_stage_history
     WHERE (from_stage)::text = ANY($1::text[]) AND (to_stage)::text = ANY($2::text[]) AND created_at <= $3
     ORDER BY created_at ASC`,
    [fromStages, toStages, cutoff],
  );
  return rows;
}

/** Mirrors getAbandonedSplit()'s `.in("to_stage", TO).lte("created_at", cutoff)` full-row fetch. */
export async function getStageHistoryToStagesUntil(toStages: string[], cutoff: string): Promise<{ lead_id: string; from_stage: string | null; to_stage: string; created_at: string }[]> {
  const { rows } = await getPool().query(
    `SELECT lead_id, from_stage::text AS from_stage, to_stage::text AS to_stage, created_at
     FROM public.lead_stage_history WHERE (to_stage)::text = ANY($1::text[]) AND created_at <= $2 ORDER BY created_at ASC`,
    [toStages, cutoff],
  );
  return rows;
}

/** Mirrors getAbandonedSplit()'s chunked `.in("lead_id", chunk).lte("created_at", cutoff)` lookup. */
export async function getStageHistoryByLeadIdsUntil(leadIds: string[], cutoff: string): Promise<{ lead_id: string; from_stage: string | null; to_stage: string; created_at: string }[]> {
  if (leadIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT lead_id, from_stage::text AS from_stage, to_stage::text AS to_stage, created_at
     FROM public.lead_stage_history WHERE lead_id = ANY($1::uuid[]) AND created_at <= $2 ORDER BY created_at ASC`,
    [leadIds, cutoff],
  );
  return rows;
}

/** Mirrors getBrandPerformance()'s active-brands read. */
export async function getActiveBrands(): Promise<{ id: string; name: string; code: string }[]> {
  const { rows } = await getPool().query(`SELECT id, name, code FROM public.brands WHERE active = true ORDER BY code`);
  return rows;
}

/** Mirrors getBrandPerformance()'s `.select("brand_id, stage")` lead fetch with optional created_at range. */
export async function getLeadsBrandStage(range: DateRange): Promise<{ brand_id: string | null; stage: string }[]> {
  const { where, params } = unscopedRangeWhere(range);
  const { rows } = await getPool().query(`SELECT brand_id, stage::text AS stage FROM public.kob_leads ${where}`, params);
  return rows;
}

/** Mirrors getBrandPerformance()'s `.eq("to_stage","KTN_CS")` history fetch with optional created_at range. */
export async function getKtnCsStageHistoryLeadIds(range: DateRange): Promise<{ lead_id: string }[]> {
  const { where, params } = unscopedRangeWhere(range);
  const extra = where ? `${where} AND to_stage = 'KTN_CS'` : "WHERE to_stage = 'KTN_CS'";
  const { rows } = await getPool().query(`SELECT lead_id FROM public.lead_stage_history ${extra}`, params);
  return rows;
}

/** Mirrors getBrandPerformance()'s `.eq("stage","KTN_CS").not("cuisine","is",null)` lead fetch. */
export async function getKtnCsLeadsWithCuisine(): Promise<{ id: string; cuisine: string }[]> {
  const { rows } = await getPool().query(
    `SELECT id, cuisine FROM public.kob_leads WHERE stage = 'KTN_CS' AND cuisine IS NOT NULL`,
  );
  return rows;
}

/** Mirrors getStateSpread()'s india_states read. */
export async function getAllStatesIdName(): Promise<{ id: string; name: string }[]> {
  const { rows } = await getPool().query(`SELECT id, name FROM public.india_states`);
  return rows;
}

/** Mirrors getStateSpread()'s unfiltered `.select("state_id, stage, notes")` full-table paged fetch (here: unpaged, single query). */
export async function getAllLeadsStateStageNotes(): Promise<{ state_id: string | null; stage: string; notes: string | null }[]> {
  const { rows } = await getPool().query(`SELECT state_id, stage::text AS stage, notes FROM public.kob_leads`);
  return rows;
}

/** Mirrors getStateSpread()'s chunked `.in("pincode", chunk)` india_pincodes lookup. */
export async function getPincodeStates(pincodes: string[]): Promise<{ pincode: string; state: string }[]> {
  if (pincodes.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT pincode, state FROM public.india_pincodes WHERE pincode = ANY($1::text[])`,
    [pincodes],
  );
  return rows;
}

/** Mirrors getFunnelStageLeads()'s LEAD_GENERATED branch: all lead ids in range, oldest first. */
export async function getLeadIdsCreatedInRange(range: DateRange): Promise<{ id: string }[]> {
  const { where, params } = unscopedRangeWhere(range);
  const { rows } = await getPool().query(`SELECT id FROM public.kob_leads ${where} ORDER BY created_at ASC`, params);
  return rows;
}

/** Mirrors getFunnelStageLeads()'s manual-create audit-log lookup for the LEAD_GENERATED mode filter. */
export async function getManualCreateAuditEntityIds(range: DateRange): Promise<{ entity_id: string | null }[]> {
  const { where, params } = unscopedRangeWhere(range);
  const extra = where ? `${where} AND action = 'lead_manual_create'` : "WHERE action = 'lead_manual_create'";
  const { rows } = await getPool().query(`SELECT entity_id FROM public.audit_logs ${extra} ORDER BY created_at ASC`, params);
  return rows;
}

/** Mirrors getFunnelStageLeads()'s generic-stage branch: lead_stage_history filtered by to_stage + mode + range. */
export async function getStageHistoryForFunnelLeads(
  stageKey: string,
  mode: "auto" | "manual" | "all",
  range: DateRange,
): Promise<{ lead_id: string; to_stage: string; created_at: string; changed_by: string | null }[]> {
  const conditions: string[] = ["to_stage = $1"];
  const params: unknown[] = [stageKey];
  if (mode === "auto") conditions.push("changed_by IS NULL");
  if (mode === "manual") conditions.push("changed_by IS NOT NULL");
  if (range.from) { params.push(range.from); conditions.push(`created_at >= $${params.length}`); }
  if (range.to) { params.push(range.to); conditions.push(`created_at <= $${params.length}`); }
  const { rows } = await getPool().query(
    `SELECT lead_id, to_stage::text AS to_stage, created_at, changed_by
     FROM public.lead_stage_history WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`,
    params,
  );
  return rows;
}

/** Mirrors getFunnelStageLeads()'s final `.in("id", leadIds.slice(0,300))` detail fetch. */
export async function getLeadDetailsForFunnelLeads(ids: string[]): Promise<{ id: string; code: string; full_name: string; phone: string | null; stage: string; language: string | null; assigned_to: string | null; created_at: string }[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT id, code, full_name, phone, stage::text AS stage, language::text AS language, assigned_to, created_at
     FROM public.kob_leads WHERE id = ANY($1::uuid[]) ORDER BY created_at DESC`,
    [ids],
  );
  return rows;
}

/** Mirrors getFunnelStageLeads()'s WEBINAR_ATTENDED branch: webinar_batches read. */
export async function getWebinarBatchesInRange(range: DateRange): Promise<{ id: string; name: string; scheduled_at: string; language: string | null }[]> {
  const { where, params } = unscopedRangeWhere(range, "scheduled_at");
  const { rows } = await getPool().query(
    `SELECT id, name, scheduled_at, language::text AS language FROM public.webinar_batches ${where} ORDER BY scheduled_at DESC`,
    params,
  );
  return rows;
}

/** Mirrors getFunnelStageLeads()'s chunked `.in("batch_id", chunk).eq("attended", true)` attendance fetch. */
export async function getAttendedWebinarAttendanceByBatchIds(batchIds: string[]): Promise<{ id: string; lead_id: string; batch_id: string; marked_at: string | null }[]> {
  if (batchIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT id, lead_id, batch_id, marked_at FROM public.webinar_attendance WHERE attended = true AND batch_id = ANY($1::uuid[]) ORDER BY id DESC`,
    [batchIds],
  );
  return rows;
}

/** Mirrors getFunnelStageLeads()'s chunked lead detail fetch for webinar attendees. */
export async function getLeadDetailsForWebinarAttendees(ids: string[]): Promise<{ id: string; code: string; full_name: string; phone: string | null; stage: string; language: string | null; created_at: string; assigned_to: string | null }[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT id, code, full_name, phone, stage::text AS stage, language::text AS language, created_at, assigned_to
     FROM public.kob_leads WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

/** Mirrors getFunnelStageLeads()'s chunked profile-name lookup for webinar attendees' assigned executives. */
export async function getProfileNamesByIds(ids: string[]): Promise<{ id: string; full_name: string }[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query(`SELECT id, full_name FROM public.profiles WHERE id = ANY($1::uuid[])`, [ids]);
  return rows;
}
