import { type Request, type Response, type NextFunction } from "express";
import { supabaseAdmin } from "../integrations/supabase/client.js";
import { logAudit } from "../utils/audit.js";
import { config } from "../config/index.js";
import * as referenceRepo from "../repositories/reference.repository.js";
import * as configRepo from "../repositories/config.repository.js";
import * as leadRepo from "../repositories/lead.repository.js";
import * as funnelRepo from "../repositories/funnel.repository.js";
import * as dashboardRepo from "../repositories/dashboard.repository.js";
import * as adminRepo from "../repositories/admin.repository.js";
import * as analyticsRepo from "../repositories/analytics.repository.js";
import { resolveLeadScopeOrDeny, requireRoleOrDeny, actorHasRole, resolveActorRole } from "../db/authz.js";
import { withTransaction } from "../db/transaction.js";
import { getPool } from "../db/pool.js";
import { pgClient } from "../db/pgQueryAdapter.js";
import * as scvRepo from "../repositories/scv.repository.js";

// STAGE 10C: true only when DATA_BACKEND=rds (default remains "supabase").
// Used only by the specific low-risk read-only handlers migrated in this
// stage (see each function below) — every other handler is untouched and
// keeps using req.supabase/supabaseAdmin exactly as before.
const useRds = () => config.dataBackend === "rds";

type DateRangeInput = { from?: string; to?: string };

function parseDateRange(req: Request): DateRangeInput {
  return {
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
  };
}

async function getOrgReadClient(req: Request) {
  const client = req.supabase ?? (process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : undefined);
  if (!client) {
    throw new Error("Supabase client not initialized");
  }
  if (!req.userId) return client;
  const { data: role } = await client.rpc("get_user_role", { _user_id: req.userId });
  if (((role as string | null) ?? "executive") === "executive" || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return client;
  }
  return supabaseAdmin;
}

function applyCreatedRange<Q extends { gte: any; lte: any }>(q: Q, r: DateRangeInput, col = "created_at"): Q {
  if (r.from) q = q.gte(col, r.from) as Q;
  if (r.to) q = q.lte(col, r.to) as Q;
  return q;
}

async function budgetedSpendForRange(
  supabase: any,
  r: { from?: string; to?: string },
): Promise<number | null> {
  const start = r.from ? new Date(r.from) : null;
  const end = r.to ? new Date(r.to) : null;
  if (!start || !end) return null;

  const months: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const { data: rows } = await supabase
    .from("marketing_kpi_targets")
    .select("period, target_value")
    .eq("metric", "SPEND")
    .in("period", months);
  const byMonth = new Map<string, number>();
  for (const row of (rows ?? []) as any[]) byMonth.set(String(row.period).slice(0, 10), Number(row.target_value ?? 0));
  if (byMonth.size === 0) return null;

  let total = 0;
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (day <= endDay) {
    const key = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const budget = byMonth.get(key);
    if (budget) {
      const daysInMonth = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
      total += budget / daysInMonth;
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return Math.round(total);
}

/** STAGE 10E3: the month list budgetedSpendForRange above fetches from marketing_kpi_targets. */
function budgetPeriodsForRange(r: { from?: string; to?: string }): string[] {
  const start = r.from ? new Date(r.from) : null;
  const end = r.to ? new Date(r.to) : null;
  if (!start || !end) return [];
  const months: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/** STAGE 10E3: pure reimplementation of budgetedSpendForRange's day-prorating math, operating on already-fetched rows. */
function budgetedSpendFromTargets(rows: { period: string; target_value: number }[], r: { from?: string; to?: string }): number | null {
  const start = r.from ? new Date(r.from) : null;
  const end = r.to ? new Date(r.to) : null;
  if (!start || !end) return null;

  const byMonth = new Map<string, number>();
  for (const row of rows) byMonth.set(String(row.period).slice(0, 10), Number(row.target_value ?? 0));
  if (byMonth.size === 0) return null;

  let total = 0;
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (day <= endDay) {
    const key = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const budget = byMonth.get(key);
    if (budget) {
      const daysInMonth = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
      total += budget / daysInMonth;
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return Math.round(total);
}

/**
 * Controller for listBrands.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 700).
 * Preserves exact query: supabase.from("brands").select("*").order("code")
 * Uses request-scoped RLS client: req.supabase
 */
export async function listBrands(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await referenceRepo.listBrands());
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("brands")
      .select("*")
      .order("code");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listSources.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 722).
 * Query: supabase.from("lead_sources").select("*").order("name")
 * Uses request-scoped RLS client: req.supabase
 */
export async function listSources(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await referenceRepo.listSources());
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("lead_sources")
      .select("*")
      .order("name");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listStates.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 726).
 * Query: supabase.from("india_states").select("*").order("name")
 * Uses request-scoped RLS client: req.supabase
 */
export async function listStates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await referenceRepo.listStates());
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("india_states")
      .select("*")
      .order("name");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listStatePincodeTotals.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 730).
 * Queries:
 *   - v_state_pincode_totals: select("state, total_pincodes").order("state")
 *   - v_city_scope: select("state_name, native_kitchen_scope, other_kitchen_scope, city_id")
 *   - india_states: select("id, name, code, active")
 * Uses request-scoped RLS client: req.supabase
 */
/** Shared aggregation used by listStatePincodeTotals() for both backends. */
function aggregateStatePincodeTotals(
  totals: { state: string; total_pincodes: number | null }[],
  scope: { state_name: string | null; native_kitchen_scope: number | null; other_kitchen_scope: number | null }[],
  states: { id: string; name: string; code: string | null; active: boolean }[],
) {
  const agg = new Map<string, { native: number; other: number; cities: number }>();
  for (const r of scope) {
    const key = String(r.state_name ?? "").toUpperCase().trim();
    if (!key) continue;
    const cur = agg.get(key) ?? { native: 0, other: 0, cities: 0 };
    cur.native += Number(r.native_kitchen_scope ?? 0);
    cur.other += Number(r.other_kitchen_scope ?? 0);
    cur.cities += 1;
    agg.set(key, cur);
  }

  const stateMeta = new Map<string, { id: string; code: string | null; active: boolean }>();
  for (const s of states) {
    stateMeta.set(String(s.name ?? "").toUpperCase().trim(), {
      id: s.id, code: s.code ?? null, active: !!s.active,
    });
  }

  return totals.map((r) => {
    const a = agg.get(r.state) ?? { native: 0, other: 0, cities: 0 };
    const m = stateMeta.get(r.state);
    return {
      state: r.state,
      total_pincodes: Number(r.total_pincodes ?? 0),
      cities_configured: a.cities,
      native_kitchen_scope: a.native,
      other_kitchen_scope: a.other,
      state_id: m?.id ?? null,
      state_code: m?.code ?? null,
      active: m ? m.active : null,
    };
  });
}

export async function listStatePincodeTotals(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      const { totals, scope, states } = await referenceRepo.listStatePincodeTotalsRaw();
      res.status(200).json(aggregateStatePincodeTotals(totals, scope, states));
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const [totalsRes, scopeRes, statesRes] = await Promise.all([
      req.supabase
        .from("v_state_pincode_totals")
        .select("state, total_pincodes")
        .order("state"),
      req.supabase
        .from("v_city_scope")
        .select("state_name, native_kitchen_scope, other_kitchen_scope, city_id"),
      req.supabase
        .from("india_states")
        .select("id, name, code, active"),
    ]);

    if (totalsRes.error) {
      res.status(500).json({ error: totalsRes.error.message });
      return;
    }

    const result = aggregateStatePincodeTotals(
      (totalsRes.data ?? []) as any[],
      (scopeRes.data ?? []) as any[],
      (statesRes.data ?? []) as any[],
    );

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listCitiesWithScope.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 774).
 * Queries:
 *   - v_city_scope: select("*").order("state_name")
 *   - india_cities: select("id, district_aliases, state_aliases")
 * Uses request-scoped RLS client: req.supabase
 */
export async function listCitiesWithScope(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      const { scope, aliases } = await referenceRepo.listCitiesWithScopeRaw();
      const result = scope.map((c) => ({
        ...c,
        district_aliases: aliases.get(c.city_id)?.district_aliases ?? [],
        state_aliases: aliases.get(c.city_id)?.state_aliases ?? [],
      }));
      res.status(200).json(result);
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const [scopeRes, aliasRes] = await Promise.all([
      req.supabase.from("v_city_scope").select("*").order("state_name"),
      req.supabase.from("india_cities").select("id, district_aliases, state_aliases"),
    ]);

    if (scopeRes.error) {
      res.status(500).json({ error: scopeRes.error.message });
      return;
    }

    const aliases = new Map<string, { district_aliases: string[]; state_aliases: string[] }>();
    for (const r of (((aliasRes as any).data ?? []) as any[])) {
      aliases.set(r.id, {
        district_aliases: r.district_aliases ?? [],
        state_aliases: r.state_aliases ?? [],
      });
    }

    const result = (((scopeRes.data ?? []) as any[])).map((c) => ({
      ...c,
      district_aliases: aliases.get(c.city_id)?.district_aliases ?? [],
      state_aliases: aliases.get(c.city_id)?.state_aliases ?? [],
    }));

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listStateNativeBrands.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 817).
 * Query: supabase.from("state_native_brand").select("state_id, brand_id, india_states(name, code), brands(name, code)")
 * Uses request-scoped RLS client: req.supabase
 */
export async function listStateNativeBrands(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await referenceRepo.listStateNativeBrands());
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("state_native_brand")
      .select("state_id, brand_id, india_states(name, code), brands(name, code)");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getConfig.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 685).
 * Query: supabase.from("kob_configuration").select("*").eq("id", 1).maybeSingle()
 * Uses request-scoped RLS client: req.supabase
 */
export async function getConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await configRepo.getConfig());
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("kob_configuration")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listKpiTargets.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 933).
 * Query: supabase.from("kpi_targets").select("*").order("metric")
 * Uses request-scoped RLS client: req.supabase
 */
export async function listKpiTargets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await configRepo.listKpiTargets());
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("kpi_targets")
      .select("*")
      .order("metric");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listAuditLogs.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 969).
 * Query: supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100)
 * Uses request-scoped RLS client: req.supabase
 */
export async function listAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await referenceRepo.listRecentAuditLogs());
      return;
    }
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getScvRules.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1275, loadScvRules line 1014).
 * Query: supabase.from("scv_rules").select("*").eq("id", 1).maybeSingle()
 * Fallback: { weight_conversion: 35, weight_tat: 25, weight_eoi1_webinar: 15, weight_eoi2_payment: 15, weight_crm_discipline: 10 }
 * Uses request-scoped RLS client: req.supabase
 */
const SCV_RULES_FALLBACK = {
  weight_conversion: 35,
  weight_tat: 25,
  weight_eoi1_webinar: 15,
  weight_eoi2_payment: 15,
  weight_crm_discipline: 10,
};

export async function getScvRules(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json((await configRepo.getScvRules()) ?? SCV_RULES_FALLBACK);
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("scv_rules")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? SCV_RULES_FALLBACK);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getIncentiveRules.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1297, loadIncentiveRules line 1021).
 * Query: supabase.from("incentive_rules").select("*").order("sort_order")
 * Uses request-scoped RLS client: req.supabase
 */
export async function getIncentiveRules(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await configRepo.getIncentiveRules());
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("incentive_rules")
      .select("*")
      .order("sort_order");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listRateableUsers.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1324).
 * Query: supabase.from("user_roles").select("user_id, role, profiles!inner(id, full_name, email)").in("role", ["executive", "team_leader", "kob_manager"])
 * Uses request-scoped RLS client: req.supabase
 */
export async function listRateableUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      const rows = await referenceRepo.listRateableUsers();
      res.status(200).json(rows.map((r) => ({ user_id: r.user_id, role: r.role, full_name: r.full_name ?? "—", email: r.email ?? null })));
      return;
    }
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("user_roles")
      .select("user_id, role, profiles!inner(id, full_name, email)")
      .in("role", ["executive", "team_leader", "kob_manager"]);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const result = (data ?? []).map((r: any) => ({
      user_id: r.user_id,
      role: r.role as string,
      full_name: r.profiles?.full_name ?? "—",
      email: r.profiles?.email ?? null,
    }));

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listRoleWeights.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1341).
 * Query: supabase.from("scv_role_weights").select("*")
 * Uses request-scoped RLS client: req.supabase
 */
export async function listRoleWeights(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await referenceRepo.listRoleWeights());
      return;
    }
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("scv_role_weights")
      .select("*");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listAllProfiles.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2205).
 * Queries:
 *   - profiles: select("id, full_name, email, phone, team_leader_id")
 *   - user_roles: select("user_id, role")
 * Uses request-scoped RLS client: req.supabase
 */
export async function listAllProfiles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await referenceRepo.listAllProfilesWithRoles());
      return;
    }
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data: profiles, error: pErr } = await req.supabase
      .from("profiles")
      .select("id, full_name, email, phone, team_leader_id");

    if (pErr) {
      res.status(500).json({ error: pErr.message });
      return;
    }

    const { data: roles, error: rErr } = await req.supabase
      .from("user_roles")
      .select("user_id, role");

    if (rErr) {
      res.status(500).json({ error: rErr.message });
      return;
    }

    const roleByUser: Record<string, string[]> = {};
    for (const r of roles ?? []) {
      (roleByUser[(r as any).user_id] ??= []).push((r as any).role);
    }

    const result = (profiles ?? []).map((p: any) => ({
      ...p,
      roles: roleByUser[p.id] ?? [],
    }));

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getKpiSnapshot.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 101).
 * Without date range: returns v_kpi_snapshot.
 * With range: computes achieved/prev/target inline from kob_leads + kpi_targets.
 * Uses trusted server client (supabaseAdmin) when available.
 */
export async function getKpiSnapshot(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const r = parseDateRange(req);

    if (!r.from && !r.to) {
      if (useRds()) {
        res.status(200).json(await analyticsRepo.getKpiSnapshotView());
        return;
      }
      const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
      if (!supabase) {
        res.status(500).json({ error: "Supabase client not initialized" });
        return;
      }
      const { data: rows, error } = await supabase.from("v_kpi_snapshot").select("*");
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.status(200).json(rows ?? []);
      return;
    }

    const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
    if (!useRds() && !supabase) {
      res.status(500).json({ error: "Supabase client not initialized" });
      return;
    }

    const PAGE = 1000;
    const fetchAll = async (build: () => any) => {
      const out: any[] = [];
      for (let page = 0; ; page++) {
        const { data: chunk, error } = await build().range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        const got = (chunk ?? []) as any[];
        out.push(...got);
        if (got.length < PAGE) break;
      }
      return out;
    };

    const rows = useRds()
      ? await analyticsRepo.getLeadsForKpiSnapshot(r)
      : await fetchAll(() =>
          applyCreatedRange(
            supabase!.from("kob_leads").select("id, stage, created_at, updated_at").order("created_at", { ascending: true }),
            r,
            "created_at",
          ),
        );

    const fromMs = r.from ? new Date(r.from).getTime() : 0;
    const toMs = r.to ? new Date(r.to).getTime() : Date.now();
    const span = Math.max(1, toMs - fromMs);
    const prevFrom = new Date(fromMs - span).toISOString();
    const prevTo = new Date(fromMs).toISOString();
    const prev = useRds()
      ? await analyticsRepo.getLeadsForKpiSnapshot({ from: prevFrom, to: prevTo })
      : await fetchAll(() =>
          supabase!.from("kob_leads").select("id, stage, created_at")
            .gte("created_at", prevFrom).lt("created_at", prevTo)
            .order("created_at", { ascending: true }),
        );

    const allIds = [...rows, ...prev].map((l) => l.id).filter(Boolean);
    const firedIds = new Set<string>();
    const failedIds = new Set<string>();
    for (let i = 0; i < allIds.length; i += 100) {
      const chunk = allIds.slice(i, i + 100);
      const hist = useRds()
        ? await analyticsRepo.getLeadIdStageFireHistory(chunk)
        : (
            await supabase!
              .from("lead_stage_history")
              .select("lead_id, to_stage")
              .in("lead_id", chunk)
              .in("to_stage", ["AUTO_FIRED", "FAILED_FIRE"])
              .limit(2000)
          ).data ?? [];
      for (const h of hist as any[]) {
        if (h.to_stage === "AUTO_FIRED") firedIds.add(h.lead_id);
        else failedIds.add(h.lead_id);
      }
    }

    const everFired = (l: any) => l.stage === "AUTO_FIRED" || firedIds.has(l.id);

    const monthStart = (ms: number) => {
      const d = new Date(ms);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
    };
    const fromMonth = monthStart(fromMs || toMs);
    const toMonth = monthStart(toMs);
    const targets = useRds()
      ? await analyticsRepo.getKpiTargetsInRange(fromMonth, toMonth)
      : (
          await supabase!
            .from("kpi_targets")
            .select("metric, target_value, effective_from")
            .gte("effective_from", fromMonth)
            .lte("effective_from", toMonth)
            .order("effective_from", { ascending: false })
        ).data ?? [];
    const tmap = new Map<string, number>();
    for (const t of targets as any[]) {
      if (!tmap.has(t.metric)) tmap.set(t.metric, Number(t.target_value ?? 0));
    }

    const metrics: Array<{ metric: string; match: (l: any) => boolean }> = [
      { metric: "TOTAL_LEADS", match: () => true },
      { metric: "FEE_PAID", match: (l) => l.stage === "FEE_PAID" },
      { metric: "AGREEMENT_SIGNED", match: (l) => l.stage === "AGREEMENT_SIGNED" },
      { metric: "KTN_CS", match: (l) => l.stage === "KTN_CS" },
      { metric: "KTN_LIVE", match: (l) => l.stage === "KTN_LIVE" },
      { metric: "EOI_1", match: (l) => l.stage === "EOI_1" },
      { metric: "WEBINAR", match: (l) => l.stage === "WEBINAR" },
      { metric: "EOI_2", match: (l) => l.stage === "EOI_2" },
      { metric: "FORM_FILLED", match: (l) => l.stage === "FORM_FILLED" },
      { metric: "AUTO_FIRED", match: everFired },
      { metric: "ABANDONED_LEADS", match: (l) => !everFired(l) },
      { metric: "FAILED_FIRE", match: (l) => l.stage === "FAILED_FIRE" },
      { metric: "PARKED", match: (l) => ["NO_RESPONSE", "LATER", "NO", "RETARGETING"].includes(l.stage) },
    ];

    const days = Math.max(1, span / 86400000);
    const result = metrics.map(({ metric, match }) => {
      const achieved = rows.filter(match).length;
      const prevPeriod = prev.filter(match).length;
      const target = tmap.get(metric) ?? 0;
      const run_rate = Math.round((achieved / days) * 30 * 10) / 10;
      const achieved_pct = target > 0 ? Math.round((achieved / target) * 1000) / 10 : 0;
      const trend: "up" | "down" | "flat" =
        prevPeriod === 0 && achieved > 0 ? "up" :
        achieved > prevPeriod ? "up" :
        achieved < prevPeriod ? "down" : "flat";
      return { metric, target, achieved, run_rate, achieved_pct, prev_period: prevPeriod, trend };
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getContractsCount.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 250).
 * Contracts strictly count leads whose stage is KTN_CS, filtered by stage_entered_at.
 * Uses trusted server client (supabaseAdmin) when available.
 */
export async function getContractsCount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      const r = parseDateRange(req);
      const current = await analyticsRepo.countContracts(r.from, r.to);
      let previous = 0;
      if (r.from && r.to) {
        const fromMs = new Date(r.from).getTime();
        const toMs = new Date(r.to).getTime();
        const span = Math.max(1, toMs - fromMs);
        previous = await analyticsRepo.countContracts(new Date(fromMs - span).toISOString(), new Date(fromMs).toISOString());
      }
      res.status(200).json({ count: current, prev_period: previous });
      return;
    }

    const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
    if (!supabase) {
      res.status(500).json({ error: "Supabase client not initialized" });
      return;
    }

    const r = parseDateRange(req);

    const countFor = async (from?: string, to?: string) => {
      let q = supabase.from("kob_leads").select("id", { count: "exact", head: true }).eq("stage", "KTN_CS");
      if (from) q = q.gte("stage_entered_at", from);
      if (to) q = q.lte("stage_entered_at", to);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    };

    const current = await countFor(r.from, r.to);

    let previous = 0;
    if (r.from && r.to) {
      const fromMs = new Date(r.from).getTime();
      const toMs = new Date(r.to).getTime();
      const span = Math.max(1, toMs - fromMs);
      previous = await countFor(new Date(fromMs - span).toISOString(), new Date(fromMs).toISOString());
    }

    res.status(200).json({ count: current, prev_period: previous });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getDashboardKpis.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 285).
 * Uses trusted server client (supabaseAdmin) when available.
 */
export async function getDashboardKpis(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      const r = parseDateRange(req);
      const leads = await analyticsRepo.getAllLeadsForDashboardKpis(r);
      const count = (pred: (l: analyticsRepo.DashboardKpiLeadRow) => boolean) => leads.filter(pred).length;
      const totalLeads = leads.length;
      const feePaid = count((l) => l.stage === "FEE_PAID");
      const agreementSigned = count((l) => l.stage === "AGREEMENT_SIGNED");
      const ktnCs = count((l) => l.stage === "KTN_CS");
      const ktnLive = count((l) => l.stage === "KTN_LIVE");
      const parked = count((l) => ["NO_RESPONSE", "LATER", "NO", "RETARGETING"].includes(l.stage));
      const autoLeads = count((l) => l.mode === "AUTO");
      const manualLeads = count((l) => l.mode === "MANUAL");
      const activeStates = await analyticsRepo.countActiveStates();
      const activeCities = await analyticsRepo.countActiveCities();
      const kitchenScope = await analyticsRepo.getKitchenScopeTotal();

      const periods = budgetPeriodsForRange(r);
      const spendTargets = await analyticsRepo.getMarketingSpendByPeriods(periods);
      const budgeted = budgetedSpendFromTargets(spendTargets, r);
      const totalSpend = budgeted ?? leads.reduce((s, l) => s + Number(l.cost_per_lead ?? 0), 0);

      const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
      const cac = ktnLive > 0 ? totalSpend / ktnLive : 0;

      res.status(200).json({
        totalLeads, feePaid, agreementSigned, ktnCs, ktnLive, parked, autoLeads, manualLeads,
        activeStates: activeStates ?? 0, activeCities: activeCities ?? 0, kitchenScope,
        totalSpend, cac: Math.round(cac), cpl: Math.round(cpl),
      });
      return;
    }

    const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
    if (!supabase) {
      res.status(500).json({ error: "Supabase client not initialized" });
      return;
    }

    const r = parseDateRange(req);

    const base = () => applyCreatedRange(supabase.from("kob_leads").select("*", { count: "exact", head: true }), r);
    const { count: totalLeads } = await base();
    const { count: feePaid } = await base().eq("stage", "FEE_PAID");
    const { count: agreementSigned } = await base().eq("stage", "AGREEMENT_SIGNED");
    const { count: ktnCs } = await base().eq("stage", "KTN_CS");
    const { count: ktnLive } = await base().eq("stage", "KTN_LIVE");
    const { count: parked } = await base().in("stage", ["NO_RESPONSE", "LATER", "NO", "RETARGETING"]);
    const { count: autoLeads } = await base().eq("mode", "AUTO");
    const { count: manualLeads } = await base().eq("mode", "MANUAL");
    const { count: activeStates } = await supabase.from("india_states").select("*", { count: "exact", head: true }).eq("active", true);
    const { count: activeCities } = await supabase.from("india_cities").select("*", { count: "exact", head: true }).eq("active", true);

    const { data: scope } = await supabase.from("v_city_scope").select("native_kitchen_scope, other_kitchen_scope, city_active, state_active, district_active");
    const kitchenScope = (scope ?? [])
      .filter((row: any) => row.city_active && row.state_active && row.district_active)
      .reduce((s: number, row: any) => s + (row.native_kitchen_scope ?? 0) + (row.other_kitchen_scope ?? 0), 0);

    let ql = supabase.from("kob_leads").select("source_id, lead_sources(cost_per_lead)");
    ql = applyCreatedRange(ql, r);
    const { data: leadRows } = await ql;
    const budgeted = await budgetedSpendForRange(supabase, r);
    const totalSpend = budgeted ?? (leadRows ?? []).reduce(
      (s: number, l: any) => s + Number(l.lead_sources?.cost_per_lead ?? 0), 0,
    );

    const cpl = totalLeads && totalLeads > 0 ? totalSpend / totalLeads : 0;
    const cac = ktnLive && ktnLive > 0 ? totalSpend / ktnLive : 0;

    res.status(200).json({
      totalLeads: totalLeads ?? 0,
      feePaid: feePaid ?? 0,
      agreementSigned: agreementSigned ?? 0,
      ktnCs: ktnCs ?? 0,
      ktnLive: ktnLive ?? 0,
      parked: parked ?? 0,
      autoLeads: autoLeads ?? 0,
      manualLeads: manualLeads ?? 0,
      activeStates: activeStates ?? 0,
      activeCities: activeCities ?? 0,
      kitchenScope,
      totalSpend,
      cac: Math.round(cac),
      cpl: Math.round(cpl),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getFunnelBySource.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 346).
 * Uses orgRead for leads and req.supabase for lead_sources.
 */
/** Shared aggregation used by getFunnelBySource() for both backends. */
function aggregateFunnelBySource(
  sources: { id: string; name: string; cost_per_lead: number | null }[],
  leads: { source_id: string | null; stage: string }[],
) {
  const map = new Map<string, any>();
  for (const s of sources) {
    map.set(s.id, {
      source_id: s.id, source_name: s.name, cost_per_lead: s.cost_per_lead,
      total_leads: 0, inbox_count: 0, eoi1_count: 0, webinar_count: 0, eoi2_count: 0,
      form_filled_count: 0, fee_paid_count: 0, agreement_count: 0, ktn_cs_count: 0,
      ktn_live_count: 0, total_spend: 0,
    });
  }

  for (const l of leads) {
    const row = map.get(l.source_id as string);
    if (!row) continue;
    row.total_leads++;
    if (l.stage === "LEAD_INBOX") row.inbox_count++;
    else if (l.stage === "EOI_1") row.eoi1_count++;
    else if (l.stage === "WEBINAR") row.webinar_count++;
    else if (l.stage === "EOI_2") row.eoi2_count++;
    else if (l.stage === "FORM_FILLED") row.form_filled_count++;
    else if (l.stage === "FEE_PAID") row.fee_paid_count++;
    else if (l.stage === "AGREEMENT_SIGNED") row.agreement_count++;
    else if (l.stage === "KTN_CS") row.ktn_cs_count++;
    else if (l.stage === "KTN_LIVE") row.ktn_live_count++;
  }

  for (const row of map.values()) {
    row.total_spend = row.total_leads * Number(row.cost_per_lead ?? 0);
  }
  return Array.from(map.values());
}

export async function getFunnelBySource(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const r = parseDateRange(req);

    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized" }); return; }
      const scope = await resolveLeadScopeOrDeny(req.userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      const sources = await referenceRepo.listSources();
      const leads = await funnelRepo.getLeadsSourceStage(scope, r);
      res.status(200).json(aggregateFunnelBySource(sources, leads));
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized" });
      return;
    }

    const { data: sources, error: sErr } = await req.supabase.from("lead_sources").select("id, name, cost_per_lead");
    if (sErr) {
      res.status(500).json({ error: sErr.message });
      return;
    }

    const orgClient = await getOrgReadClient(req);

    let q = orgClient.from("kob_leads").select("source_id, stage");
    q = applyCreatedRange(q, r);
    const { data: leads, error: lErr } = await q;
    if (lErr) {
      res.status(500).json({ error: lErr.message });
      return;
    }

    res.status(200).json(aggregateFunnelBySource((sources ?? []) as any[], (leads ?? []) as any[]));
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getFunnelByLanguage.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 381).
 * Uses orgRead for leads.
 */
/** Shared aggregation used by getFunnelByLanguage() for both backends. */
function aggregateFunnelByLanguage(leads: { language: string | null; stage: string }[]) {
  const map = new Map<string, any>();
  for (const l of leads) {
    const k = l.language ?? "Others";
    if (!map.has(k)) {
      map.set(k, { language: k, total_leads: 0, fee_paid: 0, agreement: 0, ktn_cs: 0, ktn_live: 0 });
    }
    const row = map.get(k);
    row.total_leads++;
    if (l.stage === "FEE_PAID") row.fee_paid++;
    else if (l.stage === "AGREEMENT_SIGNED") row.agreement++;
    else if (l.stage === "KTN_CS") row.ktn_cs++;
    else if (l.stage === "KTN_LIVE") row.ktn_live++;
  }
  return Array.from(map.values());
}

export async function getFunnelByLanguage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const r = parseDateRange(req);

    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized" }); return; }
      const scope = await resolveLeadScopeOrDeny(req.userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      const leads = await funnelRepo.getLeadsLanguageStage(scope, r);
      res.status(200).json(aggregateFunnelByLanguage(leads));
      return;
    }

    const orgClient = await getOrgReadClient(req);

    let q = orgClient.from("kob_leads").select("language, stage");
    q = applyCreatedRange(q, r);
    const { data: leads, error } = await q;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(aggregateFunnelByLanguage((leads ?? []) as any[]));
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getFunnelByBrand.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 402).
 * Uses orgRead for leads and req.supabase for brands.
 */
