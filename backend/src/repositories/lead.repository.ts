import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";
import type { LeadScope } from "../db/authz.js";
import { leadScopeSql } from "../db/authz.js";
import { withTransaction } from "../db/transaction.js";
import { insertAuditLog } from "./admin.repository.js";

/**
 * STAGE 10E1 — direct-RDS repository for core lead READS (listLeads,
 * getLeadDetail) with EXPLICIT server-side authorization. kob_app_user owns
 * every table, so RDS RLS does not apply to it — row scoping here is done
 * entirely in the WHERE clause via a server-resolved `LeadScope`
 * (never from client-supplied input). See src/db/authz.ts.
 *
 * All queries are parameterized; no user input is ever concatenated into SQL.
 */

export interface LeadListRow {
  id: string;
  code: string;
  full_name: string;
  phone: string | null;
  stage: string;
  mode: string;
  language: string | null;
  tags: string[];
  auto_fired_status: string;
  gallabox_template_sent: boolean;
  av_link_sent: boolean;
  form_link_sent: boolean;
  scv_score: number | null;
  investment_capacity: number | null;
  next_action: string | null;
  assigned_to: string | null;
  created_at: string;
  last_activity_at: string | null;
  stage_entered_at: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_message_count: number | null;
  has_unread_messages: boolean | null;
  brand_id: string | null;
  state_id: string | null;
  city_id: string | null;
  source_id: string | null;
  brands: { name: string } | null;
  india_states: { name: string; code: string | null } | null;
  india_cities: { name: string; tier: number | null } | null;
  lead_sources: { name: string } | null;
}

const LEAD_LIST_SELECT = `
  SELECT l.id, l.code, l.full_name, l.phone, l.stage::text AS stage, l.mode::text AS mode,
         l.language::text AS language, l.tags, l.auto_fired_status::text AS auto_fired_status,
         l.gallabox_template_sent, l.av_link_sent, l.form_link_sent, l.scv_score,
         l.investment_capacity::float8 AS investment_capacity, l.next_action, l.assigned_to,
         l.created_at, l.last_activity_at, l.stage_entered_at, l.last_message, l.last_message_at,
         l.unread_message_count, l.has_unread_messages, l.brand_id, l.state_id, l.city_id, l.source_id,
         CASE WHEN br.id IS NULL THEN NULL ELSE jsonb_build_object('name', br.name) END AS brands,
         CASE WHEN st.id IS NULL THEN NULL ELSE jsonb_build_object('name', st.name, 'code', st.code) END AS india_states,
         CASE WHEN ci.id IS NULL THEN NULL ELSE jsonb_build_object('name', ci.name, 'tier', ci.tier) END AS india_cities,
         CASE WHEN src.id IS NULL THEN NULL ELSE jsonb_build_object('name', src.name) END AS lead_sources
  FROM public.kob_leads l
  LEFT JOIN public.brands br ON br.id = l.brand_id
  LEFT JOIN public.india_states st ON st.id = l.state_id
  LEFT JOIN public.india_cities ci ON ci.id = l.city_id
  LEFT JOIN public.lead_sources src ON src.id = l.source_id
`;

export interface LeadListFilters {
  stage?: string;
  limit: number;
  from?: string;
  to?: string;
}

/**
 * Mirrors listLeads()'s exact Supabase query shape:
 *  - stage given            -> WHERE stage = $stage, date range (if any) applied
 *                               on stage_entered_at when stage === 'KTN_CS', else created_at.
 *  - no stage, no range     -> no filter at all (everything, incl. KTN_CS).
 *  - no stage, range given  -> TWO queries, concatenated in this order:
 *       1) stage <> 'KTN_CS' AND created_at in [from,to]
 *       2) stage  = 'KTN_CS' AND stage_entered_at in [from,to]
 *    (this matches the existing Supabase code's two-query split; each half
 *    is independently capped at `limit`, exactly like the original).
 * ORDER BY created_at DESC always, regardless of which column was filtered.
 *
 * NOTE: the Supabase path loops in pages of 1000 rows only to work around
 * PostgREST's hardcoded per-request cap — Postgres itself has no such cap,
 * so a single `LIMIT $n` query here produces the identical result set.
 *
 * `scope` is resolved server-side (never from client input) and applied as
 * an unconditional AND on every branch.
 */
