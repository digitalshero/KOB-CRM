import { getPool } from "../db/pool.js";

/**
 * STAGE 10C — direct-RDS repository for read-only master/reference data.
 *
 * Every query here is a plain SELECT with no row-level filtering and no
 * dependency on auth.uid(): the matching Supabase/PostgREST behavior today
 * is RLS granting `true` to any authenticated user (see Stage 10A audit),
 * i.e. "every signed-in user sees the same rows." No transaction/actor
 * context is needed for that — the caller (controller) still enforces
 * `requireAuth` exactly as before; this repository is only reached after
 * that middleware has already run.
 *
 * Numeric columns are cast to float8 so pg returns a JS number, matching
 * what PostgREST/Supabase returns for `numeric` columns (pg's default
 * driver behavior returns `numeric` as a string, which would NOT match).
 */

export interface Brand {
  id: string;
  code: string;
  name: string;
  is_shero: boolean;
  active: boolean;
  created_at: string;
}

export async function listBrands(): Promise<Brand[]> {
  const { rows } = await getPool().query<Brand>(
    `SELECT id, code, name, is_shero, active, created_at FROM public.brands ORDER BY code`,
  );
  return rows;
}

export interface LeadSource {
  id: string;
  name: string;
  category: string | null;
  cost_per_lead: number | null;
  active: boolean;
  created_at: string;
}

export async function listSources(): Promise<LeadSource[]> {
  const { rows } = await getPool().query<LeadSource>(
    `SELECT id, name, category, cost_per_lead::float8 AS cost_per_lead, active, created_at
     FROM public.lead_sources ORDER BY name`,
  );
  return rows;
}

export interface IndiaState {
  id: string;
  code: string | null;
  name: string;
  region: string | null;
  active: boolean;
  created_at: string;
}

export async function listStates(): Promise<IndiaState[]> {
  const { rows } = await getPool().query<IndiaState>(
    `SELECT id, code, name, region, active, created_at FROM public.india_states ORDER BY name`,
  );
  return rows;
}

export interface StatePincodeTotalRow {
  state: string;
  total_pincodes: number;
}
export interface CityScopeRow {
  state_name: string | null;
  native_kitchen_scope: number | null;
  other_kitchen_scope: number | null;
  city_id: string;
}
export interface StateMetaRow {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
}

/** Raw rows for the three sources listStatePincodeTotals() aggregates client-side. */
export async function listStatePincodeTotalsRaw(): Promise<{
  totals: StatePincodeTotalRow[];
  scope: CityScopeRow[];
  states: StateMetaRow[];
}> {
  const pool = getPool();
  const [totalsRes, scopeRes, statesRes] = await Promise.all([
    pool.query<StatePincodeTotalRow>(
      `SELECT state, total_pincodes::int AS total_pincodes FROM public.v_state_pincode_totals ORDER BY state`,
    ),
    pool.query<CityScopeRow>(
      `SELECT state_name, native_kitchen_scope::float8 AS native_kitchen_scope,
              other_kitchen_scope::float8 AS other_kitchen_scope, city_id
       FROM public.v_city_scope`,
    ),
    pool.query<StateMetaRow>(`SELECT id, name, code, active FROM public.india_states`),
  ]);
  return { totals: totalsRes.rows, scope: scopeRes.rows, states: statesRes.rows };
}

export interface CityWithScopeRow {
  city_id: string;
  city_name: string;
  tier: number | null;
  pincode_count: number | null;
  city_active: boolean | null;
  state_id: string;
  state_name: string | null;
  state_active: boolean | null;
  district_id: string;
  district_name: string | null;
  district_active: boolean | null;
  native_brand_id: string | null;
  native_brand_name: string | null;
  native_brand_multiplier: number | null;
  other_brand_multiplier: number | null;
  native_kitchen_scope: number | null;
  other_kitchen_scope: number | null;
  district_aliases: string[];
  state_aliases: string[];
}

export async function listCitiesWithScopeRaw(): Promise<{
  scope: Omit<CityWithScopeRow, "district_aliases" | "state_aliases">[];
  aliases: Map<string, { district_aliases: string[]; state_aliases: string[] }>;
}> {
  const pool = getPool();
  const [scopeRes, aliasRes] = await Promise.all([
    pool.query(
      `SELECT city_id, city_name, tier, pincode_count, city_active,
              state_id, state_name, state_active, district_id, district_name, district_active,
              native_brand_id, native_brand_name,
              native_brand_multiplier::float8 AS native_brand_multiplier,
              other_brand_multiplier::float8 AS other_brand_multiplier,
              native_kitchen_scope::float8 AS native_kitchen_scope,
              other_kitchen_scope::float8 AS other_kitchen_scope
       FROM public.v_city_scope ORDER BY state_name`,
    ),
    pool.query<{ id: string; district_aliases: string[] | null; state_aliases: string[] | null }>(
      `SELECT id, district_aliases, state_aliases FROM public.india_cities`,
    ),
  ]);
  const aliases = new Map<string, { district_aliases: string[]; state_aliases: string[] }>();
  for (const r of aliasRes.rows) {
    aliases.set(r.id, { district_aliases: r.district_aliases ?? [], state_aliases: r.state_aliases ?? [] });
  }
  return { scope: scopeRes.rows, aliases };
}

export interface StateNativeBrandRow {
  state_id: string;
  brand_id: string;
  india_states: { name: string; code: string | null } | null;
  brands: { name: string; code: string } | null;
}