/** Shared aggregation used by getFunnelByBrand() for both backends. */
function aggregateFunnelByBrand(
  brands: { id: string; name: string; code: string }[],
  leads: { brand_id: string | null; stage: string }[],
) {
  const map = new Map<string, any>();
  for (const b of brands) {
    map.set(b.id, {
      brand_id: b.id, brand_name: b.name, brand_code: b.code,
      total_leads: 0, fee_paid: 0, agreement: 0, ktn_cs: 0, ktn_live: 0,
    });
  }

  for (const l of leads) {
    const row = map.get(l.brand_id as string);
    if (!row) continue;
    row.total_leads++;
    if (l.stage === "FEE_PAID") row.fee_paid++;
    else if (l.stage === "AGREEMENT_SIGNED") row.agreement++;
    else if (l.stage === "KTN_CS") row.ktn_cs++;
    else if (l.stage === "KTN_LIVE") row.ktn_live++;
  }
  return Array.from(map.values());
}

export async function getFunnelByBrand(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const r = parseDateRange(req);

    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized" }); return; }
      const scope = await resolveLeadScopeOrDeny(req.userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      const brands = await referenceRepo.listBrands();
      const leads = await funnelRepo.getLeadsBrandStage(scope, r);
      res.status(200).json(aggregateFunnelByBrand(brands, leads));
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized" });
      return;
    }

    const { data: brands, error: bErr } = await req.supabase.from("brands").select("id, name, code");
    if (bErr) {
      res.status(500).json({ error: bErr.message });
      return;
    }

    const orgClient = await getOrgReadClient(req);

    let q = orgClient.from("kob_leads").select("brand_id, stage");
    q = applyCreatedRange(q, r);
    const { data: leads, error: lErr } = await q;
    if (lErr) {
      res.status(500).json({ error: lErr.message });
      return;
    }

    res.status(200).json(aggregateFunnelByBrand((brands ?? []) as any[], (leads ?? []) as any[]));
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getStageDistribution.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 428).
 * Paged through PostgREST 1000 limit up to 200 pages.
 * Uses orgRead for leads.
 */
export async function getStageDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const r = parseDateRange(req);

    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized" }); return; }
      const scope = await resolveLeadScopeOrDeny(req.userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      const rows = await funnelRepo.getLeadsIdStageCreated(scope, r);
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.stage] = (counts[row.stage] ?? 0) + 1;
      res.status(200).json(Object.entries(counts).map(([stage, count]) => ({ stage, count })));
      return;
    }

    const orgClient = await getOrgReadClient(req);

    const seen = new Set<string>();
    const counts: Record<string, number> = {};

    for (let page = 0; page < 200; page++) {
      let q = orgClient.from("kob_leads").select("id, stage, created_at").order("created_at", { ascending: true });
      q = applyCreatedRange(q, r);
      const { data: rows, error } = await q.range(page * 1000, page * 1000 + 999);
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      const list = (rows ?? []) as any[];
      for (const row of list) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        counts[row.stage] = (counts[row.stage] ?? 0) + 1;
      }
      if (list.length < 1000) break;
    }

    res.status(200).json(Object.entries(counts).map(([stage, count]) => ({ stage, count })));
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getStateSummary.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 454).
 * Uses req.supabase for states and scope, orgRead for leads.
 */
export async function getStateSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      const userId = req.userId;
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      const scope = await resolveLeadScopeOrDeny(userId);
      if (!scope) { res.status(403).json({ error: "Forbidden" }); return; }

      const r = parseDateRange(req);
      const [states, leads, scopeRows] = await Promise.all([
        analyticsRepo.listStatesForSummary(),
        analyticsRepo.getScopedLeadsStateStageCreated(scope, r),
        analyticsRepo.getCityScopeForStateSummary(),
      ]);

      const byState: Record<string, any> = {};
      for (const s of states) byState[s.id] = { ...s, leads: 0, ktn_live: 0, fee_paid: 0, scope: 0 };
      for (const l of leads) {
        const b = byState[l.state_id as string];
        if (!b) continue;
        b.leads++;
        if (l.stage === "KTN_LIVE") b.ktn_live++;
        if (l.stage === "FEE_PAID") b.fee_paid++;
      }
      for (const c of scopeRows) {
        if (!c.city_active || !c.state_active || !c.district_active) continue;
        const b = byState[c.state_id];
        if (b) b.scope += (Number(c.native_kitchen_scope) || 0) + (Number(c.other_kitchen_scope) || 0);
      }

      res.status(200).json(Object.values(byState));
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized" });
      return;
    }

    const { data: states, error: sErr } = await req.supabase.from("india_states").select("id, name, code, active");
    if (sErr) {
      res.status(500).json({ error: sErr.message });
      return;
    }

    const orgClient = await getOrgReadClient(req);
    const r = parseDateRange(req);

    let q = orgClient.from("kob_leads").select("state_id, stage, created_at");
    q = applyCreatedRange(q, r);
    const { data: leads, error: lErr } = await q;
    if (lErr) {
      res.status(500).json({ error: lErr.message });
      return;
    }

    const { data: scope, error: scErr } = await req.supabase
      .from("v_city_scope")
      .select("state_id, native_kitchen_scope, other_kitchen_scope, city_active, state_active, district_active");
    if (scErr) {
      res.status(500).json({ error: scErr.message });
      return;
    }

    const byState: Record<string, any> = {};
    for (const s of states ?? []) {
      byState[(s as any).id] = { ...s, leads: 0, ktn_live: 0, fee_paid: 0, scope: 0 };
    }
    for (const l of leads ?? []) {
      const b = byState[(l as any).state_id];
      if (!b) continue;
      b.leads++;
      if ((l as any).stage === "KTN_LIVE") b.ktn_live++;
      if ((l as any).stage === "FEE_PAID") b.fee_paid++;
    }
    for (const c of scope ?? []) {
      if (!(c as any).city_active || !(c as any).state_active || !(c as any).district_active) continue;
      const b = byState[(c as any).state_id];
      if (b) {
        b.scope += (Number((c as any).native_kitchen_scope) || 0) + (Number((c as any).other_kitchen_scope) || 0);
      }
    }

    res.status(200).json(Object.values(byState));
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listMarketingTargets.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2773).
 * Query: supabase.from("marketing_kpi_targets").select("*").eq("period", period)
 * Uses request-scoped client: req.supabase
 */
export async function listMarketingTargets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const period = typeof req.query.period === "string" && req.query.period.trim()
      ? req.query.period.trim()
      : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);

    if (useRds()) {
      res.status(200).json(await configRepo.listMarketingTargets(period));
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("marketing_kpi_targets")
      .select("*")
      .eq("period", period);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json((data ?? []) as any[]);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listManualRatings.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1358).
 * Query: supabase.from("scv_manual_ratings").select("*").order("period", { ascending: false }).order("rated_at", { ascending: false }).limit(500)
 * Uses request-scoped client: req.supabase
 */
export async function listManualRatings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await referenceRepo.listManualRatings());
      return;
    }
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("scv_manual_ratings")
      .select("*")
      .order("period", { ascending: false })
      .order("rated_at", { ascending: false })
      .limit(500);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listScvComposite.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1347).
 * Query: supabase.from("v_scv_composite").select("*").order("composite_score", { ascending: false })
 * Uses request-scoped client: req.supabase
 */
export async function listScvComposite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await scvRepo.getScvComposite());
      return;
    }
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("v_scv_composite")
      .select("*")
      .order("composite_score", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getMyAllocationMode.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2482).
 * Query: supabase.from("profiles").select("allocation_mode").eq("id", req.userId).maybeSingle()
 * Strictly scoped to authenticated user req.userId.
 */
export async function getMyAllocationMode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId || (!useRds() && !req.supabase)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (useRds()) {
      const mode = await referenceRepo.getMyAllocationMode(req.userId);
      res.status(200).json({ mode: (mode ?? "MANUAL") as "MANUAL" | "ROUND_ROBIN" });
      return;
    }

    const { data, error } = await req.supabase!
      .from("profiles")
      .select("allocation_mode")
      .eq("id", req.userId)
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({
      mode: ((data as any)?.allocation_mode ?? "MANUAL") as "MANUAL" | "ROUND_ROBIN",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listGallaboxTemplates.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 897).
 * Query: supabase.from("gallabox_templates").select("*").order("name")
 * Pure SELECT on gallabox_templates table. Does NOT make any external Gallabox API calls.
 */
export async function listGallaboxTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      res.status(200).json(await referenceRepo.listGallaboxTemplates());
      return;
    }
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { data, error } = await req.supabase
      .from("gallabox_templates")
      .select("*")
      .order("name");

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    next(err);
  }
}

const ABANDONED_STAGES = [
  "LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE", "EOI_1", "WEBINAR", "EOI_2",
  "FORM_FILLED", "FEE_PAID", "KTN_CS",
];

/**
 * Controller for getAbandonedLeads.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 3096).
 * Query: v_abandoned_leads, scoped by role (executive sees only assigned_to == userId)
 */
export async function getAbandonedLeads(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId || (!useRds() && !req.supabase)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let rows: any[];
    if (useRds()) {
      const scope = await resolveLeadScopeOrDeny(req.userId);
      if (scope === null) {
        res.status(403).json({ error: "Forbidden: no role assigned" });
        return;
      }
      rows = await analyticsRepo.getAbandonedLeadsView(scope);
    } else {
      const { data: role } = await req.supabase!.rpc("get_user_role", { _user_id: req.userId });
      const r = (role as string | null) ?? "executive";

      let q = req.supabase!.from("v_abandoned_leads")
        .select("lead_id, code, full_name, stage, assigned_to, team_leader_id, brand_id, brand_name, language, stage_entered_at, days_in_stage, is_abandoned")
        .eq("is_abandoned", true);

      if (r === "executive") q = q.eq("assigned_to", req.userId);

      const { data, error } = await q.order("days_in_stage", { ascending: false }).limit(1000);
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      rows = (data ?? []) as any[];
    }

    // Enrich with assignee / TL names
    const ids = Array.from(new Set(rows.flatMap((x) => [x.assigned_to, x.team_leader_id]).filter(Boolean))) as string[];
    let names: Record<string, string> = {};
    if (ids.length) {
      const profs = useRds()
        ? await analyticsRepo.getProfileFullNamesByIds(ids)
        : (await req.supabase!.from("profiles").select("id, full_name").in("id", ids)).data ?? [];
      for (const p of profs) names[(p as any).id] = (p as any).full_name;
    }

    const summary: Record<string, number> = {};
    for (const s of ABANDONED_STAGES) summary[s] = 0;
    for (const row of rows) summary[row.stage] = (summary[row.stage] ?? 0) + 1;

    const enriched = rows.map((x) => ({
      ...x,
      assigned_to_name: x.assigned_to ? names[x.assigned_to] ?? null : null,
      team_leader_name: x.team_leader_id ? names[x.team_leader_id] ?? null : null,
      days_in_stage: Math.floor(Number(x.days_in_stage ?? 0)),
    }));

    res.status(200).json({ rows: enriched, summary, stages: ABANDONED_STAGES });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getAllocationBreakdownByTL.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2216).
 * Query: profiles, user_roles, kob_leads
 */
export async function getAllocationBreakdownByTL(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { data: profiles, error: pErr } = await req.supabase.from("profiles").select("id, full_name, team_leader_id");
    if (pErr) {
      res.status(500).json({ error: pErr.message });
      return;
    }
    const { data: roles, error: rErr } = await req.supabase.from("user_roles").select("user_id, role");
    if (rErr) {
      res.status(500).json({ error: rErr.message });
      return;
    }
    const { data: leads, error: lErr } = await req.supabase.from("kob_leads").select("id, team_leader_id, assigned_to");
    if (lErr) {
      res.status(500).json({ error: lErr.message });
      return;
    }

    const roleByUser: Record<string, string[]> = {};
    for (const r of roles ?? []) (roleByUser[(r as any).user_id] ??= []).push((r as any).role);

    const tls = (profiles ?? []).filter((p: any) => roleByUser[p.id]?.includes("team_leader"));
    const execCountByTL: Record<string, number> = {};
    for (const p of profiles ?? []) {
      if (roleByUser[(p as any).id]?.includes("executive") && (p as any).team_leader_id) {
        execCountByTL[(p as any).team_leader_id] = (execCountByTL[(p as any).team_leader_id] ?? 0) + 1;
      }
    }

    let orgUnassignedToTL = 0;
    let orgUnallocatedWithinTeam = 0;
    const perTL: Record<string, { received: number; allocated: number; unallocated: number }> = {};
    for (const l of leads ?? []) {
      const tl = (l as any).team_leader_id;
      const assigned = (l as any).assigned_to;
      if (!tl) { orgUnassignedToTL += 1; continue; }
      perTL[tl] ??= { received: 0, allocated: 0, unallocated: 0 };
      perTL[tl].received += 1;
      if (assigned) perTL[tl].allocated += 1;
      else { perTL[tl].unallocated += 1; orgUnallocatedWithinTeam += 1; }
    }

    const rows = tls.map((tl: any) => ({
      id: tl.id,
      name: tl.full_name,
      teamSize: execCountByTL[tl.id] ?? 0,
      received: perTL[tl.id]?.received ?? 0,
      allocated: perTL[tl.id]?.allocated ?? 0,
      unallocated: perTL[tl.id]?.unallocated ?? 0,
    })).sort((a, b) => b.received - a.received);

    res.status(200).json({ rows, orgUnassignedToTL, orgUnallocatedWithinTeam });
  } catch (err) {
    next(err);
  }
}

const EXECUTIVE_SUMMARY_STAGES = [
  "LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE", "EOI_1", "WEBINAR", "WEBINAR_ATTENDED", "EOI2_PENDING",
  "EOI_2", "FORM_FILLED", "FEE_PAID", "AGREEMENT_SIGNED", "KTN_CS", "KTN_LIVE",
  "NO", "LATER", "NO_RESPONSE", "RETARGETING", "DEAD_LEAD", "NON_SERVICEABLE", "NO_VACANCY", "DUPLICATE_LEAD",
];

/**
 * Controller for getExecutiveStageSummary.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2584).
 */
export async function getExecutiveStageSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const executiveId = typeof req.query.executiveId === "string" ? req.query.executiveId : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    if (useRds()) {
      const userId = req.userId;
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      const scope = await resolveLeadScopeOrDeny(userId);
      if (!scope) { res.status(403).json({ error: "Forbidden" }); return; }

      const execIds = await analyticsRepo.getExecutiveRoleUserIdsScoped(scope);
      if (!execIds.length) {
        res.status(200).json({ executives: [] as any[], stages: EXECUTIVE_SUMMARY_STAGES });
        return;
      }

      const profiles = await analyticsRepo.getProfilesForExecSummary(execIds);
      const scopedExecIds = profiles.map((p) => p.id);
      const targetExecIds = executiveId && scopedExecIds.includes(executiveId) ? [executiveId] : scopedExecIds;

      const leads = await analyticsRepo.getLeadsByAssignedToStageEntered(targetExecIds, from, to);

      const countsByExec: Record<string, Record<string, number>> = {};
      for (const l of leads) {
        (countsByExec[l.assigned_to] ??= {})[l.stage] = ((countsByExec[l.assigned_to]?.[l.stage]) ?? 0) + 1;
      }

      const executives = profiles.map((p) => {
        const ec = countsByExec[p.id] ?? {};
        return {
          id: p.id,
          name: p.full_name,
          email: p.email,
          team_leader_id: p.team_leader_id,
          counts: Object.fromEntries(EXECUTIVE_SUMMARY_STAGES.map((stage) => [stage, ec[stage] ?? 0])),
          total: Object.values(ec).reduce((a: number, b: number) => a + b, 0),
        };
      });

      const combined: Record<string, number> = {};
      for (const e of executives) {
        for (const stage of EXECUTIVE_SUMMARY_STAGES) {
          combined[stage] = (combined[stage] ?? 0) + ((e.counts as Record<string, number>)[stage] ?? 0);
        }
      }
      const combinedTotal = Object.values(combined).reduce((a, b) => a + b, 0);

      res.status(200).json({
        executives,
        stages: EXECUTIVE_SUMMARY_STAGES,
        combined: { id: "all", name: "All Executives", counts: combined, total: combinedTotal },
      });
      return;
    }

    const db = await getOrgReadClient(req);

    const { data: roles } = await db.from("user_roles").select("user_id, role").eq("role", "executive");
    const execIds = (roles ?? []).map((r: any) => r.user_id);
    if (!execIds.length) {
      res.status(200).json({ executives: [] as any[], stages: EXECUTIVE_SUMMARY_STAGES });
      return;
    }

    const { data: profilesRaw } = await db
      .from("profiles")
      .select("id, full_name, email, team_leader_id, assignment_active")
      .in("id", execIds)
      .order("full_name", { ascending: true });
    const profiles = profilesRaw ?? [];

    const scopedExecIds = profiles.map((p: any) => p.id);
    const targetExecIds = executiveId && scopedExecIds.includes(executiveId)
      ? [executiveId]
      : scopedExecIds;

    const leads: any[] = [];
    if (targetExecIds.length) {
      const PAGE = 1000;
      for (let i = 0; ; i += PAGE) {
        let q = db
          .from("kob_leads")
          .select("id, assigned_to, stage")
          .in("assigned_to", targetExecIds)
          .order("id", { ascending: true });
        if (from) q = q.gte("stage_entered_at", from);
        if (to) q = q.lte("stage_entered_at", to);
        const { data: pageData, error } = await q.range(i, i + PAGE - 1);
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        const page = (pageData ?? []) as any[];
        leads.push(...page);
        if (page.length < PAGE) break;
      }
    }

    const countsByExec: Record<string, Record<string, number>> = {};
    for (const l of leads) {
      const execId = l.assigned_to as string;
      const stage = l.stage as string;
      (countsByExec[execId] ??= {})[stage] = ((countsByExec[execId]?.[stage]) ?? 0) + 1;
    }

    const executives = profiles.map((p: any) => {
      const ec = countsByExec[p.id] ?? {};
      return {
        id: p.id,
        name: p.full_name,
        email: p.email,
        team_leader_id: p.team_leader_id,
        counts: Object.fromEntries(
          EXECUTIVE_SUMMARY_STAGES.map((stage) => [stage, ec[stage] ?? 0])
        ),
        total: Object.values(ec).reduce((a: number, b: number) => a + b, 0),
      };
    });

    const combined: Record<string, number> = {};
    for (const e of executives) {
      for (const stage of EXECUTIVE_SUMMARY_STAGES) {
        combined[stage] = (combined[stage] ?? 0) + ((e.counts as Record<string, number>)[stage] ?? 0);
      }
    }
    const combinedTotal = Object.values(combined).reduce((a, b) => a + b, 0);

    res.status(200).json({
      executives,
      stages: EXECUTIVE_SUMMARY_STAGES,
      combined: { id: "all", name: "All Executives", counts: combined, total: combinedTotal },
    });
  } catch (err) {
    next(err);
  }
}

const PARKED_STAGES = new Set(["RETARGETING", "NO", "LATER", "NO_RESPONSE"]);
const metricPred = (metric: string) => (l: any) => {
  switch (metric) {
    case "TOTAL_LEADS":
    case "SPEND":
    case "CPL":
    case "CAC":
    case "ACTIVE_STATES":
    case "ACTIVE_CITIES":
    case "KITCHEN_SCOPE":
      return true;
    case "PARKED": return PARKED_STAGES.has(l.stage);
    case "AUTO_LEADS": return l.mode === "AUTO";
    case "MANUAL_LEADS": return l.mode === "MANUAL";
    case "CONVERSION": return l.stage === "KTN_LIVE";
    default: return l.stage === metric;
  }
};

function bucketStart(d: Date, unit: "month" | "week"): Date {
  const x = new Date(d);
  if (unit === "month") { x.setUTCDate(1); x.setUTCHours(0,0,0,0); return x; }
  const day = x.getUTCDay(); const diff = (day + 6) % 7;
  x.setUTCDate(x.getUTCDate() - diff); x.setUTCHours(0,0,0,0); return x;
}
function addBuckets(d: Date, n: number, unit: "month" | "week"): Date {
  const x = new Date(d);
  if (unit === "month") x.setUTCMonth(x.getUTCMonth() + n);
  else x.setUTCDate(x.getUTCDate() + n * 7);
  return x;
}
function labelOf(d: Date, unit: "month" | "week"): string {
  if (unit === "month") return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  const m = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `W ${m}`;
}
function seriesFor(rows: any[], metric: string, buckets: Date[], unit: "month" | "week") {
  const pred = metricPred(metric);
  const out: Array<{ period: string; value: number }> = [];
  for (let i = 0; i < buckets.length; i++) {
    const start = buckets[i].getTime();
    const end = (i + 1 < buckets.length ? buckets[i + 1] : addBuckets(buckets[i], 1, unit)).getTime();
    let c = 0;
    for (const l of rows) {
      const t = new Date(l.created_at).getTime();
      if (t >= start && t < end && pred(l)) c++;
    }
    out.push({ period: labelOf(buckets[i], unit), value: c });
  }
  const n = out.length;
  const xs = out.map((_, i) => i);
  const ys = out.map(o => o.value);
  const sx = xs.reduce((a,b)=>a+b,0);
  const sy = ys.reduce((a,b)=>a+b,0);
  const sxx = xs.reduce((a,b)=>a+b*b,0);
  const sxy = xs.reduce((a,b,i)=>a+b*ys[i],0);
  const denom = n * sxx - sx * sx || 1;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return out.map((o, i) => ({ ...o, trend: Math.max(0, Math.round((intercept + slope * i) * 10) / 10) }));
}

/**
 * Controller for getKpiTrend.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 3032).
 */
export async function getKpiTrend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const metric = typeof req.query.metric === "string" ? req.query.metric : "TOTAL_LEADS";

    const now = new Date();
    const monthStart = bucketStart(now, "month");
    const weekStart = bucketStart(now, "week");
    const monthBuckets: Date[] = [];
    for (let i = 5; i >= 0; i--) monthBuckets.push(addBuckets(monthStart, -i, "month"));
    const weekBuckets: Date[] = [];
    for (let i = 23; i >= 0; i--) weekBuckets.push(addBuckets(weekStart, -i, "week"));
    const earliest = monthBuckets[0] < weekBuckets[0] ? monthBuckets[0] : weekBuckets[0];

    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized on request" }); return; }
      const scope = await resolveLeadScopeOrDeny(req.userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      const src = await dashboardRepo.getLeadsStageModeCreatedSince(scope, earliest.toISOString());
      res.status(200).json({
        monthly: seriesFor(src, metric, monthBuckets, "month"),
        weekly: seriesFor(src, metric, weekBuckets, "week"),
      });
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const { data: rows, error } = await req.supabase
      .from("kob_leads")
      .select("stage, mode, created_at")
      .gte("created_at", earliest.toISOString());

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    const src = (rows ?? []) as any[];
    res.status(200).json({
      monthly: seriesFor(src, metric, monthBuckets, "month"),
      weekly: seriesFor(src, metric, weekBuckets, "week"),
    });
  } catch (err) {
    next(err);
  }
}

// ==================================================
// BATCH 7: MARKETING KPIS
// ==================================================

function monthStartUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function nextMonthStartUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

async function computeMarketingTotals(
  supabase: any,
  fromIso: string,
  toIso: string,
  spendOverride?: number,
) {
  const rows = useRds()
    ? await analyticsRepo.getLeadsStageWithSourceCost(fromIso, toIso)
    : await (async () => {
        const { data: leads, error } = await supabase
          .from("kob_leads")
          .select("stage, lead_sources(cost_per_lead)")
          .gte("created_at", fromIso)
          .lt("created_at", toIso);
        if (error) throw error;
        return ((leads ?? []) as any[]).map((l) => ({ stage: l.stage, cost_per_lead: l.lead_sources?.cost_per_lead ?? null }));
      })();
  const totalLeads = rows.length;
  const totalSpend =
    spendOverride !== undefined
      ? spendOverride
      : rows.reduce((s, l: any) => s + Number(l.cost_per_lead ?? 0), 0);
  const ktnLive = rows.filter((l) => l.stage === "KTN_LIVE").length;
  const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const cac = ktnLive > 0 ? totalSpend / ktnLive : 0;
  return { SPEND: totalSpend, LEADS: totalLeads, CPL: cpl, CAC: cac };
}

/**
 * Controller for getMarketingKpis.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2724).
 */
