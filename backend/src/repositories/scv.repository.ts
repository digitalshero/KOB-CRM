import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";

/**
 * STAGE 10I-C — most SCV read endpoints reuse the existing pure helper
 * functions in kob.controller.ts (loadScvComponentWeights, computeScvForExecs,
 * fetchScvRoster, loadScvModeConfig, computeScvModeForExecs) UNCHANGED, fed
 * via the pgQueryAdapter (see dashboard.controller.ts's 10I-B rationale for
 * why this is preferred over reimplementing the formulas). This repository
 * only holds the one query that isn't a `.from()`-chain: the v_scv_composite
 * view, which has no equivalent pure helper to reuse.
 */
export async function getScvComposite(): Promise<Record<string, unknown>[]> {
  const { rows } = await getPool().query(`SELECT * FROM public.v_scv_composite ORDER BY composite_score DESC`);
  return rows;
}

// ---- STAGE 10I-D: writes, inside withTransaction(req.userId, ...) ----

export interface ScvComponentWeightsPatch { weight_conversion: number; weight_tat: number; weight_eoi2_payment: number; weight_crm_discipline: number }
export async function updateComponentWeights(client: PoolClient, patch: ScvComponentWeightsPatch): Promise<void> {
  await client.query(
    `UPDATE public.scv_component_weights SET weight_conversion = $1, weight_tat = $2, weight_eoi2_payment = $3, weight_crm_discipline = $4 WHERE id = 1`,
    [patch.weight_conversion, patch.weight_tat, patch.weight_eoi2_payment, patch.weight_crm_discipline],
  );
}

export interface ScvMonthlyInputUpsert { user_id: string; period: string; updated_by: string; ktn_cs_target: number | null; crm_discipline: number | null }
export async function upsertMonthlyInput(client: PoolClient, row: ScvMonthlyInputUpsert): Promise<void> {
  await client.query(
    `INSERT INTO public.scv_monthly_inputs (user_id, period, updated_by, ktn_cs_target, crm_discipline)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, period) DO UPDATE SET updated_by = EXCLUDED.updated_by, ktn_cs_target = EXCLUDED.ktn_cs_target, crm_discipline = EXCLUDED.crm_discipline`,
    [row.user_id, row.period, row.updated_by, row.ktn_cs_target, row.crm_discipline],
  );
}

export async function getConfigIncentiveAmount(client: PoolClient): Promise<number | null> {
  const { rows } = await client.query(`SELECT incentive_amount FROM public.kob_configuration WHERE id = 1`);
  return rows[0]?.incentive_amount ?? null;
}

export async function updateConfigIncentiveAmount(client: PoolClient, amount: number): Promise<void> {
  await client.query(`UPDATE public.kob_configuration SET incentive_amount = $1, updated_at = now() WHERE id = 1`, [amount]);
}

export interface ScvModeConfigChangeInsert { mode: string; changed_by: string | null; component: string; previous_value: string | null; new_value: string | null }
export async function insertModeConfigChanges(client: PoolClient, rows: ScvModeConfigChangeInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [];
  rows.forEach((r, i) => {
    const base = i * 5;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    params.push(r.mode, r.changed_by, r.component, r.previous_value, r.new_value);
  });
  await client.query(
    `INSERT INTO public.scv_mode_config_changes (mode, changed_by, component, previous_value, new_value) VALUES ${values.join(", ")}`,
    params,
  );
}

export async function getIncentiveRulesForUpdate(client: PoolClient): Promise<{ id: string; label: string; incentive_pct: number; incentive_amount: number }[]> {
  const { rows } = await client.query(`SELECT id, label, incentive_pct, incentive_amount FROM public.incentive_rules`);
  return rows;
}

export async function updateIncentiveRuleAmounts(client: PoolClient, id: string, incentivePct: number, incentiveAmount: number): Promise<void> {
  await client.query(
    `UPDATE public.incentive_rules SET incentive_pct = $1, incentive_amount = $2, updated_at = now() WHERE id = $3`,
    [incentivePct, incentiveAmount, id],
  );
}

export interface ScvModeConfigUpdate { mode: string; components: unknown; tat_movements: unknown; updated_by: string }
export async function updateModeConfig(client: PoolClient, row: ScvModeConfigUpdate): Promise<void> {
  await client.query(
    `UPDATE public.scv_mode_config SET components = $1, tat_movements = $2, updated_by = $3, updated_at = now() WHERE mode = $4`,
    [JSON.stringify(row.components), JSON.stringify(row.tat_movements), row.updated_by, row.mode],
  );
}

export interface ScvModeInputUpsert {
  user_id: string; period: string; mode: string; ktn_cs_target: number | null; discipline: number | null;
  marks: Record<string, unknown>; updated_by: string;
}
export async function upsertModeInput(client: PoolClient, row: ScvModeInputUpsert): Promise<void> {
  await client.query(
    `INSERT INTO public.scv_mode_inputs (user_id, period, mode, ktn_cs_target, discipline, marks, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, period, mode) DO UPDATE SET ktn_cs_target = EXCLUDED.ktn_cs_target, discipline = EXCLUDED.discipline,
       marks = EXCLUDED.marks, updated_by = EXCLUDED.updated_by`,
    [row.user_id, row.period, row.mode, row.ktn_cs_target, row.discipline, JSON.stringify(row.marks), row.updated_by],
  );
}