export async function listStateNativeBrands(): Promise<StateNativeBrandRow[]> {
  // Mirrors the Supabase embedded-select
  // `.select("state_id, brand_id, india_states(name, code), brands(name, code)")`
  // with explicit joins and a nested-object shape for parity.
  const { rows } = await getPool().query(
    `SELECT snb.state_id, snb.brand_id,
            CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('name', s.name, 'code', s.code) END AS india_states,
            CASE WHEN b.id IS NULL THEN NULL ELSE jsonb_build_object('name', b.name, 'code', b.code) END AS brands
     FROM public.state_native_brand snb
     LEFT JOIN public.india_states s ON s.id = snb.state_id
     LEFT JOIN public.brands b ON b.id = snb.brand_id`,
  );
  return rows;
}

// ---- STAGE 10I-F: small remaining read-only listing endpoints ----

export async function listRecentAuditLogs(): Promise<Record<string, unknown>[]> {
  const { rows } = await getPool().query(`SELECT * FROM public.audit_logs ORDER BY created_at DESC LIMIT 100`);
  return rows;
}

export async function listRateableUsers(): Promise<{ user_id: string; role: string; full_name: string; email: string | null }[]> {
  const { rows } = await getPool().query(
    `SELECT ur.user_id, ur.role::text AS role, p.full_name, p.email
     FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = ANY($1::text[])`,
    [["executive", "team_leader", "kob_manager"]],
  );
  return rows;
}

export async function listRoleWeights(): Promise<Record<string, unknown>[]> {
  const { rows } = await getPool().query(`SELECT * FROM public.scv_role_weights`);
  return rows;
}

export async function listAllProfilesWithRoles(): Promise<{ id: string; full_name: string; email: string | null; phone: string | null; team_leader_id: string | null; roles: string[] }[]> {
  const pool = getPool();
  const [profiles, roles] = await Promise.all([
    pool.query(`SELECT id, full_name, email, phone, team_leader_id FROM public.profiles`),
    pool.query(`SELECT user_id, role::text AS role FROM public.user_roles`),
  ]);
  const roleByUser = new Map<string, string[]>();
  for (const r of roles.rows) {
    const arr = roleByUser.get(r.user_id) ?? [];
    arr.push(r.role);
    roleByUser.set(r.user_id, arr);
  }
  return profiles.rows.map((p: any) => ({ ...p, roles: roleByUser.get(p.id) ?? [] }));
}

export async function listManualRatings(): Promise<Record<string, unknown>[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM public.scv_manual_ratings ORDER BY period DESC, rated_at DESC LIMIT 500`,
  );
  return rows;
}

export async function getMyAllocationMode(userId: string): Promise<string | null> {
  const { rows } = await getPool().query(`SELECT allocation_mode FROM public.profiles WHERE id = $1`, [userId]);
  return rows[0]?.allocation_mode ?? null;
}

export async function listGallaboxTemplates(): Promise<Record<string, unknown>[]> {
  const { rows } = await getPool().query(`SELECT * FROM public.gallabox_templates ORDER BY name`);
  return rows;
}

export async function getProfileById(userId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await getPool().query(`SELECT * FROM public.profiles WHERE id = $1`, [userId]);
  return rows[0] ?? null;
}

/** Mirrors getMyExecOverview()'s dueToday embed: `.select("...,kob_leads(code,full_name)")`. */
export async function getDueTodayRetargeting(leadIds: string[], untilIso: string): Promise<{
  id: string; lead_id: string; bucket: string | null; next_touch_at: string | null; phase: string | null;
  lead: { code: string; full_name: string } | null;
}[]> {
  if (leadIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT rs.id, rs.lead_id, rs.bucket::text AS bucket, rs.next_touch_at, rs.phase::text AS phase,
            l.code AS lead_code, l.full_name AS lead_full_name
     FROM public.retargeting_schedule rs
     JOIN public.kob_leads l ON l.id = rs.lead_id
     WHERE rs.lead_id = ANY($1::uuid[]) AND rs.is_dead = false AND rs.next_touch_at <= $2
     ORDER BY rs.next_touch_at ASC`,
    [leadIds, untilIso],
  );
  return rows.map((r: any) => ({
    id: r.id, lead_id: r.lead_id, bucket: r.bucket, next_touch_at: r.next_touch_at, phase: r.phase,
    lead: { code: r.lead_code, full_name: r.lead_full_name },
  }));
}

/** Mirrors listGallaboxFireQueue()'s double embed: `lead:kob_leads(...)`, `template:gallabox_templates(...)`. */
export async function listGallaboxFireQueue(): Promise<Record<string, unknown>[]> {
  const { rows } = await getPool().query(
    `SELECT q.id, q.status::text AS status, q.channel::text AS channel, q.created_at, q.fired_at, q.error,
            jsonb_build_object('code', l.code, 'full_name', l.full_name, 'language', l.language, 'mode', l.mode, 'email', l.email) AS lead,
            jsonb_build_object('name', t.name, 'language', t.language, 'email_subject', t.email_subject, 'email_body', t.email_body) AS template
     FROM public.gallabox_fire_queue q
     LEFT JOIN public.kob_leads l ON l.id = q.lead_id
     LEFT JOIN public.gallabox_templates t ON t.id = q.template_id
     ORDER BY q.created_at DESC LIMIT 100`,
  );
  return rows;
}

/** Mirrors listWhatsappMessages()'s `.order("last_message_at",{ascending:false,nullsFirst:false}).range(...)`. */
export async function listWhatsappMessagesPage(offset: number, size: number, unreadOnly: boolean): Promise<Record<string, unknown>[]> {
  const extra = unreadOnly ? "AND has_unread_messages = true" : "";
  const { rows } = await getPool().query(
    `SELECT id, code, full_name, phone, stage::text AS stage, language::text AS language, assigned_to,
            last_message, last_message_at, unread_message_count, has_unread_messages
     FROM public.kob_leads
     WHERE last_message IS NOT NULL ${extra}
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT $1 OFFSET $2`,
    [size, offset],
  );
  return rows;
}
