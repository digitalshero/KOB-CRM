/**
 * Node/Express replacement for Supabase's EOI1 7-day retargeting family:
 *   send_eoi1_7day_retargeting()           (default: language NOT IN (TELUGU, MALAYALAM))
 *   send_eoi1_7day_retargeting_telugu()    (language = TELUGU)
 *   send_eoi1_7day_retargeting_malayalam() (language = MALAYALAM)
 * Latest live defs read directly from source, not assumed:
 *   default    - supabase/migrations/20260809160017_bcac45dd-2309-4a14-8c14-0deab99560b5.sql
 *   telugu     - supabase/migrations/20260809155639_39590be5-5586-478a-86a2-e6ba05fc16a9.sql
 *   malayalam  - supabase/migrations/20260809160017_bcac45dd-2309-4a14-8c14-0deab99560b5.sql
 *
 * Confirmed from the live SQL (not assumed): default and Telugu BOTH reuse
 * the exact same `lead_inbox_retarget_api_key/_secret/_channel_id` credentials
 * the Lead Inbox function uses (not separate EOI1-specific keys) — only
 * Malayalam has its own dedicated `eoi1_malayalam_api_key/_secret/_channel_id`.
 * No fallback to shared/base Gallabox credentials exists in any of the three.
 *
 * This is a SEPARATE pipeline from retargetingWorker.ts and from
 * leadInboxRetargeting.ts — own eligibility condition (stage = EOI_1,
 * stage_entered_at < now() - 7 days, language-partitioned), own three
 * ledger tables, own audit actions.
 *
 * Modes (same convention as the other workers):
 *   --dry-run                    all three variants, batch-select (LIMIT 200
 *                                 each), simulate only, no writes/sends
 *   --lead-ids=a,b,c              real sends/writes restricted to exactly
 *                                 these lead_ids, across whichever of the
 *                                 three variants each lead's language matches
 *   (no flags)                    production batch mode, all three variants,
 *                                 LIMIT 200 each, same as the SQL
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
  key: "default" | "telugu" | "malayalam";
  languageFilter: string; // SQL fragment for the language condition
  ledgerTable: string;
  templateName: string;
  buttons: string[];
  auditAction: string;
  apiKeySetting: string;
  apiSecretSetting: string;
  channelSetting: string;
}

const VARIANTS: VariantConfig[] = [
  {
    key: "default",
    languageFilter: `k.language NOT IN ('TELUGU'::lead_language, 'MALAYALAM'::lead_language)`,
    ledgerTable: "lead_eoi1_retarget_sends",
    templateName: "eoi_1_retarget",
    buttons: ["Book Free Live Webinar", "Later", "No"],
    auditAction: "EOI1_7DAY_RETARGET_SENT",
    apiKeySetting: "lead_inbox_retarget_api_key",
    apiSecretSetting: "lead_inbox_retarget_api_secret",
    channelSetting: "lead_inbox_retarget_channel_id",
  },
  {
    key: "telugu",
    languageFilter: `k.language = 'TELUGU'::lead_language`,
    ledgerTable: "lead_eoi1_retarget_telugu_sends",
    templateName: "eoi_1_retarget_telugu",
    buttons: ["Telugu Free Webinar", "Needs Time", "Not Interested"],
    auditAction: "EOI1_7DAY_RETARGET_TELUGU_SENT",
    apiKeySetting: "lead_inbox_retarget_api_key",
    apiSecretSetting: "lead_inbox_retarget_api_secret",
    channelSetting: "lead_inbox_retarget_channel_id",
  },
  {
    key: "malayalam",
    languageFilter: `k.language = 'MALAYALAM'::lead_language`,
    ledgerTable: "lead_eoi1_retarget_malayalam_sends",
    templateName: "eoi_1_retarget_malayalam",
    buttons: ["Malayalam Free Webinar", "Needs More Time", "No, Thank You"],
    auditAction: "EOI1_7DAY_RETARGET_MALAYALAM_SENT",
    apiKeySetting: "eoi1_malayalam_api_key",
    apiSecretSetting: "eoi1_malayalam_api_secret",
    channelSetting: "eoi1_malayalam_channel_id",
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
  const allowlistClause = leadIds ? `AND k.id = ANY($1::uuid[])` : "";
  const params: unknown[] = leadIds ? [leadIds] : [];
  const limitClause = leadIds ? "" : `LIMIT ${BATCH_LIMIT}`;
  const { rows } = await pool.query<LeadRow>(
    // stage_entered_at cast to text — see the identical comment in
    // leadInboxRetargeting.ts: avoids a JS Date precision-truncation
    // round-trip that would otherwise permanently break the
    // (lead_id, stage_entered_at) duplicate-prevention equality check.
    `SELECT k.id, k.full_name, k.phone, k.stage_entered_at::text AS stage_entered_at
     FROM public.kob_leads k
     WHERE k.stage = 'EOI_1'::lead_stage
       AND ${v.languageFilter}
       AND k.stage_entered_at < now() - interval '7 days'
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

  // No-fallback behavior preserved exactly, same as the SQL's own guard.
  if (!apiKey || !apiSecret || !channel) {
    return { variant: v.key, processed: 0, sent: 0, skipped: 0, reason: `${v.apiKeySetting}/${v.apiSecretSetting}/${v.channelSetting} not fully configured (no fallback, by design)` };
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
          whatsapp: {
            type: "template",
            template: {
              templateName: v.templateName,
              buttonValues: v.buttons.map((payload, index) => ({
                index, sub_type: "quick_reply", parameters: { type: "payload", payload },
              })),
            },
          },
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
