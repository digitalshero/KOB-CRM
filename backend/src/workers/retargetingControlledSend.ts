/**
 * Phase 2 — CONTROLLED, ALLOWLIST-ONLY retargeting send.
 *
 * Same business-rule logic as process_retargeting_sends() (latest def:
 * supabase/migrations/20260918093713_...sql) and the same row-eligibility
 * conditions, but with one mandatory addition: `rs.lead_id = ANY($leadIds)`.
 * This script NEVER queries the general backlog — it can only ever touch the
 * exact lead_ids passed on the command line. There is no code path here that
 * drops that filter.
 *
 * Usage: node dist/workers/retargetingControlledSend.js <leadId1> [leadId2] ...
 *
 * This performs REAL Gallabox sends and REAL writes to retargeting_attempts /
 * retargeting_schedule / kob_leads / audit_logs for the given lead_ids only.
 * This is NOT wired into any scheduler — it is invoked manually, once, for a
 * controlled test.
 */
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import * as adminRepo from "../repositories/admin.repository.js";

const GALLABOX_SEND_URL = "https://server.gallabox.com/devapi/messages/whatsapp";
const MAX_AGE_DAYS = 180;

interface ConfigRow {
  rt_no_days: number; rt_no_attempts: number;
  rt_later_first_days: number; rt_later_first_attempts: number; rt_later_then_days: number;
  rt_noresp_first_days: number; rt_noresp_first_attempts: number;
  rt_noresp_second_days: number; rt_noresp_second_attempts: number;
  rt_noresp_final_days: number;
}

