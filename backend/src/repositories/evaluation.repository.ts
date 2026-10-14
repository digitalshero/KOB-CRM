import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";

/** STAGE 10I-C — direct-RDS repository for the read-only evaluation endpoints. Writes stay on Supabase for now. */

export async function listQuestions(): Promise<Record<string, unknown>[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM public.evaluation_questions ORDER BY sort_order ASC, created_at ASC`,
  );
  return rows;
}

export async function getResponsesAndScore(leadId: string): Promise<{ responses: Record<string, unknown>[]; score: Record<string, unknown> | null }> {
  const pool = getPool();
  const [{ rows: responses }, { rows: scoreRows }] = await Promise.all([
    pool.query(`SELECT * FROM public.evaluation_responses WHERE lead_id = $1`, [leadId]),
    pool.query(`SELECT * FROM public.v_lead_evaluation_score WHERE lead_id = $1 LIMIT 1`, [leadId]),
  ]);
  return { responses, score: scoreRows[0] ?? null };
}

export async function listHistoryForLead(leadId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM public.v_lead_evaluation_history WHERE lead_id = $1 ORDER BY filled_at DESC`,
    [leadId],
  );
  return rows;
}

// ---- STAGE 10I-D: writes, inside withTransaction(req.userId, ...) ----

export interface EvaluationQuestionUpsert {
  question_text: string; weight: number; question_type: string; active: boolean; sort_order: number;
}

export async function updateQuestion(client: PoolClient, id: string, row: EvaluationQuestionUpsert): Promise<void> {
  await client.query(
    `UPDATE public.evaluation_questions SET question_text = $1, weight = $2, question_type = $3, active = $4, sort_order = $5 WHERE id = $6`,
    [row.question_text, row.weight, row.question_type, row.active, row.sort_order, id],
  );
}

export async function insertQuestion(client: PoolClient, row: EvaluationQuestionUpsert): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO public.evaluation_questions (question_text, weight, question_type, active, sort_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [row.question_text, row.weight, row.question_type, row.active, row.sort_order],
  );
  return rows[0];
}

export async function deleteQuestion(client: PoolClient, id: string): Promise<void> {
  await client.query(`DELETE FROM public.evaluation_questions WHERE id = $1`, [id]);
}

export async function getQuestionWeights(client: PoolClient, ids: string[]): Promise<{ id: string; weight: number }[]> {
  if (ids.length === 0) return [];
  const { rows } = await client.query(`SELECT id, weight FROM public.evaluation_questions WHERE id = ANY($1::uuid[])`, [ids]);
  return rows;
}

export interface EvaluationResponseInsert {
  evaluation_id: string; lead_id: string; question_id: string;
  answer_value: number | null; answer_text: string | null; weight_at_time: number | null;
  filled_by: string; filled_at: string;
}

export async function insertResponses(client: PoolClient, rows: EvaluationResponseInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [];
  rows.forEach((r, i) => {
    const base = i * 8;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
    params.push(r.evaluation_id, r.lead_id, r.question_id, r.answer_value, r.answer_text, r.weight_at_time, r.filled_by, r.filled_at);
  });
  await client.query(
    `INSERT INTO public.evaluation_responses (evaluation_id, lead_id, question_id, answer_value, answer_text, weight_at_time, filled_by, filled_at)
     VALUES ${values.join(", ")}`,
    params,
  );
}

export async function getHistoryByEvaluationId(client: PoolClient, evaluationId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await client.query(`SELECT * FROM public.v_lead_evaluation_history WHERE evaluation_id = $1 LIMIT 1`, [evaluationId]);
  return rows[0] ?? null;
}

export interface LeadsForEvaluationFilter { isMgr: boolean; isTL: boolean; userId: string }

/** Mirrors listLeadsForEvaluation()'s `.or("team_leader_id.eq.X,assigned_to.eq.Y")` scope for team leaders. */
export async function listLeadsForEvaluation(filter: LeadsForEvaluationFilter): Promise<Record<string, unknown>[]> {
  let where = "";
  const params: unknown[] = [];
  if (!filter.isMgr) {
    if (filter.isTL) {
      params.push(filter.userId);
      where = `WHERE (team_leader_id = $1 OR assigned_to = $1)`;
    } else {
      params.push(filter.userId);
      where = `WHERE assigned_to = $1`;
    }
  }
  const { rows } = await getPool().query(
    `SELECT id, code, full_name, phone, stage::text AS stage, language::text AS language, assigned_to, team_leader_id, created_at
     FROM public.kob_leads ${where} ORDER BY created_at DESC LIMIT 500`,
    params,
  );
  return rows;
}