/**
 * Builds the one or two condition/params blocks that listLeadRows/
 * countLeadRows both filter by — the single place the "KTN_CS uses
 * stage_entered_at, everything else uses created_at" rule is expressed,
 * so every consumer (list or count) stays mechanically in sync.
 */
function buildLeadListConditionBlocks(scope: LeadScope, filters: Omit<LeadListFilters, "limit">): { conditions: string[]; params: unknown[] }[] {
  const { stage, from, to } = filters;
  const hasRange = Boolean(from || to);
  const blocks: { conditions: string[]; params: unknown[] }[] = [];

  // --- main block ---
  {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const scopeSql = leadScopeSql(scope, params.length + 1);
    if (scopeSql.sql !== "TRUE") { conditions.push(scopeSql.sql); params.push(...scopeSql.params); }

    if (stage) {
      params.push(stage);
      conditions.push(`l.stage::text = $${params.length}`);
      const dateCol = stage === "KTN_CS" ? "stage_entered_at" : "created_at";
      if (from) { params.push(from); conditions.push(`l.${dateCol} >= $${params.length}`); }
      if (to) { params.push(to); conditions.push(`l.${dateCol} <= $${params.length}`); }
    } else if (hasRange) {
      conditions.push(`l.stage <> 'KTN_CS'`);
      if (from) { params.push(from); conditions.push(`l.created_at >= $${params.length}`); }
      if (to) { params.push(to); conditions.push(`l.created_at <= $${params.length}`); }
    }

    blocks.push({ conditions, params });
  }

  // --- second block: KTN_CS rows filtered by stage_entered_at, only when !stage && hasRange ---
  if (!stage && hasRange) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const scopeSql = leadScopeSql(scope, params.length + 1);
    if (scopeSql.sql !== "TRUE") { conditions.push(scopeSql.sql); params.push(...scopeSql.params); }

    conditions.push(`l.stage = 'KTN_CS'`);
    if (from) { params.push(from); conditions.push(`l.stage_entered_at >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`l.stage_entered_at <= $${params.length}`); }

    blocks.push({ conditions, params });
  }

  return blocks;
}

export async function listLeadRows(scope: LeadScope, filters: LeadListFilters): Promise<LeadListRow[]> {
  const { limit } = filters;
  const pool = getPool();
  const out: LeadListRow[] = [];

  for (const { conditions, params } of buildLeadListConditionBlocks(scope, filters)) {
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitIdx = params.length + 1;
    const { rows } = await pool.query<LeadListRow>(
      `${LEAD_LIST_SELECT} ${where} ORDER BY l.created_at DESC LIMIT $${limitIdx}`,
      [...params, limit],
    );
    out.push(...rows);
  }

  return out;
}

/**
 * Same exact filter rule as listLeadRows (reused via
 * buildLeadListConditionBlocks), but returns a total count instead of
 * fetching full rows — used by the KOB Dashboard's "Leads" KPI card so it
 * matches the Lead Inbox page's total for the same scope/date range,
 * without paying the cost of pulling every row just to measure .length.
 */
export async function countLeadRows(scope: LeadScope, filters: Omit<LeadListFilters, "limit">): Promise<number> {
  const pool = getPool();
  let total = 0;

  for (const { conditions, params } of buildLeadListConditionBlocks(scope, filters)) {
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) FROM public.kob_leads l ${where}`,
      params,
    );
    total += Number(rows[0]?.count ?? 0);
  }

  return total;
}

/** Name lookup used for listLeads' `assigned_profile` enrichment. */
export async function getAssigneeNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { rows } = await getPool().query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM public.profiles WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  for (const r of rows) map.set(r.id, r.full_name);
  return map;
}

export interface LeadDetailRow {
  id: string; code: string; full_name: string; phone: string | null; email: string | null;
  brand_id: string | null; state_id: string | null; district_id: string | null; city_id: string | null; source_id: string | null;
  stage: string; assigned_to: string | null; team_leader_id: string | null;
  scv_score: number | null; investment_capacity: number | null; notes: string | null;
  converted_at: string | null; last_activity_at: string | null; created_at: string; updated_at: string;
  mode: string; auto_fired_status: string; gallabox_template_sent: boolean; av_link_sent: boolean; form_link_sent: boolean;
  language: string | null; assigned_language_executive: string | null; stage_entered_at: string | null;
  next_action: string | null; last_message: string | null; last_message_at: string | null;
  unread_message_count: number | null; has_unread_messages: boolean | null; tags: string[]; cuisine: string | null;
  brands: { name: string; code: string } | null;
  india_states: { name: string; code: string | null } | null;
  india_cities: { name: string; tier: number | null } | null;
  lead_sources: { name: string; category: string | null } | null;
}

