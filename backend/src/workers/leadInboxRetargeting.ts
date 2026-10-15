/**
 * Node/Express replacement for Supabase's send_lead_inbox_7day_retargeting()
 * (latest def: supabase/migrations/20260903072849_6b58bfa3-bf70-4589-b49c-
 * b5d2ff0d3fea.sql). Despite the function's name, the real window is 24
 * hours, not 7 days. This is a SEPARATE pipeline from retargetingWorker.ts
 * (which drives retargeting_schedule) — this one reads kob_leads.stage_
 * entered_at directly and writes to its own dedicated ledger table.
 *
 * Modes (same convention as retargetingWorker.ts):
 *   --dry-run              batch-select (LIMIT 200), simulate only, no writes/sends
 *   --lead-ids=a,b,c        real sends/writes restricted to exactly these lead_ids
 *   (no flags)              production batch mode, LIMIT 200, same as the SQL
 */
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import * as adminRepo from "../repositories/admin.repository.js";

const GALLABOX_SEND_URL = "https://server.gallabox.com/devapi/messages/whatsapp";
const TEMPLATE_NAME = "lead_inbox_retargeting";
const AUDIT_ACTION = "LEAD_INBOX_24H_RETARGET_SENT";
const BATCH_LIMIT = 200;

interface LeadRow {
  id: string; full_name: string | null; phone: string | null; stage_entered_at: string;
}

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

async function selectEligibleRows(leadIds: string[] | null): Promise<LeadRow[]> {
  const pool = getPool();
  const allowlistClause = leadIds ? `AND k.id = ANY($1::uuid[])` : "";
  const params: unknown[] = leadIds ? [leadIds] : [];
  const limitClause = leadIds ? "" : `LIMIT ${BATCH_LIMIT}`;
  const { rows } = await pool.query<LeadRow>(
    `SELECT k.id, k.full_name, k.phone, k.stage_entered_at
     FROM public.kob_leads k
     WHERE k.stage = 'LEAD_INBOX'::lead_stage
       AND k.stage_entered_at <= now() - interval '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM public.lead_inbox_retarget_sends s
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

async function main() {
  const { mode, leadIds } = parseArgs(process.argv.slice(2));
  const dryRun = mode === "dry-run";

  const apiKey = await getSetting("lead_inbox_retarget_api_key");
  const apiSecret = await getSetting("lead_inbox_retarget_api_secret");
  const channel = await getSetting("lead_inbox_retarget_channel_id");

  // No-fallback behavior preserved exactly: SQL returns (0,0,0) if any of
  // these three are missing, never falls back to the shared base credentials.
  if (!apiKey || !apiSecret || !channel) {
    console.log(JSON.stringify({ mode, processed: 0, sent: 0, skipped: 0, reason: "lead_inbox_retarget_* credentials not fully configured (no fallback, by design)" }));
    return;
  }

  const rows = await selectEligibleRows(mode === "allowlist" ? leadIds : null);
  if (mode === "allowlist") console.log("ALLOWLIST (only these lead_ids will ever be touched):", JSON.stringify(leadIds));
  console.log(`mode=${mode} eligible_rows=${rows.length}`);

  const pool = getPool();
  const report: any[] = [];
  let processed = 0, sent = 0, skipped = 0;

  for (const l of rows) {
    processed++;
    const phone = normalizePhone(l.phone);

    if (dryRun) {
      if (!phone) { skipped++; report.push({ lead_id: l.id, outcome: "WOULD_SKIP_INVALID_PHONE" }); continue; }
      report.push({ lead_id: l.id, outcome: "WOULD_SEND", template: TEMPLATE_NAME, stage_entered_at: l.stage_entered_at });
      sent++;
      continue;
    }

    if (!phone) {
      skipped++;
      report.push({ lead_id: l.id, outcome: "SKIPPED_INVALID_PHONE" });
      continue;
    }

    const { rows: rowIdRows } = await pool.query<{ id: string }>(
      `INSERT INTO public.lead_inbox_retarget_sends (lead_id, stage_entered_at, status)
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
              templateName: TEMPLATE_NAME,
              buttonValues: [
                { index: 0, sub_type: "quick_reply", parameters: { type: "payload", payload: "விருப்பம் உள்ளது" } },
                { index: 1, sub_type: "quick_reply", parameters: { type: "payload", payload: "ఆసక్తి ఉంది" } },
                { index: 2, sub_type: "quick_reply", parameters: { type: "payload", payload: "താൽപ്പര്യമുണ്ട്" } },
                { index: 3, sub_type: "quick_reply", parameters: { type: "payload", payload: "Later" } },
                { index: 4, sub_type: "quick_reply", parameters: { type: "payload", payload: "No" } },
              ],
            },
          },
        }),
      });
      const json: any = await res.json().catch(() => null);
      if (!res.ok) {
        await pool.query(`UPDATE public.lead_inbox_retarget_sends SET status='FAILED', error=$2, updated_at=now() WHERE id=$1`,
          [rowId, `Gallabox ${res.status}: ${JSON.stringify(json)}`.slice(0, 2000)]);
        skipped++;
        report.push({ lead_id: l.id, outcome: "SEND_FAILED", error: `${res.status} ${JSON.stringify(json)}` });
        continue;
      }
      const messageId = json?.id ?? json?.data?.id ?? json?.message?.id ?? null;
      await pool.query(`UPDATE public.lead_inbox_retarget_sends SET status='SENT', message_id=$2, sent_at=now(), error=NULL, updated_at=now() WHERE id=$1`, [rowId, messageId]);
      await withTransaction(null, (client) =>
        adminRepo.insertAuditLog(client, null, AUDIT_ACTION, "kob_leads", l.id, { template: TEMPLATE_NAME, message_id: messageId }),
      );
      sent++;
      report.push({ lead_id: l.id, outcome: "SENT", template: TEMPLATE_NAME, message_id: messageId });
    } catch (e: any) {
      await pool.query(`UPDATE public.lead_inbox_retarget_sends SET status='FAILED', error=$2, updated_at=now() WHERE id=$1`, [rowId, e?.message ?? "request error"]);
      skipped++;
      report.push({ lead_id: l.id, outcome: "SEND_ERROR", error: e?.message });
    }
  }

  console.log(JSON.stringify({ mode, lead_id_allowlist: leadIds, processed, sent, skipped, report }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
