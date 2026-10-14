import type { PoolClient, QueryResultRow } from "pg";
import { getPool } from "../db/pool.js";

/** Accepts either a Pool or a PoolClient — see src/db/authz.ts for the same pattern. */
type Queryable = { query<T extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<{ rows: T[] }> };

/**
 * STAGE 10H — direct-RDS repository for SYSTEM/public-webhook writes
 * (postLeadStage, postTemplateStage). Every write here runs inside
 * withTransaction(null, ...) — actor is always NULL, matching the
 * Supabase path's service-role (supabaseAdmin) calls, which never carry a
 * caller JWT. auth.uid() therefore resolves to NULL in every trigger these
 * statements fire, exactly as today.
 *
 * Per the Stage 10F/10G policy (continued here for consistency): a
 * business write and its OWN audit_logs insert are bundled into one
 * transaction so they commit/roll back together. Across MULTIPLE hops of a
 * stage walk, each hop is its own separate withTransaction call — this
 * intentionally reproduces the Supabase path's existing non-atomic,
 * partial-walk-on-failure behavior (two independent PostgREST calls per
 * hop today), which the "stage_updated"/"current_stage" response fields
 * depend on. Do NOT wrap an entire multi-hop walk in one transaction.
 */

export interface LeadStageRow { id: string; stage: string }

/**
 * Mirrors `.from("kob_leads").select("id, stage").eq("id", leadId).maybeSingle()`.
 * No scope — system context reads any lead, same as supabaseAdmin. Pure
 * read with no actor-context need, so it may run directly against the pool
 * (no transaction required) — same rationale as reference/config reads.
 */
export async function findLeadById(client: Queryable, leadId: string): Promise<LeadStageRow | null> {
  const { rows } = await client.query<LeadStageRow>(`SELECT id, stage::text AS stage FROM public.kob_leads WHERE id = $1`, [leadId]);
  return rows[0] ?? null;
}

/**
 * Mirrors the `.ilike("phone", "%"+tail)` candidate fetch used by
 * postLeadStage/postFailedFire/postTemplateStage, with the SAME exact-tail
 * re-filter applied in JS by the caller (ILIKE only narrows candidates;
 * phoneTail() equality is what actually decides a match).
 */
export async function findLeadsByPhoneSuffix(client: Queryable, tail: string, limit: number, orderByCreatedDesc = false): Promise<(LeadStageRow & { phone: string | null; language?: string | null; created_at?: string })[]> {
  const order = orderByCreatedDesc ? "ORDER BY created_at DESC" : "";
  const { rows } = await client.query(
    `SELECT id, stage::text AS stage, phone, language::text AS language, created_at
     FROM public.kob_leads WHERE phone ILIKE $1 ${order} LIMIT $2`,
    [`%${tail}`, limit],
  );
  return rows;
}

/** Mirrors `.from("kob_leads").update({ stage }).eq("id", leadId)` under supabaseAdmin (no scope, system context). */
export async function updateLeadStageSystem(client: PoolClient, leadId: string, stage: string): Promise<void> {
  await client.query(`UPDATE public.kob_leads SET stage = $2 WHERE id = $1`, [leadId, stage]);
}

export interface RetargetingApplyResult { previous_stage: string | null; new_stage: string | null; updated: boolean }

/** Calls the unmodified apply_later_retargeting(_lead_id) RPC — never reimplemented in SQL here. */
export async function applyLaterRetargeting(client: PoolClient, leadId: string): Promise<RetargetingApplyResult | null> {
  const { rows } = await client.query<RetargetingApplyResult>(`SELECT * FROM public.apply_later_retargeting($1)`, [leadId]);
  return rows[0] ?? null;
}

/** Calls the unmodified apply_no_retargeting(_lead_id) RPC — never reimplemented in SQL here. */
export async function applyNoRetargeting(client: PoolClient, leadId: string): Promise<RetargetingApplyResult | null> {
  const { rows } = await client.query<RetargetingApplyResult>(`SELECT * FROM public.apply_no_retargeting($1)`, [leadId]);
  return rows[0] ?? null;
}

/**
 * Idempotency check for postFailedFire-style `lead_events` lookups
 * (`.eq("event", name).eq("payload->>message_id", id)`). Exported for a
 * future stage; not used by the handlers migrated in Stage 10H.
 */
export async function findLeadEventByPayloadMessageId(event: string, messageId: string): Promise<{ id: string } | null> {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM public.lead_events WHERE event = $1 AND payload->>'message_id' = $2 LIMIT 1`,
    [event, messageId],
  );
  return rows[0] ?? null;
}
