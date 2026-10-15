/**
 * Phase 2 production retargeting worker — Node/Express replacement for
 * Supabase's process_retargeting_sends() (latest def: supabase/migrations/
 * 20260918093713_62c0aa2f-4131-410f-a13e-f65386fa96ff.sql), the only
 * function in that pipeline that actually calls Gallabox (advance_
 * retargeting_schedule() and send_retargeting_first_touch() only do
 * bookkeeping/scheduling, never a send).
 *
 * This file consolidates and supersedes the exact logic already proven in
 * retargetingDryRun.ts (dry-run simulation) and retargetingControlledSend.ts
 * (allowlist-only real send, verified against two synthetic leads — see the
 * controlled retargeting test report). No business-rule changes from either
 * of those — this is the same decision engine with three selectable modes.
 *
 * Modes (mutually exclusive, via CLI args):
 *   --dry-run                 Batch-select (LIMIT 200, no allowlist) from the
 *                              REAL backlog, decide what would happen, make
 *                              NO writes and NO Gallabox calls.
 *   --lead-ids=id1,id2,...    Real sends + real writes, but the SQL selection
 *                              is restricted to exactly these lead_ids — can
 *                              never touch the general backlog. For controlled
 *                              tests against synthetic/test leads only.
 *   (no flags)                PRODUCTION batch mode: real sends + real writes
 *                              against the real backlog, capped at the same
 *                              LIMIT 200 process_retargeting_sends() used.
 *                              This is the mode the systemd timer will
 *                              eventually invoke — the timer ships DISABLED,
 *                              so this mode does not run automatically yet.
 */
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import * as adminRepo from "../repositories/admin.repository.js";

const GALLABOX_SEND_URL = "https://server.gallabox.com/devapi/messages/whatsapp";
const MAX_AGE_DAYS = 180;
const BATCH_LIMIT = 200;

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