interface ScheduleRow {
  id: string; lead_id: string; bucket: string; attempts_done: number; phase: number;
  first_touch_source: string | null; first_touch_at: string; next_touch_at: string;
  full_name: string | null; phone: string | null; lead_stage: string; lead_language: string | null;
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

async function main() {
  const leadIds = process.argv.slice(2);
  if (leadIds.length === 0) {
    console.error("Usage: retargetingControlledSend.js <leadId1> [leadId2] ...");
    process.exit(1);
  }
  console.log("ALLOWLIST (only these lead_ids will ever be touched):", JSON.stringify(leadIds));

  const pool = getPool();
  const { rows: cfgRows } = await pool.query<ConfigRow>(`SELECT * FROM public.kob_configuration WHERE id = 1`);
  const cfg = cfgRows[0];

  const apiKey = await getSetting("gallabox_api_key");
  const apiSecret = await getSetting("gallabox_api_secret");
  const channel = await getSetting("gallabox_channel_id");
  const baseTemplate = await getSetting("retargeting_template_name");
  const mediaUrl = await getSetting("retargeting_media_url");
  const mediaName = await getSetting("retargeting_media_name");
  const teTemplate = await getSetting("retargeting_template_name_telugu");
  const mlTemplate = await getSetting("retargeting_template_name_malayalam");
  const liTemplate = (await getSetting("leadinbox_rt_template_name")) ?? "leadinbox_stage_retargeting_clone";

  if (!apiKey || !apiSecret) {
    console.log(JSON.stringify({ error: "Gallabox credentials not configured in integration_settings" }));
    return;
  }

  // Mandatory allowlist filter — the one and only selection criterion besides
  // the exact same eligibility conditions process_retargeting_sends() uses.
  const { rows } = await pool.query<ScheduleRow>(
    `SELECT rs.id, rs.lead_id, rs.bucket::text AS bucket, rs.attempts_done, rs.phase,
            rs.first_touch_source, rs.first_touch_at, rs.next_touch_at,
            l.full_name, l.phone, l.stage::text AS lead_stage, l.language::text AS lead_language
     FROM public.retargeting_schedule rs
     JOIN public.kob_leads l ON l.id = rs.lead_id
     WHERE rs.is_dead = false
       AND rs.next_touch_at <= now()
       AND (rs.attempts_done > 0 OR rs.first_touch_at + interval '24 hours' <= now())
       AND l.stage IN ('NO','LATER','NO_RESPONSE','RETARGETING')
       AND rs.lead_id = ANY($1::uuid[])
     ORDER BY rs.next_touch_at`,
    [leadIds],
  );

  console.log(`Eligible rows within allowlist: ${rows.length} (of ${leadIds.length} lead_ids given)`);

  const report: any[] = [];

  for (const r of rows) {
    const ageDays = (Date.now() - new Date(r.first_touch_at).getTime()) / 86400000;
    let dead = false;
    if (r.bucket === "NO") {
      if (r.attempts_done >= (cfg.rt_no_attempts ?? 6)) dead = true;
    } else if (ageDays > MAX_AGE_DAYS) {
      dead = true;
    }

    if (dead) {
      await withTransaction(null, async (client) => {
        await client.query(`UPDATE public.retargeting_schedule SET is_dead = true, updated_at = now() WHERE id = $1`, [r.id]);
        await client.query(`UPDATE public.kob_leads SET stage = 'DEAD_LEAD' WHERE id = $1`, [r.lead_id]);
        await adminRepo.insertAuditLog(client, null, "RETARGETING_COMPLETED", "kob_leads", r.lead_id, {
          bucket: r.bucket, attempts_done: r.attempts_done, age_days: Math.round(ageDays),
        });
      });
      report.push({ lead_id: r.lead_id, outcome: "KILLED_DEAD_LEAD" });
      continue;
    }

    let button = "Know More";
    let useTemplate = baseTemplate;
    if (r.lead_language === "TELUGU" && teTemplate) useTemplate = teTemplate;
    else if (r.lead_language === "MALAYALAM" && mlTemplate) useTemplate = mlTemplate;

    if (r.attempts_done === 0 && r.first_touch_source === "LEAD_INBOX") {
      useTemplate = liTemplate; button = "Know More";
    }
    if (r.bucket === "LATER" && r.attempts_done === 0 && r.first_touch_source === "LEAD_INBOX_LATER_7D") {
      useTemplate = r.lead_language === "TAMIL" ? "later_retargeting_clone_tamil_new_crm_clone"
        : r.lead_language === "TELUGU" ? "later_retargeting_telugu_new_crm"
        : r.lead_language === "MALAYALAM" ? "later_retargeting_malayalam_new_crm"
        : liTemplate;
      button = "Know More";
    }
    if (r.bucket === "LATER" && r.attempts_done === 0 && r.first_touch_source === "EOI1_LATER_7D") {
      useTemplate = r.lead_language === "TAMIL" ? "later_retargeting_tamil_new_crm"
        : r.lead_language === "MALAYALAM" ? "later_retargeting_malayalam_new_crm1"
        : r.lead_language === "TELUGU" ? "later_retargeting_telugu_new_crm1"
        : useTemplate;
      button = "Know More";
    }
    if (r.bucket === "NO" && r.attempts_done === 0) {
      const suffix = r.lead_language === "TAMIL" ? "tamil" : r.lead_language === "TELUGU" ? "telugu" : r.lead_language === "MALAYALAM" ? "malayalam" : null;
      if (suffix) { useTemplate = `no_retargeting_${suffix}_crm`; button = "Know More"; }
    }
    if (r.bucket === "NO" && (useTemplate ?? "").startsWith("eoi_1_abandoned")) {
      const nextDays = Math.max(cfg.rt_no_days ?? 30, 1);
      await pool.query(
        `UPDATE public.retargeting_schedule SET next_touch_at = now() + make_interval(days => $2), updated_at = now() WHERE id = $1`,
        [r.id, nextDays],
      );
      report.push({ lead_id: r.lead_id, outcome: "SKIPPED_EOI1_ABANDONED_ON_NO", template: useTemplate });
      continue;
    }

    const phone = normalizePhone(r.phone);
    const attemptNo = r.attempts_done + 1;

    const { rows: attemptRows } = await pool.query<{ id: string }>(
      `INSERT INTO public.retargeting_attempts (lead_id, schedule_id, bucket, attempt_no, template_name, scheduled_for, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING') RETURNING id`,
      [r.lead_id, r.id, r.bucket, attemptNo, useTemplate, r.next_touch_at],
    );
    const attemptId = attemptRows[0].id;

    if (!phone) {
      await pool.query(`UPDATE public.retargeting_attempts SET status='FAILED', error='invalid phone', updated_at=now() WHERE id=$1`, [attemptId]);
      report.push({ lead_id: r.lead_id, outcome: "FAILED_INVALID_PHONE", template: useTemplate });
      continue;
    }

    let sendOutcome: any = { lead_id: r.lead_id, bucket: r.bucket, language: r.lead_language, template: useTemplate, button };
    try {
      const res = await fetch(GALLABOX_SEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apiKey, apiSecret },
        body: JSON.stringify({
          channelId: channel,
          channelType: "whatsapp",
          recipient: { name: r.full_name?.trim() || "Customer", phone },
          whatsapp: {
            type: "template",
            template: {
              templateName: useTemplate,
              buttonValues: [{ index: 0, sub_type: "quick_reply", parameters: { type: "payload", payload: button } }],
              headerValues: { mediaUrl: mediaUrl ?? undefined, mediaName: mediaName ?? undefined },
            },
          },
        }),
      });
      const json: any = await res.json().catch(() => null);
      if (!res.ok) {
        await pool.query(`UPDATE public.retargeting_attempts SET status='FAILED', error=$2, updated_at=now() WHERE id=$1`,
          [attemptId, `Gallabox ${res.status}: ${JSON.stringify(json)}`.slice(0, 2000)]);
        sendOutcome.outcome = "SEND_FAILED";
        sendOutcome.error = `${res.status} ${JSON.stringify(json)}`;
      } else {
        const messageId = json?.id ?? json?.data?.id ?? json?.message?.id ?? null;
        await pool.query(`UPDATE public.retargeting_attempts SET status='SENT', sent_at=now(), updated_at=now(), error=NULL WHERE id=$1`, [attemptId]);
        await withTransaction(null, (client) =>
          adminRepo.insertAuditLog(client, null, "RETARGETING_SENT", "kob_leads", r.lead_id, {
            bucket: r.bucket, attempt_no: attemptNo, template: useTemplate, language: r.lead_language,
            first_touch_source: r.first_touch_source, message_id: messageId,
          }),
        );
        sendOutcome.outcome = "SENT";
        sendOutcome.message_id = messageId;
      }
    } catch (e: any) {
      await pool.query(`UPDATE public.retargeting_attempts SET status='FAILED', error=$2, updated_at=now() WHERE id=$1`, [attemptId, e?.message ?? "request error"]);
      sendOutcome.outcome = "SEND_ERROR";
      sendOutcome.error = e?.message;
    }

