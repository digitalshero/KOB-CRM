import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";

/**
 * STAGE 10I-C — direct-RDS repository for the read-only webinar endpoints.
 * These are org-wide today (no role scoping in the Supabase path — requireAuth
 * only), so the RDS reads below stay unscoped too, preserving current behavior.
 * Writes (createWebinarBatch, addLeadsToBatch, markAttendance, etc.) are out
 * of scope for this pass.
 */

export interface DateRange { from?: string; to?: string }

export interface WebinarBatchRow { id: string; name: string; scheduled_at: string; language: string | null; notes: string | null; created_at: string }

export async function listWebinarBatchesInRange(range: DateRange): Promise<WebinarBatchRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (range.from) { params.push(range.from); conditions.push(`created_at >= $${params.length}`); }
  if (range.to) { params.push(range.to); conditions.push(`created_at <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await getPool().query(
    `SELECT id, name, scheduled_at, language::text AS language, notes, created_at
     FROM public.webinar_batches ${where} ORDER BY scheduled_at DESC`,
    params,
  );
  return rows;
}

/** Mirrors getWebinarHistory()'s batch fetch, which filters on scheduled_at (not created_at like listWebinarBatches). */
export async function listWebinarBatchesByScheduledAt(range: DateRange): Promise<{ id: string; name: string; scheduled_at: string; language: string | null }[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (range.from) { params.push(range.from); conditions.push(`scheduled_at >= $${params.length}`); }
  if (range.to) { params.push(range.to); conditions.push(`scheduled_at <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await getPool().query(
    `SELECT id, name, scheduled_at, language::text AS language FROM public.webinar_batches ${where} ORDER BY scheduled_at DESC`,
    params,
  );
  return rows;
}

export async function getAttendanceCountsByBatchIds(batchIds: string[]): Promise<{ batch_id: string; attended: boolean }[]> {
  if (batchIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT batch_id, attended FROM public.webinar_attendance WHERE batch_id = ANY($1::uuid[])`,
    [batchIds],
  );
  return rows;
}

export async function getBatchAttendanceRows(batchId: string): Promise<{ id: string; lead_id: string; attended: boolean; marked_at: string | null; defaulter_marked_at: string | null }[]> {
  const { rows } = await getPool().query(
    `SELECT id, lead_id, attended, marked_at, defaulter_marked_at
     FROM public.webinar_attendance WHERE batch_id = $1 ORDER BY created_at ASC`,
    [batchId],
  );
  return rows;
}

export async function getLeadsBasicByIds(ids: string[]): Promise<{ id: string; code: string; full_name: string; phone: string | null; stage: string; language: string | null }[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT id, code, full_name, phone, stage::text AS stage, language::text AS language
     FROM public.kob_leads WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

export interface WebinarEligibleLeadsFilter { language?: string; search?: string }

export async function listWebinarEligibleLeads(filter: WebinarEligibleLeadsFilter): Promise<{ id: string; code: string; full_name: string; phone: string | null; stage: string; language: string | null; assigned_to: string | null; created_at: string }[]> {
  const conditions: string[] = [`stage = 'WEBINAR'`];
  const params: unknown[] = [];
  if (filter.language && filter.language !== "ALL") {
    params.push(filter.language.toUpperCase());
    conditions.push(`(language)::text = $${params.length}`);
  }
  if (filter.search && filter.search.trim()) {
    params.push(`%${filter.search.trim()}%`);
    const p = `$${params.length}`;
    conditions.push(`(full_name ILIKE ${p} OR code ILIKE ${p} OR phone ILIKE ${p})`);
  }
  const { rows } = await getPool().query(
    `SELECT id, code, full_name, phone, stage::text AS stage, language::text AS language, assigned_to, created_at
     FROM public.kob_leads WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT 500`,
    params,
  );
  return rows;
}

export async function getAttendanceForBatchesFull(batchIds: string[]): Promise<{ id: string; batch_id: string; lead_id: string; attended: boolean; marked_at: string | null; defaulter_marked_at: string | null; created_at: string }[]> {
  if (batchIds.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT id, batch_id, lead_id, attended, marked_at, defaulter_marked_at, created_at
     FROM public.webinar_attendance WHERE batch_id = ANY($1::uuid[])`,
    [batchIds],
  );
  return rows;
}

export async function getLeadsForWebinarHistory(ids: string[]): Promise<{ id: string; code: string; full_name: string; phone: string | null; stage: string; language: string | null; assigned_to: string | null }[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT id, code, full_name, phone, stage::text AS stage, language::text AS language, assigned_to
     FROM public.kob_leads WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

export async function getProfileNamesByIds(ids: string[]): Promise<{ id: string; full_name: string }[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query(`SELECT id, full_name FROM public.profiles WHERE id = ANY($1::uuid[])`, [ids]);
  return rows;
}

// ---- STAGE 10I-D: writes, inside withTransaction(req.userId, ...) ----

export interface WebinarBatchInsert { name: string; scheduled_at: string; language: string | null; notes: string | null; created_by: string | null }

export async function insertBatch(client: PoolClient, row: WebinarBatchInsert): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `INSERT INTO public.webinar_batches (name, scheduled_at, language, notes, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [row.name, row.scheduled_at, row.language, row.notes, row.created_by],
  );
  return rows[0];
}

export async function deleteBatch(client: PoolClient, id: string): Promise<void> {
  await client.query(`DELETE FROM public.webinar_batches WHERE id = $1`, [id]);
}

export async function upsertAttendanceRows(client: PoolClient, rows: { batch_id: string; lead_id: string }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const values: string[] = [];
  const params: unknown[] = [];
  rows.forEach((r, i) => {
    values.push(`($${i * 2 + 1}, $${i * 2 + 2}, false)`);
    params.push(r.batch_id, r.lead_id);
  });
  const { rowCount } = await client.query(
    `INSERT INTO public.webinar_attendance (batch_id, lead_id, attended) VALUES ${values.join(", ")}
     ON CONFLICT (batch_id, lead_id) DO NOTHING`,
    params,
  );
  return rowCount ?? 0;
}

export async function deleteAttendance(client: PoolClient, id: string): Promise<void> {
  await client.query(`DELETE FROM public.webinar_attendance WHERE id = $1`, [id]);
}

export async function markAttendance(client: PoolClient, id: string, attended: boolean, markedBy: string | null): Promise<void> {
  await client.query(
    `UPDATE public.webinar_attendance SET attended = $1, marked_at = now(), marked_by = $2 WHERE id = $3`,
    [attended, markedBy, id],
  );
}

export async function getAttendanceById(client: PoolClient, id: string): Promise<{ id: string; batch_id: string; lead_id: string } | null> {
  const { rows } = await client.query(`SELECT id, batch_id, lead_id FROM public.webinar_attendance WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findAttendanceIdByBatchAndLead(client: PoolClient, batchId: string, leadId: string): Promise<string | null> {
  const { rows } = await client.query(`SELECT id FROM public.webinar_attendance WHERE batch_id = $1 AND lead_id = $2`, [batchId, leadId]);
  return rows[0]?.id ?? null;
}

export async function rescheduleAttendanceRow(client: PoolClient, id: string, newBatchId: string): Promise<void> {
  await client.query(
    `UPDATE public.webinar_attendance SET batch_id = $1, attended = false, defaulter_marked_at = NULL, marked_at = NULL, marked_by = NULL WHERE id = $2`,
    [newBatchId, id],
  );
}

export async function getWebinarDefaulterTemplateIds(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query(`SELECT id FROM public.gallabox_templates WHERE category = 'WEBINAR_DEFAULTER'`);
  return rows.map((r: any) => r.id);
}

export async function cancelPendingFireQueueForLead(client: PoolClient, leadId: string, templateIds: string[]): Promise<number> {
  if (templateIds.length === 0) return 0;
  const { rows } = await client.query(
    `UPDATE public.gallabox_fire_queue SET status = 'FAILED', error = 'CANCELLED: rescheduled to another webinar batch'
     WHERE lead_id = $1 AND status = 'PENDING' AND template_id = ANY($2::uuid[]) RETURNING id`,
    [leadId, templateIds],
  );
  return rows.length;
}

export async function cancelPendingEmailQueueForLead(client: PoolClient, leadId: string, templateIds: string[]): Promise<void> {
  if (templateIds.length === 0) return;
  await client.query(
    `UPDATE public.email_fire_queue SET status = 'FAILED', error = 'CANCELLED: rescheduled to another webinar batch'
     WHERE lead_id = $1 AND status = 'PENDING' AND template_id = ANY($2::uuid[])`,
    [leadId, templateIds],
  );
}