/**
 * Mirrors getLeadDetail()'s `.select("*", ...).eq("id", leadId).maybeSingle()`.
 *
 * SECURITY FIX (Stage 10A gap): the existing Supabase path always uses the
 * service-role client here with NO ownership check — any authenticated user
 * can fetch any lead by ID. For DATA_BACKEND=rds, ownership is enforced
 * directly in the WHERE clause (`AND assigned_to = $actorId` for scope.kind
 * === "assigned_to"), so an inaccessible lead simply does not come back as a
 * row — collapsing "doesn't exist" and "exists but not yours" into the same
 * null result, preserving the existing 404 contract without revealing which
 * case occurred.
 */
export async function getLeadById(leadId: string, scope: LeadScope): Promise<LeadDetailRow | null> {
  const params: unknown[] = [leadId];
  const conditions = [`l.id = $1`];
  const scopeSql = leadScopeSql(scope, params.length + 1);
  if (scopeSql.sql !== "TRUE") { conditions.push(scopeSql.sql); params.push(...scopeSql.params); }

  const { rows } = await getPool().query<LeadDetailRow>(
    `SELECT l.id, l.code, l.full_name, l.phone, l.email, l.brand_id, l.state_id, l.district_id, l.city_id, l.source_id,
            l.stage::text AS stage, l.assigned_to, l.team_leader_id, l.scv_score,
            l.investment_capacity::float8 AS investment_capacity, l.notes, l.converted_at, l.last_activity_at,
            l.created_at, l.updated_at, l.mode::text AS mode, l.auto_fired_status::text AS auto_fired_status,
            l.gallabox_template_sent, l.av_link_sent, l.form_link_sent, l.language::text AS language,
            l.assigned_language_executive, l.stage_entered_at, l.next_action, l.last_message, l.last_message_at,
            l.unread_message_count, l.has_unread_messages, l.tags, l.cuisine,
            CASE WHEN br.id IS NULL THEN NULL ELSE jsonb_build_object('name', br.name, 'code', br.code) END AS brands,
            CASE WHEN st.id IS NULL THEN NULL ELSE jsonb_build_object('name', st.name, 'code', st.code) END AS india_states,
            CASE WHEN ci.id IS NULL THEN NULL ELSE jsonb_build_object('name', ci.name, 'tier', ci.tier) END AS india_cities,
            CASE WHEN src.id IS NULL THEN NULL ELSE jsonb_build_object('name', src.name, 'category', src.category) END AS lead_sources
     FROM public.kob_leads l
     LEFT JOIN public.brands br ON br.id = l.brand_id
     LEFT JOIN public.india_states st ON st.id = l.state_id
     LEFT JOIN public.india_cities ci ON ci.id = l.city_id
     LEFT JOIN public.lead_sources src ON src.id = l.source_id
     WHERE ${conditions.join(" AND ")}`,
    params,
  );
  return rows[0] ?? null;
}

export interface LeadStageHistoryRow {
  id: string; from_stage: string | null; to_stage: string; created_at: string; changed_by: string | null; note: string | null;
}

/** Only ever called after getLeadById() has already confirmed access to leadId. */
export async function getLeadStageHistory(leadId: string): Promise<LeadStageHistoryRow[]> {
  const { rows } = await getPool().query<LeadStageHistoryRow>(
    `SELECT id, from_stage::text AS from_stage, to_stage::text AS to_stage, created_at, changed_by, note
     FROM public.lead_stage_history WHERE lead_id = $1 ORDER BY created_at ASC`,
    [leadId],
  );
  return rows;
}

export interface LeadActivityRow {
  id: string; activity_type: string; detail: string | null; created_at: string; actor_id: string | null;
}