export async function getMarketingKpis(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const now = new Date();
    const curStart = monthStartUtc(now);
    const nextStart = nextMonthStartUtc(now);
    const prevStart = monthStartUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));

    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const dayOfMonth = now.getUTCDate();
    const daysElapsed = Math.max(1, dayOfMonth);

    const runRate = (v: number) => (v / daysElapsed) * daysInMonth;

    const targets = useRds()
      ? await configRepo.listMarketingTargets(curStart.toISOString().slice(0, 10))
      : await (async () => {
          const { data, error: tErr } = await req.supabase!
            .from("marketing_kpi_targets")
            .select("metric, target_value")
            .eq("period", curStart.toISOString().slice(0, 10));
          if (tErr) throw tErr;
          return (data ?? []) as any[];
        })();

    const tmap = new Map<string, number>();
    for (const t of targets as any[]) tmap.set(t.metric, Number(t.target_value));

    const prevBudget = useRds()
      ? Number((await configRepo.listMarketingTargets(prevStart.toISOString().slice(0, 10))).find((t) => t.metric === "SPEND")?.target_value ?? 0)
      : await (async () => {
          const { data: prevTargets, error: ptErr } = await req.supabase!
            .from("marketing_kpi_targets")
            .select("metric, target_value")
            .eq("period", prevStart.toISOString().slice(0, 10))
            .eq("metric", "SPEND");
          if (ptErr) throw ptErr;
          return Number((prevTargets ?? [])[0]?.target_value ?? 0);
        })();

    const budget = tmap.get("SPEND");
    const curSpend = budget !== undefined ? (budget / daysInMonth) * daysElapsed : undefined;
    const prevSpend = prevBudget > 0 ? prevBudget : undefined;

    const cur = await computeMarketingTotals(req.supabase, curStart.toISOString(), nextStart.toISOString(), curSpend);
    const prev = await computeMarketingTotals(req.supabase, prevStart.toISOString(), curStart.toISOString(), prevSpend);

    const metrics = ["SPEND", "LEADS", "CPL", "CAC"] as const;
    const out = metrics.map((m) => ({
      metric: m,
      achieved: cur[m],
      prev_period: prev[m],
      run_rate: m === "CPL" || m === "CAC" ? cur[m] : runRate(cur[m]),
      target: tmap.get(m) ?? null,
      period: curStart.toISOString().slice(0, 10),
    }));

    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

// ==================================================
// BATCH 7: METRIC DRILLDOWN
// ==================================================

/**
 * Controller for getMetricDrilldown.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 3056).
 */
export async function getMetricDrilldown(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const metric = typeof req.query.metric === "string" ? req.query.metric : "";
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    if (useRds()) {
      const userId = req.userId;
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      const scope = await resolveLeadScopeOrDeny(userId);
      if (!scope) { res.status(403).json({ error: "Forbidden" }); return; }

      const leads = await analyticsRepo.getScopedLeadsStageLangCityCreated(scope, { from, to });
      const pred = metricPred(metric);
      const rows = leads.filter(pred as any);
      const cityIds = Array.from(new Set(rows.map((r) => r.city_id).filter(Boolean))) as string[];
      let cityMap = new Map<string, string>();
      if (cityIds.length) {
        const cities = await analyticsRepo.getCityNamesByIds(cityIds);
        for (const c of cities) cityMap.set(c.id, c.name);
      }
      const byCity = new Map<string, number>();
      const byLang = new Map<string, number>();
      for (const r of rows) {
        const cname = r.city_id ? (cityMap.get(r.city_id) ?? "Unknown") : "Unassigned";
        byCity.set(cname, (byCity.get(cname) ?? 0) + 1);
        const lang = r.language ?? "Others";
        byLang.set(lang, (byLang.get(lang) ?? 0) + 1);
      }
      const sortDesc = (m: Map<string, number>) =>
        Array.from(m.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
      res.status(200).json({ byCity: sortDesc(byCity).slice(0, 25), byLanguage: sortDesc(byLang) });
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const orgClient = await getOrgReadClient(req);
    let q = orgClient.from("kob_leads").select("stage, language, city_id, created_at");
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    const { data: leads, error } = await q;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    const pred = metricPred(metric);
    const rows = ((leads ?? []) as any[]).filter(pred);
    const cityIds = Array.from(new Set(rows.map((r: any) => r.city_id).filter(Boolean)));
    let cityMap = new Map<string, string>();
    if (cityIds.length) {
      const { data: cities } = await req.supabase.from("india_cities").select("id, name").in("id", cityIds);
      for (const c of (cities ?? []) as any[]) cityMap.set(c.id, c.name);
    }
    const byCity = new Map<string, number>();
    const byLang = new Map<string, number>();
    for (const r of rows) {
      const cname = r.city_id ? (cityMap.get(r.city_id) ?? "Unknown") : "Unassigned";
      byCity.set(cname, (byCity.get(cname) ?? 0) + 1);
      const lang = r.language ?? "Others";
      byLang.set(lang, (byLang.get(lang) ?? 0) + 1);
    }
    const sortDesc = (m: Map<string, number>) =>
      Array.from(m.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    res.status(200).json({ byCity: sortDesc(byCity).slice(0, 25), byLanguage: sortDesc(byLang) });
  } catch (err) {
    next(err);
  }
}

// ==================================================
// BATCH 7: MY RETARGETING QUEUE
// ==================================================

/**
 * Controller for getMyRetargetingQueue.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2435).
 */
export async function getMyRetargetingQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { data: leads, error: lErr } = await req.supabase
      .from("kob_leads")
      .select("id, code, full_name")
      .eq("assigned_to", userId);
    if (lErr) throw lErr;
    const leadIds = (leads ?? []).map((l: any) => l.id);
    if (leadIds.length === 0) {
      res.status(200).json([]);
      return;
    }
    const { data: rows, error: rErr } = await req.supabase
      .from("retargeting_schedule")
      .select("id, lead_id, bucket, next_touch_at, attempts_done, phase, is_dead")
      .in("lead_id", leadIds)
      .eq("is_dead", false)
      .order("next_touch_at", { ascending: true });
    if (rErr) throw rErr;
    const byId = new Map((leads ?? []).map((l: any) => [l.id, l]));
    res.status(200).json((rows ?? []).map((r: any) => ({ ...r, lead: byId.get(r.lead_id) })));
  } catch (err) {
    next(err);
  }
}

// ==================================================
// BATCH 7: MY STAGE HISTORY
// ==================================================

/**
 * Controller for getMyStageHistory.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2456).
 */
export async function getMyStageHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { data: leads, error: lErr } = await req.supabase
      .from("kob_leads")
      .select("id, code, full_name")
      .eq("assigned_to", userId);
    if (lErr) throw lErr;
    const ids = (leads ?? []).map((l: any) => l.id);
    if (ids.length === 0) {
      res.status(200).json([]);
      return;
    }
    const { data: hist, error: hErr } = await req.supabase
      .from("lead_stage_history")
      .select("lead_id, from_stage, to_stage, changed_at")
      .in("lead_id", ids)
      .order("changed_at", { ascending: false });
    if (hErr) throw hErr;
    const byId = new Map((leads ?? []).map((l: any) => [l.id, l]));
    res.status(200).json((hist ?? []).map((h: any) => ({
      code: byId.get(h.lead_id)?.code,
      name: byId.get(h.lead_id)?.full_name,
      from_stage: h.from_stage,
      to_stage: h.to_stage,
      changed_at: h.changed_at,
    })));
  } catch (err) {
    next(err);
  }
}

// ==================================================
// BATCH 7: SCV SCORE COMPUTATION HELPERS & getMyScvScore
// ==================================================

async function loadIncentiveRules(supabase: any) {
  const { data } = await supabase.from("incentive_rules").select("*").order("sort_order");
  return (data ?? []) as any[];
}
function lookupIncentive(rules: any[], score: number) {
  for (const r of rules) if (score >= r.min_score && score <= r.max_score) return { label: r.label, pct: r.incentive_pct, amount: Number(r.incentive_amount ?? 0) };
  return { label: "Unrated", pct: 0, amount: 0 };
}
async function scvPageAll(build: () => any): Promise<any[]> {
  const all: any[] = [];
  for (let page = 0; page < 200; page++) {
    const { data, error } = await build().range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    const rows = (data ?? []) as any[];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}
async function scvPageAllChunked(
  ids: string[],
  build: (chunk: string[]) => any,
): Promise<any[]> {
  const all: any[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    all.push(...(await scvPageAll(() => build(chunk))));
  }
  return all;
}

const SCV_WEIGHTS_FALLBACK = { conversion: 35, tat: 25, eoi2Payment: 15, crm: 25 };
async function loadScvComponentWeights(supabase: any) {
  const { data } = await supabase.from("scv_component_weights").select("*").eq("id", 1).maybeSingle();
  if (!data) return { ...SCV_WEIGHTS_FALLBACK };
  return {
    conversion: Number(data.weight_conversion),
    tat: Number(data.weight_tat),
    eoi2Payment: Number(data.weight_eoi2_payment),
    crm: Number(data.weight_crm_discipline),
  };
}
const TAT_CLOSE_STAGES = new Set(["NO", "LATER", "NO_RESPONSE", "RETARGETING", "DEAD_LEAD", "NON_SERVICEABLE", "NO_VACANCY", "DUPLICATE_LEAD"]);
const TAT_SLA_MS = 96 * 3600000;

function currentScvMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function scvMonthRange(month?: string): { start: string; end: string } {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) month = currentScvMonthKey();
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

async function computeScvForExecs(supabase: any, execIds: string[], range?: { start: string; end: string }) {
  const r = range ?? scvMonthRange(currentScvMonthKey());
  const weights = await loadScvComponentWeights(supabase);
  const incentiveRules = await loadIncentiveRules(supabase);
  const byExec = new Map<string, any>();
  if (!execIds.length) return { weights, incentiveRules, byExec };

  const leads = await scvPageAll(() =>
    supabase.from("kob_leads")
      .select("id, assigned_to, stage, created_at, stage_entered_at")
      .in("assigned_to", execIds)
      .lt("created_at", r.end)
      .order("id", { ascending: true }),
  );
  const leadIds = leads.map((l: any) => l.id);
  const hist = await scvPageAllChunked(leadIds, (chunk) =>
    supabase.from("lead_stage_history")
      .select("lead_id, from_stage, to_stage, created_at")
      .in("lead_id", chunk)
      .gte("created_at", r.start)
      .order("created_at", { ascending: true }),
  );
  const feePaidMoves = await scvPageAll(() =>
    supabase.from("lead_stage_history")
      .select("lead_id, changed_by, created_at")
      .eq("from_stage", "EOI_2")
      .eq("to_stage", "FEE_PAID")
      .in("changed_by", execIds)
      .gte("created_at", r.start).lt("created_at", r.end)
      .order("lead_id", { ascending: true }),
  );
  const { data: inputs } = await supabase
    .from("scv_monthly_inputs")
    .select("user_id, ktn_cs_target, crm_discipline")
    .eq("period", r.start.slice(0, 10))
    .in("user_id", execIds);
  const inputByUser = new Map<string, any>(((inputs ?? []) as any[]).map((i) => [i.user_id, i]));

  const { data: orgTargetRow } = await supabase
    .from("kpi_targets")
    .select("target_value, effective_from")
    .eq("metric", "KTN_CS")
    .eq("period", "monthly")
    .lte("effective_from", r.start.slice(0, 10))
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const orgKtnCsTarget = orgTargetRow?.target_value != null ? Number(orgTargetRow.target_value) : null;

  const leadsByExec: Record<string, any[]> = {};
  for (const l of leads) (leadsByExec[l.assigned_to] ??= []).push(l);
  const histByLead: Record<string, any[]> = {};
  for (const h of hist as any[]) (histByLead[h.lead_id] ??= []).push(h);
  for (const arr of Object.values(histByLead)) arr.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const startMs = new Date(r.start).getTime();
  const endMs = new Date(r.end).getTime();
  const nowMs = Date.now();
  const inMonth = (iso: string) => { const t = new Date(iso).getTime(); return t >= startMs && t < endMs; };
  const clampPct = (n: number) => Math.max(0, Math.min(100, n));

  for (const eid of execIds) {
    const el = leadsByExec[eid] ?? [];
    const input = inputByUser.get(eid);
    const target = input?.ktn_cs_target != null ? Number(input.ktn_cs_target) : orgKtnCsTarget;

    const ktnCs = el.filter((l: any) => l.stage === "KTN_CS" && l.stage_entered_at && inMonth(l.stage_entered_at)).length;
    const conversionPct = target && target > 0 ? clampPct((ktnCs / target) * 100) : 0;

    let tatTotal = 0, tatPass = 0;
    const ktnLiveLeads = new Set<string>();
    const eoi2Eligible = new Set<string>();
    const eoi2Paid = new Set<string>();
    for (const l of el) {
      const rows = histByLead[l.id] ?? [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (inMonth(row.created_at)) {
          if (row.to_stage === "KTN_LIVE") ktnLiveLeads.add(l.id);
          if (row.to_stage === "EOI_2") eoi2Eligible.add(l.id);
          if (row.from_stage === "EOI_2" && row.to_stage === "FEE_PAID") eoi2Eligible.add(l.id);
        }
        if (row.to_stage !== "WEBINAR" || !inMonth(row.created_at)) continue;
        const entryMs = new Date(row.created_at).getTime();
        let outcome: "pass" | "fail" | "closed" | "pending" = "pending";
        for (let j = i + 1; j < rows.length; j++) {
          const nx = rows[j];
          const t = new Date(nx.created_at).getTime();
          if (t - entryMs > TAT_SLA_MS) { outcome = "fail"; break; }
          if (nx.to_stage === "KTN_CS") { outcome = "pass"; break; }
          if (nx.to_stage === "WEBINAR") { outcome = "closed"; break; }
          if (TAT_CLOSE_STAGES.has(nx.to_stage)) { outcome = "closed"; break; }
        }
        if (outcome === "pending" && Math.min(nowMs, endMs) - entryMs > TAT_SLA_MS) outcome = "fail";
        if (outcome === "pass") { tatTotal++; tatPass++; }
        else if (outcome === "fail") tatTotal++;
      }
    }
    const tatPct = tatTotal ? (tatPass / tatTotal) * 100 : 0;
    for (const m of feePaidMoves as any[]) if (m.changed_by === eid) eoi2Paid.add(m.lead_id);
    const eoi2Pct = eoi2Eligible.size ? clampPct((eoi2Paid.size / eoi2Eligible.size) * 100) : 0;
    const crmPct = input?.crm_discipline != null ? clampPct(Number(input.crm_discipline)) : 0;

    const points =
      (conversionPct * weights.conversion + tatPct * weights.tat +
        eoi2Pct * weights.eoi2Payment + crmPct * weights.crm) / 100;
    const finalScore = Math.min(100, Math.round(points));
    const slab = lookupIncentive(incentiveRules, finalScore);

    byExec.set(eid, {
      total: el.length, converted: ktnCs,
      ktnCsTarget: target,
      conversionPct: Math.round(conversionPct),
      tatPct: Math.round(tatPct),
      tatCycles: tatTotal, tatPass, tatFail: tatTotal - tatPass,
      eoi2EligibleCount: eoi2Eligible.size,
      conversionPoints: Math.round(conversionPct * weights.conversion) / 100,
      tatPoints: Math.round(tatPct * weights.tat) / 100,
      eoi2Points: Math.round(eoi2Pct * weights.eoi2Payment) / 100,
      crmPoints: Math.round(crmPct * weights.crm) / 100,
      eoi2Pct: Math.round(eoi2Pct),
      crmPct: Math.round(crmPct),
      crmInput: input?.crm_discipline != null ? Number(input.crm_discipline) : null,
      finalScore,
      slabLabel: slab.label,
      incentivePct: slab.pct,
      ktnCs,
      ktnLive: ktnLiveLeads.size,
      feePaid: eoi2Paid.size,
    });
  }
  return { weights, incentiveRules, byExec };
}

/**
 * Controller for getMyScvScore.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2682).
 */
export async function getMyScvScore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { byExec } = await computeScvForExecs(useRds() ? pgClient : req.supabase, [userId]);
    const s = byExec.get(userId);
    res.status(200).json({ score: (s?.finalScore ?? null) as number | null });
  } catch (err) {
    next(err);
  }
}

// ==================================================
// BATCH 7: MY TEAM (EXECUTIVE ROSTER)
// ==================================================

async function fetchExecRoster(supabase: any, cols = "id, full_name, email, phone") {
  const { data: roles, error: rErr } = await supabase.from("user_roles").select("user_id").eq("role", "executive");
  if (rErr) throw rErr;
  const ids = Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
  if (!ids.length) return [];
  const { data, error } = await supabase.from("profiles").select(cols).in("id", ids);
  if (error) throw error;
  return data ?? [];
}

/**
 * Controller for getMyTeam.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1425).
 */
export async function getMyTeam(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgClient = await getOrgReadClient(req);
    const roster = await fetchExecRoster(orgClient);
    res.status(200).json(roster);
  } catch (err) {
    next(err);
  }
}

// ==================================================
// BATCH 8: RETARGETING & SCV CONTROLLERS & HELPERS
// ==================================================

/**
 * Controller for getRetargetingQueue.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 974).
 */
export async function getRetargetingQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = req.supabase ?? supabaseAdmin;
    if (!client) {
      res.status(500).json({ error: "Supabase client not initialized" });
      return;
    }
    const all: any[] = [];
    for (let page = 0; page < 20; page++) {
      const { data, error } = await client
        .from("v_retargeting_queue")
        .select("*")
        .order("next_touch_at")
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      const rows = data ?? [];
      all.push(...rows);
      if (rows.length < 1000) break;
    }
    res.status(200).json(all);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getScvComponentWeights.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1726).
 */
export async function getScvComponentWeights(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = useRds() ? pgClient : (req.supabase ?? supabaseAdmin);
    if (!client) {
      res.status(500).json({ error: "Supabase client not initialized" });
      return;
    }
    const weights = await loadScvComponentWeights(client);
    const { data: history, error } = await client
      .from("scv_weight_changes")
      .select("id, changed_by, component, previous_weight, new_weight, changed_at")
      .order("changed_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const ids = Array.from(new Set((history ?? []).map((h: any) => h.changed_by).filter(Boolean)));
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await client.from("profiles").select("id, full_name").in("id", ids);
      (profs ?? []).forEach((p: any) => names.set(p.id, p.full_name));
    }
    res.status(200).json({
      weights,
      history: (history ?? []).map((h: any) => ({ ...h, changed_by_name: names.get(h.changed_by) ?? "—" })),
    });
  } catch (err) {
    next(err);
  }
}

async function scvAvailableMonths(supabase: any): Promise<string[]> {
  const { data } = await supabase.from("kob_leads").select("created_at").order("created_at", { ascending: true }).limit(1);
  const first = (data?.[0] as any)?.created_at ? new Date((data[0] as any).created_at) : new Date();
  const now = new Date();
  const months: string[] = [];
  let y = now.getUTCFullYear(), m = now.getUTCMonth();
  const fy = first.getUTCFullYear(), fm = first.getUTCMonth();
  while (y > fy || (y === fy && m >= fm)) {
    months.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m--; if (m < 0) { m = 11; y--; }
  }
  return months;
}

/**
 * Controller for getScvLeaderboard.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1246).
 */
export async function getScvLeaderboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const supabase = useRds() ? pgClient : (req.supabase ?? supabaseAdmin);
    if (!supabase) {
      res.status(500).json({ error: "Supabase client not initialized" });
      return;
    }
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    const { data: execs, error: execsErr } = await supabase
      .from("user_roles").select("user_id")
      .eq("role", "executive" as any);
    if (execsErr) throw execsErr;
    const rows = (execs ?? []) as any[];
    const execIds = rows.map((r: any) => r.user_id);
    const { data: profs } = execIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", execIds)
      : { data: [] as any[] };
    const names: Record<string, string> = {};
    for (const p of (profs ?? []) as any[]) names[p.id] = p.full_name ?? "—";
    const { byExec } = await computeScvForExecs(supabase, execIds, scvMonthRange(month));
    const out = execIds.map((id) => {
      const s = byExec.get(id) ?? { total: 0, ktnLive: 0, feePaid: 0, finalScore: 0 };
      return {
        user_id: id, full_name: names[id] ?? "—",
        lead_count: s.total, avg_scv: s.finalScore,
        conversions: s.ktnLive, fee_paid: s.feePaid,
      };
    });
    out.sort((a, b) => b.avg_scv - a.avg_scv || b.conversions - a.conversions);
    res.status(200).json({ rows: out.slice(0, 20), months: await scvAvailableMonths(supabase) });
  } catch (err) {
    next(err);
  }
}

type ScvMode = "AUTO" | "MANUAL";
const SCV_COMPONENT_TYPES = ["conversion", "tat", "eoi1Webinar", "eoi2Payment", "discipline", "mark"] as const;
const TAT_MOVEMENT_DEFS: Record<string, { from: string[]; to: string }> = {
  lead_eoi1: { from: ["LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE"], to: "EOI_1" },
  eoi1_webinar: { from: ["EOI_1"], to: "WEBINAR" },
  webinar_eoi2: { from: ["WEBINAR", "EOI2_PENDING"], to: "EOI_2" },
  eoi2_payment: { from: ["EOI_2"], to: "FEE_PAID" },
  payment_contract: { from: ["FEE_PAID"], to: "KTN_CS" },
};

async function loadScvModeConfig(supabase: any, mode: ScvMode) {
  const { data } = await supabase.from("scv_mode_config").select("*").eq("mode", mode).maybeSingle();
  return {
    components: ((data?.components ?? []) as any[]),
    tatMovements: ((data?.tat_movements ?? []) as any[]),
    incentiveAmount: Number(data?.incentive_amount ?? 10000),
  };
}

async function fetchScvRoster(supabase: any, cols = "id, full_name") {
  const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "executive");
  const ids = Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
  if (!ids.length) return [];
  const { data } = await supabase.from("profiles").select(cols).in("id", ids).order("full_name");
  return data ?? [];
}

async function computeScvModeForExecs(supabase: any, execIds: string[], mode: ScvMode, r: { start: string; end: string }) {
  const cfg = await loadScvModeConfig(supabase, mode);
  const comps = cfg.components.filter((c: any) => c.enabled);
  const incentiveRules = await loadIncentiveRules(supabase);
  const byExec = new Map<string, any>();
  if (!execIds.length) return { cfg, byExec };

  const leads = await scvPageAll(() =>
    supabase.from("kob_leads")
      .select("id, code, full_name, assigned_to, stage, created_at, stage_entered_at, mode")
      .in("assigned_to", execIds).eq("mode", mode)
      .lt("created_at", r.end)
      .order("id", { ascending: true }),
  );
  const leadIds = leads.map((l: any) => l.id);
  // Look back 90 days so stage-entry times before the month are known for TAT.
  const lookback = new Date(new Date(r.start).getTime() - 90 * 86400000).toISOString();
  const hist = await scvPageAllChunked(leadIds, (chunk) =>
    supabase.from("lead_stage_history")
      .select("lead_id, from_stage, to_stage, changed_by, created_at")
      .in("lead_id", chunk).gte("created_at", lookback).lt("created_at", r.end)
      .order("created_at", { ascending: true }),
  );
  // EOI 2 → Fee Paid credited to the mover; only leads of this mode.
  const feeMovesAll = await scvPageAll(() =>
    supabase.from("lead_stage_history")
      .select("lead_id, changed_by")
      .eq("from_stage", "EOI_2").eq("to_stage", "FEE_PAID")
      .in("changed_by", execIds)
      .gte("created_at", r.start).lt("created_at", r.end)
      .order("lead_id", { ascending: true }),
  );
  const feeLeadIds = Array.from(new Set(feeMovesAll.map((m: any) => m.lead_id)));
  const modeOk = new Set<string>();
  for (let i = 0; i < feeLeadIds.length; i += 150) {
    const { data } = await supabase.from("kob_leads").select("id").in("id", feeLeadIds.slice(i, i + 150)).eq("mode", mode);
    for (const d of (data ?? []) as any[]) modeOk.add(d.id);
  }
  // KTN CS: leads assigned to the executive, currently in KTN_CS, entered in the month.
  // Same value for Auto and Manual (not filtered by mode).
  const ktnLeads = await scvPageAll(() =>
    supabase.from("kob_leads")
      .select("id, assigned_to, stage_entered_at")
      .eq("stage", "KTN_CS")
      .in("assigned_to", execIds)
      .gte("stage_entered_at", r.start).lt("stage_entered_at", r.end)
      .order("id", { ascending: true }),
  );
  const ktnCsByExec = new Map<string, Set<string>>();
  // Weekly incentive buckets: days 1–7, 8–14, 15–21, 22–end of month.
  const ktnWeeklyByExec = new Map<string, number[]>();
  const monthStartMs = new Date(r.start).getTime();
  for (const l of ktnLeads as any[]) {
    const wk = Math.min(3, Math.floor((new Date(l.stage_entered_at).getTime() - monthStartMs) / (7 * 86400000)));
    const arr = ktnWeeklyByExec.get(l.assigned_to) ?? [0, 0, 0, 0];
    arr[Math.max(0, wk)]++;
    ktnWeeklyByExec.set(l.assigned_to, arr);
  }
  for (const l of ktnLeads as any[]) {
    (ktnCsByExec.get(l.assigned_to) ?? ktnCsByExec.set(l.assigned_to, new Set()).get(l.assigned_to)!).add(l.id);
  }
  const { data: inputs } = await supabase.from("scv_mode_inputs")
    .select("user_id, ktn_cs_target, discipline, marks")
    .eq("period", r.start.slice(0, 10)).eq("mode", mode).in("user_id", execIds);
  const inputByUser = new Map<string, any>(((inputs ?? []) as any[]).map((i) => [i.user_id, i]));
  const { data: orgTargetRow } = await supabase.from("kpi_targets")
    .select("target_value").eq("metric", "KTN_CS").eq("period", "monthly")
    .lte("effective_from", r.start.slice(0, 10)).order("effective_from", { ascending: false }).limit(1).maybeSingle();
  const orgKtnCsTarget = orgTargetRow?.target_value != null ? Number(orgTargetRow.target_value) : null;

  const leadsByExec: Record<string, any[]> = {};
  for (const l of leads) (leadsByExec[l.assigned_to] ??= []).push(l);
  const histByLead: Record<string, any[]> = {};
  for (const h of hist as any[]) (histByLead[h.lead_id] ??= []).push(h);

  const startMs = new Date(r.start).getTime();
  const endMs = new Date(r.end).getTime();
  const inMonth = (iso: string) => { const t = new Date(iso).getTime(); return t >= startMs && t < endMs; };
  const clampPct = (n: number) => Math.max(0, Math.min(100, n));
  const tatDefs = cfg.tatMovements.filter((m: any) => m.enabled && TAT_MOVEMENT_DEFS[m.key] && Number(m.days) > 0);

  for (const eid of execIds) {
    const el = leadsByExec[eid] ?? [];
    const input = inputByUser.get(eid);
    const target = input?.ktn_cs_target != null ? Number(input.ktn_cs_target) : orgKtnCsTarget;
    const ktnCs = ktnCsByExec.get(eid)?.size ?? 0;
    const conversionPct = target && target > 0 ? clampPct((ktnCs / target) * 100) : 0;

    let tatSum = 0, tatCount = 0;
    const tatPer = new Map<string, { leads: Set<string>; daysSum: number; n: number; scoreSum: number; rows: any[] }>();
    for (const m of tatDefs) tatPer.set(m.key, { leads: new Set(), daysSum: 0, n: 0, scoreSum: 0, rows: [] });
    const ktnLive = new Set<string>();
    const eoi1Eligible = new Set<string>(), eoi1Moved = new Set<string>();
    const eoi2Eligible = new Set<string>(), eoi2Paid = new Set<string>();
    for (const l of el) {
      const rows = histByLead[l.id] ?? [];
      const seenMove = new Set<string>();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!inMonth(row.created_at)) continue;
        if (row.to_stage === "KTN_LIVE") ktnLive.add(l.id);
        if (row.to_stage === "EOI_1") eoi1Eligible.add(l.id);
        if (row.from_stage === "EOI_1" && row.to_stage === "WEBINAR") { eoi1Eligible.add(l.id); eoi1Moved.add(l.id); }
        if (row.to_stage === "EOI_2") eoi2Eligible.add(l.id);
        if (row.from_stage === "EOI_2" && row.to_stage === "FEE_PAID") {
          eoi2Eligible.add(l.id);
          // Auto: credit the assigned executive, whoever made the move.
          if (mode === "AUTO") eoi2Paid.add(l.id);
        }
        for (const m of tatDefs) {
          const def = TAT_MOVEMENT_DEFS[m.key];
          if (row.to_stage !== def.to || !def.from.includes(row.from_stage)) continue;
          const k = `${m.key}`;
          if (seenMove.has(k)) continue; // unique lead per movement per month
          let enteredMs: number | null = null;
          for (let j = i - 1; j >= 0; j--) if (rows[j].to_stage === row.from_stage) { enteredMs = new Date(rows[j].created_at).getTime(); break; }
          if (enteredMs == null && m.key === "lead_eoi1") enteredMs = new Date(l.created_at).getTime();
          if (enteredMs == null) continue;
          // Lead later returned to this movement's FROM stage → conversion no longer counts.
          let returned = false;
          for (let j = i + 1; j < rows.length; j++) if (def.from.includes(rows[j].to_stage)) { returned = true; break; }
          if (returned) continue;
          seenMove.add(k);
          const actualDays = (new Date(row.created_at).getTime() - enteredMs) / 86400000;
          const moveScore = actualDays <= 0 ? 100 : clampPct((Number(m.days) / actualDays) * 100);
          tatSum += moveScore;
          tatCount++;
          const pm = tatPer.get(m.key)!; pm.leads.add(l.id); pm.daysSum += Math.max(0, actualDays); pm.n++; pm.scoreSum += moveScore;
          pm.rows.push({ leadId: l.id, code: (l as any).code, name: (l as any).full_name, fromAt: new Date(enteredMs).toISOString(), toAt: row.created_at, days: Math.max(0, actualDays) });
        }
      }
    }
    if (mode !== "AUTO") for (const mv of feeMovesAll as any[]) if (mv.changed_by === eid && modeOk.has(mv.lead_id)) eoi2Paid.add(mv.lead_id);
    // TAT weight is split equally across ENABLED movements; an enabled movement with
    // zero conversions earns 0% (stays in the denominator). Disabled ones are excluded.
    const tatAch = new Map<string, number>();
    for (const m of tatDefs) { const pm = tatPer.get(m.key)!; tatAch.set(m.key, pm.n ? pm.scoreSum / pm.n : 0); }
    const tatPct = tatDefs.length ? tatDefs.reduce((s: number, m: any) => s + tatAch.get(m.key)!, 0) / tatDefs.length : 0;
    const eoi1Pct = eoi1Eligible.size ? clampPct((eoi1Moved.size / eoi1Eligible.size) * 100) : 0;
    const eoi2Pct = eoi2Eligible.size ? clampPct((eoi2Paid.size / eoi2Eligible.size) * 100) : 0;
    const disciplinePct = input?.discipline != null ? clampPct(Number(input.discipline)) : 0;
    const marks = (input?.marks ?? {}) as Record<string, number>;

    let points = 0;
    const components = comps.map((c: any) => {
      let pct = 0, detail = "";
      switch (c.type) {
        case "conversion": pct = conversionPct; detail = `KTN CS ${ktnCs} / Target ${target ?? "—"}`; break;
        case "tat": pct = tatPct; detail = `${tatCount} movements measured`; break;
        case "eoi1Webinar": pct = eoi1Pct; detail = `Webinar ${eoi1Moved.size} / EOI 1 ${eoi1Eligible.size}`; break;
        case "eoi2Payment": pct = eoi2Pct; detail = `Fee Paid ${eoi2Paid.size} / EOI 2 ${eoi2Eligible.size}`; break;
        case "discipline": pct = disciplinePct; detail = `Mark ${input?.discipline ?? "—"}`; break;
        default: pct = marks[c.key] != null ? clampPct(Number(marks[c.key])) : 0; detail = `Mark ${marks[c.key] ?? "—"}`;
      }
      const pts = (pct * Number(c.weight)) / 100;
      points += pts;
      const tatBreakdown = c.type === "tat" ? tatDefs.map((m: any) => { const pm = tatPer.get(m.key)!; return { key: m.key, label: m.label ?? m.key, targetDays: Number(m.days), avgDays: pm.n ? Math.round((pm.daysSum / pm.n) * 10) / 10 : null, count: pm.leads.size, rows: pm.rows, achievementPct: Math.round(tatAch.get(m.key)! * 10) / 10, maxPoints: Math.round((Number(c.weight) / tatDefs.length) * 10000) / 10000, earnedPoints: Math.round(((tatAch.get(m.key)! / 100) * (Number(c.weight) / tatDefs.length)) * 100) / 100 }; }) : undefined;
      return { key: c.key, label: c.label, weight: Number(c.weight), pct: Math.round(pct), points: Math.round(pts * 100) / 100, detail, type: c.type, tatBreakdown };
    });
    const finalScore = Math.min(100, Math.round(points));
    const slab = lookupIncentive(incentiveRules, finalScore);
    byExec.set(eid, {
      components, finalScore, slabLabel: slab.label, incentivePct: slab.pct, slabAmount: slab.amount,
      ktnCs, ktnLive: ktnLive.size, ktnCsTarget: target,
      ktnWeekly: ktnWeeklyByExec.get(eid) ?? [0, 0, 0, 0],
      weeklyTarget: target && target > 0 ? target / 4 : null,
      discipline: input?.discipline != null ? Number(input.discipline) : null,
      rawTarget: input?.ktn_cs_target ?? null, marks,
    });
  }
  return { cfg, byExec };
}

