/**
 * Node/Express replacement for Supabase's WEBINAR 24-hour retargeting family:
 *   send_webinar_7day_retargeting_tamil()
 *   send_webinar_7day_retargeting_telugu()
 *   send_webinar_7day_retargeting_malayalam()
 * Latest live def (all three, same file): supabase/migrations/
 * 20260910114238_055e3835-39e8-4b08-9c3f-70ba7f085c26.sql
 *
 * Despite the function names, the real window is 24 hours, not 7 days.
 * This is a SEPARATE pipeline from retargetingWorker.ts, leadInboxRetargeting.ts,
 * and eoi1Retargeting.ts, with no overlap: it fires for leads still sitting in
 * kob_leads.stage = 'WEBINAR' (not via retargeting_schedule), using its own
 * three genuinely-dedicated Gallabox credential sets (confirmed by reading the
 * live SQL directly — unlike the EOI1 family, none of these three share
 * credentials with each other or with any other pipeline).
 *
 * Modes (same convention as the other workers):
 *   --dry-run              batch-select (LIMIT 200 per language), simulate
 *                           only, no writes/sends. Reports missing credentials
 *                           per language without attempting anything further.
 *   --lead-ids=a,b,c        real sends/writes restricted to exactly these
 *                           lead_ids, across whichever of the three languages
 *                           each lead actually has
 *   (no flags)              production batch mode, LIMIT 200 per language,
 *                           same as the SQL
 */
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import * as adminRepo from "../repositories/admin.repository.js";

const GALLABOX_SEND_URL = "https://server.gallabox.com/devapi/messages/whatsapp";
const BATCH_LIMIT = 200;

interface LeadRow {
  id: string; full_name: string | null; phone: string | null; stage_entered_at: string;
}

interface VariantConfig {
  key: "tamil" | "telugu" | "malayalam";
  language: "TAMIL" | "TELUGU" | "MALAYALAM";
  ledgerTable: string;
  templateName: string;
  auditAction: string;
  apiKeySetting: string;
  apiSecretSetting: string;
  channelSetting: string;
}

const VARIANTS: VariantConfig[] = [
  {
    key: "tamil",
    language: "TAMIL",
    ledgerTable: "lead_webinar_retarget_tamil_sends",
    templateName: "webinar_retarget_clone_clone",
    auditAction: "WEBINAR_24H_RETARGET_SENT",
    apiKeySetting: "webinar_retarget_tamil_api_key",
    apiSecretSetting: "webinar_retarget_tamil_api_secret",
    channelSetting: "webinar_retarget_tamil_channel_id",
  },
  {
    key: "telugu",
    language: "TELUGU",
    ledgerTable: "lead_webinar_retarget_telugu_sends",
    templateName: "webinar_retarget_telugu_clone",
    auditAction: "WEBINAR_24H_RETARGET_TELUGU_SENT",
    apiKeySetting: "webinar_retarget_telugu_api_key",
    apiSecretSetting: "webinar_retarget_telugu_api_secret",
    channelSetting: "webinar_retarget_telugu_channel_id",
  },
  {
    key: "malayalam",
    language: "MALAYALAM",
    ledgerTable: "lead_webinar_retarget_malayalam_sends",
    templateName: "webinar_retarget_malayalam_clone",
    auditAction: "WEBINAR_24H_RETARGET_MALAYALAM_SENT",
    apiKeySetting: "webinar_retarget_malayalam_api_key",
    apiSecretSetting: "webinar_retarget_malayalam_api_secret",
    channelSetting: "webinar_retarget_malayalam_channel_id",
  },
];

function normalizePhone(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D+/g, "");
  if (digits.length === 10) return "91" + digits;
  if (digits.length >= 11) return digits;
  return null;
}

async function getSetting(key: string): Promise<string | null> {
  const { rows } = await getPool().query<{ value: string }>(
    `SELECT value FROM public.integration_settings WHERE key = $1`,
    [key],
  );
  return rows[0]?.value ?? null;
}

async function selectEligibleRows(v: VariantConfig, leadIds: string[] | null): Promise<LeadRow[]> {
  const pool = getPool();
  const allowlistClause = leadIds ? `AND k.id = ANY($2::uuid[])` : "";
  const params: unknown[] = leadIds ? [v.language, leadIds] : [v.language];
  const limitClause = leadIds ? "" : `LIMIT ${BATCH_LIMIT}`;
  const { rows } = await pool.query<LeadRow>(
    // stage_entered_at cast to text — same reason as leadInboxRetargeting.ts
    // and eoi1Retargeting.ts: avoids a JS Date precision-truncation
    // round-trip that would otherwise permanently break the
    // (lead_id, stage_entered_at) duplicate-prevention equality check.
    `SELECT k.id, k.full_name, k.phone, k.stage_entered_at::text AS stage_entered_at
     FROM public.kob_leads k
     WHERE k.stage = 'WEBINAR'::lead_stage
       AND k.language = $1::lead_language
       AND k.stage_entered_at < now() - interval '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM public.${v.ledgerTable} s
         WHERE s.lead_id = k.id AND s.stage_entered_at = k.stage_entered_at AND s.status = 'SENT'
       )
       ${allowlistClause}
     ORDER BY k.stage_entered_at ASC
     ${limitClause}`,
    params,
  );
  return rows;
}