/** Only ever called after getLeadById() has already confirmed access to leadId. */
export async function getLeadActivities(leadId: string): Promise<LeadActivityRow[]> {
  const { rows } = await getPool().query<LeadActivityRow>(
    `SELECT id, activity_type, detail, created_at, actor_id
     FROM public.lead_activities WHERE lead_id = $1 ORDER BY created_at ASC`,
    [leadId],
  );
  return rows;
}

export interface ProfileRow { id: string; full_name: string; email: string | null }

export async function getProfilesByIds(ids: string[]): Promise<ProfileRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query<ProfileRow>(
    `SELECT id, full_name, email FROM public.profiles WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

/**
 * STAGE 10G — core lead MUTATIONS, each called inside an active
 * withTransaction(req.userId, ...) (see db/transaction.ts). This is what
 * makes auth.uid() resolve to the caller for every trigger these statements
 * fire (validate_stage_transition, on_lead_stage_change, log_lead_activity,
 * auto_enroll_retargeting, cancel_retargeting_on_exit, touch_updated_at) —
 * none of that trigger logic is duplicated here; it runs unmodified on RDS.
 *
 * Every write is scoped server-side via the caller's LeadScope, matching
 * exactly what the Supabase path's kob_leads RLS UPDATE policies already
 * enforce today:
 *   - executive:  WHERE id = $leadId AND assigned_to = $actorId
 *                 (RLS makes an inaccessible row invisible to the UPDATE —
 *                 0 rows affected, no error. The scoped WHERE clause here
 *                 reproduces that exact silent-no-op behavior.)
 *   - team_leader/kob_manager/super_admin: WHERE id = $leadId (org-wide,
 *                 matching their existing RLS policies exactly).
 */

/**
 * Builds the scope condition only (e.g. "assigned_to = $3" or "TRUE"),
 * starting its own placeholder(s) at `scopeParamIndex`. The caller supplies
 * `id = $1` and any SET-clause placeholders itself, then appends
 * `scope.params` to its own parameter array in the same order.
 */
function scopeCondition(scope: LeadScope, scopeParamIndex: number): { sql: string; params: unknown[] } {
  return leadScopeSql(scope, scopeParamIndex);
}

/**
 * Mirrors updateLeadStage()'s `.update({ stage }).eq("id", leadId)`. Does
 * NOT catch trigger exceptions (e.g. validate_stage_transition rejecting an
 * invalid transition) — those propagate to the caller, which maps them to
 * the same 400 status the Supabase path already uses for this endpoint.
 */
export async function updateLeadStage(client: PoolClient, leadId: string, stage: string, scope: LeadScope): Promise<void> {
  const s = scopeCondition(scope, 3);
  await client.query(
    `UPDATE public.kob_leads SET stage = $2 WHERE id = $1 ${s.sql === "TRUE" ? "" : `AND ${s.sql}`}`,
    [leadId, stage, ...s.params],
  );
}

/** Mirrors reassignLead()'s `.update({ assigned_to: executiveId }).eq("id", leadId)`. */
export async function reassignLead(client: PoolClient, leadId: string, executiveId: string, scope: LeadScope): Promise<void> {
  const s = scopeCondition(scope, 3);
  await client.query(
    `UPDATE public.kob_leads SET assigned_to = $2 WHERE id = $1 ${s.sql === "TRUE" ? "" : `AND ${s.sql}`}`,
    [leadId, executiveId, ...s.params],
  );
}

/** Mirrors setLeadCuisine()'s brand-active lookup: `.from("brands").select("name").eq("active",true).eq("name",cuisine).maybeSingle()`. Open read, no scope. */
export async function isActiveBrandName(client: PoolClient, name: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT 1 FROM public.brands WHERE active = true AND name = $1`, [name]);
  return rows.length > 0;
}

/** Mirrors setLeadCuisine()'s `.update({ cuisine }).eq("id", leadId)`. */
export async function setLeadCuisine(client: PoolClient, leadId: string, cuisine: string, scope: LeadScope): Promise<void> {
  const s = scopeCondition(scope, 3);
  await client.query(
    `UPDATE public.kob_leads SET cuisine = $2 WHERE id = $1 ${s.sql === "TRUE" ? "" : `AND ${s.sql}`}`,
    [leadId, cuisine, ...s.params],
  );
}

