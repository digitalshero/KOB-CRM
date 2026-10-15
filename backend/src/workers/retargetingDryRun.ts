/**
 * Phase 2 (dry-run only) — read-only simulation of Supabase's
 * process_retargeting_sends() (latest def: supabase/migrations/
 * 20260918093713_62c0aa2f-4131-410f-a13e-f65386fa96ff.sql), which is the
 * actual Gallabox-sending function. advance_retargeting_schedule() and
 * send_retargeting_first_touch() only do bookkeeping/scheduling — this is
 * the one that calls net.http_post.
 *
 * This script makes NO writes and NO Gallabox calls. It selects exactly the
 * same rows with exactly the same WHERE clause, and reproduces the same
 * template-selection branching, reporting what WOULD happen. Run it with
 * `node dist/workers/retargetingDryRun.js` after building.
 */
import { getPool } from "../db/pool.js";

interface ConfigRow {
  rt_no_days: number; rt_no_attempts: number;
  rt_later_first_days: number; rt_later_first_attempts: number; rt_later_then_days: number;
  rt_noresp_first_days: number; rt_noresp_first_attempts: number;
  rt_noresp_second_days: number; rt_noresp_second_attempts: number;
  rt_noresp_final_days: number;
}

interface ScheduleRow {
  id: string; lead_id: string; bucket: string; is_dead: boolean;
  attempts_done: number; phase: number; first_touch_source: string | null;
  first_touch_at: string; next_touch_at: string;
  full_name: string | null; phone: string | null; lead_stage: string; lead_language: string | null;
}

