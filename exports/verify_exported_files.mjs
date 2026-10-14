import fs from 'fs';
import path from 'path';

const exportsDir = path.resolve('exports');

function countCsvRecords(content) {
  if (!content || !content.trim()) return 0;
  let inQuotes = false;
  let rowCount = 0;
  const len = content.length;
  for (let i = 0; i < len; i++) {
    const c = content[i];
    if (c === '"') {
      if (inQuotes && i + 1 < len && content[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === '\n' && !inQuotes) {
      rowCount++;
    }
  }
  if (len > 0 && content[len - 1] !== '\n') {
    rowCount++;
  }
  return Math.max(0, rowCount - 1);
}

const tables = [
  { order: 1, name: 'auth.users', filename: '01_auth_users', format: 'json' },
  { order: 2, name: 'brands', filename: '02_brands', format: 'csv' },
  { order: 3, name: 'india_states', filename: '03_india_states', format: 'csv' },
  { order: 4, name: 'india_pincodes', filename: '04_india_pincodes', format: 'csv' },
  { order: 5, name: 'lead_sources', filename: '05_lead_sources', format: 'csv' },
  { order: 6, name: 'gallabox_templates', filename: '06_gallabox_templates', format: 'csv' },
  { order: 7, name: 'evaluation_questions', filename: '07_evaluation_questions', format: 'csv' },
  { order: 8, name: 'kob_configuration', filename: '08_kob_configuration', format: 'csv' },
  { order: 9, name: 'integration_settings', filename: '09_integration_settings', format: 'csv' },
  { order: 10, name: 'kpi_targets', filename: '10_kpi_targets', format: 'csv' },
  { order: 11, name: 'india_districts', filename: '11_india_districts', format: 'csv' },
  { order: 12, name: 'india_cities', filename: '12_india_cities', format: 'json' },
  { order: 13, name: 'brand_state_availability', filename: '13_brand_state_availability', format: 'csv' },
  { order: 14, name: 'state_native_brand', filename: '14_state_native_brand', format: 'csv' },
  { order: 15, name: 'profiles', filename: '15_profiles', format: 'csv' },
  { order: 16, name: 'user_roles', filename: '16_user_roles', format: 'csv' },
  { 
    order: 17, 
    name: 'audit_logs', 
    type: 'chunks',
    chunks: [
      '17_audit_logs_part01.csv',
      '17_audit_logs_part02.csv',
      '17_audit_logs_part03.csv',
      '17_audit_logs_part04.csv',
      '17_audit_logs_part05.csv',
      '17_audit_logs_part06.csv',
      '17_audit_logs_part07.csv'
    ],
    expectedCount: 127666
  },
  { order: 18, name: 'retargeting_rules', filename: '18_retargeting_rules', format: 'json' },
  { order: 19, name: 'kob_leads', filename: '19_kob_leads', format: 'csv', expectedCount: 4744 },
  { order: 20, name: 'lead_stage_history', filename: '20_lead_stage_history', format: 'csv' },
  { order: 21, name: 'lead_activities', filename: '21_lead_activities', format: 'csv' },
  { 
    order: 22, 
    name: 'lead_events', 
    type: 'chunks',
    chunks: [
      '22_lead_events_part01.csv',
      '22_lead_events_part02.csv',
      '22_lead_events_part03.csv'
    ],
    expectedCount: 49535
  },
  { order: 23, name: 'retargeting_schedule', filename: '23_retargeting_schedule', format: 'csv' },
  { order: 24, name: 'retargeting_attempts', filename: '24_retargeting_attempts', format: 'csv' },
  { order: 25, name: 'gallabox_fire_queue', filename: '25_gallabox_fire_queue', format: 'csv' },
  { order: 26, name: 'email_fire_queue', filename: '26_email_fire_queue', format: 'csv' },
  { order: 27, name: 'webinar_batches', filename: '27_webinar_batches', format: 'csv' },
  { order: 28, name: 'webinar_attendance', filename: '28_webinar_attendance', format: 'csv' },
  { order: 29, name: 'evaluation_responses', filename: '29_evaluation_responses', format: 'csv' },
  { order: 30, name: 'lead_inbox_retarget_sends', filename: '30_lead_inbox_retarget_sends', format: 'csv' },
  { order: 31, name: 'lead_eoi1_retarget_sends', filename: '31_lead_eoi1_retarget_sends', format: 'csv' },
  { order: 32, name: 'lead_eoi1_retarget_telugu_sends', filename: '32_lead_eoi1_retarget_telugu_sends', format: 'csv' },
  { order: 33, name: 'lead_eoi1_retarget_malayalam_sends', filename: '33_lead_eoi1_retarget_malayalam_sends', format: 'csv' },
  { order: 34, name: 'lead_webinar_retarget_tamil_sends', filename: '34_lead_webinar_retarget_tamil_sends', format: 'csv' },
  { order: 35, name: 'lead_webinar_retarget_telugu_sends', filename: '35_lead_webinar_retarget_telugu_sends', format: 'csv' },
  { order: 36, name: 'lead_webinar_retarget_malayalam_sends', filename: '36_lead_webinar_retarget_malayalam_sends', format: 'csv' },
  { order: 37, name: 'website_form_default_sends', filename: '37_website_form_default_sends', format: 'csv' },
  { order: 38, name: 'website_form_tamil_sends', filename: '38_website_form_tamil_sends', format: 'csv' },
  { order: 39, name: 'website_form_telugu_sends', filename: '39_website_form_telugu_sends', format: 'csv' },
  { order: 40, name: 'website_form_malayalam_sends', filename: '40_website_form_malayalam_sends', format: 'csv' },
  { order: 41, name: 'support_lead_sends', filename: '41_support_lead_sends', format: 'csv' },
  { order: 42, name: 'meta_ads_initial_sends', filename: '42_meta_ads_initial_sends', format: 'csv' },
  { order: 43, name: 'whatsapp_broadcast_initial_sends', filename: '43_whatsapp_broadcast_initial_sends', format: 'csv' },
  { order: 44, name: 'scv_mode_config', filename: '44_scv_mode_config', format: 'json' },
  { order: 45, name: 'scv_mode_config_changes', filename: '45_scv_mode_config_changes', format: 'csv' },
  { order: 46, name: 'scv_mode_inputs', filename: '46_scv_mode_inputs', format: 'json' },
  { order: 47, name: 'scv_monthly_inputs', filename: '47_scv_monthly_inputs', format: 'csv' },
  { order: 48, name: 'scv_rules', filename: '48_scv_rules', format: 'csv' },
  { order: 49, name: 'scv_component_weights', filename: '49_scv_component_weights', format: 'csv' },
  { order: 50, name: 'scv_role_weights', filename: '50_scv_role_weights', format: 'csv' },
  { order: 51, name: 'scv_weight_changes', filename: '51_scv_weight_changes', format: 'csv' },
  { order: 52, name: 'scv_manual_ratings', filename: '52_scv_manual_ratings', format: 'csv' },
  { order: 53, name: 'incentive_rules', filename: '53_incentive_rules', format: 'csv' },
  { order: 54, name: 'incentives', filename: '54_incentives', format: 'csv' },
  { order: 55, name: 'marketing_kpi_targets', filename: '55_marketing_kpi_targets', format: 'csv' },
  { order: 56, name: 'meta_campaign_selections', type: 'skip', reason: 'NOT PRESENT IN LIVE DB' },
];

console.log('='.repeat(70));
console.log('EXPORTED FILES AUDIT & ROW COUNT CHECK');
console.log('='.repeat(70));

let foundCount = 0;
let missingCount = 0;
let skippedCount = 0;

for (const t of tables) {
  const orderStr = String(t.order).padStart(2, '0');
  const nameStr = t.name.padEnd(35);

  // Type: skip
  if (t.type === 'skip') {
    skippedCount++;
    console.log(`[SKIPPED] #${orderStr} ${nameStr} -> ${t.reason}`);
    continue;
  }

  // Type: chunks (audit_logs, lead_events)
  if (t.type === 'chunks') {
    let allChunksExist = true;
    let combinedRows = 0;
    const missingChunks = [];

    for (const chunkFile of t.chunks) {
      const chunkPath = path.join(exportsDir, chunkFile);
      if (!fs.existsSync(chunkPath)) {
        allChunksExist = false;
        missingChunks.push(chunkFile);
      } else {
        const content = fs.readFileSync(chunkPath, 'utf8');
        combinedRows += countCsvRecords(content);
      }
    }

    if (allChunksExist) {
      foundCount++;
      const fileLabel = `${t.chunks.length} chunk files`.padEnd(40);
      if (t.expectedCount && t.order === 17 && combinedRows !== t.expectedCount) {
        console.log(`[ERROR]   #${orderStr} ${nameStr} -> ${fileLabel} (Rows: ${combinedRows}, expected ${t.expectedCount})`);
      } else {
        console.log(`[FOUND]   #${orderStr} ${nameStr} -> ${fileLabel} (Rows: ${combinedRows})`);
      }
    } else {
      missingCount++;
      console.log(`[MISSING] #${orderStr} ${nameStr} -> Missing chunks: ${missingChunks.join(', ')}`);
    }
    continue;
  }

  // Type: single file (JSON or CSV)
  const jsonPath = path.join(exportsDir, `${t.filename}.json`);
  const csvPath = path.join(exportsDir, `${t.filename}.csv`);

  let fileUsed = null;
  let rowCount = 0;

  // Ignore obsolete/incomplete 17_audit_logs.json and 19_kob_leads.json (already handled above)
  if (t.format === 'json' && fs.existsSync(jsonPath)) {
    fileUsed = `${t.filename}.json`;
    try {
      const content = fs.readFileSync(jsonPath, 'utf8').trim();
      const parsed = JSON.parse(content);
      rowCount = Array.isArray(parsed) ? parsed.length : 1;
    } catch (e) {
      rowCount = `INVALID JSON (${e.message})`;
    }
  } else if (fs.existsSync(csvPath)) {
    fileUsed = `${t.filename}.csv`;
    const content = fs.readFileSync(csvPath, 'utf8');
    rowCount = countCsvRecords(content);
  }

  if (fileUsed) {
    foundCount++;
    console.log(`[FOUND]   #${orderStr} ${nameStr} -> ${fileUsed.padEnd(40)} (Rows: ${rowCount})`);
  } else {
    missingCount++;
    console.log(`[MISSING] #${orderStr} ${nameStr} -> ${t.filename}.${t.format}`);
  }
}

console.log('='.repeat(70));
console.log(`Summary: ${foundCount} / ${tables.length - skippedCount} active tables present, ${skippedCount} skipped, ${missingCount} missing.`);
console.log('='.repeat(70));