/** Mirrors updateLeadNextAction()'s `.update({ next_action: value }).eq("id", leadId)`. */
export async function updateLeadNextAction(client: PoolClient, leadId: string, value: string | null, scope: LeadScope): Promise<void> {
  const s = scopeCondition(scope, 3);
  await client.query(
    `UPDATE public.kob_leads SET next_action = $2 WHERE id = $1 ${s.sql === "TRUE" ? "" : `AND ${s.sql}`}`,
    [leadId, value, ...s.params],
  );
}

/**
 * Mirrors setLeadRnrTag()'s pre-read `.from("kob_leads").select("tags").eq("id", leadId).maybeSingle()`.
 * Scoped: an inaccessible lead returns null here, exactly like the
 * Supabase path's RLS-filtered SELECT returning no row — the controller
 * then returns the same 404 "Lead not found" both paths already use.
 */
export async function getLeadTagsScoped(client: PoolClient, leadId: string, scope: LeadScope): Promise<string[] | null> {
  const s = scopeCondition(scope, 2);
  const { rows } = await client.query<{ tags: string[] }>(
    `SELECT tags FROM public.kob_leads WHERE id = $1 ${s.sql === "TRUE" ? "" : `AND ${s.sql}`}`,
    [leadId, ...s.params],
  );
  return rows[0]?.tags ?? null;
}

/** Mirrors setLeadRnrTag()'s `.update({ tags: nextTags }).eq("id", leadId)`. */
export async function setLeadTags(client: PoolClient, leadId: string, tags: string[], scope: LeadScope): Promise<void> {
  const s = scopeCondition(scope, 3);
  await client.query(
    `UPDATE public.kob_leads SET tags = $2 WHERE id = $1 ${s.sql === "TRUE" ? "" : `AND ${s.sql}`}`,
    [leadId, tags, ...s.params],
  );
}

/** Mirrors markLeadMessagesRead()'s `.update({ unread_message_count: 0, has_unread_messages: false }).eq("id", leadId)`. */
export async function markLeadMessagesRead(client: PoolClient, leadId: string, scope: LeadScope): Promise<void> {
  const s = scopeCondition(scope, 2);
  await client.query(
    `UPDATE public.kob_leads SET unread_message_count = 0, has_unread_messages = false WHERE id = $1 ${s.sql === "TRUE" ? "" : `AND ${s.sql}`}`,
    [leadId, ...s.params],
  );
}

/**
 * STAGE 10I-E — createManualLead. All triggers restored on RDS (Stage 9) fire
 * unmodified on a plain INSERT: mark_duplicate_lead() (defense-in-depth —
 * the app-level findPhoneClash() check below is the primary 400 response,
 * exactly as on the Supabase path), and the per-source initial-template
 * triggers (send_meta_ads_initial_template, send_support_lead_template,
 * send_whatsapp_broadcast_initial_template, send_website_form_*_template)
 * which only ever INSERT a row into gallabox_fire_queue/email_fire_queue —
 * no outbound HTTP happens here or in those trigger functions themselves;
 * sending only happens if a separate worker later consumes that queue, and
 * no such worker is started by this migration.
 */

/** Mirrors createManualLead()'s full-table phone-clash scan, done server-side instead of row-by-row in JS. */
export async function findPhoneClash(phoneTail: string): Promise<{ id: string; code: string } | null> {
  const { rows } = await getPool().query(
    `SELECT id, code FROM public.kob_leads WHERE right(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 10) = $1 LIMIT 1`,
    [phoneTail],
  );
  return rows[0] ?? null;
}