interface Settings {
  apiKey: string | null; apiSecret: string | null; channel: string | null;
  baseTemplate: string | null; mediaUrl: string | null; mediaName: string | null;
  teTemplate: string | null; mlTemplate: string | null; liTemplate: string;
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

async function loadSettings(): Promise<Settings> {
  return {
    apiKey: await getSetting("gallabox_api_key"),
    apiSecret: await getSetting("gallabox_api_secret"),
    channel: await getSetting("gallabox_channel_id"),
    baseTemplate: await getSetting("retargeting_template_name"),
    mediaUrl: await getSetting("retargeting_media_url"),
    mediaName: await getSetting("retargeting_media_name"),
    teTemplate: await getSetting("retargeting_template_name_telugu"),
    mlTemplate: await getSetting("retargeting_template_name_malayalam"),
    liTemplate: (await getSetting("leadinbox_rt_template_name")) ?? "leadinbox_stage_retargeting_clone",
  };
}

/** Mandatory allowlist filter (when provided) sits alongside, never replaces, the real eligibility conditions. */
async function selectEligibleRows(leadIds: string[] | null): Promise<ScheduleRow[]> {
  const pool = getPool();
  const allowlistClause = leadIds ? `AND rs.lead_id = ANY($1::uuid[])` : "";
  const params: unknown[] = leadIds ? [leadIds] : [];
  const limitClause = leadIds ? "" : `LIMIT ${BATCH_LIMIT}`;
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
       ${allowlistClause}
     ORDER BY rs.next_touch_at
     ${limitClause}`,
    params,
  );
  return rows;
}

function chooseTemplate(r: ScheduleRow, s: Settings): { template: string | null; button: string } {
  let button = "Know More";
  let template = s.baseTemplate;

  if (r.lead_language === "TELUGU" && s.teTemplate) template = s.teTemplate;
  else if (r.lead_language === "MALAYALAM" && s.mlTemplate) template = s.mlTemplate;

  if (r.attempts_done === 0 && r.first_touch_source === "LEAD_INBOX") {
    template = s.liTemplate; button = "Know More";
  }
  if (r.bucket === "LATER" && r.attempts_done === 0 && r.first_touch_source === "LEAD_INBOX_LATER_7D") {
    template = r.lead_language === "TAMIL" ? "later_retargeting_clone_tamil_new_crm_clone"
      : r.lead_language === "TELUGU" ? "later_retargeting_telugu_new_crm"
      : r.lead_language === "MALAYALAM" ? "later_retargeting_malayalam_new_crm"
      : s.liTemplate;
    button = "Know More";
  }
  if (r.bucket === "LATER" && r.attempts_done === 0 && r.first_touch_source === "EOI1_LATER_7D") {
    template = r.lead_language === "TAMIL" ? "later_retargeting_tamil_new_crm"
      : r.lead_language === "MALAYALAM" ? "later_retargeting_malayalam_new_crm1"
      : r.lead_language === "TELUGU" ? "later_retargeting_telugu_new_crm1"
      : template;
    button = "Know More";
  }
  if (r.bucket === "LATER" && r.attempts_done === 0 && r.first_touch_source === "WEBINAR_LATER_7D") {
    template = r.lead_language === "TAMIL" ? "webinar_later_retargeting_new_crm_clone"
      : r.lead_language === "TELUGU" ? "webinar_later_telugu_retargeting_new_crm"
      : r.lead_language === "MALAYALAM" ? "webinar_later_malayalam_retargeting_new_crm"
      : template;
    button = "Know More";
  }
  if (r.bucket === "NO" && r.attempts_done === 0) {
    const suffix = r.lead_language === "TAMIL" ? "tamil" : r.lead_language === "TELUGU" ? "telugu" : r.lead_language === "MALAYALAM" ? "malayalam" : null;
    if (suffix) { template = `no_retargeting_${suffix}_crm`; button = "Know More"; }
  }
  return { template, button };
}

function nextScheduleStep(r: ScheduleRow, cfg: ConfigRow, attemptNo: number): { attempts: number; phase: number; days: number } {
  let attempts = attemptNo;
  let phase = r.phase;
  let days: number;

  if (r.bucket === "NO") {
    days = cfg.rt_no_days ?? 30;
  } else if (r.bucket === "LATER") {
    if (r.phase <= 1) {
      if (attempts >= (cfg.rt_later_first_attempts ?? 3)) { phase = 2; attempts = 0; days = cfg.rt_later_then_days ?? 30; }
      else days = cfg.rt_later_first_days ?? 10;
    } else days = cfg.rt_later_then_days ?? 30;
  } else {
    if (r.phase <= 1) {
      if (attempts >= (cfg.rt_noresp_first_attempts ?? 3)) { phase = 2; attempts = 0; days = cfg.rt_noresp_second_days ?? 10; }
      else days = cfg.rt_noresp_first_days ?? 3;
    } else if (r.phase === 2) {
      if (attempts >= (cfg.rt_noresp_second_attempts ?? 3)) { phase = 3; attempts = 0; days = cfg.rt_noresp_final_days ?? 30; }
      else days = cfg.rt_noresp_second_days ?? 10;
    } else days = cfg.rt_noresp_final_days ?? 30;
  }
  return { attempts, phase, days: Math.max(days, 1) };
}

async function processRow(r: ScheduleRow, cfg: ConfigRow, s: Settings, dryRun: boolean): Promise<any> {
  const pool = getPool();
  const ageDays = (Date.now() - new Date(r.first_touch_at).getTime()) / 86400000;
  let dead = false;
  if (r.bucket === "NO") { if (r.attempts_done >= (cfg.rt_no_attempts ?? 6)) dead = true; }
  else if (ageDays > MAX_AGE_DAYS) dead = true;

  if (dead) {
    if (!dryRun) {
      await withTransaction(null, async (client) => {
        await client.query(`UPDATE public.retargeting_schedule SET is_dead = true, updated_at = now() WHERE id = $1`, [r.id]);
        await client.query(`UPDATE public.kob_leads SET stage = 'DEAD_LEAD' WHERE id = $1`, [r.lead_id]);
        await adminRepo.insertAuditLog(client, null, "RETARGETING_COMPLETED", "kob_leads", r.lead_id, {
          bucket: r.bucket, attempts_done: r.attempts_done, age_days: Math.round(ageDays),
        });
      });
    }
    return { lead_id: r.lead_id, bucket: r.bucket, outcome: dryRun ? "WOULD_KILL_DEAD_LEAD" : "KILLED_DEAD_LEAD" };
  }

  const { template, button } = chooseTemplate(r, s);

  if (r.bucket === "NO" && (template ?? "").startsWith("eoi_1_abandoned")) {
    if (!dryRun) {
      const nextDays = Math.max(cfg.rt_no_days ?? 30, 1);
      await pool.query(
        `UPDATE public.retargeting_schedule SET next_touch_at = now() + make_interval(days => $2), updated_at = now() WHERE id = $1`,
        [r.id, nextDays],
      );
    }
    return { lead_id: r.lead_id, bucket: r.bucket, outcome: dryRun ? "WOULD_SKIP_EOI1_ABANDONED_ON_NO" : "SKIPPED_EOI1_ABANDONED_ON_NO", template };
  }

  const phone = normalizePhone(r.phone);
  const attemptNo = r.attempts_done + 1;

  if (dryRun) {
    if (!phone) return { lead_id: r.lead_id, bucket: r.bucket, outcome: "WOULD_FAIL_INVALID_PHONE" };
    return {
      lead_id: r.lead_id, bucket: r.bucket, language: r.lead_language, attempts_done: r.attempts_done,
      phase: r.phase, first_touch_source: r.first_touch_source, outcome: "WOULD_SEND",
      template, button, channel: s.channel, credentials_configured: !!(s.apiKey && s.apiSecret),
    };
  }

  const { rows: attemptRows } = await pool.query<{ id: string }>(
    `INSERT INTO public.retargeting_attempts (lead_id, schedule_id, bucket, attempt_no, template_name, scheduled_for, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING') RETURNING id`,
    [r.lead_id, r.id, r.bucket, attemptNo, template, r.next_touch_at],
  );
  const attemptId = attemptRows[0].id;

  if (!phone) {
    await pool.query(`UPDATE public.retargeting_attempts SET status='FAILED', error='invalid phone', updated_at=now() WHERE id=$1`, [attemptId]);
    return { lead_id: r.lead_id, bucket: r.bucket, outcome: "FAILED_INVALID_PHONE", template };
  }

  const result: any = { lead_id: r.lead_id, bucket: r.bucket, language: r.lead_language, template, button };
  try {
    const res = await fetch(GALLABOX_SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apiKey: s.apiKey ?? "", apiSecret: s.apiSecret ?? "" },
      body: JSON.stringify({
        channelId: s.channel,
        channelType: "whatsapp",
        recipient: { name: r.full_name?.trim() || "Customer", phone },
        whatsapp: {
          type: "template",
          template: {
            templateName: template,
            buttonValues: [{ index: 0, sub_type: "quick_reply", parameters: { type: "payload", payload: button } }],
            headerValues: { mediaUrl: s.mediaUrl ?? undefined, mediaName: s.mediaName ?? undefined },
          },
        },
      }),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) {
      await pool.query(`UPDATE public.retargeting_attempts SET status='FAILED', error=$2, updated_at=now() WHERE id=$1`,
        [attemptId, `Gallabox ${res.status}: ${JSON.stringify(json)}`.slice(0, 2000)]);
      result.outcome = "SEND_FAILED";
      result.error = `${res.status} ${JSON.stringify(json)}`;
    } else {
      const messageId = json?.id ?? json?.data?.id ?? json?.message?.id ?? null;
      await pool.query(`UPDATE public.retargeting_attempts SET status='SENT', sent_at=now(), updated_at=now(), error=NULL WHERE id=$1`, [attemptId]);
      await withTransaction(null, (client) =>
        adminRepo.insertAuditLog(client, null, "RETARGETING_SENT", "kob_leads", r.lead_id, {
          bucket: r.bucket, attempt_no: attemptNo, template, language: r.lead_language,
          first_touch_source: r.first_touch_source, message_id: messageId,
        }),
      );
      result.outcome = "SENT";
      result.message_id = messageId;
    }
  } catch (e: any) {
    await pool.query(`UPDATE public.retargeting_attempts SET status='FAILED', error=$2, updated_at=now() WHERE id=$1`, [attemptId, e?.message ?? "request error"]);
    result.outcome = "SEND_ERROR";
    result.error = e?.message;
  }

