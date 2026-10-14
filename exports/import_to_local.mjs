import fs from 'fs';
import path from 'path';
import pg from 'pg';

/**
 * Lovable/Supabase -> Local PostgreSQL Data Importer & Verifier
 * 
 * Usage:
 *   node exports/import_to_local.mjs           (Runs DRY RUN by default)
 *   node exports/import_to_local.mjs --dry-run (Explicit DRY RUN mode)
 *   node exports/import_to_local.mjs --execute (Executes actual import into kob_local)
 */

const exportsDir = path.resolve('exports');
const isExecute = process.argv.includes('--execute');
const isDryRun = !isExecute || process.argv.includes('--dry-run');

// ==============================================================================
// 1. FAST, QUOTE-AWARE CSV PARSER
// ==============================================================================
function parseCsv(content) {
  if (!content || !content.trim()) return { headers: [], rows: [] };

  let firstLineEnd = content.indexOf('\n');
  if (firstLineEnd === -1) firstLineEnd = content.length;
  const firstLine = content.slice(0, firstLineEnd).trim();
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  const delimiter = semicolons > commas ? ';' : ',';

  const headers = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  const len = content.length;

  while (i < len) {
    const c = content[i];
    if (c === '"') {
      if (inQuotes && i + 1 < len && content[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (!inQuotes && c === delimiter) {
      headers.push(cur.trim().replace(/^["']|["']$/g, ''));
      cur = '';
      i++;
      continue;
    }
    if (!inQuotes && (c === '\n' || c === '\r')) {
      headers.push(cur.trim().replace(/^["']|["']$/g, ''));
      cur = '';
      if (c === '\r' && i + 1 < len && content[i + 1] === '\n') i++;
      i++;
      break;
    }
    cur += c;
    i++;
  }

  const rows = [];
  let currentRow = [];
  cur = '';
  inQuotes = false;

  while (i < len) {
    const c = content[i];
    if (c === '"') {
      if (inQuotes && i + 1 < len && content[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (!inQuotes && c === delimiter) {
      currentRow.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (!inQuotes && (c === '\n' || c === '\r')) {
      currentRow.push(cur);
      cur = '';
      if (c === '\r' && i + 1 < len && content[i + 1] === '\n') i++;
      i++;

      if (currentRow.length > 0 && !(currentRow.length === 1 && !currentRow[0].trim())) {
        const obj = {};
        for (let h = 0; h < headers.length; h++) {
          const val = currentRow[h] !== undefined ? currentRow[h].trim() : '';
          obj[headers[h]] = val === '' ? null : val;
        }
        rows.push(obj);
      }
      currentRow = [];
      continue;
    }
    cur += c;
    i++;
  }

  if (cur.length > 0 || currentRow.length > 0) {
    currentRow.push(cur);
    if (currentRow.length > 0 && !(currentRow.length === 1 && !currentRow[0].trim())) {
      const obj = {};
      for (let h = 0; h < headers.length; h++) {
        const val = currentRow[h] !== undefined ? currentRow[h].trim() : '';
        obj[headers[h]] = val === '' ? null : val;
      }
      rows.push(obj);
    }
  }

  return { delimiter, headers, rows };
}

// ==============================================================================
// 2. TARGET TABLE DEFINITIONS & TOPOLOGICAL DEPENDENCY ORDER
// ==============================================================================
const tableDefinitions = [
  // Stage 1: Auth & Independent Master Tables (#01 - #10)
  { order: 1, schema: 'auth', table: 'users', files: ['01_auth_users.json'], format: 'json', pkey: 'id' },
  { order: 2, schema: 'public', table: 'brands', files: ['02_brands.csv'], format: 'csv', pkey: 'id' },
  { order: 3, schema: 'public', table: 'india_states', files: ['03_india_states.csv'], format: 'csv', pkey: 'id' },
  { order: 4, schema: 'public', table: 'india_pincodes', files: ['04_india_pincodes.csv'], format: 'csv', pkey: 'pincode' },
  { order: 5, schema: 'public', table: 'lead_sources', files: ['05_lead_sources.csv'], format: 'csv', pkey: 'id' },
  { order: 6, schema: 'public', table: 'gallabox_templates', files: ['06_gallabox_templates.csv'], format: 'csv', pkey: 'id' },
  { order: 7, schema: 'public', table: 'evaluation_questions', files: ['07_evaluation_questions.csv'], format: 'csv', pkey: 'id' },
  { order: 8, schema: 'public', table: 'kob_configuration', files: ['08_kob_configuration.csv'], format: 'csv', pkey: 'id' },
  { order: 9, schema: 'public', table: 'integration_settings', files: ['09_integration_settings.csv'], format: 'csv', pkey: 'key' },
  { order: 10, schema: 'public', table: 'kpi_targets', files: ['10_kpi_targets.csv'], format: 'csv', pkey: 'id' },

  // Stage 2: Geographic & Brand Availability Tables (#11 - #14)
  { order: 11, schema: 'public', table: 'india_districts', files: ['11_india_districts.csv'], format: 'csv', pkey: 'id' },
  { order: 12, schema: 'public', table: 'india_cities', files: ['12_india_cities.json'], format: 'json', pkey: 'id' },
  { order: 13, schema: 'public', table: 'brand_state_availability', files: ['13_brand_state_availability.csv'], format: 'csv', pkey: 'id' },
  { order: 14, schema: 'public', table: 'state_native_brand', files: ['14_state_native_brand.csv'], format: 'csv', pkey: 'state_id' },

  // Stage 3: User Profiles & Rules (#15 - #18)
  { order: 15, schema: 'public', table: 'profiles', files: ['15_profiles.csv'], format: 'csv', pkey: 'id' },
  { order: 16, schema: 'public', table: 'user_roles', files: ['16_user_roles.csv'], format: 'csv', pkey: 'id' },
  { 
    order: 17, 
    schema: 'public', 
    table: 'audit_logs', 
    files: [
      '17_audit_logs_part01.csv',
      '17_audit_logs_part02.csv',
      '17_audit_logs_part03.csv',
      '17_audit_logs_part04.csv',
      '17_audit_logs_part05.csv',
      '17_audit_logs_part06.csv',
      '17_audit_logs_part07.csv'
    ], 
    format: 'csv_chunks', 
    pkey: 'id' 
  },
  { order: 18, schema: 'public', table: 'retargeting_rules', files: ['18_retargeting_rules.json'], format: 'json', pkey: 'bucket' },

  // Stage 4: THE CORE LEADS TABLE (#19)
  { order: 19, schema: 'public', table: 'kob_leads', files: ['19_kob_leads.csv'], format: 'csv', pkey: 'id' },

  // Stage 5: Child Tables Directly Referencing kob_leads (#20 - #43)
  { order: 20, schema: 'public', table: 'lead_stage_history', files: ['20_lead_stage_history.csv'], format: 'csv', pkey: 'id' },
  { order: 21, schema: 'public', table: 'lead_activities', files: ['21_lead_activities.csv'], format: 'csv', pkey: 'id' },
  { 
    order: 22, 
    schema: 'public', 
    table: 'lead_events', 
    files: [
      '22_lead_events_part01.csv',
      '22_lead_events_part02.csv',
      '22_lead_events_part03.csv'
    ], 
    format: 'csv_chunks', 
    pkey: 'id' 
  },
  { order: 23, schema: 'public', table: 'retargeting_schedule', files: ['23_retargeting_schedule.csv'], format: 'csv', pkey: 'id' },
  { order: 24, schema: 'public', table: 'retargeting_attempts', files: ['24_retargeting_attempts.csv'], format: 'csv', pkey: 'id' },
  { order: 25, schema: 'public', table: 'gallabox_fire_queue', files: ['25_gallabox_fire_queue.csv'], format: 'csv', pkey: 'id' },
  { order: 26, schema: 'public', table: 'email_fire_queue', files: ['26_email_fire_queue.csv'], format: 'csv', pkey: 'id' },
  { order: 27, schema: 'public', table: 'webinar_batches', files: ['27_webinar_batches.csv'], format: 'csv', pkey: 'id' },
  { order: 28, schema: 'public', table: 'webinar_attendance', files: ['28_webinar_attendance.csv'], format: 'csv', pkey: 'id' },
  { order: 29, schema: 'public', table: 'evaluation_responses', files: ['29_evaluation_responses.csv'], format: 'csv', pkey: 'id' },
  { order: 30, schema: 'public', table: 'lead_inbox_retarget_sends', files: ['30_lead_inbox_retarget_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 31, schema: 'public', table: 'lead_eoi1_retarget_sends', files: ['31_lead_eoi1_retarget_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 32, schema: 'public', table: 'lead_eoi1_retarget_telugu_sends', files: ['32_lead_eoi1_retarget_telugu_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 33, schema: 'public', table: 'lead_eoi1_retarget_malayalam_sends', files: ['33_lead_eoi1_retarget_malayalam_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 34, schema: 'public', table: 'lead_webinar_retarget_tamil_sends', files: ['34_lead_webinar_retarget_tamil_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 35, schema: 'public', table: 'lead_webinar_retarget_telugu_sends', files: ['35_lead_webinar_retarget_telugu_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 36, schema: 'public', table: 'lead_webinar_retarget_malayalam_sends', files: ['36_lead_webinar_retarget_malayalam_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 37, schema: 'public', table: 'website_form_default_sends', files: ['37_website_form_default_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 38, schema: 'public', table: 'website_form_tamil_sends', files: ['38_website_form_tamil_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 39, schema: 'public', table: 'website_form_telugu_sends', files: ['39_website_form_telugu_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 40, schema: 'public', table: 'website_form_malayalam_sends', files: ['40_website_form_malayalam_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 41, schema: 'public', table: 'support_lead_sends', files: ['41_support_lead_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 42, schema: 'public', table: 'meta_ads_initial_sends', files: ['42_meta_ads_initial_sends.csv'], format: 'csv', pkey: 'id' },
  { order: 43, schema: 'public', table: 'whatsapp_broadcast_initial_sends', files: ['43_whatsapp_broadcast_initial_sends.csv'], format: 'csv', pkey: 'id' },

  // Stage 6: SCV, Incentives & Marketing KPI Tables (#44 - #55)
  { order: 44, schema: 'public', table: 'scv_mode_config', files: ['44_scv_mode_config.json'], format: 'json', pkey: 'mode' },
  { order: 45, schema: 'public', table: 'scv_mode_config_changes', files: ['45_scv_mode_config_changes.csv'], format: 'csv', pkey: 'id' },
  { order: 46, schema: 'public', table: 'scv_mode_inputs', files: ['46_scv_mode_inputs.json'], format: 'json', pkey: 'id' },
  { order: 47, schema: 'public', table: 'scv_monthly_inputs', files: ['47_scv_monthly_inputs.csv'], format: 'csv', pkey: 'id' },
  { order: 48, schema: 'public', table: 'scv_rules', files: ['48_scv_rules.csv'], format: 'csv', pkey: 'id' },
  { order: 49, schema: 'public', table: 'scv_component_weights', files: ['49_scv_component_weights.csv'], format: 'csv', pkey: 'id' },
  { order: 50, schema: 'public', table: 'scv_role_weights', files: ['50_scv_role_weights.csv'], format: 'csv', pkey: 'role' },
  { order: 51, schema: 'public', table: 'scv_weight_changes', files: ['51_scv_weight_changes.csv'], format: 'csv', pkey: 'id' },
  { order: 52, schema: 'public', table: 'scv_manual_ratings', files: ['52_scv_manual_ratings.csv'], format: 'csv', pkey: 'id' },
  { order: 53, schema: 'public', table: 'incentive_rules', files: ['53_incentive_rules.csv'], format: 'csv', pkey: 'id' },
  { order: 54, schema: 'public', table: 'incentives', files: ['54_incentives.csv'], format: 'csv', pkey: 'id' },
  { order: 55, schema: 'public', table: 'marketing_kpi_targets', files: ['55_marketing_kpi_targets.csv'], format: 'csv', pkey: 'id' },

  // #56 SKIPPED (not in live database)
  { order: 56, schema: 'public', table: 'meta_campaign_selections', skip: true, reason: 'NOT PRESENT IN LIVE DB' }
];

// ==============================================================================
// 3. SCHEMA COLUMN DEFINITIONS EXTRACTOR (FROM prisma/schema.prisma)
// ==============================================================================
function loadSchemaDictionary() {
  const schemaText = fs.readFileSync('prisma/schema.prisma', 'utf8');
  const modelNames = new Set(
    schemaText.split('\n')
      .filter(l => l.trim().startsWith('model '))
      .map(l => l.trim().split(/\s+/)[1])
  );

  const dict = {};
  let currentModel = null;

  for (const line of schemaText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('model ')) {
      currentModel = trimmed.split(/\s+/)[1];
      dict[currentModel] = {};
    } else if (currentModel && trimmed.startsWith('}')) {
      currentModel = null;
    } else if (currentModel && trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('@@')) {
      const parts = trimmed.split(/\s+/);
      const colName = parts[0];
      const colType = parts[1];
      const cleanType = colType.replace('?', '').replace('[]', '');

      // Skip Prisma virtual relation fields (reverse relations and relation fields)
      if (trimmed.includes('@relation') || modelNames.has(cleanType)) {
        continue;
      }

      dict[currentModel][colName] = {
        type: colType,
        isOptional: colType.endsWith('?'),
        isArray: colType.endsWith('[]'),
        hasDefault: trimmed.includes('@default'),
        isId: trimmed.includes('@id')
      };
    }
  }
  return dict;
}

// ==============================================================================
// 4. VALUE VALIDATOR AND TYPE CONVERTER
// ==============================================================================
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateAndConvertValue(val, colDef) {
  if (val === null || val === undefined || val === '') {
    return { valid: true, value: null };
  }

  const rawType = colDef.type.replace('?', '');

  // Array types (e.g. text[])
  if (colDef.isArray || rawType.endsWith('[]')) {
    if (Array.isArray(val)) {
      return { valid: true, value: val };
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          return { valid: true, value: parsed };
        } catch (e) {
          return { valid: false, error: `Invalid JSON array for array column: ${val}` };
        }
      }
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        // Postgres array literal
        const inner = trimmed.slice(1, -1);
        const elements = inner ? inner.split(',').map(s => s.replace(/^["']|["']$/g, '')) : [];
        return { valid: true, value: elements };
      }
      return { valid: true, value: [trimmed] };
    }
    return { valid: false, error: `Unexpected array value: ${val}` };
  }

  // Boolean
  if (rawType === 'Boolean') {
    if (typeof val === 'boolean') return { valid: true, value: val };
    const s = String(val).toLowerCase().trim();
    if (['true', 't', '1'].includes(s)) return { valid: true, value: true };
    if (['false', 'f', '0'].includes(s)) return { valid: true, value: false };
    return { valid: false, error: `Invalid boolean: ${val}` };
  }

  // Integer / SmallInt / BigInt
  if (['Int', 'BigInt'].includes(rawType)) {
    const num = Number(val);
    if (!Number.isInteger(num)) {
      return { valid: false, error: `Invalid integer: ${val}` };
    }
    return { valid: true, value: num };
  }

  // Decimal / Float
  if (['Float', 'Decimal'].includes(rawType)) {
    const num = Number(val);
    if (Number.isNaN(num)) {
      return { valid: false, error: `Invalid number: ${val}` };
    }
    return { valid: true, value: num };
  }

  // DateTime
  if (rawType === 'DateTime') {
    if (val instanceof Date && !Number.isNaN(val.getTime())) {
      return { valid: true, value: val.toISOString() };
    }
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) {
      return { valid: false, error: `Invalid date: ${val}` };
    }
    return { valid: true, value: d.toISOString() };
  }

  // Json
  if (rawType === 'Json') {
    if (typeof val === 'object') return { valid: true, value: val };
    try {
      const parsed = JSON.parse(val);
      return { valid: true, value: parsed };
    } catch (e) {
      return { valid: false, error: `Invalid JSON: ${e.message}` };
    }
  }

  // UUID string checking
  if (typeof val === 'string' && val.length === 36 && val.includes('-')) {
    if (!UUID_REGEX.test(val)) {
      return { valid: false, error: `Malformed UUID: ${val}` };
    }
  }

  return { valid: true, value: val };
}

// ==============================================================================
// 5. MAIN DRY-RUN & VALIDATION RUNNER
// ==============================================================================
async function runDryRun() {
  console.log('='.repeat(80));
  console.log(`KOB LIVE DATA -> LOCAL DOCKER POSTGRESQL IMPORTER`);
  console.log(`MODE: ${isExecute ? 'EXECUTE (LIVE IMPORT)' : 'DRY RUN ONLY (ZERO INSERTS)'}`);
  console.log('='.repeat(80));

  const schemaDict = loadSchemaDictionary();
  const results = [];
  const globalIdRegistry = {
    users: new Set(),
    brands: new Set(),
    india_states: new Set(),
    india_districts: new Set(),
    india_cities: new Set(),
    lead_sources: new Set(),
    kob_leads: new Set(),
    webinar_batches: new Set(),
    retargeting_schedule: new Set(),
    evaluation_questions: new Set(),
  };

  let totalRowsRead = 0;
  let totalParsingErrors = 0;
  let totalTypeErrors = 0;
  let totalColumnMismatches = 0;

  for (const t of tableDefinitions) {
    if (t.skip) {
      results.push({
        order: t.order,
        table: t.table,
        status: 'SKIPPED',
        rows: 0,
        files: t.files || [],
        notes: t.reason
      });
      continue;
    }

    const modelName = t.table;
    const modelDef = schemaDict[modelName] || schemaDict[`${modelName}s`] || schemaDict[t.table.replace(/s$/, '')];

    if (!modelDef) {
      results.push({
        order: t.order,
        table: t.table,
        status: 'ERROR',
        rows: 0,
        files: t.files,
        notes: `Model '${modelName}' not found in Prisma schema dictionary`
      });
      continue;
    }

    let tableRows = [];
    let fileHeaders = [];
    let parseError = null;

    for (const fileName of t.files) {
      const filePath = path.join(exportsDir, fileName);
      if (!fs.existsSync(filePath)) {
        parseError = `File '${fileName}' not found in exports/`;
        break;
      }

      if (t.format === 'json') {
        try {
          const raw = fs.readFileSync(filePath, 'utf8').trim();
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          tableRows.push(...list);
          if (list.length > 0 && fileHeaders.length === 0) {
            fileHeaders = Object.keys(list[0]);
          }
        } catch (e) {
          parseError = `JSON parse failed for ${fileName}: ${e.message}`;
          break;
        }
      } else {
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = parseCsv(raw);
          tableRows.push(...parsed.rows);
          if (fileHeaders.length === 0) {
            fileHeaders = parsed.headers;
          }
        } catch (e) {
          parseError = `CSV parse failed for ${fileName}: ${e.message}`;
          break;
        }
      }
    }

    if (parseError) {
      totalParsingErrors++;
      results.push({
        order: t.order,
        table: t.table,
        status: 'PARSE_ERROR',
        rows: 0,
        files: t.files,
        notes: parseError
      });
      continue;
    }

    totalRowsRead += tableRows.length;

    // Check columns against schema
    const targetCols = Object.keys(modelDef);
    const missingRequiredCols = targetCols.filter(c => {
      const col = modelDef[c];
      return !fileHeaders.includes(c) && !col.isOptional && !col.hasDefault;
    });

    const extraColsInFile = fileHeaders.filter(c => !targetCols.includes(c));
    if (extraColsInFile.length > 0) {
      totalColumnMismatches++;
    }

    // Validate type conversions on all rows
    let rowTypeErrorCount = 0;
    for (let r = 0; r < tableRows.length; r++) {
      const row = tableRows[r];
      // Register PK if table is a referenced parent
      if (t.pkey && row[t.pkey] && globalIdRegistry[t.table]) {
        globalIdRegistry[t.table].add(String(row[t.pkey]));
      }

      for (const colName of fileHeaders) {
        if (!modelDef[colName]) continue; // extra column ignored during insert
        const val = row[colName];
        const res = validateAndConvertValue(val, modelDef[colName]);
        if (!res.valid) {
          rowTypeErrorCount++;
          if (rowTypeErrorCount <= 3) {
            console.warn(`[TYPE WARN] #${t.order} ${t.table} row ${r + 1} col '${colName}': ${res.error}`);
          }
        }
      }
    }

    if (rowTypeErrorCount > 0) {
      totalTypeErrors += rowTypeErrorCount;
    }

    results.push({
      order: t.order,
      table: t.table,
      status: missingRequiredCols.length > 0 ? 'SCHEMA_MISMATCH' : 'VALIDATED',
      rows: tableRows.length,
      files: t.files,
      missingRequiredCols,
      extraColsInFile,
      rowTypeErrors: rowTypeErrorCount
    });
  }

  // ==============================================================================
  // 6. PRINT AUDIT REPORT TABLE
  // ==============================================================================
  console.log('\n' + '-'.repeat(110));
  console.log(
    '#'.padEnd(4) + 
    'TABLE NAME'.padEnd(35) + 
    'FILES / CHUNKS'.padEnd(25) + 
    'ROWS'.padStart(8) + '  ' + 
    'STATUS'.padEnd(16) + 
    'NOTES'
  );
  console.log('-'.repeat(110));

  for (const r of results) {
    const orderStr = String(r.order).padStart(2, '0');
    const tableStr = r.table.padEnd(35);
    const fileStr = (r.files.length > 1 ? `${r.files.length} chunk files` : (r.files[0] || 'NONE')).padEnd(25);
    const rowStr = String(r.rows).padStart(8);
    const statusStr = `[${r.status}]`.padEnd(16);
    let noteStr = '';

    if (r.status === 'SKIPPED') {
      noteStr = r.notes || '';
    } else if (r.extraColsInFile && r.extraColsInFile.length > 0) {
      noteStr = `(${r.extraColsInFile.length} extra cols ignored: ${r.extraColsInFile.slice(0, 3).join(', ')}${r.extraColsInFile.length > 3 ? '...' : ''})`;
    } else if (r.missingRequiredCols && r.missingRequiredCols.length > 0) {
      noteStr = `MISSING REQ: ${r.missingRequiredCols.join(', ')}`;
    }

    console.log(`${orderStr}  ${tableStr}${fileStr}${rowStr}  ${statusStr}${noteStr}`);
  }

  console.log('-'.repeat(110));
  console.log(`TOTAL ACTIVE TABLES VALIDATED: ${results.filter(r => r.status === 'VALIDATED').length} / 55`);
  console.log(`TOTAL ROWS READ & PARSED:      ${totalRowsRead.toLocaleString()}`);
  console.log(`PARSING ERRORS:                ${totalParsingErrors}`);
  console.log(`TYPE CONVERSION ERRORS:        ${totalTypeErrors}`);
  console.log(`DATABASE INSERTS PERFORMED:    0 (DRY RUN MODE)`);
  console.log('='.repeat(110));

  // ==============================================================================
  // 7. FOREIGN-KEY INTEGRITY SPOT CHECK
  // ==============================================================================
  console.log('\nFOREIGN-KEY PARENT REGISTRY SIZES:');
  for (const [parentTable, idSet] of Object.entries(globalIdRegistry)) {
    console.log(`  - ${parentTable.padEnd(24)}: ${idSet.size.toLocaleString()} unique IDs registered`);
  }

  // FK validation across child rows
  const leadsFile = path.join(exportsDir, '19_kob_leads.csv');
  const leadsRows = parseCsv(fs.readFileSync(leadsFile, 'utf8')).rows;
  let invalidLeadFks = 0;
  for (const l of leadsRows) {
    if (l.brand_id && !globalIdRegistry.brands.has(l.brand_id)) invalidLeadFks++;
    if (l.state_id && !globalIdRegistry.india_states.has(l.state_id)) invalidLeadFks++;
    if (l.district_id && !globalIdRegistry.india_districts.has(l.district_id)) invalidLeadFks++;
    if (l.city_id && !globalIdRegistry.india_cities.has(l.city_id)) invalidLeadFks++;
    if (l.source_id && !globalIdRegistry.lead_sources.has(l.source_id)) invalidLeadFks++;
    if (l.assigned_to && !globalIdRegistry.users.has(l.assigned_to)) invalidLeadFks++;
    if (l.team_leader_id && !globalIdRegistry.users.has(l.team_leader_id)) invalidLeadFks++;
  }

  const histFile = path.join(exportsDir, '20_lead_stage_history.csv');
  const histRows = parseCsv(fs.readFileSync(histFile, 'utf8')).rows;
  let invalidHistFks = 0;
  for (const h of histRows) {
    if (h.lead_id && !globalIdRegistry.kob_leads.has(h.lead_id)) invalidHistFks++;
    if (h.changed_by && !globalIdRegistry.users.has(h.changed_by)) invalidHistFks++;
  }

  const actFile = path.join(exportsDir, '21_lead_activities.csv');
  const actRows = parseCsv(fs.readFileSync(actFile, 'utf8')).rows;
  let invalidActFks = 0;
  for (const a of actRows) {
    if (a.lead_id && !globalIdRegistry.kob_leads.has(a.lead_id)) invalidActFks++;
    if (a.actor_id && !globalIdRegistry.users.has(a.actor_id)) invalidActFks++;
  }

  console.log('\nFOREIGN-KEY CROSS-REFERENCE VALIDATION:');
  console.log(`  - kob_leads FK references           : ${invalidLeadFks === 0 ? 'ALL VALID (0 orphans)' : `${invalidLeadFks} invalid`}`);
  console.log(`  - lead_stage_history FK references  : ${invalidHistFks === 0 ? 'ALL VALID (0 orphans)' : `${invalidHistFks} invalid`}`);
  console.log(`  - lead_activities FK references     : ${invalidActFks === 0 ? 'ALL VALID (0 orphans)' : `${invalidActFks} invalid`}`);

  const totalFkErrors = invalidLeadFks + invalidHistFks + invalidActFks;
  const isSafe = totalParsingErrors === 0 && totalFkErrors === 0 && results.filter(r => r.status === 'SCHEMA_MISMATCH').length === 0;
  console.log('\n' + '='.repeat(80));
  console.log(`OVERALL SAFETY ASSESSMENT: ${isSafe ? 'SAFE TO IMPORT' : 'NOT SAFE TO IMPORT (Fix errors first)'}`);
  console.log('='.repeat(80));

  return { isSafe, totalRowsRead, totalParsingErrors, totalTypeErrors, results };
}

// ==============================================================================
// 8. ACTUAL DATA IMPORTER (TRANSACTIONAL, SAFE REPLICA SESSION)
// ==============================================================================
async function runActualImport() {
  console.log('='.repeat(80));
  console.log('KOB LIVE DATA -> LOCAL POSTGRESQL ACTUAL IMPORTER');
  console.log('MODE: ACTUAL IMPORT (WRITING TO LOCAL DATABASE)');
  console.log('='.repeat(80));

  // 1. Connection target validation
  const envText = fs.readFileSync('.env', 'utf8');
  const match = envText.match(/DATABASE_URL="([^"]+)"/);
  if (!match) {
    throw new Error('DATABASE_URL not found in .env');
  }
  const connectionString = match[1];
  const url = new URL(connectionString);

  console.log('\n--- CONNECTION TARGET VERIFICATION ---');
  console.log('Host:        ', url.hostname);
  console.log('Port:        ', url.port);
  console.log('Database:    ', url.pathname.replace(/^\//, ''));
  console.log('User:        ', url.username);
  console.log('Schema:      ', url.searchParams.get('schema') || 'public');

  // STRICT SAFETY ENFORCEMENT
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const isTargetDb = url.pathname.replace(/^\//, '') === 'kob_local';
  if (!isLocalHost || !isTargetDb) {
    console.error('\n[SAFETY ABORT] Target is NOT local kob_local database!');
    console.error(`Received host: ${url.hostname}, database: ${url.pathname}`);
    throw new Error('Refusing to connect to non-local database!');
  }
  console.log('SAFETY CHECK: Strictly verified local kob_local target.');

  const client = new pg.Client({ connectionString });
  await client.connect();
  console.log('[CONNECTED TO LOCAL POSTGRESQL]');

  // Check if kob_local currently contains data
  const preCheck = await client.query(`
    SELECT count(*)::int AS cnt FROM information_schema.tables 
    WHERE table_schema IN ('public', 'auth', 'incentives') AND table_type = 'BASE TABLE';
  `);
  console.log(`Verified ${preCheck.rows[0].cnt} tables exist in target schemas.`);

  const importStats = [];

  try {
    console.log('\n--- COMMENCING IMPORT TRANSACTION ---');
    console.log('1. Starting single database transaction (BEGIN)...');
    await client.query('BEGIN;');

    console.log("2. Setting session_replication_role = 'replica' (Silencing triggers & side-effects)...");
    await client.query("SET session_replication_role = 'replica';");
    await client.query("SET statement_timeout = 0;");

    console.log('3. Inserting tables in foreign-key dependency order (#01 - #55)...\n');

    for (const t of tableDefinitions) {
      if (t.skip) {
        importStats.push({ order: t.order, table: t.table, schema: t.schema, status: 'SKIPPED', rows: 0, reason: t.reason });
        console.log(`[#${String(t.order).padStart(2, '0')}] ${t.schema}.${t.table.padEnd(32)}: [SKIPPED] (${t.reason})`);
        continue;
      }

      // Read file(s)
      let tableRows = [];
      for (const fileName of t.files) {
        const filePath = path.join(exportsDir, fileName);
        if (t.format === 'json') {
          const raw = fs.readFileSync(filePath, 'utf8').trim();
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          tableRows.push(...list);
        } else {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = parseCsv(raw);
          tableRows.push(...parsed.rows);
        }
      }

      // Deduplicate rows by primary key in-memory to prevent duplicate key collisions
      if (t.pkey && tableRows.length > 0) {
        const seenPkeys = new Set();
        const uniqueRows = [];
        for (const row of tableRows) {
          const pkVal = row[t.pkey];
          if (pkVal !== null && pkVal !== undefined) {
            if (!seenPkeys.has(pkVal)) {
              seenPkeys.add(pkVal);
              uniqueRows.push(row);
            }
          } else {
            uniqueRows.push(row);
          }
        }
        if (uniqueRows.length < tableRows.length) {
          console.log(`[DEDUP] #${String(t.order).padStart(2, '0')} ${t.table}: Filtered out ${tableRows.length - uniqueRows.length} duplicate rows. Importing ${uniqueRows.length.toLocaleString()} unique rows.`);
          tableRows = uniqueRows;
        }
      }

      if (tableRows.length === 0) {
        importStats.push({ order: t.order, table: t.table, schema: t.schema, status: 'SUCCESS', rows: 0 });
        console.log(`[#${String(t.order).padStart(2, '0')}] ${t.schema}.${t.table.padEnd(32)}:        0 rows (table empty in source export)`);
        continue;
      }

      // Query physical database columns for this table
      const colRes = await client.query(`
        SELECT column_name, data_type, udt_name 
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2;
      `, [t.schema, t.table]);

      if (colRes.rows.length === 0) {
        throw new Error(`Target table "${t.schema}"."${t.table}" not found in local database!`);
      }

      const dbColMap = new Map();
      for (const r of colRes.rows) {
        dbColMap.set(r.column_name, r);
      }

      // Intersect exported keys with real database columns
      const firstRowKeys = Object.keys(tableRows[0] || {});
      const insertCols = firstRowKeys.filter(k => dbColMap.has(k));

      if (insertCols.length === 0) {
        throw new Error(`No matching columns found between export and table "${t.schema}"."${t.table}"!`);
      }

      const colListSql = insertCols.map(c => `"${c}"`).join(', ');
      const BATCH_SIZE = 200;
      let insertedCount = 0;

      // Clear any migration seed placeholders for this table before importing live data
      await client.query(`DELETE FROM "${t.schema}"."${t.table}";`);

      for (let i = 0; i < tableRows.length; i += BATCH_SIZE) {
        const batch = tableRows.slice(i, i + BATCH_SIZE);
        const valueClauses = [];
        const params = [];
        let paramIdx = 1;

        for (const row of batch) {
          const rowParams = [];
          for (const col of insertCols) {
            const colMeta = dbColMap.get(col);
            let val = row[col];

            if (val === '' || val === undefined) {
              val = null;
            } else if (val !== null) {
              // Array handling
              if (colMeta.data_type === 'ARRAY' || colMeta.udt_name.startsWith('_')) {
                if (typeof val === 'string') {
                  const s = val.trim();
                  if (s.startsWith('{') && s.endsWith('}')) {
                    const inner = s.slice(1, -1);
                    val = inner ? inner.split(',').map(x => x.replace(/^["']|["']$/g, '')) : [];
                  } else if (s.startsWith('[') && s.endsWith(']')) {
                    try { val = JSON.parse(s); } catch (e) { val = [s]; }
                  } else {
                    val = [s];
                  }
                }
              } else if (colMeta.data_type === 'boolean') {
                if (typeof val === 'string') {
                  const s = val.toLowerCase().trim();
                  val = ['true', 't', '1'].includes(s);
                }
              } else if (colMeta.data_type === 'json' || colMeta.data_type === 'jsonb' || colMeta.udt_name === 'jsonb' || colMeta.udt_name === 'json') {
                if (typeof val === 'object') {
                  val = JSON.stringify(val);
                }
              }
            }

            rowParams.push(`$${paramIdx++}`);
            params.push(val);
          }
          valueClauses.push(`(${rowParams.join(', ')})`);
        }

        const insertSql = `INSERT INTO "${t.schema}"."${t.table}" (${colListSql}) VALUES ${valueClauses.join(', ')};`;
        await client.query(insertSql, params);
        insertedCount += batch.length;
      }

      importStats.push({ order: t.order, table: t.table, schema: t.schema, status: 'SUCCESS', rows: insertedCount });
      console.log(`[#${String(t.order).padStart(2, '0')}] ${t.schema}.${t.table.padEnd(32)}: ${String(insertedCount).padStart(8)} rows inserted`);
    }

    // 4. Restore trigger behavior before commit
    console.log("\n4. Restoring session_replication_role = 'origin'...");
    await client.query("SET session_replication_role = 'origin';");

    // 5. Commit transaction
    console.log("5. Committing transaction (COMMIT)...");
    await client.query('COMMIT;');
    console.log('\n[SUCCESS] TRANSACTION COMMITTED. All data safely persisted into kob_local!');

    // 6. Post-import database row count verification
    console.log('\n' + '='.repeat(100));
    console.log('POST-IMPORT ROW COUNT VERIFICATION');
    console.log('='.repeat(100));
    let mismatchCount = 0;
    for (const stat of importStats) {
      if (stat.status === 'SKIPPED') {
        console.log(`  ${(stat.schema + '.' + stat.table).padEnd(38)}: [SKIPPED]`);
        continue;
      }
      const countRes = await client.query(`SELECT count(*)::int AS cnt FROM "${stat.schema}"."${stat.table}"`);
      const dbCount = countRes.rows[0].cnt;
      const match = dbCount === stat.rows;
      if (!match) mismatchCount++;
      console.log(`  ${(stat.schema + '.' + stat.table).padEnd(38)}: Exported ${String(stat.rows).padStart(6)} | DB ${String(dbCount).padStart(6)} | ${match ? '[MATCH]' : '[MISMATCH]'}`);
    }

    // 7. Post-import FK checks
    console.log('\n' + '='.repeat(100));
    console.log('POST-IMPORT FOREIGN-KEY INTEGRITY VERIFICATION');
    console.log('='.repeat(100));
    const leadOrphanRes = await client.query(`
      SELECT count(*)::int as cnt FROM public.lead_stage_history h
      WHERE h.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.kob_leads l WHERE l.id = h.lead_id);
    `);
    console.log(`  lead_stage_history -> kob_leads orphan rows: ${leadOrphanRes.rows[0].cnt}`);

    const actOrphanRes = await client.query(`
      SELECT count(*)::int as cnt FROM public.lead_activities a
      WHERE a.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.kob_leads l WHERE l.id = a.lead_id);
    `);
    console.log(`  lead_activities -> kob_leads orphan rows:     ${actOrphanRes.rows[0].cnt}`);

    const eventOrphanRes = await client.query(`
      SELECT count(*)::int as cnt FROM public.lead_events e
      WHERE e.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.kob_leads l WHERE l.id = e.lead_id);
    `);
    console.log(`  lead_events -> kob_leads orphan rows:         ${eventOrphanRes.rows[0].cnt}`);

    const leadUserOrphanRes = await client.query(`
      SELECT count(*)::int as cnt FROM public.kob_leads l
      WHERE l.assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.assigned_to);
    `);
    console.log(`  kob_leads -> auth.users orphan assigned_to:   ${leadUserOrphanRes.rows[0].cnt}`);

    const totalDbOrphans = leadOrphanRes.rows[0].cnt + actOrphanRes.rows[0].cnt + eventOrphanRes.rows[0].cnt + leadUserOrphanRes.rows[0].cnt;

    console.log('\n' + '='.repeat(100));
    console.log(`FINAL RESULT: ${mismatchCount === 0 && totalDbOrphans === 0 ? 'ALL DATA IMPORTED & VERIFIED WITH 100% PARITY' : 'VERIFICATION WARNINGS FOUND'}`);
    console.log(`Mismatches: ${mismatchCount} | Orphan FKs: ${totalDbOrphans}`);
    console.log('='.repeat(100));

  } catch (err) {
    console.error('\n' + '!'.repeat(80));
    console.error(`[FATAL IMPORT ERROR]: ${err.message}`);
    console.error('!'.repeat(80));
    console.log("\nInitiating atomic transaction rollback...");
    try {
      await client.query('ROLLBACK;');
      await client.query("SET session_replication_role = 'origin';");
      console.log('[ROLLBACK COMPLETE] Transaction completely rolled back. Zero partial data committed to kob_local.');
    } catch (rbErr) {
      console.error('Error during rollback execution:', rbErr.message);
    }
    throw err;
  } finally {
    await client.end();
  }
}

// ==============================================================================
// 9. CLI ENTRYPOINT
// ==============================================================================
async function main() {
  if (isExecute) {
    await runActualImport();
  } else {
    await runDryRun();
  }
}

main().catch(err => {
  console.error('[EXIT]: Process terminated with error.');
  process.exit(1);
});