/** Mirrors createManualLead()'s `.like("code","IND-%").order("code",{ascending:false}).limit(1)`. */
export async function getLastManualLeadCode(): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT code FROM public.kob_leads WHERE code LIKE 'IND-%' ORDER BY code DESC LIMIT 1`,
  );
  return rows[0]?.code ?? null;
}

/**
 * STAGE 10I-E — importLeads. Mirrors the five parallel Supabase lookups used
 * to build the in-memory brand/state/city/source/phone maps.
 */
export interface ImportReferenceData {
  defaultMode: "AUTO" | "MANUAL";
  brands: { id: string; code: string; name: string }[];
  states: { id: string; name: string }[];
  cities: { id: string; name: string; state_id: string | null; district_id: string | null }[];
  sources: { id: string; name: string }[];
  existingPhones: string[];
}
export async function getImportReferenceData(): Promise<ImportReferenceData> {
  const pool = getPool();
  const [cfg, brands, states, cities, sources, existing] = await Promise.all([
    pool.query(`SELECT default_mode FROM public.kob_configuration WHERE id = 1`),
    pool.query(`SELECT id, code, name FROM public.brands`),
    pool.query(`SELECT id, name FROM public.india_states`),
    pool.query(`SELECT id, name, state_id, district_id FROM public.india_cities`),
    pool.query(`SELECT id, name FROM public.lead_sources`),
    pool.query(`SELECT phone FROM public.kob_leads`),
  ]);
  return {
    defaultMode: (cfg.rows[0]?.default_mode === "MANUAL" ? "MANUAL" : "AUTO"),
    brands: brands.rows,
    states: states.rows,
    cities: cities.rows,
    sources: sources.rows,
    existingPhones: existing.rows.map((r: any) => r.phone),
  };
}

/** Mirrors importLeads()'s `.like("code","IMP-%").order("code",{ascending:false}).limit(1)`. */
export async function getLastImportCode(): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT code FROM public.kob_leads WHERE code LIKE 'IMP-%' ORDER BY code DESC LIMIT 1`,
  );
  return rows[0]?.code ?? null;
}

export interface ImportLeadInsert {
  code: string; full_name: string; phone: string | null; email: string | null;
  mode: "AUTO" | "MANUAL"; language: string; brand_id: string | null; state_id: string | null;
  district_id: string | null; city_id: string | null; source_id: string | null;
  investment_capacity: number | null; team_leader_id: string | null;
}
/** Throws on failure — caller catches per-row, exactly like the Supabase path's per-row `if (error)` branch. */
export async function insertImportLead(client: PoolClient, row: ImportLeadInsert): Promise<{ id: string; stage: string }> {
  const { rows } = await client.query<{ id: string; stage: string }>(
    `INSERT INTO public.kob_leads (code, full_name, phone, email, stage, mode, language, brand_id, state_id, district_id, city_id, source_id, investment_capacity, team_leader_id)
     VALUES ($1, $2, $3, $4, 'LEAD_INBOX', $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, stage::text AS stage`,
    [row.code, row.full_name, row.phone, row.email, row.mode, row.language, row.brand_id, row.state_id, row.district_id, row.city_id, row.source_id, row.investment_capacity, row.team_leader_id],
  );
  return rows[0];
}

/**
 * Mirrors importLeads()'s `.rpc("send_csv_import_meta_ads_initial", {_lead_id})`
 * call for freshly imported Meta Ads leads. The underlying function performs a
 * synchronous `net.http_post()` to Gallabox — on RDS, `pg_net`/the `net` schema
 * is not installed, so that call fails inside the function's own
 * `EXCEPTION WHEN OTHERS` handler and it returns 'failed' without sending
 * anything or raising. Calling it here is therefore inert on RDS today (not a
 * silent behavior change we're introducing — it already no-ops safely), and
 * it must be re-reviewed before any future RDS pg_net/outbound equivalent exists.
 */
export async function callCsvImportMetaAdsInitial(client: PoolClient, leadId: string): Promise<string | null> {
  try {
    const { rows } = await client.query<{ send_csv_import_meta_ads_initial: string }>(
      `SELECT public.send_csv_import_meta_ads_initial($1) AS send_csv_import_meta_ads_initial`,
      [leadId],
    );
    return rows[0]?.send_csv_import_meta_ads_initial ?? null;
  } catch {
    return null;
  }
}

// ---- STAGE 10I-E: shared inbound-webhook find-or-create, RDS-native
// reimplementation of lead-sync.service.ts's ensureLeadByPhone(). Same
// matching key (last 10 digits), same idempotency/retry-on-collision
// behavior, same trigger reliance (mark_duplicate_lead, per-source initial
// template triggers — all restored on RDS and run unmodified on this INSERT,
// same safety profile as createManualLead/importLeads above). ----

export async function findLeadByPhoneTail(client: PoolClient | ReturnType<typeof getPool>, tail: string): Promise<{ id: string; stage: string } | null> {
  const { rows } = await client.query(
    `SELECT id, stage::text AS stage FROM public.kob_leads WHERE right(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 10) = $1
     ORDER BY created_at DESC LIMIT 1`,
    [tail],
  );
  return rows[0] ?? null;
}

