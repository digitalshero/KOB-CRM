import { getPool } from "../db/pool.js";
import type { LeadScope } from "../db/authz.js";
import { leadScopeSql } from "../db/authz.js";

/**
 * STAGE 10E2 — direct-RDS repository for funnel/distribution read endpoints.
 *
 * These repository functions only fetch raw, lead-scoped rows. All
 * aggregation/business-formula logic stays in the controller and is REUSED
 * UNCHANGED between the Supabase and RDS branches (same JS functions, just
 * fed rows from a different source) — this is deliberate: it guarantees the
 * business formulas cannot silently diverge between backends.
 *
 * Scope is resolved server-side (see resolveLeadScopeOrDeny in
 * kob.controller.ts) and applied here as an unconditional AND, matching the
 * getOrgReadClient() pattern used by the Supabase path for these same
 * endpoints: executive -> assigned_to = self; team_leader/kob_manager/
 * super_admin -> org-wide.
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

export async function getLeadsSourceStage(scope: LeadScope, range: DateRange): Promise<{ source_id: string | null; stage: string }[]> {
  const { where, params } = scopeAndRangeWhere(scope, range);
  const { rows } = await getPool().query(`SELECT source_id, stage::text AS stage FROM public.kob_leads ${where}`, params);
  return rows;
}

export async function getLeadsLanguageStage(scope: LeadScope, range: DateRange): Promise<{ language: string | null; stage: string }[]> {
  const { where, params } = scopeAndRangeWhere(scope, range);
  const { rows } = await getPool().query(`SELECT language::text AS language, stage::text AS stage FROM public.kob_leads ${where}`, params);
  return rows;
}

export async function getLeadsBrandStage(scope: LeadScope, range: DateRange): Promise<{ brand_id: string | null; stage: string }[]> {
  const { where, params } = scopeAndRangeWhere(scope, range);
  const { rows } = await getPool().query(`SELECT brand_id, stage::text AS stage FROM public.kob_leads ${where}`, params);
  return rows;
}

/**
 * Mirrors getStageDistribution()'s paged fetch. The Supabase path pages in
 * 1000-row chunks (PostgREST's cap) with a `seen` id Set purely as a
 * defensive dedup guard against overlapping pages — Postgres has no such
 * cap and a single query cannot produce overlapping rows, so both the
 * paging loop and the dedup guard are omitted here without changing output.
 */
export async function getLeadsIdStageCreated(scope: LeadScope, range: DateRange): Promise<{ id: string; stage: string; created_at: string }[]> {
  const { where, params } = scopeAndRangeWhere(scope, range);
  const { rows } = await getPool().query(
    `SELECT id, stage::text AS stage, created_at FROM public.kob_leads ${where} ORDER BY created_at ASC`,
    params,
  );
  return rows;
}

export interface UnallocatedLeadRow {
  id: string; code: string; full_name: string; phone: string | null; stage: string; mode: string;
  language: string | null; assigned_to: string | null; created_at: string;
  brands: { name: string } | null;
  india_states: { name: string } | null;
  india_cities: { name: string } | null;
  lead_sources: { name: string } | null;
}

/** Mirrors getUnallocatedLeads(): assigned_to IS NULL, scoped, newest first. */
export async function getUnallocatedLeadsRaw(scope: LeadScope): Promise<UnallocatedLeadRow[]> {
  const conditions = ["l.assigned_to IS NULL"];
  const params: unknown[] = [];
  const scopeSql = leadScopeSql(scope, params.length + 1);
  if (scopeSql.sql !== "TRUE") { conditions.push(scopeSql.sql); params.push(...scopeSql.params); }

  const { rows } = await getPool().query<UnallocatedLeadRow>(
    `SELECT l.id, l.code, l.full_name, l.phone, l.stage::text AS stage, l.mode::text AS mode,
            l.language::text AS language, l.assigned_to, l.created_at,
            CASE WHEN br.id IS NULL THEN NULL ELSE jsonb_build_object('name', br.name) END AS brands,
            CASE WHEN st.id IS NULL THEN NULL ELSE jsonb_build_object('name', st.name) END AS india_states,
            CASE WHEN ci.id IS NULL THEN NULL ELSE jsonb_build_object('name', ci.name) END AS india_cities,
            CASE WHEN src.id IS NULL THEN NULL ELSE jsonb_build_object('name', src.name) END AS lead_sources
     FROM public.kob_leads l
     LEFT JOIN public.brands br ON br.id = l.brand_id
     LEFT JOIN public.india_states st ON st.id = l.state_id
     LEFT JOIN public.india_cities ci ON ci.id = l.city_id
     LEFT JOIN public.lead_sources src ON src.id = l.source_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY l.created_at DESC`,
    params,
  );
  return rows;
}