/**
 * Controller for getScvModeIncentives.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1993).
 */
export async function getScvModeIncentives(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const supabase = req.supabase ?? supabaseAdmin;
    const userId = req.userId;
    if (!supabase || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const reader = useRds() ? pgClient : (process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : supabase);
    const { data: conf } = await (reader as any).from("kob_configuration").select("default_mode, incentive_amount").eq("id", 1).maybeSingle();
    const activeMode: ScvMode = conf?.default_mode === "MANUAL" ? "MANUAL" : "AUTO";
    const incentiveAmount = Number(conf?.incentive_amount ?? 10000);
    const modeParam = req.query.mode as string | undefined;
    const mode: ScvMode = (modeParam === "AUTO" || modeParam === "MANUAL") ? modeParam : activeMode;
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    const team = await fetchScvRoster(reader as any);
    const { cfg, byExec } = await computeScvModeForExecs(reader as any, team.map((t: any) => t.id), mode, scvMonthRange(month)!);
    const rows = team.map((e: any) => {
      const s = byExec.get(e.id) ?? { components: [], finalScore: 0, slabLabel: "Unrated", incentivePct: 0, ktnCs: 0, ktnLive: 0, ktnCsTarget: null, discipline: null, rawTarget: null, marks: {} };
      const wt = (s as any).weeklyTarget as number | null;
      const weekly: number[] = (s as any).ktnWeekly ?? [0, 0, 0, 0];
      const amount = wt ? weekly.reduce((sum, c) => sum + (c >= wt ? c * incentiveAmount : 0), 0) : 0;
      return { id: e.id, name: e.full_name, ...s, amount: Math.round(amount) };
    });
    const [isMgr, isAdmin, isTL] = useRds()
      ? await Promise.all([
          actorHasRole(getPool(), userId, "kob_manager"),
          actorHasRole(getPool(), userId, "super_admin"),
          actorHasRole(getPool(), userId, "team_leader"),
        ])
      : await Promise.all([
          supabase.rpc("has_role", { _user_id: userId, _role: "kob_manager" }).then((r: any) => r.data),
          supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }).then((r: any) => r.data),
          supabase.rpc("has_role", { _user_id: userId, _role: "team_leader" }).then((r: any) => r.data),
        ]);
    const { data: slabRows } = await (reader as any).from("incentive_rules").select("label, min_score, max_score, incentive_pct, incentive_amount").order("sort_order");
    res.status(200).json({
      mode, activeMode, rows,
      components: cfg.components.filter((c: any) => c.enabled),
      slabs: (slabRows ?? []).map((r: any) => ({ label: r.label, minScore: Number(r.min_score), maxScore: Number(r.max_score), pct: Number(r.incentive_pct), amount: Number(r.incentive_amount) })),
      months: await scvAvailableMonths(useRds() ? pgClient : supabase),
      canEditTargets: !!(isMgr || isAdmin || isTL),
      canEditConfig: !!(isMgr || isAdmin),
    });
  } catch (err) {
    next(err);
  }
}

// ==================================================
// BATCH 9: TL METRICS & UNALLOCATED LEADS
// ==================================================

/**
 * Fetch leads scoped to current user's role (RLS / orgClient).
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1434).
 */