export interface EnsureLeadInput { phone: string; name: string | null; language: string | null; sourceName: string | null; origin: string }
export interface EnsureLeadResult { leadId: string | null; stage: string | null; created: boolean; error?: string }

const ENSURE_LEAD_LANGUAGE_MAP: Record<string, string> = {
  tamil: "TAMIL", telugu: "TELUGU", malayalam: "MALAYALAM", hindi: "HINDI", bengali: "BENGALI",
  english: "ENGLISH", kannada: "KANNADA", marathi: "MARATHI", gujarati: "GUJARATI", others: "OTHERS", other: "OTHERS",
};

export async function ensureLeadByPhoneRds(input: EnsureLeadInput): Promise<EnsureLeadResult> {
  const tail = String(input.phone ?? "").replace(/\D+/g, "").slice(-10);
  if (tail.length < 10) return { leadId: null, stage: null, created: false, error: "phone_too_short" };

  const pool = getPool();
  const existing = await findLeadByPhoneTail(pool, tail);
  if (existing) return { leadId: existing.id, stage: existing.stage, created: false };

  let source_id: string | null = null;
  const sourceName = (input.sourceName ?? "").trim();
  if (sourceName) {
    const { rows } = await pool.query(`SELECT id FROM public.lead_sources WHERE name ILIKE $1 LIMIT 1`, [sourceName]);
    source_id = rows[0]?.id ?? null;
  }

  const language = input.language ? (ENSURE_LEAD_LANGUAGE_MAP[input.language.trim().toLowerCase()] ?? null) : null;
  const fullName = (input.name ?? "").trim() || `WhatsApp Lead ${tail}`;
  const phone = input.phone.trim();

  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await getLastManualLeadCode();
    let nextNum = 1;
    const m = /^IND-(\d+)$/.exec(last ?? "");
    if (m) nextNum = parseInt(m[1], 10) + 1;
    const code = `IND-${String(nextNum + attempt).padStart(5, "0")}`;

    try {
      const inserted = await withTransaction(null, async (client) => {
        const { rows } = await client.query<{ id: string; stage: string }>(
          `INSERT INTO public.kob_leads (code, full_name, phone, source_id, stage, notes, language)
           VALUES ($1, $2, $3, $4, 'LEAD_INBOX', $5, $6)
           RETURNING id, stage::text AS stage`,
          [code, fullName, phone, source_id, `Auto-created from ${input.origin}`, language],
        );
        const row = rows[0];
        await insertAuditLog(client, null, "INBOUND_LEAD_AUTO_CREATED", "kob_leads", row.id, { origin: input.origin, phone, code, source: sourceName || null, language });
        return row;
      });
      return { leadId: inserted.id, stage: inserted.stage, created: true };
    } catch (e: any) {
      const message = e?.message ?? String(e);
      if (/duplicate key/i.test(message)) {
        const raced = await findLeadByPhoneTail(pool, tail);
        if (raced) return { leadId: raced.id, stage: raced.stage, created: false };
        continue;
      }
      return { leadId: null, stage: null, created: false, error: message };
    }
  }

  const raced = await findLeadByPhoneTail(pool, tail);
  if (raced) return { leadId: raced.id, stage: raced.stage, created: false };
  return { leadId: null, stage: null, created: false, error: "code_generation_failed" };
}

/** Mirrors postWhatsappMessage()'s richer phone lookup (newest-first, tail match client-side). */
export async function findLeadByPhoneIlikeRich(tail: string): Promise<{
  id: string; phone: string | null; stage: string; unread_message_count: number | null;
  created_at: string; source_id: string | null; language: string | null;
} | null> {
  if (tail.length < 6) return null;
  const { rows } = await getPool().query(
    `SELECT id, phone, stage::text AS stage, unread_message_count, created_at, source_id, language::text AS language
     FROM public.kob_leads WHERE phone ILIKE $1 ORDER BY created_at DESC LIMIT 5`,
    [`%${tail}`],
  );
  return rows.find((l: any) => String(l.phone ?? "").replace(/\D+/g, "").slice(-10) === tail) ?? null;
}

