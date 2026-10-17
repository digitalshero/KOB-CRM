/**
 * Node/systemd replacement for three Supabase pg_cron-scheduled SQL
 * functions, which exist in the live RDS database but have no scheduler
 * (pg_cron is not installed on this RDS instance — see audit findings):
 *   move_lead_inbox_24h_to_no_response()  (supabase/migrations/20260903072849_...)
 *   move_eoi1_48h_to_no_response()        (supabase/migrations/20260828122521_...)
 *   move_webinar_48h_to_no_response()     (supabase/migrations/20260903105704_...)
 *
 * Each query below is copied verbatim (WHERE/JOIN logic unchanged) from its
 * source function's definition, read via `pg_get_functiondef` against the
 * live RDS database — not assumed from migration history. No new timing or
 * eligibility rule is introduced. The stage UPDATE runs inside
 * withTransaction(null, ...), so auth.uid() resolves to NULL for the
 * duration of the transaction, giving lead_stage_history.changed_by = NULL
 * (automated), exactly matching the invariant that already distinguishes
 * automated from manual moves everywhere else in this app.
 * stage_entered_at, lead_stage_history, auto_enroll_retargeting and the
 * STAGE_CHANGE activity row are all populated by the existing, unmodified
 * `on_lead_stage_change` / `auto_enroll_retargeting` / `log_lead_activity`
 * triggers that already fire on any UPDATE of kob_leads.stage — nothing
 * here duplicates their effects.
 *
 * This worker intentionally does NOT send any Gallabox message itself —
 * the existing immediate/manual WEBINAR send behavior (and the three
 * retargeting-send workers) are untouched and unrelated to this file.
 *
 * Modes (same convention as the other workers):
 *   --dry-run     read-only: prints eligible counts + lead_ids per variant,
 *                 no writes
 *   (no flags)    production batch mode: performs the UPDATE for all three
 *                 variants, same as the SQL functions
 */
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";

interface VariantResult {
  variant: "lead_inbox" | "eoi1" | "webinar";
  moved: number;
  lead_ids: string[];
}

const SELECT_ELIGIBLE: Record<VariantResult["variant"], string> = {
  // Mirrors move_lead_inbox_24h_to_no_response()'s `due` CTE exactly.
  lead_inbox: `
    SELECT k.id
    FROM public.kob_leads k
    JOIN public.lead_inbox_retarget_sends s
      ON s.lead_id = k.id
     AND s.stage_entered_at = k.stage_entered_at
     AND s.status = 'SENT'
    WHERE k.stage = 'LEAD_INBOX'::lead_stage
      AND s.sent_at IS NOT NULL
      AND s.sent_at <= now() - interval '24 hours'
  `,
  // Mirrors move_eoi1_48h_to_no_response()'s UPDATE ... WHERE exactly.
  eoi1: `
    SELECT k.id
    FROM public.kob_leads k
    WHERE k.stage = 'EOI_1'::lead_stage
      AND k.stage_entered_at < now() - interval '48 hours'
  `,
  // Mirrors move_webinar_48h_to_no_response()'s UPDATE ... WHERE exactly.
  webinar: `
    SELECT k.id
    FROM public.kob_leads k
    WHERE k.stage = 'WEBINAR'::lead_stage
      AND EXISTS (
        SELECT 1 FROM public.lead_webinar_retarget_tamil_sends s
        WHERE s.lead_id = k.id AND s.stage_entered_at = k.stage_entered_at
          AND s.status = 'SENT' AND s.sent_at IS NOT NULL
          AND s.sent_at < now() - interval '24 hours'
        UNION ALL
        SELECT 1 FROM public.lead_webinar_retarget_telugu_sends s
        WHERE s.lead_id = k.id AND s.stage_entered_at = k.stage_entered_at
          AND s.status = 'SENT' AND s.sent_at IS NOT NULL
          AND s.sent_at < now() - interval '24 hours'
        UNION ALL
        SELECT 1 FROM public.lead_webinar_retarget_malayalam_sends s
        WHERE s.lead_id = k.id AND s.stage_entered_at = k.stage_entered_at
          AND s.status = 'SENT' AND s.sent_at IS NOT NULL
          AND s.sent_at < now() - interval '24 hours'
      )
  `,
};

async function selectEligible(variant: VariantResult["variant"]): Promise<string[]> {
  const { rows } = await getPool().query<{ id: string }>(SELECT_ELIGIBLE[variant]);
  return rows.map((r) => r.id);
}

async function moveVariant(variant: VariantResult["variant"], dryRun: boolean): Promise<VariantResult> {
  if (dryRun) {
    const eligibleIds = await selectEligible(variant);
    return { variant, moved: 0, lead_ids: eligibleIds };
  }

  // changed_by = NULL: withTransaction(null, ...) never sets
  // request.jwt.claim.sub, so auth.uid() is NULL inside this transaction —
  // the same mechanism every other system/webhook write in this app uses.
  // The UPDATE's FROM clause re-runs the identical SELECT above as a CTE,
  // atomically, exactly as the source SQL function's own `due`/`upd` CTEs do.
  // Same defensive re-check the original lead_inbox SQL function has in its
  // own UPDATE WHERE (on top of its `due` CTE) — harmless no-op for the
  // other two variants, whose source WHERE already implies it.
  const extraGuard: Record<VariantResult["variant"], string> = {
    lead_inbox: "AND k.stage = 'LEAD_INBOX'::lead_stage",
    eoi1: "AND k.stage = 'EOI_1'::lead_stage",
    webinar: "AND k.stage = 'WEBINAR'::lead_stage",
  };

  const moved = await withTransaction(null, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `WITH due AS (${SELECT_ELIGIBLE[variant]})
       UPDATE public.kob_leads k
       SET stage = 'NO_RESPONSE'::lead_stage
       FROM due
       WHERE k.id = due.id ${extraGuard[variant]}
       RETURNING k.id`,
    );
    return rows.map((r) => r.id);
  });

  return { variant, moved: moved.length, lead_ids: moved };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const results: VariantResult[] = [];
  for (const variant of Object.keys(SELECT_ELIGIBLE) as VariantResult["variant"][]) {
    results.push(await moveVariant(variant, dryRun));
  }
  console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "batch", results }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