async function fetchScopedLeads(supabase: any, r: DateRangeInput = {}) {
  const cols = "id, code, full_name, phone, stage, mode, language, assigned_to, team_leader_id, brand_id, source_id, state_id, city_id, scv_score, created_at, updated_at, converted_at, last_activity_at, brands(name, code), lead_sources(name, cost_per_lead), india_states(name)";
  const out: any[] = [];
  const PAGE = 1000;
  for (let i = 0; ; i += PAGE) {
    let q = supabase.from("kob_leads").select(cols).order("created_at", { ascending: false });
    q = applyCreatedRange(q, r);
    const { data, error } = await q.range(i, i + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as any[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/**
 * Controller for getTLOverview.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1453).
 */
export async function getTLOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const range = parseDateRange(req);

    if (useRds()) {
      const userId = req.userId;
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      const scope = await resolveLeadScopeOrDeny(userId);
      if (!scope) { res.status(403).json({ error: "Forbidden" }); return; }

      const leads = await analyticsRepo.fetchScopedLeadsRich(scope, range);
      const team = await analyticsRepo.fetchExecRosterScoped(scope, ["id"]);
      const stageCount = (s: string) => leads.filter((l) => l.stage === s).length;
      const allocated = leads.filter((l) => l.assigned_to).length;
      const unallocated = leads.length - allocated;
      const periods = budgetPeriodsForRange(range);
      const spendTargets = await analyticsRepo.getMarketingSpendByPeriods(periods);
      const budgetedTL = budgetedSpendFromTargets(spendTargets, range);
      const totalSpend = budgetedTL ?? leads.reduce((s, l) => s + Number(l.lead_sources?.cost_per_lead ?? 0), 0);

      const ktnLive = stageCount("KTN_LIVE");
      const scvAvg = leads.length ? Math.round(leads.reduce((s, l) => s + (l.scv_score ?? 0), 0) / leads.length) : 0;
      const parked = leads.filter((l) => ["NO_RESPONSE", "LATER", "NO", "RETARGETING"].includes(l.stage)).length;
      const autoLeads = leads.filter((l) => l.mode === "AUTO").length;
      const manualLeads = leads.filter((l) => l.mode === "MANUAL").length;
      const activeStates = await analyticsRepo.countActiveStates();
      const activeCities = await analyticsRepo.countActiveCities();
      const kitchenScope = await analyticsRepo.getKitchenScopeTotalBuggyAsIs();

      res.status(200).json({
        totalAssigned: leads.length,
        allocated, unallocated,
        teamSize: team.length,
        eoi1: stageCount("EOI_1"),
        webinar: stageCount("WEBINAR"),
        eoi2: stageCount("EOI_2"),
        feePaid: stageCount("FEE_PAID"),
        agreement: stageCount("AGREEMENT_SIGNED"),
        ktnCs: stageCount("KTN_CS"),
        ktnLive,
        totalLeads: leads.length,
        totalSpend,
        cpl: leads.length ? Math.round(totalSpend / leads.length) : 0,
        cac: ktnLive ? Math.round(totalSpend / ktnLive) : 0,
        teamScv: scvAvg,
        parked,
        autoLeads,
        manualLeads,
        activeStates: activeStates ?? 0,
        activeCities: activeCities ?? 0,
        kitchenScope,
      });
      return;
    }

    const supabase = req.supabase ?? supabaseAdmin;
    const orgClient = await getOrgReadClient(req);
    const leads = await fetchScopedLeads(orgClient, range);
    const team = await fetchExecRoster(orgClient, "id");
    const stageCount = (s: string) => leads.filter((l: any) => l.stage === s).length;
    const allocated = leads.filter((l: any) => l.assigned_to).length;
    const unallocated = leads.length - allocated;
    const budgetedTL = await budgetedSpendForRange(supabase, range);
    const totalSpend = budgetedTL ?? leads.reduce((s: number, l: any) => s + Number(l.lead_sources?.cost_per_lead ?? 0), 0);

    const ktnLive = stageCount("KTN_LIVE");
    const scvAvg = leads.length ? Math.round(leads.reduce((s: number, l: any) => s + (l.scv_score ?? 0), 0) / leads.length) : 0;
    const parked = leads.filter((l: any) => ["NO_RESPONSE", "LATER", "NO", "RETARGETING"].includes(l.stage)).length;
    const autoLeads = leads.filter((l: any) => l.mode === "AUTO").length;
    const manualLeads = leads.filter((l: any) => l.mode === "MANUAL").length;
    const { count: activeStates } = await supabase.from("india_states").select("*", { count: "exact", head: true }).eq("active", true);
    const { count: activeCities } = await supabase.from("india_cities").select("*", { count: "exact", head: true }).eq("active", true);
    const { data: scope } = await supabase.from("v_city_scope").select("kitchen_scope");
    const kitchenScope = (scope ?? []).reduce((s: number, r: any) => s + Number(r.kitchen_scope ?? 0), 0);
    res.status(200).json({
      totalAssigned: leads.length,
      allocated, unallocated,
      teamSize: team.length,
      eoi1: stageCount("EOI_1"),
      webinar: stageCount("WEBINAR"),
      eoi2: stageCount("EOI_2"),
      feePaid: stageCount("FEE_PAID"),
      agreement: stageCount("AGREEMENT_SIGNED"),
      ktnCs: stageCount("KTN_CS"),
      ktnLive,
      totalLeads: leads.length,
      totalSpend,
      cpl: leads.length ? Math.round(totalSpend / leads.length) : 0,
      cac: ktnLive ? Math.round(totalSpend / ktnLive) : 0,
      teamScv: scvAvg,
      parked,
      autoLeads,
      manualLeads,
      activeStates: activeStates ?? 0,
      activeCities: activeCities ?? 0,
      kitchenScope,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getTLExecutivePerformance.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1501).
 */
export async function getTLExecutivePerformance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const range = parseDateRange(req);

    if (useRds()) {
      const userId = req.userId;
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      const scope = await resolveLeadScopeOrDeny(userId);
      if (!scope) { res.status(403).json({ error: "Forbidden" }); return; }

      const leads = await analyticsRepo.fetchScopedLeadsRich(scope, range);
      const team = await analyticsRepo.fetchExecRosterScoped(scope, ["id", "full_name", "email"]);
      const out = (team as any[]).map((e: any) => {
        const el = leads.filter((l) => l.assigned_to === e.id);
        const c = (s: string) => el.filter((l) => l.stage === s).length;
        const ktnLive = c("KTN_LIVE");
        const langs: Record<string, number> = {};
        el.forEach((l) => { if (l.language) langs[l.language] = (langs[l.language] ?? 0) + 1; });
        const language = Object.entries(langs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
        const now = Date.now();
        const active = el.filter((l) => !["DEAD_LEAD", "KTN_LIVE", "NO"].includes(l.stage));
        const compliant = active.filter((l) => {
          const created = new Date(l.created_at).getTime();
          const last = new Date(l.last_activity_at ?? l.updated_at).getTime();
          return (last - created) <= 48 * 3600 * 1000 || (now - last) <= 48 * 3600 * 1000;
        }).length;
        const tat = active.length ? Math.round((compliant / active.length) * 100) : 100;
        const scv = el.length ? Math.round(el.reduce((s, l) => s + (l.scv_score ?? 0), 0) / el.length) : 0;
        const conv = el.length ? Math.round((ktnLive / el.length) * 100) : 0;
        const incentive = scv >= 70 && ktnLive >= 1 ? "Eligible" : "Not eligible";
        return {
          id: e.id, name: e.full_name, email: e.email, language,
          leads: el.length,
          eoi1: c("EOI_1"), webinar: c("WEBINAR"), eoi2: c("EOI_2"),
          feePaid: c("FEE_PAID"), agreement: c("AGREEMENT_SIGNED"),
          ktnCs: c("KTN_CS"), ktnLive,
          conversion: conv, tat, scv, incentive,
        };
      });
      res.status(200).json(out);
      return;
    }

    const orgClient = await getOrgReadClient(req);
    const leads = await fetchScopedLeads(orgClient, range);
    const team = await fetchExecRoster(orgClient, "id, full_name, email");
    const out = team.map((e: any) => {
      const el = leads.filter((l: any) => l.assigned_to === e.id);
      const c = (s: string) => el.filter((l: any) => l.stage === s).length;
      const ktnLive = c("KTN_LIVE");
      const langs: Record<string, number> = {};
      el.forEach((l: any) => { if (l.language) langs[l.language] = (langs[l.language] ?? 0) + 1; });
      const language = Object.entries(langs).sort((a,b) => b[1]-a[1])[0]?.[0] ?? "—";
      const now = Date.now();
      const active = el.filter((l: any) => !["DEAD_LEAD","KTN_LIVE","NO"].includes(l.stage));
      const compliant = active.filter((l: any) => {
        const created = new Date(l.created_at).getTime();
        const last = new Date(l.last_activity_at ?? l.updated_at).getTime();
        return (last - created) <= 48 * 3600 * 1000 || (now - last) <= 48 * 3600 * 1000;
      }).length;
      const tat = active.length ? Math.round((compliant / active.length) * 100) : 100;
      const scv = el.length ? Math.round(el.reduce((s: number, l: any) => s + (l.scv_score ?? 0), 0) / el.length) : 0;
      const conv = el.length ? Math.round((ktnLive / el.length) * 100) : 0;
      const incentive = scv >= 70 && ktnLive >= 1 ? "Eligible" : "Not eligible";
      return {
        id: e.id, name: e.full_name, email: e.email, language,
        leads: el.length,
        eoi1: c("EOI_1"), webinar: c("WEBINAR"), eoi2: c("EOI_2"),
        feePaid: c("FEE_PAID"), agreement: c("AGREEMENT_SIGNED"),
        ktnCs: c("KTN_CS"), ktnLive,
        conversion: conv, tat, scv, incentive,
      };
    });
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getTLBrandPerformance.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1541).
 */
export async function getTLBrandPerformance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const range = parseDateRange(req);

    if (useRds()) {
      const userId = req.userId;
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      const scope = await resolveLeadScopeOrDeny(userId);
      if (!scope) { res.status(403).json({ error: "Forbidden" }); return; }

      const leads = await analyticsRepo.fetchScopedLeadsRich(scope, range);
      const bmap: Record<string, any> = {};
      for (const l of leads) {
        const b = l.brands?.name ?? "Unassigned";
        if (!bmap[b]) bmap[b] = { brand: b, leads: 0, eoi1: 0, webinar: 0, eoi2: 0, feePaid: 0, agreement: 0, ktnCs: 0, ktnLive: 0, spend: 0 };
        bmap[b].leads++;
        bmap[b].spend += Number(l.lead_sources?.cost_per_lead ?? 0);
        if (l.stage === "EOI_1") bmap[b].eoi1++;
        if (l.stage === "WEBINAR") bmap[b].webinar++;
        if (l.stage === "EOI_2") bmap[b].eoi2++;
        if (l.stage === "FEE_PAID") bmap[b].feePaid++;
        if (l.stage === "AGREEMENT_SIGNED") bmap[b].agreement++;
        if (l.stage === "KTN_CS") bmap[b].ktnCs++;
        if (l.stage === "KTN_LIVE") bmap[b].ktnLive++;
      }
      const out = Object.values(bmap).map((b: any) => ({
        ...b,
        cac: b.ktnLive ? Math.round(b.spend / b.ktnLive) : 0,
        conversion: b.leads ? Math.round((b.ktnLive / b.leads) * 100) : 0,
      }));
      res.status(200).json(out);
      return;
    }

    const orgClient = await getOrgReadClient(req);
    const leads = await fetchScopedLeads(orgClient, range);
    const bmap: Record<string, any> = {};
    for (const l of leads as any[]) {
      const b = l.brands?.name ?? "Unassigned";
      if (!bmap[b]) bmap[b] = { brand: b, leads: 0, eoi1: 0, webinar: 0, eoi2: 0, feePaid: 0, agreement: 0, ktnCs: 0, ktnLive: 0, spend: 0 };
      bmap[b].leads++;
      bmap[b].spend += Number(l.lead_sources?.cost_per_lead ?? 0);
      if (l.stage === "EOI_1") bmap[b].eoi1++;
      if (l.stage === "WEBINAR") bmap[b].webinar++;
      if (l.stage === "EOI_2") bmap[b].eoi2++;
      if (l.stage === "FEE_PAID") bmap[b].feePaid++;
      if (l.stage === "AGREEMENT_SIGNED") bmap[b].agreement++;
      if (l.stage === "KTN_CS") bmap[b].ktnCs++;
      if (l.stage === "KTN_LIVE") bmap[b].ktnLive++;
    }
    const out = Object.values(bmap).map((b: any) => ({
      ...b,
      cac: b.ktnLive ? Math.round(b.spend / b.ktnLive) : 0,
      conversion: b.leads ? Math.round((b.ktnLive / b.leads) * 100) : 0,
    }));
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getTLLanguagePerformance.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1568).
 */
export async function getTLLanguagePerformance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const range = parseDateRange(req);

    if (useRds()) {
      const userId = req.userId;
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      const scope = await resolveLeadScopeOrDeny(userId);
      if (!scope) { res.status(403).json({ error: "Forbidden" }); return; }

      const leads = await analyticsRepo.fetchScopedLeadsRich(scope, range);
      const team = await analyticsRepo.fetchExecRosterScoped(scope, ["id", "full_name"]) as any[];
      const lmap: Record<string, any> = {};
      for (const l of leads) {
        const lang = l.language ?? "Others";
        if (!lmap[lang]) lmap[lang] = { language: lang, leads: 0, execs: new Set(), eoi1: 0, webinar: 0, eoi2: 0, ktnCs: 0, ktnLive: 0, tatSum: 0, tatN: 0 };
        lmap[lang].leads++;
        if (l.assigned_to) lmap[lang].execs.add(l.assigned_to);
        if (l.stage === "EOI_1") lmap[lang].eoi1++;
        if (l.stage === "WEBINAR") lmap[lang].webinar++;
        if (l.stage === "EOI_2") lmap[lang].eoi2++;
        if (l.stage === "KTN_CS") lmap[lang].ktnCs++;
        if (l.stage === "KTN_LIVE") lmap[lang].ktnLive++;
        const t = new Date(l.last_activity_at ?? l.updated_at).getTime() - new Date(l.created_at).getTime();
        lmap[lang].tatSum += t; lmap[lang].tatN++;
      }
      const out = Object.values(lmap).map((v: any) => ({
        language: v.language, leads: v.leads,
        executives: [...v.execs].map((id: any) => team.find((t: any) => t.id === id)?.full_name).filter(Boolean).join(", "),
        execCount: v.execs.size,
        eoi1: v.eoi1, webinar: v.webinar, eoi2: v.eoi2, ktnCs: v.ktnCs, ktnLive: v.ktnLive,
        tatHours: v.tatN ? Math.round(v.tatSum / v.tatN / 3600000) : 0,
        conversion: v.leads ? Math.round((v.ktnLive / v.leads) * 100) : 0,
      }));
      res.status(200).json(out);
      return;
    }

    const orgClient = await getOrgReadClient(req);
    const leads = await fetchScopedLeads(orgClient, range);
    const team = await fetchExecRoster(orgClient, "id, full_name");
    const lmap: Record<string, any> = {};
    for (const l of leads as any[]) {
      const lang = l.language ?? "Others";
      if (!lmap[lang]) lmap[lang] = { language: lang, leads: 0, execs: new Set(), eoi1: 0, webinar: 0, eoi2: 0, ktnCs: 0, ktnLive: 0, tatSum: 0, tatN: 0 };
      lmap[lang].leads++;
      if (l.assigned_to) lmap[lang].execs.add(l.assigned_to);
      if (l.stage === "EOI_1") lmap[lang].eoi1++;
      if (l.stage === "WEBINAR") lmap[lang].webinar++;
      if (l.stage === "EOI_2") lmap[lang].eoi2++;
      if (l.stage === "KTN_CS") lmap[lang].ktnCs++;
      if (l.stage === "KTN_LIVE") lmap[lang].ktnLive++;
      const t = new Date(l.last_activity_at ?? l.updated_at).getTime() - new Date(l.created_at).getTime();
      lmap[lang].tatSum += t; lmap[lang].tatN++;
    }
    const out = Object.values(lmap).map((v: any) => ({
      language: v.language, leads: v.leads,
      executives: [...v.execs].map((id: any) => team.find((t: any) => t.id === id)?.full_name).filter(Boolean).join(", "),
      execCount: v.execs.size,
      eoi1: v.eoi1, webinar: v.webinar, eoi2: v.eoi2, ktnCs: v.ktnCs, ktnLive: v.ktnLive,
      tatHours: v.tatN ? Math.round(v.tatSum / v.tatN / 3600000) : 0,
      conversion: v.leads ? Math.round((v.ktnLive / v.leads) * 100) : 0,
    }));
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getTLTATBreach.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1600).
 */
export async function getTLTATBreach(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      const userId = req.userId;
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      const scope = await resolveLeadScopeOrDeny(userId);
      if (!scope) { res.status(403).json({ error: "Forbidden" }); return; }

      const leads = await analyticsRepo.fetchScopedLeadsRich(scope);
      const leadIds = leads.map((l) => l.id);
      if (!leadIds.length) {
        res.status(200).json({ transitions: [], firstContact: [] });
        return;
      }
      const hist = await analyticsRepo.getLeadStageHistoryByLeadIds(leadIds);
      const acts = await analyticsRepo.getLeadActivitiesByLeadIds(leadIds);

      const SLA_HOURS: Record<string, number> = {
        "LEAD_INBOX->EOI_1": 24, "EOI_1->WEBINAR": 72, "WEBINAR->EOI_2": 48,
        "EOI_2->FEE_PAID": 96, "FEE_PAID->AGREEMENT_SIGNED": 72,
        "AGREEMENT_SIGNED->KTN_CS": 168, "KTN_CS->KTN_LIVE": 336,
      };
      const byLead: Record<string, any[]> = {};
      for (const h of hist) (byLead[h.lead_id] ??= []).push(h);
      const transitions: any[] = [];
      for (const l of leads) {
        const rows = byLead[l.id] ?? [];
        for (const r of rows) {
          const key = `${r.from_stage ?? "NEW"}->${r.to_stage}`;
          const sla = SLA_HOURS[key];
          if (!sla) continue;
          const prev = rows.filter((x) => new Date(x.changed_at) < new Date(r.changed_at)).slice(-1)[0];
          const start = prev ? new Date(prev.changed_at) : new Date(l.created_at);
          const elapsedH = (new Date(r.changed_at).getTime() - start.getTime()) / 3600000;
          if (elapsedH > sla) {
            transitions.push({
              lead: l.code, name: l.full_name, transition: key.replace(/_/g, " "),
              slaHours: sla, elapsedHours: Math.round(elapsedH), breach: Math.round(elapsedH - sla),
            });
          }
        }
      }
      const actsByLead: Record<string, any[]> = {};
      for (const a of acts) (actsByLead[a.lead_id] ??= []).push(a);
      const firstContact: any[] = [];
      for (const l of leads) {
        const first = actsByLead[l.id]?.[0];
        const elapsed = ((first ? new Date(first.created_at) : new Date()).getTime() - new Date(l.created_at).getTime()) / 3600000;
        if (elapsed > 24) firstContact.push({ lead: l.code, name: l.full_name, elapsedHours: Math.round(elapsed), contacted: !!first });
      }
      res.status(200).json({
        transitions: transitions.slice(0, 100),
        firstContact: firstContact.slice(0, 100),
      });
      return;
    }

    const supabase = req.supabase ?? supabaseAdmin;
    const orgClient = await getOrgReadClient(req);
    const leads = await fetchScopedLeads(orgClient);
    const leadIds = leads.map((l: any) => l.id);
    if (!leadIds.length) {
      res.status(200).json({ transitions: [], firstContact: [] });
      return;
    }
    const hist: any[] = [];
    for (let i = 0; i < leadIds.length; i += 150) {
      const chunk = leadIds.slice(i, i + 150);
      const { data: h } = await supabase.from("lead_stage_history").select("lead_id, from_stage, to_stage, changed_at").in("lead_id", chunk).order("changed_at");
      if (h) hist.push(...h);
    }
    const acts: any[] = [];
    for (let i = 0; i < leadIds.length; i += 150) {
      const chunk = leadIds.slice(i, i + 150);
      const { data: a } = await supabase.from("lead_activities").select("lead_id, created_at").in("lead_id", chunk).order("created_at");
      if (a) acts.push(...a);
    }

    const SLA_HOURS: Record<string, number> = {
      "LEAD_INBOX->EOI_1": 24, "EOI_1->WEBINAR": 72, "WEBINAR->EOI_2": 48,
      "EOI_2->FEE_PAID": 96, "FEE_PAID->AGREEMENT_SIGNED": 72,
      "AGREEMENT_SIGNED->KTN_CS": 168, "KTN_CS->KTN_LIVE": 336,
    };
    const byLead: Record<string, any[]> = {};
    for (const h of hist ?? []) {
      (byLead[(h as any).lead_id] ??= []).push(h);
    }
    const transitions: any[] = [];
    for (const l of leads as any[]) {
      const rows = byLead[l.id] ?? [];
      for (const r of rows) {
        const key = `${r.from_stage ?? "NEW"}->${r.to_stage}`;
        const sla = SLA_HOURS[key];
        if (!sla) continue;
        const prev = rows.filter((x: any) => new Date(x.changed_at) < new Date(r.changed_at)).slice(-1)[0];
        const start = prev ? new Date(prev.changed_at) : new Date(l.created_at);
        const elapsedH = (new Date(r.changed_at).getTime() - start.getTime()) / 3600000;
        if (elapsedH > sla) {
          transitions.push({
            lead: l.code, name: l.full_name, transition: key.replace(/_/g, " "),
            slaHours: sla, elapsedHours: Math.round(elapsedH), breach: Math.round(elapsedH - sla),
          });
        }
      }
    }
    const actsByLead: Record<string, any[]> = {};
    for (const a of acts ?? []) (actsByLead[(a as any).lead_id] ??= []).push(a);
    const firstContact: any[] = [];
    for (const l of leads as any[]) {
      const first = actsByLead[l.id]?.[0];
      const elapsed = ((first ? new Date(first.created_at) : new Date()).getTime() - new Date(l.created_at).getTime()) / 3600000;
      if (elapsed > 24) firstContact.push({ lead: l.code, name: l.full_name, elapsedHours: Math.round(elapsed), contacted: !!first });
    }
    res.status(200).json({
      transitions: transitions.slice(0, 100),
      firstContact: firstContact.slice(0, 100),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getTLRetargeting.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1655).
 */
export async function getTLRetargeting(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      const userId = req.userId;
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      const scope = await resolveLeadScopeOrDeny(userId);
      if (!scope) { res.status(403).json({ error: "Forbidden" }); return; }

      const leads = await analyticsRepo.fetchScopedLeadsRich(scope);
      const leadIds = leads.map((l) => l.id);
      if (!leadIds.length) {
        res.status(200).json([]);
        return;
      }
      const schedule = await analyticsRepo.getRetargetingScheduleByLeadIds(leadIds);
      const map = new Map(leads.map((l) => [l.id, l]));
      res.status(200).json(schedule.map((r: any) => ({ ...r, lead: map.get(r.lead_id) })));
      return;
    }

    const supabase = req.supabase ?? supabaseAdmin;
    const orgClient = await getOrgReadClient(req);
    const leads = await fetchScopedLeads(orgClient);
    const leadIds = leads.map((l: any) => l.id);
    if (!leadIds.length) {
      res.status(200).json([]);
      return;
    }
    const schedule: any[] = [];
    for (let i = 0; i < leadIds.length; i += 150) {
      const chunk = leadIds.slice(i, i + 150);
      const { data, error } = await supabase.from("retargeting_schedule").select("*").in("lead_id", chunk).order("next_touch_at");
      if (error) throw error;
      if (data) schedule.push(...data);
    }
    const map = new Map((leads as any[]).map((l: any) => [l.id, l]));
    res.status(200).json(schedule.map((r: any) => ({ ...r, lead: map.get(r.lead_id) })));
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getTLScvIncentives.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1668).
 */
export async function getTLScvIncentives(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const supabase = req.supabase ?? supabaseAdmin;
    const userId = req.userId;
    if (!supabase || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const scvReader = useRds() ? pgClient : (process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : supabase);
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    const { data: execRoles } = await scvReader.from("user_roles").select("user_id").eq("role", "executive");
    const execSet = new Set((execRoles ?? []).map((r: any) => r.user_id));
    const team = (await fetchScvRoster(scvReader as any)).filter((e: any) => execSet.has(e.id));
    const execIds = team.map((t: any) => t.id);
    const { byExec, weights } = await computeScvForExecs(scvReader as any, execIds, scvMonthRange(month));
    const BASE_INCENTIVE = 10000;
    const rows = team.map((e: any) => {
      const s = byExec.get(e.id) ?? {
        conversionPct: 0, tatPct: 0, eoi2Pct: 0, crmPct: 0,
        finalScore: 0, slabLabel: "Unrated", incentivePct: 0,
        ktnCs: 0, ktnLive: 0, ktnCsTarget: null, crmInput: null,
      };
      const amount = Math.round(BASE_INCENTIVE * (s.incentivePct / 100));
      return {
        id: e.id, name: e.full_name,
        scvScore: s.finalScore,
        conversionScore: s.conversionPct,
        tatScore: s.tatPct,
        eoi2Score: s.eoi2Pct,
        crmScore: s.crmPct,
        ktnCsTarget: s.ktnCsTarget, crmInput: s.crmInput,
        ktnCs: s.ktnCs, ktnLive: s.ktnLive,
        slab: s.slabLabel, incentivePct: s.incentivePct, amount,
        breakdown: {
          tatPass: s.tatPass ?? 0, tatFail: s.tatFail ?? 0, tatCycles: s.tatCycles ?? 0,
          eoi2Eligible: s.eoi2EligibleCount ?? 0, feePaid: s.feePaid ?? 0,
          conversionPoints: s.conversionPoints ?? 0, tatPoints: s.tatPoints ?? 0,
          eoi2Points: s.eoi2Points ?? 0, crmPoints: s.crmPoints ?? 0,
        },
      };
    });
    const [isMgr, isAdmin, isTL] = useRds()
      ? await Promise.all([
          actorHasRole(getPool(), userId, "kob_manager"),
          actorHasRole(getPool(), userId, "super_admin"),
          actorHasRole(getPool(), userId, "team_leader"),
        ])
      : await Promise.all([
          supabase.rpc("has_role", { _user_id: userId, _role: "kob_manager" }).then((r: any) => r.data),
          supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }).then((r: any) => r.data),
          supabase.rpc("has_role", { _user_id: userId, _role: "team_leader" }).then((r: any) => r.data),
        ]);
    res.status(200).json({
      rows,
      months: await scvAvailableMonths(scvReader as any),
      canEdit: !!(isMgr || isAdmin || isTL),
      canEditTargets: !!(isMgr || isAdmin || isTL),
      weights,
      canEditWeights: !!(isMgr || isAdmin),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getUnallocatedLeads.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2181).
 */
export async function getUnallocatedLeads(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized" }); return; }
      const scope = await resolveLeadScopeOrDeny(req.userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      res.status(200).json(await funnelRepo.getUnallocatedLeadsRaw(scope));
      return;
    }

    const client = await getOrgReadClient(req);
    const PAGE = 1000;
    const out: any[] = [];
    for (let page = 0; ; page++) {
      const { data, error } = await client
        .from("kob_leads")
        .select("id, code, full_name, phone, stage, mode, language, assigned_to, created_at, brands(name), india_states(name), india_cities(name), lead_sources(name)")
        .is("assigned_to", null)
        .order("created_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listActiveExecutives.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 3192).
 */
export async function listActiveExecutives(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = await getOrgReadClient(req);
    const { data: roles, error: rErr } = await db.from("user_roles").select("user_id, role").eq("role", "executive");
    if (rErr) throw rErr;
    const execIds = (roles ?? []).map((r: any) => r.user_id);
    if (!execIds.length) {
      res.status(200).json([]);
      return;
    }
    const { data: profilesRaw, error: pErr } = await db
      .from("profiles")
      .select("id, full_name, assignment_active")
      .in("id", execIds)
      .order("full_name", { ascending: true });
    if (pErr) throw pErr;
    const out = ((profilesRaw ?? []) as any[])
      .filter((p) => p.assignment_active !== false)
      .map((p) => ({ id: p.id, full_name: p.full_name }));
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listAllExecutives.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2850).
 */
export async function listAllExecutives(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const supabase = req.supabase ?? supabaseAdmin;
    const { data: roles, error: rErr } = await supabase.from("user_roles").select("user_id, role").eq("role", "executive");
    if (rErr) throw rErr;
    const execIds = (roles ?? []).map((r: any) => r.user_id);
    if (execIds.length === 0) {
      res.status(200).json([]);
      return;
    }
    const { data: profsRaw, error: pErr } = await supabase
      .from("profiles")
      .select("id, full_name, email, team_leader_id, primary_language, secondary_language, assignment_active")
      .in("id", execIds);
    if (pErr) throw pErr;

    const { data: leads, error: lErr } = await supabase
      .from("kob_leads")
      .select("assigned_to, language")
      .in("assigned_to", execIds);
    if (lErr) throw lErr;

    const langByExec: Record<string, Record<string, number>> = {};
    for (const l of leads ?? []) {
      const a = (l as any).assigned_to as string;
      const lang = (l as any).language as string | null;
      if (!a || !lang) continue;
      (langByExec[a] ??= {})[lang] = (langByExec[a]?.[lang] ?? 0) + 1;
    }
    const out = (profsRaw ?? []).map((p: any) => {
      const langs = Object.entries(langByExec[p.id] ?? {}).sort((a, b) => b[1] - a[1]);
      return {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        team_leader_id: p.team_leader_id,
        primary_language: (p as any).primary_language ?? langs[0]?.[0] ?? null,
        secondary_language: (p as any).secondary_language ?? null,
        languages: langs.map(([l]) => l),
        assignment_active: p.assignment_active !== false,
      };
    });
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listAllocatableExecutives.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2811).
 */
export async function listAllocatableExecutives(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const supabase = req.supabase ?? supabaseAdmin;
    const { data: roles, error: rErr } = await supabase.from("user_roles").select("user_id, role").eq("role", "executive");
    if (rErr) throw rErr;
    const execIds = (roles ?? []).map((r: any) => r.user_id);
    if (execIds.length === 0) {
      res.status(200).json([]);
      return;
    }
    const { data: profsRaw, error: pErr } = await supabase
      .from("profiles")
      .select("id, full_name, email, team_leader_id, primary_language, secondary_language, assignment_active")
      .in("id", execIds);
    if (pErr) throw pErr;
    const profs = (profsRaw ?? []).filter((p: any) => p.assignment_active !== false);

    const { data: leads, error: lErr } = await supabase
      .from("kob_leads")
      .select("assigned_to, language")
      .in("assigned_to", execIds);
    if (lErr) throw lErr;

    const langByExec: Record<string, Record<string, number>> = {};
    for (const l of leads ?? []) {
      const a = (l as any).assigned_to as string;
      const lang = (l as any).language as string | null;
      if (!a || !lang) continue;
      (langByExec[a] ??= {})[lang] = (langByExec[a]?.[lang] ?? 0) + 1;
    }
    const out = (profs ?? []).map((p: any) => {
      const langs = Object.entries(langByExec[p.id] ?? {}).sort((a, b) => b[1] - a[1]);
      return {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        team_leader_id: p.team_leader_id,
        primary_language: (p as any).primary_language ?? langs[0]?.[0] ?? null,
        secondary_language: (p as any).secondary_language ?? null,
        languages: langs.map(([l]) => l),
      };
    });
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listExecutivesWithStats.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2508).
 */
export async function listExecutivesWithStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = await getOrgReadClient(req);
    const { data: roles, error: rErr } = await db.from("user_roles").select("user_id, role");
    if (rErr) throw rErr;
    const execIds = (roles ?? []).filter((r: any) => r.role === "executive").map((r: any) => r.user_id);
    if (!execIds.length) {
      res.status(200).json([]);
      return;
    }
    const { data: profilesRaw, error: pErr } = await db
      .from("profiles")
      .select("id, full_name, email, team_leader_id, assignment_active")
      .in("id", execIds);
    if (pErr) throw pErr;
    const profiles = (profilesRaw ?? []).filter((p: any) => p.assignment_active !== false);

    const tlIds = Array.from(new Set((profiles ?? []).map((p: any) => p.team_leader_id).filter(Boolean)));
    const { data: tls, error: tlErr } = tlIds.length
      ? await db.from("profiles").select("id, full_name").in("id", tlIds)
      : { data: [] as any[], error: null };
    if (tlErr) throw tlErr;
    const tlName = new Map((tls ?? []).map((t: any) => [t.id, t.full_name]));
    const scopedExecIds = (profiles ?? []).map((p: any) => p.id);

    const leads: any[] = [];
    if (scopedExecIds.length) {
      const PAGE = 1000;
      for (let i = 0; ; i += PAGE) {
        const { data, error } = await db
          .from("kob_leads")
          .select("id, assigned_to, stage")
          .in("assigned_to", scopedExecIds)
          .order("id", { ascending: true })
          .range(i, i + PAGE - 1);
        if (error) throw new Error(error.message);
        const page = (data ?? []) as any[];
        leads.push(...page);
        if (page.length < PAGE) break;
      }
    }
    const byExec: Record<string, Map<string, any>> = {};
    for (const l of leads) {
      const bag = (byExec[(l as any).assigned_to] ??= new Map());
      bag.set((l as any).id, l);
    }
    const out = (profiles ?? []).map((p: any) => {
      const el = Array.from((byExec[p.id] ?? new Map()).values());
      const c = (s: string) => el.filter((l: any) => l.stage === s).length;
      const ktnLive = c("KTN_LIVE");

      return {
        id: p.id,
        name: p.full_name,
        email: p.email,
        teamLeaderId: p.team_leader_id,
        teamLeaderName: p.team_leader_id ? (tlName.get(p.team_leader_id) ?? "—") : "—",
        leads: el.length,
        eoi1: c("EOI_1"), webinar: c("WEBINAR"), eoi2: c("EOI_2"),
        feePaid: c("FEE_PAID"), agreement: c("AGREEMENT_SIGNED"),
        ktnCs: c("KTN_CS"), ktnLive,
        conversion: el.length ? Math.round((ktnLive / el.length) * 100) : 0,
      };
    });
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getLeadDetail.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 630).
 * Queries:
 * - kob_leads with joins: brands, india_states, india_cities, lead_sources.
 * - lead_stage_history ordered by created_at asc.
 * - lead_activities ordered by created_at asc.
 * - profiles for actors, assigned_to, team_leader_id.
 * Preserves exact error message on not found: "Lead not found (id=...)"
 */
export async function getLeadDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const leadId = (typeof req.query.leadId === "string" ? req.query.leadId : undefined)
      ?? (typeof req.query.lead_id === "string" ? req.query.lead_id : undefined);

    if (!leadId) {
      res.status(400).json({ error: "leadId is required" });
      return;
    }

    if (useRds()) {
      if (!req.userId) {
        res.status(500).json({ error: "Database client not initialized on request" });
        return;
      }
      // STAGE 10E1 SECURITY FIX: the Supabase path below always uses the
      // service-role client with NO ownership check (Stage 10A gap). Here,
      // scope is resolved server-side and enforced in the SQL WHERE clause
      // (see lead.repository.ts#getLeadById) — an inaccessible lead comes
      // back as "no row", collapsing into the SAME 404 as "doesn't exist",
      // so this endpoint never reveals whether another user's lead exists.
      const scope = await resolveLeadScopeOrDeny(req.userId);
      if (scope === null) {
        res.status(403).json({ error: "Forbidden: no role assigned" });
        return;
      }

      let lead;
      try {
        lead = await leadRepo.getLeadById(leadId, scope);
      } catch (e: any) {
        res.status(500).json({ error: `Lead fetch failed: ${e?.message ?? "unknown error"}` });
        return;
      }
      if (!lead) {
        res.status(404).json({ error: `Lead not found (id=${leadId})` });
        return;
      }

      const [history, activities] = await Promise.all([
        leadRepo.getLeadStageHistory(leadId),
        leadRepo.getLeadActivities(leadId),
      ]);

      const actorIds = Array.from(new Set([
        ...history.map((h) => h.changed_by).filter((x): x is string => Boolean(x)),
        ...activities.map((a) => a.actor_id).filter((x): x is string => Boolean(x)),
      ]));
      const profileIds = Array.from(new Set([
        ...actorIds,
        lead.assigned_to,
        lead.team_leader_id,
      ].filter((x): x is string => Boolean(x))));

      const profiles = await leadRepo.getProfilesByIds(profileIds);
      const actors: Record<string, string> = {};
      const people: Record<string, { full_name: string; email: string | null }> = {};
      for (const p of profiles) {
        actors[p.id] = p.full_name;
        people[p.id] = { full_name: p.full_name, email: p.email };
      }

      res.status(200).json({ lead, history, activities, actors, people });
      return;
    }

    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
    if (!db) {
      res.status(500).json({ error: "Database client not initialized on request" });
      return;
    }

    const { data: lead, error } = await db
      .from("kob_leads")
      .select("*, brands(name, code), india_states(name, code), india_cities(name, tier), lead_sources(name, category)")
      .eq("id", leadId)
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: `Lead fetch failed: ${error.message}` });
      return;
    }
    if (!lead) {
      res.status(404).json({ error: `Lead not found (id=${leadId})` });
      return;
    }

    const { data: history, error: hErr } = await db
      .from("lead_stage_history")
      .select("id, from_stage, to_stage, created_at, changed_by, note")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });
    if (hErr) {
      res.status(500).json({ error: hErr.message });
      return;
    }

    const { data: activities, error: aErr } = await db
      .from("lead_activities")
      .select("id, activity_type, detail, created_at, actor_id")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });
    if (aErr) {
      res.status(500).json({ error: aErr.message });
      return;
    }

    const actorIds = Array.from(new Set([
      ...(history ?? []).map((h: any) => h.changed_by).filter(Boolean),
      ...(activities ?? []).map((a: any) => a.actor_id).filter(Boolean),
    ]));
    const profileIds = Array.from(new Set([
      ...actorIds,
      (lead as any).assigned_to,
      (lead as any).team_leader_id,
    ].filter(Boolean)));

    let actors: Record<string, string> = {};
    let people: Record<string, { full_name: string; email: string | null }> = {};
    if (profileIds.length) {
      for (let i = 0; i < profileIds.length; i += 150) {
        const chunk = profileIds.slice(i, i + 150);
        const { data: profs, error: pErr } = await db
          .from("profiles")
          .select("id, full_name, email")
          .in("id", chunk as string[]);
        if (pErr) {
          res.status(500).json({ error: pErr.message });
          return;
        }
        for (const p of (profs ?? []) as any[]) {
          actors[p.id] = p.full_name;
          people[p.id] = { full_name: p.full_name, email: p.email };
        }
      }
    }

    res.status(200).json({
      lead,
      history: history ?? [],
      activities: activities ?? [],
      actors,
      people,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getMyExecOverview.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2347).
 * Scoped to req.user.id.
 */
export async function getMyExecOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const userId = req.userId;
    const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : undefined;

    let q = req.supabase
      .from("kob_leads")
      .select("id, code, full_name, stage, last_activity_at, updated_at, created_at, assigned_to")
      .eq("assigned_to", userId);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    const { data: leads, error } = await q;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const rows = leads ?? [];

    const stageCounts: Record<string, number> = {};
    for (const l of rows) stageCounts[(l as any).stage] = (stageCounts[(l as any).stage] ?? 0) + 1;

    const TAT_HOURS = 48;
    const now = Date.now();
    const tatAlerts = rows
      .map((l: any) => {
        const last = new Date(l.last_activity_at ?? l.updated_at ?? l.created_at).getTime();
        const hours = Math.round((now - last) / 3600000);
        return { id: l.id, code: l.code, full_name: l.full_name, stage: l.stage, hours };
      })
      .filter((r) => r.hours > TAT_HOURS)
      .sort((a, b) => b.hours - a.hours);

    const leadIds = rows.map((l: any) => l.id);
    let dueToday: any[] = [];
    if (leadIds.length) {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      for (let i = 0; i < leadIds.length; i += 150) {
        const chunk = leadIds.slice(i, i + 150);
        const { data: rt } = await (req.supabase as any)
          .from("retargeting_schedule")
          .select("id, lead_id, bucket, next_touch_at, phase, kob_leads(code, full_name)")
          .in("lead_id", chunk)
          .eq("is_dead", false)
          .lte("next_touch_at", today.toISOString())
          .order("next_touch_at", { ascending: true });
        dueToday.push(...(rt ?? []));
      }
      dueToday.sort((a, b) => new Date(a.next_touch_at).getTime() - new Date(b.next_touch_at).getTime());
    }

    const reached: Record<string, Set<string>> = { WEBINAR: new Set(), EOI_2: new Set(), KTN_CS: new Set() };
    for (const l of rows as any[]) {
      if (reached[l.stage]) reached[l.stage].add(l.id);
    }
    let webinarAttended = 0;
    if (leadIds.length) {
      for (let i = 0; i < leadIds.length; i += 150) {
        const chunk = leadIds.slice(i, i + 150);
        const { data: hist } = await (req.supabase as any)
          .from("lead_stage_history")
          .select("lead_id, to_stage")
          .in("lead_id", chunk)
          .in("to_stage", ["WEBINAR", "EOI_2", "KTN_CS"]);
        for (const h of hist ?? []) reached[h.to_stage]?.add(h.lead_id);

        const { data: att } = await (req.supabase as any)
          .from("webinar_attendance")
          .select("lead_id")
          .in("lead_id", chunk)
          .eq("attended", true);
        webinarAttended += new Set((att ?? []).map((a: any) => a.lead_id)).size;
      }
    }

    res.status(200).json({
      total: rows.length,
      stageCounts,
      tatAlerts,
      tatThreshold: TAT_HOURS,
      dueToday,
      kpis: {
        webinarInvited: reached.WEBINAR.size,
        webinarAttended,
        eoi2: reached.EOI_2.size,
        ktnCs: reached.KTN_CS.size,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getScvModeConfig.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2032).
 */
export async function getScvModeConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = useRds() ? pgClient : req.supabase;
    if (!client) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const mode = (typeof req.query.mode === "string" ? req.query.mode.toUpperCase() : "AUTO") as ScvMode;
    if (mode !== "AUTO" && mode !== "MANUAL") {
      res.status(400).json({ error: "mode must be AUTO or MANUAL" });
      return;
    }

    const cfg = await loadScvModeConfig(client, mode);
    const { data: glob } = await (client as any)
      .from("kob_configuration")
      .select("incentive_amount")
      .eq("id", 1)
      .maybeSingle();

    const { data: history } = await (client as any)
      .from("scv_mode_config_changes")
      .select("id, changed_by, component, previous_value, new_value, changed_at")
      .eq("mode", mode)
      .order("changed_at", { ascending: false })
      .limit(50);

    const ids = Array.from(new Set(((history ?? []) as any[]).map((h) => h.changed_by).filter(Boolean)));
    const names = new Map<string, string>();
    if (ids.length) {
      for (let i = 0; i < ids.length; i += 150) {
        const chunk = ids.slice(i, i + 150);
        const { data: profs } = await (client as any).from("profiles").select("id, full_name").in("id", chunk);
        (profs ?? []).forEach((p: any) => names.set(p.id, p.full_name));
      }
    }

    const { data: slabs } = await (client as any)
      .from("incentive_rules")
      .select("id, label, min_score, max_score, incentive_pct, incentive_amount, sort_order")
      .order("sort_order");

    res.status(200).json({
      ...cfg,
      slabs: slabs ?? [],
      incentiveAmount: Number(glob?.incentive_amount ?? 10000),
      history: ((history ?? []) as any[]).map((h) => ({
        ...h,
        changed_by_name: names.get(h.changed_by) ?? "—",
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getTATBreachDetailed.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2261).
 * Global TAT breach broken down by transition.
 */
export async function getTATBreachDetailed(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const leads = useRds()
      ? await analyticsRepo.getAllLeadsForTatBreach()
      : await (async () => {
          const { data, error: lErr } = await req.supabase!
            .from("kob_leads")
            .select("id, code, full_name, stage, created_at, updated_at, last_activity_at, assigned_to");
          if (lErr) throw lErr;
          return (data ?? []) as any[];
        })();

    const leadIds = leads.map((l: any) => l.id);
    if (!leadIds.length) {
      res.status(200).json({ first: [], transitions: {}, retargeting: [] });
      return;
    }

    const assigneeIds = Array.from(new Set(leads.map((l: any) => l.assigned_to).filter(Boolean))) as string[];
    const execMap = new Map<string, string>();
    if (assigneeIds.length) {
      const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;
      for (let i = 0; i < assigneeIds.length; i += 150) {
        const chunk = assigneeIds.slice(i, i + 150);
        const profs = useRds()
          ? await analyticsRepo.getProfileFullNamesByIds(chunk)
          : (await db!.from("profiles").select("id, full_name").in("id", chunk)).data ?? [];
        for (const p of profs) execMap.set((p as any).id, (p as any).full_name);
      }
    }

    const execName = (l: any) => (l?.assigned_to ? execMap.get(l.assigned_to) ?? "—" : "—");

    const hist = useRds() ? await analyticsRepo.getStageHistoryForLeads(leadIds) : (await req.supabase!.from("lead_stage_history").select("lead_id, from_stage, to_stage, changed_at").in("lead_id", leadIds).order("changed_at")).data ?? [];
    const acts = useRds() ? await analyticsRepo.getActivitiesForLeads(leadIds) : (await req.supabase!.from("lead_activities").select("lead_id, created_at").in("lead_id", leadIds).order("created_at")).data ?? [];
    const rt = useRds() ? await analyticsRepo.getRetargetingScheduleForLeads(leadIds) : (await req.supabase!.from("retargeting_schedule").select("lead_id, next_touch_at, attempts_done, bucket, is_dead").in("lead_id", leadIds)).data ?? [];


    const SLA: Record<string, number> = {
      "LEAD_INBOX->EOI_1": 24, "EOI_1->WEBINAR": 72, "WEBINAR->EOI_2": 48,
      "EOI_2->FEE_PAID": 96, "FEE_PAID->AGREEMENT_SIGNED": 72,
      "AGREEMENT_SIGNED->KTN_CS": 168, "KTN_CS->KTN_LIVE": 336,
    };
    const byLead: Record<string, any[]> = {};
    for (const h of hist ?? []) (byLead[(h as any).lead_id] ??= []).push(h);
    const leadMap = new Map((leads ?? []).map((l: any) => [l.id, l]));

    const transitions: Record<string, any[]> = {};
    for (const key of Object.keys(SLA)) transitions[key] = [];
    for (const [lid, rows] of Object.entries(byLead)) {
      const l: any = leadMap.get(lid);
      if (!l) continue;
      for (const r of rows) {
        const key = `${r.from_stage ?? "NEW"}->${r.to_stage}`;
        const sla = SLA[key];
        if (!sla) continue;
        const prev = rows.filter((x: any) => new Date(x.changed_at) < new Date(r.changed_at)).slice(-1)[0];
        const start = prev ? new Date(prev.changed_at) : new Date(l.created_at);
        const elapsedH = (new Date(r.changed_at).getTime() - start.getTime()) / 3600000;
        if (elapsedH > sla) {
          transitions[key].push({
            lead: l.code, name: l.full_name, exec_name: execName(l),
            slaHours: sla, elapsedHours: Math.round(elapsedH), breach: Math.round(elapsedH - sla),
          });
        }
      }
    }

    const actsByLead: Record<string, any[]> = {};
    for (const a of acts ?? []) (actsByLead[(a as any).lead_id] ??= []).push(a);
    const first: any[] = [];
    for (const l of leads ?? []) {
      const f = actsByLead[(l as any).id]?.[0];
      const elapsed = ((f ? new Date(f.created_at) : new Date()).getTime() - new Date((l as any).created_at).getTime()) / 3600000;
      if (elapsed > 24) first.push({ lead: (l as any).code, name: (l as any).full_name, exec_name: execName(l), elapsedHours: Math.round(elapsed), contacted: !!f });
    }
    const now = Date.now();
    const retargeting = (rt ?? [])
      .filter((r: any) => r.next_touch_at && new Date(r.next_touch_at).getTime() < now && !r.is_dead)
      .map((r: any) => {
        const l: any = leadMap.get(r.lead_id);
        const overdueH = Math.round((now - new Date(r.next_touch_at).getTime()) / 3600000);
        return { lead: l?.code, name: l?.full_name, exec_name: execName(l), bucket: r.bucket, attempts: r.attempts_done, overdueHours: overdueH };
      })
      .slice(0, 100);

    res.status(200).json({ first: first.slice(0, 100), transitions, retargeting });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getMyRole.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 88).
 */
export async function getMyRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId || (!useRds() && !req.supabase)) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }
    if (useRds()) {
      const role = await resolveActorRole(getPool(), req.userId);
      const profile = await referenceRepo.getProfileById(req.userId);
      res.json({ role: role ?? "executive", profile });
      return;
    }
    const { data: role } = await req.supabase!.rpc("get_user_role", { _user_id: req.userId });
    const { data: profile } = await req.supabase!.from("profiles").select("*").eq("id", req.userId).maybeSingle();
    res.json({ role: (role as string | null) ?? "executive", profile });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listGallaboxFireQueue.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2334).
 */
export async function listGallaboxFireQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized" });
      return;
    }
    const { data, error } = await req.supabase
      .from("gallabox_fire_queue")
      .select("id, status, channel, created_at, fired_at, error, lead:kob_leads(code, full_name, language, mode, email), template:gallabox_templates(name, language, email_subject, email_body)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listLeads.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 483).
 */
export async function listLeads(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }

    const stage = typeof req.query.stage === "string" ? req.query.stage : undefined;
    const limit = req.query.limit ? Math.max(1, parseInt(String(req.query.limit), 10) || 200) : 200;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    if (useRds()) {
      // STAGE 10E1: scope is resolved server-side from user_roles — never
      // from any client-supplied field (query/body cannot influence it).
      const scope = await resolveLeadScopeOrDeny(req.userId);
      if (scope === null) {
        res.status(403).json({ error: "Forbidden: no role assigned" });
        return;
      }
      const out = await leadRepo.listLeadRows(scope, { stage, limit, from, to });
      const assigneeIds = Array.from(new Set(out.map((l) => l.assigned_to).filter((x): x is string => Boolean(x))));
      const nameById = await leadRepo.getAssigneeNames(assigneeIds);
      const result = out.map((l) => ({
        ...l,
        assigned_profile: l.assigned_to ? { full_name: nameById.get(l.assigned_to) ?? null } : null,
      }));
      res.json(result);
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }

    const cols =
      "id, code, full_name, phone, stage, mode, language, tags, auto_fired_status, gallabox_template_sent, av_link_sent, form_link_sent, scv_score, investment_capacity, next_action, assigned_to, created_at, last_activity_at, stage_entered_at, last_message, last_message_at, unread_message_count, has_unread_messages, brand_id, state_id, city_id, source_id, brands(name), india_states(name, code), india_cities(name, tier), lead_sources(name)";

    // Non-executive roles must all see identical org-wide numbers, so use the
    // trusted server client for them instead of role-scoped RLS reads.
    const { data: role } = await req.supabase.rpc("get_user_role", { _user_id: req.userId });
    const roleName = (role as string | null) ?? "executive";
    let client: any = req.supabase;
    if (roleName !== "executive" && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      client = supabaseAdmin;
    }

    // PostgREST caps every request at 1000 rows, so page through until the
    // requested limit is reached; otherwise counts silently stop at 1000.
    const PAGE = 1000;
    const out: any[] = [];
    const hasRange = Boolean(from || to);
    // KTN_CS is filtered by the date the lead entered KTN CS, not by created_at.
    const ktnOnly = stage === "KTN_CS";
    const dateCol = ktnOnly ? "stage_entered_at" : "created_at";

    const fetchPaged = async (build: (q: any) => any) => {
      for (let offset = 0; offset < limit; offset += PAGE) {
        const size = Math.min(PAGE, limit - offset);
        const q = build(client.from("kob_leads").select(cols).order("created_at", { ascending: false }));
        const { data: rows, error } = await q.range(offset, offset + size - 1);
        if (error) throw error;
        const page = (rows ?? []) as any[];
        out.push(...page);
        if (page.length < size) break;
      }
    };

    await fetchPaged((q: any) => {
      if (stage) q = q.eq("stage", stage as any);
      // When no stage is requested and a range is applied, KTN_CS rows come
      // from the separate stage-entry-filtered query below.
      else if (hasRange) q = q.neq("stage", "KTN_CS" as any);
      if (from) q = q.gte(dateCol, from);
      if (to) q = q.lte(dateCol, to);
      return q;
    });

    if (!stage && hasRange) {
      await fetchPaged((q: any) => {
        q = q.eq("stage", "KTN_CS" as any);
        if (from) q = q.gte("stage_entered_at", from);
        if (to) q = q.lte("stage_entered_at", to);
        return q;
      });
    }

    // Attach the current assignee's display name (read-only enrichment).
    const assigneeIds = Array.from(new Set(out.map((l) => l.assigned_to).filter(Boolean))) as string[];
    if (assigneeIds.length) {
      const nameById = new Map<string, string>();
      const P = 500;
      for (let i = 0; i < assigneeIds.length; i += P) {
        const { data: profs } = await client
          .from("profiles")
          .select("id, full_name")
          .in("id", assigneeIds.slice(i, i + P));
        for (const p of (profs ?? []) as any[]) nameById.set(p.id, p.full_name);
      }
      for (const l of out) {
        l.assigned_profile = l.assigned_to ? { full_name: nameById.get(l.assigned_to) ?? null } : null;
      }
    } else {
      for (const l of out) l.assigned_profile = null;
    }

    res.json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listWhatsappExecutives.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 3212).
 */
export async function listWhatsappExecutives(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = await getOrgReadClient(req);
    const { data: roles } = await db.from("user_roles").select("user_id, role").eq("role", "executive");
    const execIds = (roles ?? []).map((r: any) => r.user_id);
    if (!execIds.length) {
      res.json([] as Array<{ id: string; full_name: string }>);
      return;
    }
    const { data: profilesRaw } = await db
      .from("profiles")
      .select("id, full_name")
      .in("id", execIds)
      .order("full_name", { ascending: true });
    res.json(((profilesRaw ?? []) as any[]).map((p: any) => ({ id: p.id, full_name: p.full_name })));
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for listWhatsappMessages.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 3230).
 */
export async function listWhatsappMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = await getOrgReadClient(req);
    const limit = req.query.limit ? Math.max(1, parseInt(String(req.query.limit), 10) || 2000) : 2000;
    const unreadOnly = req.query.unreadOnly === "true";

    const PAGE = 1000;
    const out: any[] = [];
    for (let offset = 0; offset < limit; offset += PAGE) {
      const size = Math.min(PAGE, limit - offset);
      let q = client
        .from("kob_leads")
        .select(
          "id, code, full_name, phone, stage, language, assigned_to, last_message, last_message_at, unread_message_count, has_unread_messages",
        )
        .not("last_message", "is", null)
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (unreadOnly) q = q.eq("has_unread_messages", true);
      const { data: rows, error } = await q.range(offset, offset + size - 1);
      if (error) throw error;
      const page = (rows ?? []) as any[];
      out.push(...page);
      if (page.length < size) break;
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for upsertKpiTarget.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 937).
 */
export async function upsertKpiTarget(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }
    const userId = req.userId;

    const { metric, period = "monthly", target_value, effective_from } = req.body ?? {};

    if (!metric || typeof metric !== "string") {
      res.status(400).json({ error: "metric is required" });
      return;
    }

    if (target_value === undefined || target_value === null || isNaN(Number(target_value))) {
      res.status(400).json({ error: "target_value is required" });
      return;
    }

    const eff = effective_from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const payload = {
      metric,
      period,
      target_value: Number(target_value),
      effective_from: eff,
    };

    if (useRds()) {
      const role = await requireRoleOrDeny(userId, ["super_admin", "kob_manager"]);
      if (role === null) { res.status(403).json({ error: "Forbidden: requires super_admin or kob_manager" }); return; }
      await withTransaction(userId, async (client) => {
        await adminRepo.upsertKpiTarget(client, payload);
        await adminRepo.insertAuditLog(client, userId, "kpi_target_update", "kpi_targets", null, payload);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase
      .from("kpi_targets")
      .upsert(payload, { onConflict: "metric,period,effective_from" });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "kpi_target_update", "kpi_targets", null, payload);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for deleteKpiTarget.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 954).
 */
export async function deleteKpiTarget(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }
    const userId = req.userId;

    const id = req.params.id || req.body?.id;
    if (!id || typeof id !== "string") {
      res.status(400).json({ error: "id is required" });
      return;
    }

    if (useRds()) {
      const role = await requireRoleOrDeny(userId, ["super_admin", "kob_manager"]);
      if (role === null) { res.status(403).json({ error: "Forbidden: requires super_admin or kob_manager" }); return; }
      await withTransaction(userId, async (client) => {
        await adminRepo.deleteKpiTarget(client, id);
        await adminRepo.insertAuditLog(client, userId, "kpi_target_delete", "kpi_targets", id, {});
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase
      .from("kpi_targets")
      .delete()
      .eq("id", id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "kpi_target_delete", "kpi_targets", id, {});
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for upsertMarketingTarget.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2786).
 */
export async function upsertMarketingTarget(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }
    const userId = req.userId;

    const { metric, target_value, period: inputPeriod } = req.body ?? {};

    if (!metric || !["SPEND", "LEADS", "CPL", "CAC"].includes(metric)) {
      res.status(400).json({ error: "metric must be SPEND, LEADS, CPL, or CAC" });
      return;
    }

    if (target_value === undefined || target_value === null || isNaN(Number(target_value)) || Number(target_value) < 0) {
      res.status(400).json({ error: "target_value must be a non-negative number" });
      return;
    }

    const period = inputPeriod ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
    const row = { metric, target_value: Number(target_value), period };

    if (useRds()) {
      const role = await requireRoleOrDeny(userId, ["super_admin", "kob_manager"]);
      if (role === null) { res.status(403).json({ error: "Forbidden: requires super_admin or kob_manager" }); return; }
      await withTransaction(userId, async (client) => {
        await adminRepo.upsertMarketingTarget(client, row);
        await adminRepo.insertAuditLog(client, userId, "marketing_target_upsert", "marketing_kpi_targets", null, row);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase
      .from("marketing_kpi_targets")
      .upsert(row, { onConflict: "metric,period" });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "marketing_target_upsert", "marketing_kpi_targets", null, row);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for upsertManualRating.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1371).
 */
export async function upsertManualRating(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }

    const { user_id, period: rawPeriod, personal_score, compliance_score, notes } = req.body ?? {};

    if (!user_id || typeof user_id !== "string") {
      res.status(400).json({ error: "user_id is required" });
      return;
    }

    if (!rawPeriod || typeof rawPeriod !== "string") {
      res.status(400).json({ error: "period is required" });
      return;
    }

    if (personal_score === undefined || personal_score === null || isNaN(Number(personal_score)) || Number(personal_score) < 0 || Number(personal_score) > 100) {
      res.status(400).json({ error: "personal_score must be between 0 and 100" });
      return;
    }

    if (compliance_score !== undefined && compliance_score !== null && (isNaN(Number(compliance_score)) || Number(compliance_score) < 0 || Number(compliance_score) > 100)) {
      res.status(400).json({ error: "compliance_score must be between 0 and 100 or null" });
      return;
    }

    const period = rawPeriod.length === 7 ? `${rawPeriod}-01` : rawPeriod;
    const row = {
      user_id,
      period,
      personal_score: Number(personal_score),
      compliance_score: compliance_score !== undefined && compliance_score !== null ? Number(compliance_score) : null,
      notes: notes ?? null,
      rated_by: req.userId,
      rated_at: new Date().toISOString(),
    };

    const { data: saved, error } = await req.supabase
      .from("scv_manual_ratings")
      .upsert(row as any, { onConflict: "user_id,period" })
      .select()
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "manual_rating_upsert", "scv_manual_ratings", saved?.id ?? null, row);
    res.status(200).json(saved);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for createBrand.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 704).
 */
export async function createBrand(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }
    const userId = req.userId;

    const { code, name, is_shero = true, active = true } = req.body ?? {};

    if (!code || typeof code !== "string" || code.trim().length === 0 || code.trim().length > 16) {
      res.status(400).json({ error: "code must be between 1 and 16 characters" });
      return;
    }

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const payload = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      is_shero: Boolean(is_shero),
      active: Boolean(active),
    };

    if (useRds()) {
      const role = await requireRoleOrDeny(userId, ["super_admin"]);
      if (role === null) { res.status(403).json({ error: "Forbidden: requires super_admin" }); return; }
      const id = await withTransaction(userId, async (client) => {
        const created = await adminRepo.createBrand(client, payload);
        await adminRepo.insertAuditLog(client, userId, "create", "brands", created.id, payload);
        return created.id;
      });
      res.status(200).json({ ok: true, id });
      return;
    }

    const { data: row, error } = await req.supabase
      .from("brands")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "create", "brands", row.id, payload);

    res.status(200).json({ ok: true, id: row.id });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for updateSourceCost.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 805).
 */
export async function updateSourceCost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }
    const userId = req.userId;

    const id = req.params.id || req.body?.id;
    const { cost_per_lead } = req.body ?? {};

    if (!id || typeof id !== "string") {
      res.status(400).json({ error: "id is required and must be a valid UUID" });
      return;
    }

    if (cost_per_lead === undefined || cost_per_lead === null || isNaN(Number(cost_per_lead))) {
      res.status(400).json({ error: "cost_per_lead must be a number" });
      return;
    }

    const costNum = Number(cost_per_lead);

    if (useRds()) {
      const role = await requireRoleOrDeny(userId, ["super_admin", "kob_manager"]);
      if (role === null) { res.status(403).json({ error: "Forbidden: requires super_admin or kob_manager" }); return; }
      await withTransaction(userId, async (client) => {
        await adminRepo.updateSourceCost(client, id, costNum);
        await adminRepo.insertAuditLog(client, userId, "source_cost_update", "lead_sources", id, { cost_per_lead: costNum });
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase
      .from("lead_sources")
      .update({ cost_per_lead: costNum })
      .eq("id", id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "source_cost_update", "lead_sources", id, { cost_per_lead: costNum });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for upsertStateNativeBrand.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 826).
 */
export async function upsertStateNativeBrand(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }
    const userId = req.userId;

    const { state_id, brand_id } = req.body ?? {};

    if (!state_id || typeof state_id !== "string" || !brand_id || typeof brand_id !== "string") {
      res.status(400).json({ error: "state_id and brand_id are required" });
      return;
    }

    if (useRds()) {
      const role = await requireRoleOrDeny(userId, ["super_admin", "kob_manager"]);
      if (role === null) { res.status(403).json({ error: "Forbidden: requires super_admin or kob_manager" }); return; }
      await withTransaction(userId, async (client) => {
        await adminRepo.upsertStateNativeBrand(client, state_id, brand_id);
        await adminRepo.insertAuditLog(client, userId, "native_brand_map", "state_native_brand", state_id, { state_id, brand_id });
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase
      .from("state_native_brand")
      .upsert({ state_id, brand_id }, { onConflict: "state_id" });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "native_brand_map", "state_native_brand", state_id, { state_id, brand_id });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for upsertGallaboxTemplate.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 901).
 * NOTE: Writes local template configuration only. External Gallabox calls = 0.
 */
export async function upsertGallaboxTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }
    const userId = req.userId;

    const {
      id,
      name,
      body,
      language,
      active = true,
      category = "ONBOARDING",
      bucket,
      email_subject,
      email_body,
    } = req.body ?? {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    if (!body || typeof body !== "string" || body.trim().length === 0) {
      res.status(400).json({ error: "body is required" });
      return;
    }

    if (!language || typeof language !== "string") {
      res.status(400).json({ error: "language is required" });
      return;
    }

    const validCategories = ["ONBOARDING", "RETARGETING", "WEBINAR_DEFAULTER"];
    if (!validCategories.includes(category)) {
      res.status(400).json({ error: `category must be one of: ${validCategories.join(", ")}` });
      return;
    }

    if (category === "RETARGETING" && !bucket) {
      res.status(400).json({ error: "Bucket required for RETARGETING templates" });
      return;
    }

    if (bucket && !["NO", "LATER", "NO_RESPONSE"].includes(bucket)) {
      res.status(400).json({ error: "bucket must be NO, LATER, or NO_RESPONSE" });
      return;
    }

    const norm = (s?: string | null) => (s && s.trim().length ? s.trim() : null);
    const payload: any = {
      name: name.trim(),
      body: body.trim(),
      language: language.trim(),
      active: Boolean(active),
      category,
      bucket: category === "RETARGETING" ? bucket : null,
      email_subject: norm(email_subject),
      email_body: norm(email_body),
    };
    if (id) payload.id = id;

    const auditMeta = {
      name: payload.name,
      language: payload.language,
      category: payload.category,
      bucket: payload.bucket,
      active: payload.active,
      email_ready: !!(payload.email_subject && payload.email_body),
    };

    if (useRds()) {
      const role = await requireRoleOrDeny(userId, ["super_admin", "kob_manager"]);
      if (role === null) { res.status(403).json({ error: "Forbidden: requires super_admin or kob_manager" }); return; }
      await withTransaction(userId, async (client) => {
        await adminRepo.upsertGallaboxTemplate(client, payload);
        await adminRepo.insertAuditLog(client, userId, id ? "gallabox_update" : "gallabox_create", "gallabox_templates", id ?? null, auditMeta);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase.from("gallabox_templates").upsert(payload);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(
      req.supabase,
      req.userId,
      id ? "gallabox_update" : "gallabox_create",
      "gallabox_templates",
      id ?? null,
      auditMeta,
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for updateIncentiveRule.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1301).
 */
export async function updateIncentiveRule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }
    const userId = req.userId;

    const id = req.params.id || req.body?.id;
    const { label, min_score, max_score, incentive_pct } = req.body ?? {};

    if (!id || typeof id !== "string") {
      res.status(400).json({ error: "id is required" });
      return;
    }

    if (!label || typeof label !== "string" || label.trim().length === 0) {
      res.status(400).json({ error: "label is required" });
      return;
    }

    const minScoreNum = Number(min_score);
    const maxScoreNum = Number(max_score);
    const incPctNum = Number(incentive_pct);

    if (isNaN(minScoreNum) || !Number.isInteger(minScoreNum) || minScoreNum < 0 || minScoreNum > 100) {
      res.status(400).json({ error: "min_score must be an integer between 0 and 100" });
      return;
    }

    if (isNaN(maxScoreNum) || !Number.isInteger(maxScoreNum) || maxScoreNum < 0 || maxScoreNum > 100) {
      res.status(400).json({ error: "max_score must be an integer between 0 and 100" });
      return;
    }

    if (isNaN(incPctNum) || !Number.isInteger(incPctNum) || incPctNum < 0 || incPctNum > 100) {
      res.status(400).json({ error: "incentive_pct must be an integer between 0 and 100" });
      return;
    }

    if (minScoreNum > maxScoreNum) {
      res.status(400).json({ error: "min_score cannot exceed max_score" });
      return;
    }

    const patch = {
      label: label.trim(),
      min_score: minScoreNum,
      max_score: maxScoreNum,
      incentive_pct: incPctNum,
    };

    if (useRds()) {
      const role = await requireRoleOrDeny(userId, ["super_admin"]);
      if (role === null) { res.status(403).json({ error: "Forbidden: requires super_admin" }); return; }
      await withTransaction(userId, async (client) => {
        await adminRepo.updateIncentiveRule(client, id, patch);
        await adminRepo.insertAuditLog(client, userId, "incentive_rule_update", "incentive_rules", id, patch);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase.from("incentive_rules").update(patch).eq("id", id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "incentive_rule_update", "incentive_rules", id, patch);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for updateScvRules.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1279).
 */
export async function updateScvRules(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }
    const userId = req.userId;

    const {
      weight_conversion,
      weight_tat,
      weight_eoi1_webinar,
      weight_eoi2_payment,
      weight_crm_discipline,
    } = req.body ?? {};

    const weights = [
      { key: "weight_conversion", val: Number(weight_conversion) },
      { key: "weight_tat", val: Number(weight_tat) },
      { key: "weight_eoi1_webinar", val: Number(weight_eoi1_webinar) },
      { key: "weight_eoi2_payment", val: Number(weight_eoi2_payment) },
      { key: "weight_crm_discipline", val: Number(weight_crm_discipline) },
    ];

    for (const w of weights) {
      if (isNaN(w.val) || !Number.isInteger(w.val) || w.val < 0 || w.val > 100) {
        res.status(400).json({ error: `${w.key} must be an integer between 0 and 100` });
        return;
      }
    }

    const sum = weights.reduce((acc, w) => acc + w.val, 0);
    if (sum !== 100) {
      res.status(400).json({ error: `Weights must sum to 100 (got ${sum})` });
      return;
    }

    const patch = {
      weight_conversion: weights[0].val,
      weight_tat: weights[1].val,
      weight_eoi1_webinar: weights[2].val,
      weight_eoi2_payment: weights[3].val,
      weight_crm_discipline: weights[4].val,
    };

    if (useRds()) {
      const role = await requireRoleOrDeny(userId, ["super_admin"]);
      if (role === null) { res.status(403).json({ error: "Forbidden: requires super_admin" }); return; }
      await withTransaction(userId, async (client) => {
        await adminRepo.updateScvRules(client, patch);
        await adminRepo.insertAuditLog(client, userId, "scv_rules_update", "scv_rules", null, patch);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase.from("scv_rules").update(patch).eq("id", 1);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "scv_rules_update", "scv_rules", null, patch);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for updateConfig.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 689).
 */
export async function updateConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }
    const userId = req.userId;

    const patch = req.body;
    if (!patch || typeof patch !== "object" || Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Config payload must be a non-empty object" });
      return;
    }

    if (useRds()) {
      // Role gate mirrors kob_configuration's RLS policy (super_admin OR
      // kob_manager). The FURTHER per-field restriction for kob_manager
      // (only default_mode/auto_mode_killswitch) is NOT re-implemented
      // here — it is enforced by the unmodified
      // enforce_kob_configuration_manager_scope trigger on RDS, exactly as
      // on the Supabase path, using the request.jwt.claim.sub this
      // transaction sets.
      const role = await requireRoleOrDeny(userId, ["super_admin", "kob_manager"]);
      if (role === null) { res.status(403).json({ error: "Forbidden: requires super_admin or kob_manager" }); return; }
      await withTransaction(userId, async (client) => {
        await adminRepo.updateConfig(client, patch);
        await adminRepo.insertAuditLog(client, userId, "config_update", "kob_configuration", null, patch);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase
      .from("kob_configuration")
      .update(patch)
      .eq("id", 1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "config_update", "kob_configuration", null, patch);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for updateMyAllocationMode.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2493).
 */
export async function updateMyAllocationMode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }

    const { mode } = req.body ?? {};
    if (mode !== "MANUAL" && mode !== "ROUND_ROBIN") {
      res.status(400).json({ error: "mode must be MANUAL or ROUND_ROBIN" });
      return;
    }

    const { error } = await req.supabase
      .from("profiles")
      .update({ allocation_mode: mode })
      .eq("id", req.userId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "allocation_mode_update", "profiles", req.userId, { mode });
    res.status(200).json({ ok: true, mode });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for updateExecutiveLanguage.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2937).
 */
export async function updateExecutiveLanguage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }

    const executiveId = req.params.id || req.body?.executiveId || req.body?.id;
    if (!executiveId || typeof executiveId !== "string") {
      res.status(400).json({ error: "executiveId is required" });
      return;
    }

    const { data: roles } = await req.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", req.userId);

    const isAdmin = (roles ?? []).some((r: any) => r.role === "super_admin" || r.role === "kob_manager");
    const isTL = (roles ?? []).some((r: any) => r.role === "team_leader");

    if (!isAdmin && !isTL) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;

    if (!isAdmin) {
      const { data: prof } = await db
        .from("profiles")
        .select("team_leader_id")
        .eq("id", executiveId)
        .maybeSingle();

      if (!prof || (prof as any).team_leader_id !== req.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    const patch: Record<string, any> = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "primary_language")) {
      patch.primary_language = req.body.primary_language || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "secondary_language")) {
      patch.secondary_language = req.body.secondary_language || null;
    }

    if (Object.keys(patch).length === 0) {
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await db
      .from("profiles")
      .update(patch)
      .eq("id", executiveId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "executive_language_updated", "profiles", executiveId, patch);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for reassignExecutiveTeamLeader.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2668).
 */
export async function reassignExecutiveTeamLeader(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }

    const executiveId = req.params.id || req.body?.executiveId || req.body?.id;
    const teamLeaderId = req.body?.teamLeaderId;

    if (!executiveId || typeof executiveId !== "string") {
      res.status(400).json({ error: "executiveId is required and must be a valid UUID" });
      return;
    }

    if (!teamLeaderId || typeof teamLeaderId !== "string") {
      res.status(400).json({ error: "teamLeaderId is required and must be a valid UUID" });
      return;
    }

    const { data: roles } = await req.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", req.userId);

    const isAdmin = (roles ?? []).some((r: any) => r.role === "super_admin" || r.role === "kob_manager");
    if (!isAdmin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;

    const { error } = await db
      .from("profiles")
      .update({ team_leader_id: teamLeaderId })
      .eq("id", executiveId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "executive_reassign_tl", "profiles", executiveId, {
      team_leader_id: teamLeaderId,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for updateScvComponentWeights.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1747).
 */
export async function updateScvComponentWeights(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId || (!useRds() && !req.supabase)) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }

    const [isMgr, isAdmin] = useRds()
      ? await Promise.all([actorHasRole(getPool(), req.userId, "kob_manager"), actorHasRole(getPool(), req.userId, "super_admin")])
      : await Promise.all([
          req.supabase!.rpc("has_role", { _user_id: req.userId, _role: "kob_manager" }).then((r: any) => r.data),
          req.supabase!.rpc("has_role", { _user_id: req.userId, _role: "super_admin" }).then((r: any) => r.data),
        ]);

    if (!isMgr && !isAdmin) {
      res.status(403).json({ error: "Only CEO or Manager can change SCV weights" });
      return;
    }

    const { conversion, tat, eoi2Payment, crm } = req.body ?? {};
    const values = [
      { key: "conversion", val: Number(conversion) },
      { key: "tat", val: Number(tat) },
      { key: "eoi2Payment", val: Number(eoi2Payment) },
      { key: "crm", val: Number(crm) },
    ];

    for (const v of values) {
      if (isNaN(v.val) || !Number.isInteger(v.val) || v.val < 0 || v.val > 100) {
        res.status(400).json({ error: `${v.key} must be an integer between 0 and 100` });
        return;
      }
    }

    const sum = values.reduce((acc, v) => acc + v.val, 0);
    if (sum !== 100) {
      res.status(400).json({ error: `Weights must total 100% (currently ${sum}%)` });
      return;
    }

    const patch = {
      weight_conversion: values[0].val,
      weight_tat: values[1].val,
      weight_eoi2_payment: values[2].val,
      weight_crm_discipline: values[3].val,
    };

    if (useRds()) {
      await withTransaction(req.userId, async (client) => {
        await scvRepo.updateComponentWeights(client, patch);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase!
      .from("scv_component_weights")
      .update(patch)
      .eq("id", 1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for saveScvMonthlyInput.
 * Migrated 1:1 from src/lib/kob.functions.ts (line 1775).
 */
export async function saveScvMonthlyInput(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId || (!useRds() && !req.supabase)) {
      res.status(500).json({ error: "Supabase client not initialized or unauthenticated" });
      return;
    }

    const { userId, month, ktnCsTarget, crmDiscipline } = req.body ?? {};

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    if (!month || typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: "month must match YYYY-MM" });
      return;
    }

    if (ktnCsTarget !== undefined && ktnCsTarget !== null) {
      const targetNum = Number(ktnCsTarget);
      if (isNaN(targetNum) || !Number.isInteger(targetNum) || targetNum < 0 || targetNum > 100000) {
        res.status(400).json({ error: "ktnCsTarget must be an integer between 0 and 100000 or null" });
        return;
      }
    }

    if (crmDiscipline !== undefined && crmDiscipline !== null) {
      const crmNum = Number(crmDiscipline);
      if (isNaN(crmNum) || crmNum < 0 || crmNum > 100) {
        res.status(400).json({ error: "crmDiscipline must be a number between 0 and 100 or null" });
        return;
      }
    }

    const role = useRds()
      ? await resolveActorRole(getPool(), req.userId)
      : (await req.supabase!.rpc("get_user_role", { _user_id: req.userId })).data;
    const isMgr = role === "kob_manager" || role === "super_admin";
    const isTL = role === "team_leader";

    if (!isMgr && !isTL) {
      res.status(403).json({ error: "Only a Manager or Team Leader can set monthly targets" });
      return;
    }

    const period = `${month}-01`;
    const payload = {
      user_id: userId,
      period,
      updated_by: req.userId,
      ktn_cs_target: ktnCsTarget !== undefined && ktnCsTarget !== null ? Number(ktnCsTarget) : null,
      crm_discipline: crmDiscipline !== undefined && crmDiscipline !== null ? Number(crmDiscipline) : null,
    };

    if (useRds()) {
      await withTransaction(req.userId, async (client) => {
        await scvRepo.upsertMonthlyInput(client, payload);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase!
      .from("scv_monthly_inputs")
      .upsert(payload, { onConflict: "user_id,period" });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for toggleEntity
 * Migrated 1:1 from src/lib/kob.functions.ts (line 795).
 * Table: india_states | india_districts | india_cities | brands | lead_sources
 * Updates `active` field and logs audit.
 */
export async function toggleEntity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const table = (req.params.entity || req.params.table || req.body?.table || req.body?.entity) as string;
    const id = (req.params.id || req.body?.id) as string;
    const active = req.body?.active;

    const allowedTables = ["india_states", "india_districts", "india_cities", "brands", "lead_sources"];
    if (!table || !allowedTables.includes(table)) {
      res.status(400).json({ error: `Invalid table: must be one of ${allowedTables.join(", ")}` });
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !uuidRegex.test(id)) {
      res.status(400).json({ error: "Invalid id: must be a valid UUID" });
      return;
    }

    if (typeof active !== "boolean") {
      res.status(400).json({ error: "active must be a boolean" });
      return;
    }

    const { error } = await req.supabase
      .from(table)
      .update({ active })
      .eq("id", id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(
      req.supabase,
      req.userId ?? null,
      active ? "activate" : "deactivate",
      table,
      id,
      { active }
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for saveIncentiveAmount
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2100).
 * Updates kob_configuration.incentive_amount and logs to scv_mode_config_changes.
 */
export async function saveIncentiveAmount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const mode = req.body?.mode;
    const incentiveAmount = req.body?.incentiveAmount;

    if (mode !== "AUTO" && mode !== "MANUAL") {
      res.status(400).json({ error: "mode must be AUTO or MANUAL" });
      return;
    }

    if (incentiveAmount === undefined || incentiveAmount === null || typeof incentiveAmount !== "number" || isNaN(incentiveAmount) || incentiveAmount < 0 || incentiveAmount > 10000000) {
      res.status(400).json({ error: "incentiveAmount must be a number between 0 and 10000000" });
      return;
    }

    if (useRds() && !req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [isMgr, isAdmin] = useRds()
      ? await Promise.all([actorHasRole(getPool(), req.userId!, "kob_manager"), actorHasRole(getPool(), req.userId!, "super_admin")])
      : await Promise.all([
          req.supabase!.rpc("has_role", { _user_id: req.userId, _role: "kob_manager" }).then((r: any) => r.data),
          req.supabase!.rpc("has_role", { _user_id: req.userId, _role: "super_admin" }).then((r: any) => r.data),
        ]);

    if (!isMgr && !isAdmin) {
      res.status(403).json({ error: "Only CEO or Manager can change incentive configuration" });
      return;
    }

    if (useRds()) {
      await withTransaction(req.userId!, async (client) => {
        const prevAmount = Number((await scvRepo.getConfigIncentiveAmount(client)) ?? 10000);
        if (prevAmount === incentiveAmount) return;
        await scvRepo.updateConfigIncentiveAmount(client, incentiveAmount);
        await scvRepo.insertModeConfigChanges(client, [{
          mode, changed_by: req.userId!, component: "Incentive Amount (per contract)",
          previous_value: `₹${prevAmount}`, new_value: `₹${incentiveAmount}`,
        }]);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { data: prev } = await req.supabase!.from("kob_configuration").select("incentive_amount").eq("id", 1).maybeSingle();
    const prevAmount = Number(prev?.incentive_amount ?? 10000);

    if (prevAmount === incentiveAmount) {
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase!
      .from("kob_configuration")
      .update({ incentive_amount: incentiveAmount, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await req.supabase!.from("scv_mode_config_changes").insert({
      mode,
      changed_by: req.userId,
      component: "Incentive Amount (per contract)",
      previous_value: `₹${prevAmount}`,
      new_value: `₹${incentiveAmount}`,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for saveIncentiveSlabs
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2119).
 * Updates incentive_rules (incentive_pct, incentive_amount) and logs diffs to scv_mode_config_changes.
 */
export async function saveIncentiveSlabs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const mode = req.body?.mode;
    const slabs = req.body?.slabs;

    if (mode !== "AUTO" && mode !== "MANUAL") {
      res.status(400).json({ error: "mode must be AUTO or MANUAL" });
      return;
    }

    if (!Array.isArray(slabs) || slabs.length > 20) {
      res.status(400).json({ error: "slabs must be an array of at most 20 items" });
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const s of slabs) {
      if (!s.id || !uuidRegex.test(s.id)) {
        res.status(400).json({ error: `Invalid slab id: ${s.id}` });
        return;
      }
      if (typeof s.incentive_pct !== "number" || !Number.isInteger(s.incentive_pct) || s.incentive_pct < 0 || s.incentive_pct > 100) {
        res.status(400).json({ error: "slab incentive_pct must be an integer between 0 and 100" });
        return;
      }
      if (typeof s.incentive_amount !== "number" || isNaN(s.incentive_amount) || s.incentive_amount < 0 || s.incentive_amount > 10000000) {
        res.status(400).json({ error: "slab incentive_amount must be between 0 and 10000000" });
        return;
      }
    }

    if (useRds() && !req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [isMgr, isAdmin] = useRds()
      ? await Promise.all([actorHasRole(getPool(), req.userId!, "kob_manager"), actorHasRole(getPool(), req.userId!, "super_admin")])
      : await Promise.all([
          req.supabase!.rpc("has_role", { _user_id: req.userId, _role: "kob_manager" }).then((r: any) => r.data),
          req.supabase!.rpc("has_role", { _user_id: req.userId, _role: "super_admin" }).then((r: any) => r.data),
        ]);

    if (!isMgr && !isAdmin) {
      res.status(403).json({ error: "Only CEO or Manager can change incentive configuration" });
      return;
    }

    if (useRds()) {
      await withTransaction(req.userId!, async (client) => {
        const prev = await scvRepo.getIncentiveRulesForUpdate(client);
        const prevMap = new Map(prev.map((r) => [r.id, r]));
        const changes: scvRepo.ScvModeConfigChangeInsert[] = [];
        for (const s of slabs) {
          const p = prevMap.get(s.id);
          if (!p) continue;
          if (Number(p.incentive_pct) === s.incentive_pct && Number(p.incentive_amount) === s.incentive_amount) continue;
          await scvRepo.updateIncentiveRuleAmounts(client, s.id, s.incentive_pct, s.incentive_amount);
          if (Number(p.incentive_amount) !== s.incentive_amount) {
            changes.push({ mode, changed_by: req.userId!, component: `Incentive: ${p.label} amount`, previous_value: `₹${Number(p.incentive_amount)}`, new_value: `₹${s.incentive_amount}` });
          }
          if (Number(p.incentive_pct) !== s.incentive_pct) {
            changes.push({ mode, changed_by: req.userId!, component: `Incentive: ${p.label} payout`, previous_value: `${p.incentive_pct}%`, new_value: `${s.incentive_pct}%` });
          }
        }
        await scvRepo.insertModeConfigChanges(client, changes);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { data: prev, error: prevErr } = await req.supabase!
      .from("incentive_rules")
      .select("id, label, incentive_pct, incentive_amount");

    if (prevErr) {
      res.status(500).json({ error: prevErr.message });
      return;
    }

    const prevMap = new Map(((prev ?? []) as any[]).map((r) => [r.id, r]));
    const changes: any[] = [];
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : req.supabase;

    for (const s of slabs) {
      const p: any = prevMap.get(s.id);
      if (!p) continue;
      if (Number(p.incentive_pct) === s.incentive_pct && Number(p.incentive_amount) === s.incentive_amount) continue;

      const { error: updErr } = await (db as any)
        .from("incentive_rules")
        .update({
          incentive_pct: s.incentive_pct,
          incentive_amount: s.incentive_amount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", s.id);

      if (updErr) {
        res.status(500).json({ error: updErr.message });
        return;
      }

      if (Number(p.incentive_amount) !== s.incentive_amount) {
        changes.push({
          component: `Incentive: ${p.label} amount`,
          previous_value: `₹${Number(p.incentive_amount)}`,
          new_value: `₹${s.incentive_amount}`,
        });
      }
      if (Number(p.incentive_pct) !== s.incentive_pct) {
        changes.push({
          component: `Incentive: ${p.label} payout`,
          previous_value: `${p.incentive_pct}%`,
          new_value: `${s.incentive_pct}%`,
        });
      }
    }

    if (changes.length) {
      const { error: chgErr } = await req.supabase!.from("scv_mode_config_changes").insert(
        changes.map((c) => ({ ...c, mode, changed_by: req.userId }))
      );
      if (chgErr) {
        res.status(500).json({ error: chgErr.message });
        return;
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for saveScvModeConfig
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2051).
 * Updates scv_mode_config, kob_configuration.incentive_amount, and records diffs in scv_mode_config_changes.
 */
export async function saveScvModeConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { mode, components, tatMovements, incentiveAmount } = req.body ?? {};

    if (mode !== "AUTO" && mode !== "MANUAL") {
      res.status(400).json({ error: "mode must be AUTO or MANUAL" });
      return;
    }

    if (!Array.isArray(components) || components.length > 20) {
      res.status(400).json({ error: "components must be an array of at most 20 items" });
      return;
    }

    if (!Array.isArray(tatMovements) || tatMovements.length > 10) {
      res.status(400).json({ error: "tatMovements must be an array of at most 10 items" });
      return;
    }

    if (typeof incentiveAmount !== "number" || isNaN(incentiveAmount) || incentiveAmount < 0 || incentiveAmount > 10000000) {
      res.status(400).json({ error: "incentiveAmount must be a number between 0 and 10000000" });
      return;
    }

    if (useRds() && !req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [isMgr, isAdmin] = useRds()
      ? await Promise.all([actorHasRole(getPool(), req.userId!, "kob_manager"), actorHasRole(getPool(), req.userId!, "super_admin")])
      : await Promise.all([
          req.supabase!.rpc("has_role", { _user_id: req.userId, _role: "kob_manager" }).then((r: any) => r.data),
          req.supabase!.rpc("has_role", { _user_id: req.userId, _role: "super_admin" }).then((r: any) => r.data),
        ]);

    if (!isMgr && !isAdmin) {
      res.status(403).json({ error: "Only CEO or Manager can change SCV configuration" });
      return;
    }

    const keys = new Set<string>();
    for (const c of components) {
      if (!c.key || typeof c.key !== "string" || c.key.length < 1 || c.key.length > 60) {
        res.status(400).json({ error: "Each component must have a valid key between 1 and 60 chars" });
        return;
      }
      if (keys.has(c.key)) {
        res.status(400).json({ error: `Duplicate component "${c.label ?? c.key}"` });
        return;
      }
      keys.add(c.key);
      if (!SCV_COMPONENT_TYPES.includes(c.type)) {
        res.status(400).json({ error: `Invalid component type: ${c.type}` });
        return;
      }
      if (typeof c.weight !== "number" || !Number.isInteger(c.weight) || c.weight < 0 || c.weight > 100) {
        res.status(400).json({ error: "Component weight must be an integer between 0 and 100" });
        return;
      }
      if (typeof c.enabled !== "boolean") {
        res.status(400).json({ error: "Component enabled must be a boolean" });
        return;
      }
    }

    for (const t of SCV_COMPONENT_TYPES) {
      if (t !== "mark" && components.filter((c: any) => c.type === t).length > 1) {
        res.status(400).json({ error: `Only one ${t} component allowed` });
        return;
      }
    }

    const sum = components.filter((c: any) => c.enabled).reduce((s: number, c: any) => s + c.weight, 0);
    if (sum !== 100) {
      res.status(400).json({ error: `Enabled weights must total 100% (currently ${sum}%)` });
      return;
    }

    const desc = (c: any) => (c ? `${c.label} ${c.weight}%${c.enabled ? "" : " (off)"}` : null);
    const tdesc = (t: any) => (t ? `${t.days} days${t.enabled ? "" : " (off)"}` : null);

    if (useRds()) {
      await withTransaction(req.userId!, async (client) => {
        const prev = await loadScvModeConfig(pgClient, mode);
        const globPrev = await (pgClient as any).from("kob_configuration").select("incentive_amount").eq("id", 1).maybeSingle();

        await scvRepo.updateModeConfig(client, { mode, components, tat_movements: tatMovements, updated_by: req.userId! });

        const changes: scvRepo.ScvModeConfigChangeInsert[] = [];
        const prevMap = new Map(prev.components.map((c: any) => [c.key, c]));
        for (const c of components) {
          const p = prevMap.get(c.key);
          if (desc(p) !== desc(c)) changes.push({ mode, changed_by: req.userId!, component: c.label, previous_value: desc(p), new_value: desc(c) });
          prevMap.delete(c.key);
        }
        for (const p of prevMap.values()) {
          changes.push({ mode, changed_by: req.userId!, component: (p as any).label, previous_value: desc(p), new_value: "deleted" });
        }

        const prevT = new Map(prev.tatMovements.map((t: any) => [t.key, t]));
        for (const t of tatMovements) {
          const p = prevT.get(t.key);
          if (tdesc(p) !== tdesc(t)) changes.push({ mode, changed_by: req.userId!, component: `TAT: ${t.label}`, previous_value: tdesc(p), new_value: tdesc(t) });
        }

        const prevAmount = Number((globPrev.data as any)?.incentive_amount ?? 10000);
        if (prevAmount !== incentiveAmount) {
          await scvRepo.updateConfigIncentiveAmount(client, incentiveAmount);
          changes.push({ mode, changed_by: req.userId!, component: "Incentive Amount (global)", previous_value: `₹${prevAmount}`, new_value: `₹${incentiveAmount}` });
        }

        await scvRepo.insertModeConfigChanges(client, changes);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const prev = await loadScvModeConfig(req.supabase!, mode);
    const { data: globPrev } = await req.supabase!.from("kob_configuration").select("incentive_amount").eq("id", 1).maybeSingle();

    const { error: updErr } = await req.supabase!.from("scv_mode_config").update({
      components,
      tat_movements: tatMovements,
      updated_by: req.userId,
      updated_at: new Date().toISOString(),
    }).eq("mode", mode);

    if (updErr) {
      res.status(500).json({ error: updErr.message });
      return;
    }

    const changes: any[] = [];
    const prevMap = new Map(prev.components.map((c: any) => [c.key, c]));
    for (const c of components) {
      const p = prevMap.get(c.key);
      if (desc(p) !== desc(c)) {
        changes.push({ component: c.label, previous_value: desc(p), new_value: desc(c) });
      }
      prevMap.delete(c.key);
    }
    for (const p of prevMap.values()) {
      changes.push({ component: (p as any).label, previous_value: desc(p), new_value: "deleted" });
    }

    const prevT = new Map(prev.tatMovements.map((t: any) => [t.key, t]));
    for (const t of tatMovements) {
      const p = prevT.get(t.key);
      if (tdesc(p) !== tdesc(t)) {
        changes.push({ component: `TAT: ${t.label}`, previous_value: tdesc(p), new_value: tdesc(t) });
      }
    }

    const prevAmount = Number(globPrev?.incentive_amount ?? 10000);
    if (prevAmount !== incentiveAmount) {
      const { error: amtErr } = await req.supabase!.from("kob_configuration").update({
        incentive_amount: incentiveAmount,
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (amtErr) {
        res.status(500).json({ error: amtErr.message });
        return;
      }
      changes.push({
        component: "Incentive Amount (global)",
        previous_value: `₹${prevAmount}`,
        new_value: `₹${incentiveAmount}`,
      });
    }

    if (changes.length) {
      const { error: insErr } = await req.supabase!.from("scv_mode_config_changes").insert(
        changes.map((c) => ({ ...c, mode, changed_by: req.userId }))
      );
      if (insErr) {
        res.status(500).json({ error: insErr.message });
        return;
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for saveScvModeInput
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2150).
 * Upserts user monthly targets/marks into scv_mode_inputs on conflict (user_id, period, mode).
 */
export async function saveScvModeInput(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { userId, month, mode, ktnCsTarget, discipline, marks } = req.body ?? {};

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!userId || !uuidRegex.test(userId)) {
      res.status(400).json({ error: "userId must be a valid UUID" });
      return;
    }

    if (!month || typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: "month must match YYYY-MM format" });
      return;
    }

    if (mode !== "AUTO" && mode !== "MANUAL") {
      res.status(400).json({ error: "mode must be AUTO or MANUAL" });
      return;
    }

    if (ktnCsTarget !== undefined && ktnCsTarget !== null) {
      const targetNum = Number(ktnCsTarget);
      if (isNaN(targetNum) || !Number.isInteger(targetNum) || targetNum < 0 || targetNum > 100000) {
        res.status(400).json({ error: "ktnCsTarget must be an integer between 0 and 100000 or null" });
        return;
      }
    }

    if (discipline !== undefined && discipline !== null) {
      const discNum = Number(discipline);
      if (isNaN(discNum) || discNum < 0 || discNum > 100) {
        res.status(400).json({ error: "discipline must be a number between 0 and 100 or null" });
        return;
      }
    }

    const marksObj = (marks && typeof marks === "object" && !Array.isArray(marks)) ? marks : {};

    if (useRds() && !req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const role = useRds()
      ? await resolveActorRole(getPool(), req.userId!)
      : (await req.supabase!.rpc("get_user_role", { _user_id: req.userId })).data;
    if (!["kob_manager", "super_admin", "team_leader"].includes(role as any)) {
      res.status(403).json({ error: "Only CEO, Manager or Team Leader can set monthly inputs" });
      return;
    }

    const payload = {
      user_id: userId,
      period: `${month}-01`,
      mode,
      ktn_cs_target: ktnCsTarget !== undefined && ktnCsTarget !== null ? Number(ktnCsTarget) : null,
      discipline: discipline !== undefined && discipline !== null ? Number(discipline) : null,
      marks: marksObj,
      updated_by: req.userId!,
    };

    if (useRds()) {
      await withTransaction(req.userId!, async (client) => {
        await scvRepo.upsertModeInput(client, payload);
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase!.from("scv_mode_inputs").upsert(payload, { onConflict: "user_id,period,mode" });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for setLeadCuisine
 * Migrated 1:1 from src/lib/kob.functions.ts (line 3264).
 * Updates cuisine on kob_leads and logs audit. Does NOT change stage, stage_entered_at, assignment, or lead_stage_history.
 */
export async function setLeadCuisine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const leadId = (req.params.id || req.body?.leadId || req.body?.id) as string;
    const cuisine = req.body?.cuisine;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!leadId || !uuidRegex.test(leadId)) {
      res.status(400).json({ error: "leadId must be a valid UUID" });
      return;
    }

    if (!cuisine || typeof cuisine !== "string" || cuisine.trim().length === 0 || cuisine.trim().length > 100) {
      res.status(400).json({ error: "cuisine must be a string between 1 and 100 characters" });
      return;
    }

    const trimmedCuisine = cuisine.trim();

    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized on request" }); return; }
      const userId = req.userId;
      const scope = await resolveLeadScopeOrDeny(userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      let brandRejected = false;
      await withTransaction(userId, async (client) => {
        const active = await leadRepo.isActiveBrandName(client, trimmedCuisine);
        if (!active) { brandRejected = true; return; }
        // Non-stage field update: no stage/history/retargeting trigger fires
        // (verified from trigger WHEN-clauses — see Stage 10G audit). Only
        // touch_updated_at runs, same as every other kob_leads UPDATE.
        await leadRepo.setLeadCuisine(client, leadId, trimmedCuisine, scope);
        await adminRepo.insertAuditLog(client, userId, "lead_cuisine_update", "kob_leads", leadId, { cuisine: trimmedCuisine });
      });
      if (brandRejected) { res.status(400).json({ error: "Selected brand is not active in Brand Management" }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    // Options come from Brand Management: only ACTIVE brands can be newly selected.
    const { data: brand, error: brandErr } = await req.supabase
      .from("brands")
      .select("name")
      .eq("active", true)
      .eq("name", trimmedCuisine)
      .maybeSingle();

    if (brandErr) {
      res.status(500).json({ error: brandErr.message });
      return;
    }

    if (!brand) {
      res.status(400).json({ error: "Selected brand is not active in Brand Management" });
      return;
    }

    // Update ONLY cuisine. Do NOT touch stage, stage_entered_at, assignment, etc.
    const { error: updateErr } = await req.supabase
      .from("kob_leads")
      .update({ cuisine: trimmedCuisine })
      .eq("id", leadId);

    if (updateErr) {
      res.status(500).json({ error: updateErr.message });
      return;
    }

    await logAudit(
      req.supabase,
      req.userId ?? null,
      "lead_cuisine_update",
      "kob_leads",
      leadId,
      { cuisine: trimmedCuisine }
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for updateLeadNextAction
 * Migrated 1:1 from src/lib/kob.functions.ts (line 579).
 * Updates next_action on kob_leads and logs audit. Does NOT change stage, assignment, etc.
 */
export async function updateLeadNextAction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const leadId = (req.params.id || req.body?.leadId || req.body?.id) as string;
    const nextAction = req.body?.nextAction;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!leadId || !uuidRegex.test(leadId)) {
      res.status(400).json({ error: "leadId must be a valid UUID" });
      return;
    }

    if (nextAction !== undefined && nextAction !== null && typeof nextAction !== "string") {
      res.status(400).json({ error: "nextAction must be a string or null" });
      return;
    }

    if (typeof nextAction === "string" && nextAction.length > 500) {
      res.status(400).json({ error: "nextAction must be at most 500 characters" });
      return;
    }

    const value = typeof nextAction === "string" && nextAction.trim().length > 0 ? nextAction.trim() : null;

    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized on request" }); return; }
      const userId = req.userId;
      const scope = await resolveLeadScopeOrDeny(userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      await withTransaction(userId, async (client) => {
        await leadRepo.updateLeadNextAction(client, leadId, value, scope);
        await adminRepo.insertAuditLog(client, userId, "lead_next_action_update", "kob_leads", leadId, { next_action: value });
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase
      .from("kob_leads")
      .update({ next_action: value })
      .eq("id", leadId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(
      req.supabase,
      req.userId ?? null,
      "lead_next_action_update",
      "kob_leads",
      leadId,
      { next_action: value }
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for setLeadRnrTag
 * Migrated 1:1 from src/lib/kob.functions.ts (line 605).
 * Marks or unmarks RNR tag on kob_leads.tags array. Never touches stage or other fields.
 */
export async function setLeadRnrTag(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const leadId = (req.params.id || req.body?.leadId || req.body?.id) as string;
    const rnr = req.body?.rnr;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!leadId || !uuidRegex.test(leadId)) {
      res.status(400).json({ error: "leadId must be a valid UUID" });
      return;
    }

    if (typeof rnr !== "boolean") {
      res.status(400).json({ error: "rnr must be a boolean" });
      return;
    }

    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized on request" }); return; }
      const userId = req.userId;
      const scope = await resolveLeadScopeOrDeny(userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      let notFound = false;
      let resultTags: string[] = [];
      await withTransaction(userId, async (client) => {
        // Scoped read: an inaccessible lead returns null here, exactly like
        // the Supabase path's RLS-filtered SELECT finding no row.
        const current = await leadRepo.getLeadTagsScoped(client, leadId, scope);
        if (current === null) { notFound = true; return; }
        const nextTags = rnr ? Array.from(new Set([...current, "RNR"])) : current.filter((t) => t !== "RNR");
        await leadRepo.setLeadTags(client, leadId, nextTags, scope);
        await adminRepo.insertAuditLog(client, userId, rnr ? "lead_tag_rnr_added" : "lead_tag_rnr_removed", "kob_leads", leadId, { tags: nextTags });
        resultTags = nextTags;
      });
      if (notFound) { res.status(404).json({ error: "Lead not found" }); return; }
      res.status(200).json({ ok: true, tags: resultTags });
      return;
    }

    const { data: row, error: readErr } = await req.supabase
      .from("kob_leads")
      .select("tags")
      .eq("id", leadId)
      .maybeSingle();

    if (readErr) {
      res.status(500).json({ error: readErr.message });
      return;
    }

    if (!row) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    const current: string[] = ((row as any)?.tags ?? []) as string[];
    const nextTags = rnr
      ? Array.from(new Set([...current, "RNR"]))
      : current.filter((t) => t !== "RNR");

    const { error: updErr } = await req.supabase
      .from("kob_leads")
      .update({ tags: nextTags })
      .eq("id", leadId);

    if (updErr) {
      res.status(500).json({ error: updErr.message });
      return;
    }

    await logAudit(
      req.supabase,
      req.userId ?? null,
      rnr ? "lead_tag_rnr_added" : "lead_tag_rnr_removed",
      "kob_leads",
      leadId,
      { tags: nextTags }
    );

    res.status(200).json({ ok: true, tags: nextTags });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for markLeadMessagesRead
 * Migrated 1:1 from src/lib/kob.functions.ts (line 590).
 * Resets unread_message_count to 0 and has_unread_messages to false.
 */
export async function markLeadMessagesRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const leadId = (req.params.id || req.body?.leadId || req.body?.id) as string;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!leadId || !uuidRegex.test(leadId)) {
      res.status(400).json({ error: "leadId must be a valid UUID" });
      return;
    }

    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized on request" }); return; }
      const userId = req.userId;
      const scope = await resolveLeadScopeOrDeny(userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      await withTransaction(userId, async (client) => {
        await leadRepo.markLeadMessagesRead(client, leadId, scope);
        await adminRepo.insertAuditLog(client, userId, "lead_messages_marked_read", "kob_leads", leadId, null);
      });
      res.status(200).json({ ok: true, unread_message_count: 0, has_unread_messages: false });
      return;
    }

    const { error } = await req.supabase
      .from("kob_leads")
      .update({ unread_message_count: 0, has_unread_messages: false })
      .eq("id", leadId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(
      req.supabase,
      req.userId ?? null,
      "lead_messages_marked_read",
      "kob_leads",
      leadId,
      null
    );

    res.status(200).json({ ok: true, unread_message_count: 0, has_unread_messages: false });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for createExecutive
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2889).
 * Creates/upserts auth user, profile, executive role, and logs audit.
 */
export async function createExecutive(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const { email, full_name, primary_language, secondary_language, team_leader_id, password } = req.body ?? {};

    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({ error: "Valid email is required" });
      return;
    }

    if (!full_name || typeof full_name !== "string" || full_name.trim().length === 0) {
      res.status(400).json({ error: "full_name is required" });
      return;
    }

    if (useRds() && !req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const callerRoles = useRds()
      ? await adminRepo.getRolesForUser(req.userId!)
      : ((await req.supabase!.from("user_roles").select("role").eq("user_id", req.userId)).data ?? []).map((r: any) => r.role);

    const isAdmin = callerRoles.includes("super_admin") || callerRoles.includes("kob_manager");
    const isTL = callerRoles.includes("team_leader");

    if (!isAdmin && !isTL) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const teamLeaderId = isAdmin ? (team_leader_id || null) : req.userId;
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = typeof password === "string" && password.trim() ? password.trim() : "Test@12345";

    const { data: existing } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    let user = existing?.users?.find((x) => x.email === cleanEmail);

    if (!user) {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: cleanPassword,
        email_confirm: true,
        user_metadata: { full_name: full_name.trim() },
      });
      if (createErr) {
        res.status(500).json({ error: createErr.message });
        return;
      }
      user = created?.user ?? undefined;
    }

    if (!user) {
      res.status(500).json({ error: "Failed to create user" });
      return;
    }

    const normLang = (l: any) => {
      if (!l || typeof l !== "string") return null;
      const u = l.trim().toUpperCase();
      return u || null;
    };

    const auditMeta = {
      email: cleanEmail,
      full_name: full_name.trim(),
      primary_language,
      secondary_language,
      team_leader_id: teamLeaderId,
    };

    if (useRds()) {
      // Supabase Auth remains the system of record for login (unchanged
      // above). RDS's auth.users is a local FK-compatibility mirror only
      // (see supabase/local-migration-compatibility.sql) — profiles.id and
      // user_roles.user_id reference it, so it must be populated first.
      await withTransaction(req.userId!, async (client) => {
        await adminRepo.upsertAuthUserMirror(client, user.id, cleanEmail);
        await adminRepo.upsertExecutiveProfile(client, {
          id: user.id,
          full_name: full_name.trim(),
          email: cleanEmail,
          primary_language: normLang(primary_language),
          secondary_language: normLang(secondary_language),
          team_leader_id: teamLeaderId,
        });
        await adminRepo.upsertExecutiveRole(client, user.id);
        await adminRepo.insertAuditLog(client, req.userId ?? null, "executive_created", "profiles", user.id, auditMeta);
      });
      res.status(200).json({ ok: true, id: user.id });
      return;
    }

    const { error: profErr } = await (supabaseAdmin.from("profiles") as any).upsert({
      id: user.id,
      full_name: full_name.trim(),
      email: cleanEmail,
      primary_language: normLang(primary_language) as any,
      secondary_language: normLang(secondary_language) as any,
      team_leader_id: teamLeaderId,
    });

    if (profErr) {
      res.status(500).json({ error: profErr.message });
      return;
    }

    const { error: roleErr } = await supabaseAdmin.from("user_roles").upsert(
      { user_id: user.id, role: "executive" as any },
      { onConflict: "user_id,role" }
    );

    if (roleErr) {
      res.status(500).json({ error: roleErr.message });
      return;
    }

    await logAudit(req.supabase!, req.userId ?? null, "executive_created", "profiles", user.id, auditMeta);

    res.status(200).json({ ok: true, id: user.id });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for reassignLead
 * Migrated 1:1 from src/lib/kob.functions.ts (line 2170).
 * Updates assigned_to on kob_leads and logs audit. Never touches stage or stage_history.
 */
export async function reassignLead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const leadId = (req.params.id || req.body?.leadId || req.body?.id) as string;
    const executiveId = (req.body?.executiveId || req.body?.assigned_to) as string;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!leadId || !uuidRegex.test(leadId)) {
      res.status(400).json({ error: "leadId must be a valid UUID" });
      return;
    }

    if (!executiveId || !uuidRegex.test(executiveId)) {
      res.status(400).json({ error: "executiveId must be a valid UUID" });
      return;
    }

    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized on request" }); return; }
      const userId = req.userId;
      const scope = await resolveLeadScopeOrDeny(userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      await withTransaction(userId, async (client) => {
        // Scoped WHERE evaluates against the lead's CURRENT (pre-update) row,
        // same as RLS's own USING clause — an executive may only reassign a
        // lead currently assigned to themselves.
        await leadRepo.reassignLead(client, leadId, executiveId, scope);
        await adminRepo.insertAuditLog(client, userId, "lead_reassign", "kob_leads", leadId, { executiveId });
      });
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase
      .from("kob_leads")
      .update({ assigned_to: executiveId })
      .eq("id", leadId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(
      req.supabase,
      req.userId ?? null,
      "lead_reassign",
      "kob_leads",
      leadId,
      { executiveId }
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for createManualLead
 * Migrated 1:1 from src/lib/kob.functions.ts (line 3136).
 * Creates a manual lead in LEAD_INBOX stage, mode MANUAL.
 */
export async function createManualLead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId || (!useRds() && !req.supabase)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { full_name, phone, language, source_id, pincode } = req.body ?? {};

    if (!full_name || typeof full_name !== "string" || full_name.trim().length === 0 || full_name.trim().length > 200) {
      res.status(400).json({ error: "full_name is required and must be between 1 and 200 characters" });
      return;
    }

    if (!phone || typeof phone !== "string" || phone.trim().length < 6 || phone.trim().length > 20) {
      res.status(400).json({ error: "phone is required and must be between 6 and 20 characters" });
      return;
    }

    const validLanguages = ["TAMIL", "TELUGU", "MALAYALAM", "ENGLISH"];
    if (!language || !validLanguages.includes(language)) {
      res.status(400).json({ error: `language must be one of: ${validLanguages.join(", ")}` });
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (source_id && !uuidRegex.test(source_id)) {
      res.status(400).json({ error: "source_id must be a valid UUID" });
      return;
    }

    const cleanPincode = typeof pincode === "string" ? pincode.trim() : "";
    if (cleanPincode.length > 0 && !/^\d{6}$/.test(cleanPincode)) {
      res.status(400).json({ error: "pincode must be a 6-digit number" });
      return;
    }

    const digits = phone.replace(/\D/g, "").slice(-10);
    if (digits.length !== 10) {
      res.status(400).json({ error: "Phone must be a valid 10-digit Indian number" });
      return;
    }

    if (useRds()) {
      const clash = await leadRepo.findPhoneClash(digits);
      if (clash) {
        res.status(400).json({ error: `Phone already exists in CRM (lead ${clash.code})` });
        return;
      }

      const last = await leadRepo.getLastManualLeadCode();
      let nextNum = 1;
      const m = /^IND-(\d+)$/.exec(last ?? "");
      if (m) nextNum = parseInt(m[1], 10) + 1;
      const code = `IND-${String(nextNum).padStart(5, "0")}`;

      // Team Leaders may only insert leads owned by their own team (same rule as the Supabase RLS policy).
      const isTL = await actorHasRole(getPool(), req.userId, "team_leader");

      const inserted = await withTransaction(req.userId, async (client) => {
        const row = await leadRepo.insertManualLead(client, {
          code,
          full_name: full_name.trim(),
          phone: `+91${digits}`,
          language,
          source_id: source_id || null,
          team_leader_id: isTL ? req.userId! : null,
          notes: cleanPincode ? `Pincode: ${cleanPincode}` : null,
        });
        await adminRepo.insertAuditLog(client, req.userId!, "lead_manual_create", "kob_leads", row.id, {
          code: row.code,
          phone: `+91${digits}`,
          language,
          pincode: cleanPincode || null,
        });
        return row;
      });

      res.status(200).json({ id: inserted.id, code: inserted.code });
      return;
    }

    const { data: dupes, error: dupeErr } = await req.supabase!.from("kob_leads").select("id, phone, code");
    if (dupeErr) {
      res.status(500).json({ error: dupeErr.message });
      return;
    }

    const clash = (dupes ?? []).find((l: any) => String(l.phone ?? "").replace(/\D/g, "").slice(-10) === digits);
    if (clash) {
      res.status(400).json({ error: `Phone already exists in CRM (lead ${clash.code})` });
      return;
    }

    const { data: last } = await req.supabase!
      .from("kob_leads")
      .select("code")
      .like("code", "IND-%")
      .order("code", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextNum = 1;
    const m = /^IND-(\d+)$/.exec((last as any)?.code ?? "");
    if (m) nextNum = parseInt(m[1], 10) + 1;
    const code = `IND-${String(nextNum).padStart(5, "0")}`;

    // Team Leaders may only insert leads owned by their own team (RLS).
    const { data: isTL } = await req.supabase!.rpc("has_role", { _user_id: req.userId, _role: "team_leader" });

    const { data: inserted, error } = await req.supabase!
      .from("kob_leads")
      .insert({
        code,
        full_name: full_name.trim(),
        phone: `+91${digits}`,
        language,
        source_id: source_id || null,
        stage: "LEAD_INBOX",
        mode: "MANUAL",
        team_leader_id: isTL ? req.userId : null,
        notes: cleanPincode ? `Pincode: ${cleanPincode}` : null,
      })
      .select("id, code")
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, req.userId, "lead_manual_create", "kob_leads", inserted.id, {
      code: inserted.code,
      phone: `+91${digits}`,
      language,
      pincode: cleanPincode || null,
    });

    res.status(200).json({ id: inserted.id, code: inserted.code });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for updateLeadStage
 * Migrated 1:1 from src/lib/kob.functions.ts (line 569).
 * Updates lead stage, firing database triggers (validate_stage_transition, on_lead_stage_change, log_lead_activity).
 */
export async function updateLeadStage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.supabase || !req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const userId = req.userId;

    const leadId = (req.params.id ?? req.body?.leadId) as string | undefined;
    const stage = req.body?.stage as string | undefined;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!leadId || !uuidRegex.test(leadId)) {
      res.status(400).json({ error: "leadId must be a valid UUID" });
      return;
    }

    if (!stage || typeof stage !== "string" || stage.trim().length === 0) {
      res.status(400).json({ error: "stage is required" });
      return;
    }

    if (useRds()) {
      // STAGE 10G: scope resolved server-side; unknown role denied, matching
      // the Stage 10E1/10E2 policy for every other RDS lead endpoint.
      const scope = await resolveLeadScopeOrDeny(userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      try {
        await withTransaction(userId, async (client) => {
          // validate_stage_transition/on_lead_stage_change/log_lead_activity/
          // auto_enroll_retargeting/cancel_retargeting_on_exit fire unmodified,
          // with auth.uid() = userId for the duration of this transaction.
          await leadRepo.updateLeadStage(client, leadId.trim(), stage.trim(), scope);
          await adminRepo.insertAuditLog(client, userId, "lead_stage_update", "kob_leads", leadId.trim(), { stage: stage.trim() });
        });
      } catch (e: any) {
        // Matches this endpoint's existing 400 (not 500) error status.
        res.status(400).json({ error: e?.message ?? "Stage update failed" });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    const { error } = await req.supabase
      .from("kob_leads")
      .update({ stage: stage.trim() as any })
      .eq("id", leadId.trim());

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    await logAudit(req.supabase, userId, "lead_stage_update", "kob_leads", leadId.trim(), { stage: stage.trim() });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

const IMPORT_LANGUAGES = [
  "TAMIL", "TELUGU", "MALAYALAM", "HINDI", "BENGALI",
  "ENGLISH", "KANNADA", "MARATHI", "GUJARATI", "OTHERS",
] as const;

function normalizeImportPhone(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const trimmed = digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
  return trimmed.length > 10 ? trimmed.slice(-10) : trimmed;
}

/**
 * STAGE 10I-E — RDS path for importLeads, factored out so the row-processing
 * loop mirrors the Supabase path's per-row resilience (one row's insert
 * failure doesn't roll back previously imported rows). Each row's INSERT
 * runs in its own withTransaction() so validate/duplicate/initial-template
 * triggers see the correct auth.uid() for that row, exactly like a normal
 * caller-JWT PostgREST insert would.
 */
async function importLeadsRds(req: Request, res: Response, rows: any[], userId: string): Promise<void> {
  const ref = await leadRepo.getImportReferenceData();
  const defaultMode = ref.defaultMode;

  const brandByCode = new Map<string, any>();
  for (const b of ref.brands) brandByCode.set(String(b.code).trim().toLowerCase(), b);
  const stateByName = new Map<string, any>();
  for (const s of ref.states) stateByName.set(String(s.name).trim().toLowerCase(), s);
  const citiesByName = new Map<string, any[]>();
  for (const c of ref.cities) {
    const k = String(c.name).trim().toLowerCase();
    citiesByName.set(k, [...(citiesByName.get(k) ?? []), c]);
  }
  const sourceByName = new Map<string, any>();
  for (const s of ref.sources) sourceByName.set(String(s.name).replace(/\s+/g, " ").trim().toLowerCase(), s);

  const existingPhones = new Set<string>();
  for (const phone of ref.existingPhones) {
    const n = normalizeImportPhone(phone);
    if (n) existingPhones.add(n);
  }

  // Team Leaders may only insert leads owned by their own team (same rule as the Supabase RLS with-check).
  const isTL = await actorHasRole(getPool(), userId, "team_leader");

  const results: Array<{ row: number; name: string; phone: string; status: "IMPORTED" | "DUPLICATE" | "INVALID"; reason?: string }> = [];
  const seenInFile = new Set<string>();

  const lastCode = await leadRepo.getLastImportCode();
  let nextNum = 1;
  const mCode = /^IMP-(\d+)$/.exec(lastCode ?? "");
  if (mCode) nextNum = parseInt(mCode[1], 10) + 1;

  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 2;
    const name = String(r.full_name ?? "").trim() || "Unknown";
    const rawPhone = String(r.phone ?? "").trim();
    const phoneNorm = normalizeImportPhone(rawPhone);

    if (phoneNorm && (existingPhones.has(phoneNorm) || seenInFile.has(phoneNorm))) {
      results.push({ row: rowNo, name, phone: rawPhone, status: "DUPLICATE", reason: "Phone already exists in CRM" });
      continue;
    }

    const channel = String(r.channel ?? "").trim().toUpperCase();
    const explicitSource = String(r.lead_source ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const sourceName = explicitSource || (channel === "APP" ? "mobile app" : channel === "WEBSITE" ? "website form" : "");
    const source = (sourceName ? sourceByName.get(sourceName) : null) ?? null;

    const brandCode = String(r.brand_code ?? "").trim().toLowerCase();
    const brand = brandByCode.get(brandCode) ?? null;

    const stateName = String(r.state_name ?? "").trim().toLowerCase();
    const state = stateByName.get(stateName) ?? null;

    const cityName = String(r.city_name ?? "").trim().toLowerCase();
    const cityMatches = citiesByName.get(cityName) ?? [];
    const city = (state ? cityMatches.find((c) => c.state_id === state.id) : cityMatches[0]) ?? cityMatches[0] ?? null;

    const langRaw = String(r.language ?? "").replace(/\s+/g, " ").trim().toUpperCase();
    const language = (IMPORT_LANGUAGES as readonly string[]).includes(langRaw) ? langRaw : "OTHERS";

    let investment: number | null = null;
    const invRaw = r.investment_capacity;
    if (invRaw !== undefined && String(invRaw).trim() !== "") {
      const n = Number(String(invRaw).replace(/[^\d.]/g, ""));
      investment = Number.isFinite(n) ? n : null;
    }

    const email = String(r.email ?? "").trim() || null;
    const code = `IMP-${String(nextNum).padStart(5, "0")}`;

    let insertedLead: { id: string; stage: string } | null = null;
    try {
      insertedLead = await withTransaction(userId, async (client) => {
        return leadRepo.insertImportLead(client, {
          code,
          full_name: name,
          phone: rawPhone || null,
          email,
          mode: defaultMode,
          language,
          brand_id: brand?.id ?? null,
          state_id: state?.id ?? (city?.state_id ?? null),
          district_id: city?.district_id ?? null,
          city_id: city?.id ?? null,
          source_id: source?.id ?? null,
          investment_capacity: investment,
          team_leader_id: isTL ? userId : null,
        });
      });
    } catch (e: any) {
      const message = e?.message ?? String(e);
      const reason = /duplicate key/i.test(message) ? "Duplicate lead (already exists in CRM)" : message;
      results.push({ row: rowNo, name, phone: rawPhone, status: "INVALID", reason });
      continue;
    }

    nextNum++;
    imported++;
    if (source && String(source.name).trim().toLowerCase() === "meta ads" && insertedLead.stage !== "DUPLICATE_LEAD") {
      await withTransaction(userId, async (client) => {
        await leadRepo.callCsvImportMetaAdsInitial(client, insertedLead!.id);
      }).catch(() => { /* lead stays imported */ });
    }
    if (phoneNorm) { seenInFile.add(phoneNorm); existingPhones.add(phoneNorm); }
    results.push({ row: rowNo, name, phone: rawPhone, status: "IMPORTED" });
  }

  const duplicates = results.filter((r) => r.status === "DUPLICATE").length;
  const invalid = results.filter((r) => r.status === "INVALID").length;

  await withTransaction(userId, async (client) => {
    await adminRepo.insertAuditLog(client, userId, "leads_import", "kob_leads", null, {
      total: rows.length, imported, duplicates, invalid, default_mode: defaultMode,
    });
  });

  res.status(200).json({ total: rows.length, imported, duplicates, invalid, defaultMode, results });
}

/**
 * Controller for importLeads
 * Migrated 1:1 from src/lib/import-leads.functions.ts (line 6).
 */
export async function importLeads(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId || (!useRds() && !req.supabase)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "No data rows provided" });
      return;
    }

    if (rows.length > 2000) {
      res.status(400).json({ error: "Maximum 2000 rows allowed per import" });
      return;
    }

    const userId = req.userId;

    if (useRds()) {
      await importLeadsRds(req, res, rows, userId);
      return;
    }

    const supabase = req.supabase!;

    const [cfgRes, brandsRes, statesRes, citiesRes, sourcesRes, existingRes] = await Promise.all([
      supabase.from("kob_configuration").select("default_mode").eq("id", 1).maybeSingle(),
      supabase.from("brands").select("id, code, name"),
      supabase.from("india_states").select("id, name"),
      supabase.from("india_cities").select("id, name, state_id, district_id"),
      supabase.from("lead_sources").select("id, name"),
      supabase.from("kob_leads").select("phone"),
    ]);

    const defaultMode = ((cfgRes.data as any)?.default_mode ?? "AUTO") as "AUTO" | "MANUAL";

    const brandByCode = new Map<string, any>();
    for (const b of (brandsRes.data ?? []) as any[]) brandByCode.set(String(b.code).trim().toLowerCase(), b);
    const stateByName = new Map<string, any>();
    for (const s of (statesRes.data ?? []) as any[]) stateByName.set(String(s.name).trim().toLowerCase(), s);
    const citiesByName = new Map<string, any[]>();
    for (const c of (citiesRes.data ?? []) as any[]) {
      const k = String(c.name).trim().toLowerCase();
      citiesByName.set(k, [...(citiesByName.get(k) ?? []), c]);
    }
    const sourceByName = new Map<string, any>();
    for (const s of (sourcesRes.data ?? []) as any[]) sourceByName.set(String(s.name).replace(/\s+/g, " ").trim().toLowerCase(), s);

    const existingPhones = new Set<string>();
    for (const l of (existingRes.data ?? []) as any[]) {
      const n = normalizeImportPhone(l.phone);
      if (n) existingPhones.add(n);
    }

    // Team Leaders may only insert leads owned by their own team (RLS with-check).
    const { data: isTL } = await supabase.rpc("has_role", { _user_id: userId, _role: "team_leader" as any });

    const results: Array<{
      row: number;
      name: string;
      phone: string;
      status: "IMPORTED" | "DUPLICATE" | "INVALID";
      reason?: string;
    }> = [];
    const seenInFile = new Set<string>();

    const { data: lastCode } = await supabase
      .from("kob_leads").select("code").like("code", "IMP-%")
      .order("code", { ascending: false }).limit(1).maybeSingle();
    let nextNum = 1;
    const m = /^IMP-(\d+)$/.exec((lastCode as any)?.code ?? "");
    if (m) nextNum = parseInt(m[1], 10) + 1;

    let imported = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2; // header is row 1
      const name = String(r.full_name ?? "").trim() || "Unknown";
      const rawPhone = String(r.phone ?? "").trim();
      const phoneNorm = normalizeImportPhone(rawPhone);

      if (phoneNorm && (existingPhones.has(phoneNorm) || seenInFile.has(phoneNorm))) {
        results.push({ row: rowNo, name, phone: rawPhone, status: "DUPLICATE", reason: "Phone already exists in CRM" });
        continue;
      }

      const channel = String(r.channel ?? "").trim().toUpperCase();
      const explicitSource = String(r.lead_source ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const sourceName = explicitSource || (channel === "APP" ? "mobile app" : channel === "WEBSITE" ? "website form" : "");
      const source = (sourceName ? sourceByName.get(sourceName) : null) ?? null;

      const brandCode = String(r.brand_code ?? "").trim().toLowerCase();
      const brand = brandByCode.get(brandCode) ?? null;

      const stateName = String(r.state_name ?? "").trim().toLowerCase();
      const state = stateByName.get(stateName) ?? null;

      const cityName = String(r.city_name ?? "").trim().toLowerCase();
      const cityMatches = citiesByName.get(cityName) ?? [];
      const city = (state ? cityMatches.find((c) => c.state_id === state.id) : cityMatches[0]) ?? cityMatches[0] ?? null;

      const langRaw = String(r.language ?? "").replace(/\s+/g, " ").trim().toUpperCase();
      const language = (IMPORT_LANGUAGES as readonly string[]).includes(langRaw) ? langRaw : "OTHERS";

      let investment: number | null = null;
      const invRaw = r.investment_capacity;
      if (invRaw !== undefined && String(invRaw).trim() !== "") {
        const n = Number(String(invRaw).replace(/[^\d.]/g, ""));
        investment = Number.isFinite(n) ? n : null;
      }

      const email = String(r.email ?? "").trim() || null;

      const code = `IMP-${String(nextNum).padStart(5, "0")}`;
      const { data: insertedLead, error } = await supabase.from("kob_leads").insert({
        code,
        full_name: name,
        phone: rawPhone || null,
        email,
        stage: "LEAD_INBOX" as const,
        mode: defaultMode as any,
        language: language as any,
        brand_id: brand?.id ?? null,
        state_id: state?.id ?? (city?.state_id ?? null),
        district_id: city?.district_id ?? null,
        city_id: city?.id ?? null,
        source_id: source?.id ?? null,
        investment_capacity: investment,
        team_leader_id: isTL ? userId : null,
      }).select("id, stage").single();

      if (error) {
        const reason = /row-level security/i.test(error.message)
          ? `Not permitted to create this lead (${error.message})`
          : /duplicate key/i.test(error.message)
            ? "Duplicate lead (already exists in CRM)"
            : error.message;
        results.push({ row: rowNo, name, phone: rawPhone, status: "INVALID", reason });
        continue;
      }

      nextNum++;
      imported++;
      if (source && String(source.name).trim().toLowerCase() === "meta ads" && insertedLead && (insertedLead as any).stage !== "DUPLICATE_LEAD") {
        try { await supabase.rpc("send_csv_import_meta_ads_initial" as any, { _lead_id: (insertedLead as any).id }); } catch { /* lead stays imported */ }
      }
      if (phoneNorm) { seenInFile.add(phoneNorm); existingPhones.add(phoneNorm); }
      results.push({ row: rowNo, name, phone: rawPhone, status: "IMPORTED" });
    }

    const duplicates = results.filter((r) => r.status === "DUPLICATE").length;
    const invalid = results.filter((r) => r.status === "INVALID").length;

    await logAudit(supabase, userId, "leads_import", "kob_leads", null, {
      total: rows.length, imported, duplicates, invalid, default_mode: defaultMode,
    } as any);

    res.status(200).json({ total: rows.length, imported, duplicates, invalid, defaultMode, results });
  } catch (err) {
    next(err);
  }
}