export async function backfillLeadEventsLeadId(client: PoolClient, leadId: string, phone: string): Promise<void> {
  await client.query(`UPDATE public.lead_events SET lead_id = $1 WHERE lead_id IS NULL AND phone = $2`, [leadId, phone]);
}

export interface LeadMessageFieldsUpdate {
  last_message: string | null; last_message_at: string; last_activity_at: string;
  unread_message_count?: number; has_unread_messages?: boolean;
}
export async function updateLeadMessageFields(client: PoolClient, leadId: string, u: LeadMessageFieldsUpdate): Promise<void> {
  if (u.unread_message_count !== undefined) {
    await client.query(
      `UPDATE public.kob_leads SET last_message = $1, last_message_at = $2, last_activity_at = $3, unread_message_count = $4, has_unread_messages = $5 WHERE id = $6`,
      [u.last_message, u.last_message_at, u.last_activity_at, u.unread_message_count, u.has_unread_messages ?? true, leadId],
    );
  } else {
    await client.query(
      `UPDATE public.kob_leads SET last_message = $1, last_message_at = $2, last_activity_at = $3 WHERE id = $4`,
      [u.last_message, u.last_message_at, u.last_activity_at, leadId],
    );
  }
}

export async function getLeadSourceNameById(sourceId: string): Promise<string | null> {
  const { rows } = await getPool().query(`SELECT name FROM public.lead_sources WHERE id = $1`, [sourceId]);
  return rows[0]?.name ?? null;
}

export async function updateLeadLanguage(client: PoolClient, leadId: string, language: string): Promise<void> {
  await client.query(`UPDATE public.kob_leads SET language = $1 WHERE id = $2`, [language, leadId]);
}

export async function getLeadStageById(leadId: string): Promise<string | null> {
  const { rows } = await getPool().query(`SELECT stage::text AS stage FROM public.kob_leads WHERE id = $1`, [leadId]);
  return rows[0]?.stage ?? null;
}

/** Mirrors postLeadEvents()'s phone lookup: `.ilike("phone", "%"+tail).limit(2)` + client-side tail-match. */
export async function findLeadByPhoneIlike(tail: string): Promise<{ id: string; phone: string | null; stage: string } | null> {
  if (tail.length < 6) return null;
  const { rows } = await getPool().query(
    `SELECT id, phone, stage::text AS stage FROM public.kob_leads WHERE phone ILIKE $1 LIMIT 2`,
    [`%${tail}`],
  );
  return rows.find((l: any) => String(l.phone ?? "").replace(/\D+/g, "").slice(-10) === tail) ?? null;
}

export interface LeadEventInsert {
  lead_id: string | null; phone: string; event: string; template: string | null;
  status: string | null; event_at: string | null; payload: unknown;
}
export async function insertLeadEvent(client: PoolClient, row: LeadEventInsert): Promise<void> {
  await client.query(
    `INSERT INTO public.lead_events (lead_id, phone, event, template, status, event_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.lead_id, row.phone, row.event, row.template, row.status, row.event_at, row.payload === undefined ? null : JSON.stringify(row.payload)],
  );
}

/**
 * Unscoped stage update for system/webhook writes (no caller role to scope
 * by — mirrors `supabaseAdmin.from("kob_leads").update({stage}).eq("id",...)`,
 * which bypasses RLS the same way kob_app_user bypasses RDS RLS).
 */
export async function updateLeadStageUnscoped(client: PoolClient, leadId: string, stage: string): Promise<void> {
  await client.query(`UPDATE public.kob_leads SET stage = $1 WHERE id = $2`, [stage, leadId]);
}

export interface ManualLeadInsert {
  code: string; full_name: string; phone: string; language: string; source_id: string | null;
  team_leader_id: string | null; notes: string | null;
}
export async function insertManualLead(client: PoolClient, row: ManualLeadInsert): Promise<{ id: string; code: string }> {
  const { rows } = await client.query<{ id: string; code: string }>(
    `INSERT INTO public.kob_leads (code, full_name, phone, language, source_id, stage, mode, team_leader_id, notes)
     VALUES ($1, $2, $3, $4, $5, 'LEAD_INBOX', 'MANUAL', $6, $7)
     RETURNING id, code`,
    [row.code, row.full_name, row.phone, row.language, row.source_id, row.team_leader_id, row.notes],
  );
  return rows[0];
}