const MAX_AGE_DAYS = 180;

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
  const pool = getPool();

  const { rows: cfgRows } = await pool.query<ConfigRow>(`SELECT * FROM public.kob_configuration WHERE id = 1`);
  const cfg = cfgRows[0];
  if (!cfg) {
    console.log(JSON.stringify({ error: "kob_configuration row id=1 not found" }));
    return;
  }

  const settingKeys = [
    "gallabox_api_key", "gallabox_api_secret", "gallabox_channel_id",
    "retargeting_template_name", "retargeting_media_url", "retargeting_media_name",
    "gallabox_api_key_telugu", "gallabox_api_secret_telugu", "gallabox_channel_id_telugu", "retargeting_template_name_telugu",
    "gallabox_api_key_malayalam", "gallabox_api_secret_malayalam", "gallabox_channel_id_malayalam", "retargeting_template_name_malayalam",
    "leadinbox_rt_template_name",
    "webinar_rt_api_key_tamil", "webinar_rt_api_secret_tamil", "webinar_rt_channel_id_tamil", "webinar_rt_template_name_tamil",
    "webinar_rt_api_key_telugu", "webinar_rt_api_secret_telugu", "webinar_rt_channel_id_telugu", "webinar_rt_template_name_telugu",
    "webinar_rt_api_key_malayalam", "webinar_rt_api_secret_malayalam", "webinar_rt_channel_id_malayalam", "webinar_rt_template_name_malayalam",
  ];
  const settings: Record<string, string | null> = {};
  for (const k of settingKeys) settings[k] = await getSetting(k);

  const apiKey = settings.gallabox_api_key;
  const apiSecret = settings.gallabox_api_secret;
  const configuredMissing = settingKeys.filter((k) => !settings[k]);

  const { rows } = await pool.query<ScheduleRow>(
    `SELECT rs.id, rs.lead_id, rs.bucket::text AS bucket, rs.is_dead, rs.attempts_done, rs.phase,
            rs.first_touch_source, rs.first_touch_at, rs.next_touch_at,
            l.full_name, l.phone, l.stage::text AS lead_stage, l.language::text AS lead_language
     FROM public.retargeting_schedule rs
     JOIN public.kob_leads l ON l.id = rs.lead_id
     WHERE rs.is_dead = false
       AND rs.next_touch_at <= now()
       AND (rs.attempts_done > 0 OR rs.first_touch_at + interval '24 hours' <= now())
       AND l.stage IN ('NO','LATER','NO_RESPONSE','RETARGETING')
     ORDER BY rs.next_touch_at
     LIMIT 200`,
  );

  const results: any[] = [];
  let killed = 0, wouldSend = 0, skippedInvalidPhone = 0, skippedEoi1AbandonedNo = 0;

  for (const r of rows) {
    const ageDays = (Date.now() - new Date(r.first_touch_at).getTime()) / 86400000;
    let dead = false;
    if (r.bucket === "NO") {
      if (r.attempts_done >= (cfg.rt_no_attempts ?? 6)) dead = true;
    } else {
      if (ageDays > MAX_AGE_DAYS) dead = true;
    }

    if (dead) {
      killed++;
      results.push({ lead_id: r.lead_id, bucket: r.bucket, outcome: "WOULD_KILL_DEAD_LEAD", attempts_done: r.attempts_done, age_days: Math.round(ageDays) });
      continue;
    }

    let button = "Know More";
    let useTemplate: string | null;
    let useKey: string | null, useSecret: string | null, useChannel: string | null;

    if (r.lead_language === "TELUGU" && settings.retargeting_template_name_telugu) {
      useTemplate = settings.retargeting_template_name_telugu;
      useKey = settings.gallabox_api_key_telugu ?? apiKey;
      useSecret = settings.gallabox_api_secret_telugu ?? apiSecret;
      useChannel = settings.gallabox_channel_id_telugu ?? settings.gallabox_channel_id;
    } else if (r.lead_language === "MALAYALAM" && settings.retargeting_template_name_malayalam) {
      useTemplate = settings.retargeting_template_name_malayalam;
      useKey = settings.gallabox_api_key_malayalam ?? apiKey;
      useSecret = settings.gallabox_api_secret_malayalam ?? apiSecret;
      useChannel = settings.gallabox_channel_id_malayalam ?? settings.gallabox_channel_id;
    } else {
      useTemplate = settings.retargeting_template_name;
      useKey = apiKey;
      useSecret = apiSecret;
      useChannel = settings.gallabox_channel_id;
    }

    if (r.attempts_done === 0 && r.first_touch_source === "WEBINAR") {
      const suffix = r.lead_language === "TAMIL" ? "tamil" : r.lead_language === "TELUGU" ? "telugu" : r.lead_language === "MALAYALAM" ? "malayalam" : null;
      if (suffix) {
        const wKey = settings[`webinar_rt_api_key_${suffix}`];
        const wSecret = settings[`webinar_rt_api_secret_${suffix}`];
        const wTemplate = settings[`webinar_rt_template_name_${suffix}`];
        if (wKey && wSecret && wTemplate) {
          useKey = wKey; useSecret = wSecret;
          useChannel = settings[`webinar_rt_channel_id_${suffix}`] ?? useChannel;
          useTemplate = wTemplate;
          button = "Book Free Webinar";
        }
      }
    }

    const liTemplate = settings.leadinbox_rt_template_name ?? "leadinbox_stage_retargeting_clone";
    if (r.attempts_done === 0 && r.first_touch_source === "LEAD_INBOX") {
      useTemplate = liTemplate; useKey = apiKey; useSecret = apiSecret; useChannel = settings.gallabox_channel_id; button = "Know More";
    }

    if (r.bucket === "LATER" && r.attempts_done === 0 && r.first_touch_source === "LEAD_INBOX_LATER_7D") {
      useKey = apiKey; useSecret = apiSecret; useChannel = settings.gallabox_channel_id; button = "Know More";
      useTemplate = r.lead_language === "TAMIL" ? "later_retargeting_clone_tamil_new_crm_clone"
        : r.lead_language === "TELUGU" ? "later_retargeting_telugu_new_crm"
        : r.lead_language === "MALAYALAM" ? "later_retargeting_malayalam_new_crm"
        : liTemplate;
    }
    if (r.bucket === "LATER" && r.attempts_done === 0 && r.first_touch_source === "EOI1_LATER_7D") {
      useKey = apiKey; useSecret = apiSecret; useChannel = settings.gallabox_channel_id; button = "Know More";
      useTemplate = r.lead_language === "TAMIL" ? "later_retargeting_tamil_new_crm"
        : r.lead_language === "MALAYALAM" ? "later_retargeting_malayalam_new_crm1"
        : r.lead_language === "TELUGU" ? "later_retargeting_telugu_new_crm1"
        : useTemplate;
    }
    if (r.bucket === "LATER" && r.attempts_done === 0 && r.first_touch_source === "WEBINAR_LATER_7D") {
      useKey = apiKey; useSecret = apiSecret; useChannel = settings.gallabox_channel_id; button = "Know More";
      useTemplate = r.lead_language === "TAMIL" ? "webinar_later_retargeting_new_crm_clone"
        : r.lead_language === "TELUGU" ? "webinar_later_telugu_retargeting_new_crm"
        : r.lead_language === "MALAYALAM" ? "webinar_later_malayalam_retargeting_new_crm"
        : useTemplate;
    }

    if (r.bucket === "NO" && r.attempts_done === 0) {
      const suffix = r.lead_language === "TAMIL" ? "tamil" : r.lead_language === "TELUGU" ? "telugu" : r.lead_language === "MALAYALAM" ? "malayalam" : null;
      if (suffix) {
        useTemplate = `no_retargeting_${suffix}_crm`;
        useKey = apiKey; useSecret = apiSecret; useChannel = settings.gallabox_channel_id; button = "Know More";
      }
    }

    if (r.bucket === "NO" && (useTemplate ?? "").startsWith("eoi_1_abandoned")) {
      skippedEoi1AbandonedNo++;
      results.push({ lead_id: r.lead_id, bucket: r.bucket, outcome: "WOULD_SKIP_EOI1_ABANDONED_ON_NO", template: useTemplate });
      continue;
    }

    const phone = normalizePhone(r.phone);
    if (!phone) {
      skippedInvalidPhone++;
      results.push({ lead_id: r.lead_id, bucket: r.bucket, outcome: "WOULD_FAIL_INVALID_PHONE" });
      continue;
    }

    wouldSend++;
    results.push({
      lead_id: r.lead_id, bucket: r.bucket, language: r.lead_language, attempts_done: r.attempts_done,
      phase: r.phase, first_touch_source: r.first_touch_source,
      outcome: "WOULD_SEND",
      template: useTemplate, button, channel: useChannel,
      credentials_configured: !!(useKey && useSecret),
      phone_normalized_preview: phone.replace(/\d(?=\d{4})/g, "*"),
    });
  }

  console.log(JSON.stringify({
    mode: "DRY_RUN_NO_WRITES_NO_SENDS",
    candidate_rows_selected: rows.length,
    query_limit: 200,
    would_send: wouldSend,
    would_kill_dead_lead: killed,
    would_skip_invalid_phone: skippedInvalidPhone,
    would_skip_eoi1_abandoned_on_no: skippedEoi1AbandonedNo,
    missing_integration_settings: configuredMissing,
    base_credentials_configured: !!(apiKey && apiSecret),
    by_bucket: rows.reduce((acc: Record<string, number>, r) => { acc[r.bucket] = (acc[r.bucket] ?? 0) + 1; return acc; }, {}),
    sample_results: results.slice(0, 20),
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
