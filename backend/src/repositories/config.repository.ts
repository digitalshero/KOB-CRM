import { getPool } from "../db/pool.js";

/**
 * STAGE 10C — direct-RDS repository for read-only configuration data.
 * See reference.repository.ts for the shared rationale (RLS=true for any
 * authenticated user, no auth.uid() dependency, no transaction needed).
 */

export interface KobConfiguration {
  id: number;
  native_multiplier: number;
  other_multiplier: number;
  incentive_slab_a: number;
  incentive_slab_b: number;
  incentive_slab_c: number;
  incentive_slab_d: number;
  rt_no_days: number;
  rt_no_attempts: number;
  rt_later_first_days: number;
  rt_later_first_attempts: number;
  rt_later_then_days: number;
  rt_noresp_first_days: number;
  rt_noresp_first_attempts: number;
  rt_noresp_second_days: number;
  rt_noresp_second_attempts: number;
  rt_noresp_final_days: number;
  updated_at: string;
  native_brand_multiplier: number;
  other_brand_multiplier: number;
  default_mode: string;
  auto_mode_killswitch: boolean;
  incentive_amount: number;
}

/** Mirrors `.from("kob_configuration").select("*").eq("id", 1).maybeSingle()`: null if absent. */
export async function getConfig(): Promise<KobConfiguration | null> {
  const { rows } = await getPool().query<KobConfiguration>(
    `SELECT id, native_multiplier::float8 AS native_multiplier, other_multiplier::float8 AS other_multiplier,
            incentive_slab_a, incentive_slab_b, incentive_slab_c, incentive_slab_d,
            rt_no_days, rt_no_attempts, rt_later_first_days, rt_later_first_attempts, rt_later_then_days,
            rt_noresp_first_days, rt_noresp_first_attempts, rt_noresp_second_days, rt_noresp_second_attempts,
            rt_noresp_final_days, updated_at, native_brand_multiplier, other_brand_multiplier,
            default_mode, auto_mode_killswitch, incentive_amount::float8 AS incentive_amount
     FROM public.kob_configuration WHERE id = 1`,
  );
  return rows[0] ?? null;
}

export interface KpiTarget {
  id: string;
  metric: string;
  period: string;
  target_value: number;
  effective_from: string;
  created_at: string;
}

export async function listKpiTargets(): Promise<KpiTarget[]> {
  const { rows } = await getPool().query<KpiTarget>(
    // effective_from is a plain `date` column. pg's default type parser turns
    // `date` into a JS Date constructed in the LOCAL server timezone, so
    // .toISOString() on it can shift the calendar date by a day depending on
    // where this process runs — a real parity bug vs. PostgREST, which
    // serializes `date` as the literal "YYYY-MM-DD" text. Casting to text
    // avoids the Date round-trip entirely.
    `SELECT id, metric, period, target_value::float8 AS target_value, effective_from::text AS effective_from, created_at
     FROM public.kpi_targets ORDER BY metric`,
  );
  return rows;
}

export interface ScvRules {
  id: number;
  weight_conversion: number;
  weight_tat: number;
  weight_eoi1_webinar: number;
  weight_eoi2_payment: number;
  weight_crm_discipline: number;
  updated_at: string;
}

/** Mirrors `.from("scv_rules").select("*").eq("id", 1).maybeSingle()`: null if absent (controller applies its own fallback). */
export async function getScvRules(): Promise<ScvRules | null> {
  const { rows } = await getPool().query<ScvRules>(
    `SELECT id, weight_conversion, weight_tat, weight_eoi1_webinar, weight_eoi2_payment,
            weight_crm_discipline, updated_at
     FROM public.scv_rules WHERE id = 1`,
  );
  return rows[0] ?? null;
}

export interface IncentiveRule {
  id: string;
  label: string;
  min_score: number;
  max_score: number;
  incentive_pct: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  incentive_amount: number | null;
}

export async function getIncentiveRules(): Promise<IncentiveRule[]> {
  const { rows } = await getPool().query<IncentiveRule>(
    `SELECT id, label, min_score, max_score, incentive_pct, sort_order, created_at, updated_at,
            incentive_amount::float8 AS incentive_amount
     FROM public.incentive_rules ORDER BY sort_order`,
  );
  return rows;
}

export interface MarketingKpiTarget {
  id: string;
  metric: string;
  target_value: number;
  period: string;
  created_at: string;
  updated_at: string;
}

/**
 * period is caller-supplied (query param) — always parameterized, never
 * concatenated. The output `period` column is cast to text for the same
 * reason as kpi_targets.effective_from above (it is a plain `date` column).
 */
export async function listMarketingTargets(period: string): Promise<MarketingKpiTarget[]> {
  const { rows } = await getPool().query<MarketingKpiTarget>(
    `SELECT id, metric, target_value::float8 AS target_value, period::text AS period, created_at, updated_at
     FROM public.marketing_kpi_targets WHERE period = $1`,
    [period],
  );
  return rows;
}