    let newAttempts = attemptNo;
    let newPhase = r.phase;
    let nextDays: number;

    if (r.bucket === "NO") {
      nextDays = cfg.rt_no_days ?? 30;
    } else if (r.bucket === "LATER") {
      if (r.phase <= 1) {
        if (newAttempts >= (cfg.rt_later_first_attempts ?? 3)) { newPhase = 2; newAttempts = 0; nextDays = cfg.rt_later_then_days ?? 30; }
        else nextDays = cfg.rt_later_first_days ?? 10;
      } else nextDays = cfg.rt_later_then_days ?? 30;
    } else {
      if (r.phase <= 1) {
        if (newAttempts >= (cfg.rt_noresp_first_attempts ?? 3)) { newPhase = 2; newAttempts = 0; nextDays = cfg.rt_noresp_second_days ?? 10; }
        else nextDays = cfg.rt_noresp_first_days ?? 3;
      } else if (r.phase === 2) {
        if (newAttempts >= (cfg.rt_noresp_second_attempts ?? 3)) { newPhase = 3; newAttempts = 0; nextDays = cfg.rt_noresp_final_days ?? 30; }
        else nextDays = cfg.rt_noresp_second_days ?? 10;
      } else nextDays = cfg.rt_noresp_final_days ?? 30;
    }

    await pool.query(
      `UPDATE public.retargeting_schedule SET attempts_done=$2, phase=$3, next_touch_at = now() + make_interval(days => $4), updated_at = now() WHERE id=$1`,
      [r.id, newAttempts, newPhase, Math.max(nextDays, 1)],
    );

    sendOutcome.new_attempts_done = newAttempts;
    sendOutcome.new_phase = newPhase;
    sendOutcome.next_touch_in_days = Math.max(nextDays, 1);
    report.push(sendOutcome);
  }

  console.log(JSON.stringify({ mode: "CONTROLLED_SEND_ALLOWLIST_ONLY", allowlist: leadIds, eligible_count: rows.length, report }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