function parseArgs(argv: string[]): { mode: "dry-run" | "allowlist" | "batch"; leadIds: string[] | null } {
  const dryRun = argv.includes("--dry-run");
  const leadIdsArg = argv.find((a) => a.startsWith("--lead-ids="));
  const leadIds = leadIdsArg ? leadIdsArg.slice("--lead-ids=".length).split(",").map((s) => s.trim()).filter(Boolean) : null;
  if (dryRun && leadIds) throw new Error("--dry-run and --lead-ids are mutually exclusive");
  if (dryRun) return { mode: "dry-run", leadIds: null };
  if (leadIds && leadIds.length > 0) return { mode: "allowlist", leadIds };
  return { mode: "batch", leadIds: null };
}

async function processVariant(v: VariantConfig, leadIds: string[] | null, dryRun: boolean): Promise<any> {
  const pool = getPool();
  const apiKey = await getSetting(v.apiKeySetting);
  const apiSecret = await getSetting(v.apiSecretSetting);
  const channel = await getSetting(v.channelSetting);

  // No-fallback behavior preserved exactly, matching the SQL's own guard:
  // stop before any send attempt if the dedicated credentials aren't fully
  // configured. Never falls back to the shared/base Gallabox account.
  if (!apiKey || !apiSecret || !channel) {
    return {
      variant: v.key, processed: 0, sent: 0, skipped: 0,
      stopped: true,
      reason: `${v.apiKeySetting}/${v.apiSecretSetting}/${v.channelSetting} not fully configured (no fallback, by design) - stopped before any send attempt`,
    };
  }

  const rows = await selectEligibleRows(v, leadIds);
  let processed = 0, sent = 0, skipped = 0;
  const report: any[] = [];

  for (const l of rows) {
    processed++;
    const phone = normalizePhone(l.phone);

    if (dryRun) {
      if (!phone) { skipped++; report.push({ lead_id: l.id, outcome: "WOULD_SKIP_INVALID_PHONE" }); continue; }
      sent++;
      report.push({ lead_id: l.id, outcome: "WOULD_SEND", template: v.templateName, stage_entered_at: l.stage_entered_at });
      continue;
    }

    if (!phone) {
      skipped++;
      report.push({ lead_id: l.id, outcome: "SKIPPED_INVALID_PHONE" });
      continue;
    }

    const { rows: rowIdRows } = await pool.query<{ id: string }>(
      `INSERT INTO public.${v.ledgerTable} (lead_id, stage_entered_at, status)
       VALUES ($1, $2, 'PENDING')
       ON CONFLICT (lead_id, stage_entered_at) DO UPDATE SET status = 'PENDING', error = NULL, updated_at = now()
       RETURNING id`,
      [l.id, l.stage_entered_at],
    );
    const rowId = rowIdRows[0].id;

    try {
      const res = await fetch(GALLABOX_SEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apiKey, apiSecret },
        body: JSON.stringify({
          channelId: channel,
          channelType: "whatsapp",
          recipient: { name: l.full_name?.trim() || "Customer", phone },
          whatsapp: { type: "template", template: { templateName: v.templateName } },
        }),
      });
      const json: any = await res.json().catch(() => null);
      if (!res.ok) {
        await pool.query(`UPDATE public.${v.ledgerTable} SET status='FAILED', error=$2, updated_at=now() WHERE id=$1`,
          [rowId, `Gallabox ${res.status}: ${JSON.stringify(json)}`.slice(0, 2000)]);
        skipped++;
        report.push({ lead_id: l.id, outcome: "SEND_FAILED", error: `${res.status} ${JSON.stringify(json)}` });
        continue;
      }
      const messageId = json?.id ?? json?.data?.id ?? json?.message?.id ?? null;
      await pool.query(`UPDATE public.${v.ledgerTable} SET status='SENT', message_id=$2, sent_at=now(), error=NULL, updated_at=now() WHERE id=$1`, [rowId, messageId]);
      await withTransaction(null, (client) =>
        adminRepo.insertAuditLog(client, null, v.auditAction, "kob_leads", l.id, { template: v.templateName, message_id: messageId }),
      );
      sent++;
      report.push({ lead_id: l.id, outcome: "SENT", template: v.templateName, message_id: messageId });
    } catch (e: any) {
      await pool.query(`UPDATE public.${v.ledgerTable} SET status='FAILED', error=$2, updated_at=now() WHERE id=$1`, [rowId, e?.message ?? "request error"]);
      skipped++;
      report.push({ lead_id: l.id, outcome: "SEND_ERROR", error: e?.message });
    }
  }

  return { variant: v.key, processed, sent, skipped, report };
}

async function main() {
  const { mode, leadIds } = parseArgs(process.argv.slice(2));
  const dryRun = mode === "dry-run";
  if (mode === "allowlist") console.log("ALLOWLIST (only these lead_ids will ever be touched):", JSON.stringify(leadIds));

  const results = [];
  for (const v of VARIANTS) {
    results.push(await processVariant(v, mode === "allowlist" ? leadIds : null, dryRun));
  }

  console.log(JSON.stringify({ mode, lead_id_allowlist: leadIds, variants: results }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