  const step = nextScheduleStep(r, cfg, attemptNo);
  await pool.query(
    `UPDATE public.retargeting_schedule SET attempts_done=$2, phase=$3, next_touch_at = now() + make_interval(days => $4), updated_at = now() WHERE id=$1`,
    [r.id, step.attempts, step.phase, step.days],
  );
  result.new_attempts_done = step.attempts;
  result.new_phase = step.phase;
  result.next_touch_in_days = step.days;
  return result;
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

  const pool = getPool();
  const { rows: cfgRows } = await pool.query<ConfigRow>(`SELECT * FROM public.kob_configuration WHERE id = 1`);
  const cfg = cfgRows[0];
  if (!cfg) { console.log(JSON.stringify({ error: "kob_configuration row id=1 not found" })); return; }

  const settings = await loadSettings();
  if (!settings.apiKey || !settings.apiSecret) {
    console.log(JSON.stringify({ mode, error: "Gallabox credentials not configured in integration_settings" }));
    return;
  }

  const dryRun = mode === "dry-run";
  const rows = await selectEligibleRows(mode === "allowlist" ? leadIds : null);

  if (mode === "allowlist") {
    console.log("ALLOWLIST (only these lead_ids will ever be touched):", JSON.stringify(leadIds));
  }
  console.log(`mode=${mode} eligible_rows=${rows.length}${mode === "batch" || mode === "dry-run" ? ` (batch cap ${BATCH_LIMIT})` : ""}`);

  const report = [];
  for (const r of rows) report.push(await processRow(r, cfg, settings, dryRun));

  console.log(JSON.stringify({
    mode,
    lead_id_allowlist: leadIds,
    eligible_count: rows.length,
    by_bucket: rows.reduce((acc: Record<string, number>, r) => { acc[r.bucket] = (acc[r.bucket] ?? 0) + 1; return acc; }, {}),
    report: mode === "dry-run" ? report : report, // same shape either way; dry-run entries carry WOULD_* outcomes instead of real ones
  }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
