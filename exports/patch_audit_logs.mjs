import fs from 'fs';
import path from 'path';
import pg from 'pg';

/**
 * Local-only patch script for public.audit_logs
 * Inserts only missing audit_logs rows into kob_local.
 */

function parseCsv(content) {
  if (!content || !content.trim()) return { headers: [], rows: [] };
  let firstLineEnd = content.indexOf('\n');
  if (firstLineEnd === -1) firstLineEnd = content.length;
  const firstLine = content.slice(0, firstLineEnd).trim();
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  const headers = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  const len = content.length;

  while (i < len) {
    const c = content[i];
    if (c === '"') {
      if (inQuotes && i + 1 < len && content[i + 1] === '"') { cur += '"'; i += 2; continue; }
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
      if (inQuotes && i + 1 < len && content[i + 1] === '"') { cur += '"'; i += 2; continue; }
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

async function runPatch() {
  console.log('='.repeat(80));
  console.log('KOB LOCAL: AUDIT LOGS RE-SYNC / PATCH');
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
  console.log('Host:     ', url.hostname);
  console.log('Port:     ', url.port);
  console.log('Database: ', url.pathname.replace(/^\//, ''));
  console.log('User:     ', url.username);

  // Strict safety guard
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const isTargetDb = url.pathname.replace(/^\//, '') === 'kob_local';
  if (!isLocalHost || !isTargetDb) {
    console.error('\n[SAFETY ABORT] Target is NOT local kob_local database!');
    throw new Error('Refusing to connect to non-local database!');
  }
  console.log('SAFETY CHECK: Strictly verified local kob_local target.');

  const client = new pg.Client({ connectionString });
  await client.connect();
  console.log('[CONNECTED TO LOCAL POSTGRESQL]');

  // 2. Pre-check: current local count
  const countPreRes = await client.query('SELECT count(*)::int AS cnt FROM public.audit_logs;');
  const currentLocalCount = countPreRes.rows[0].cnt;

  // Retrieve existing IDs
  console.log('Fetching existing IDs from local public.audit_logs...');
  const idRes = await client.query('SELECT id FROM public.audit_logs;');
  const existingIdSet = new Set(idRes.rows.map(r => r.id));

  // 3. Read and parse all 7 chunks from exports
  const exportsDir = path.resolve('exports');
  const parts = [
    '17_audit_logs_part01.csv',
    '17_audit_logs_part02.csv',
    '17_audit_logs_part03.csv',
    '17_audit_logs_part04.csv',
    '17_audit_logs_part05.csv',
    '17_audit_logs_part06.csv',
    '17_audit_logs_part07.csv'
  ];

  console.log('Parsing all 7 audit_logs export files...');
  let totalExportRows = 0;
  const uniqueExportRows = [];
  const exportIdSet = new Set();

  for (const f of parts) {
    const raw = fs.readFileSync(path.join(exportsDir, f), 'utf8');
    const parsed = parseCsv(raw);
    totalExportRows += parsed.rows.length;
    for (const row of parsed.rows) {
      if (row.id && !exportIdSet.has(row.id)) {
        exportIdSet.add(row.id);
        uniqueExportRows.push(row);
      }
    }
  }

  // 4. Identify missing rows
  const missingRows = uniqueExportRows.filter(r => !existingIdSet.has(r.id));

  console.log('\n--- PRE-PATCH AUDIT STATUS ---');
  console.log(`Current local audit_logs count        : ${currentLocalCount.toLocaleString()}`);
  console.log(`Corrected export unique count          : ${exportIdSet.size.toLocaleString()}`);
  console.log(`Number of missing IDs expected to insert: ${missingRows.length.toLocaleString()}`);

  if (missingRows.length === 0) {
    console.log('\nAll audit log rows are already present in kob_local. Nothing to patch.');
    await client.end();
    return;
  }

  // 5. Query table column definitions for public.audit_logs
  const colRes = await client.query(`
    SELECT column_name, data_type, udt_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'audit_logs';
  `);
  const dbColMap = new Map();
  for (const r of colRes.rows) {
    dbColMap.set(r.column_name, r);
  }

  const sampleRowKeys = Object.keys(missingRows[0] || {});
  const insertCols = sampleRowKeys.filter(k => dbColMap.has(k));
  const colListSql = insertCols.map(c => `"${c}"`).join(', ');

  // 6. Execute Transactional Patch
  try {
    console.log('\n--- COMMENCING PATCH TRANSACTION ---');
    console.log('1. Starting single database transaction (BEGIN)...');
    await client.query('BEGIN;');

    console.log("2. Setting session_replication_role = 'replica' (Suppressing triggers & side effects)...");
    await client.query("SET session_replication_role = 'replica';");
    await client.query("SET statement_timeout = 0;");

    console.log(`3. Inserting ${missingRows.length.toLocaleString()} missing audit_logs rows in batches...`);
    const BATCH_SIZE = 200;
    let insertedCount = 0;

    for (let i = 0; i < missingRows.length; i += BATCH_SIZE) {
      const batch = missingRows.slice(i, i + BATCH_SIZE);
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
            if (colMeta.data_type === 'boolean') {
              if (typeof val === 'string') {
                val = ['true', 't', '1'].includes(val.toLowerCase().trim());
              }
            } else if (['json', 'jsonb'].includes(colMeta.data_type) || ['json', 'jsonb'].includes(colMeta.udt_name)) {
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

      const insertSql = `INSERT INTO public.audit_logs (${colListSql}) VALUES ${valueClauses.join(', ')} ON CONFLICT (id) DO NOTHING;`;
      await client.query(insertSql, params);
      insertedCount += batch.length;
    }

    console.log(`Successfully inserted all ${insertedCount.toLocaleString()} missing rows.`);

    // 4. Restore trigger role
    console.log("\n4. Restoring session_replication_role = 'origin'...");
    await client.query("SET session_replication_role = 'origin';");

    // 5. Commit transaction
    console.log("5. Committing transaction (COMMIT)...");
    await client.query('COMMIT;');
    console.log('\n[SUCCESS] TRANSACTION COMMITTED.');

    // 6. Post-patch Verification
    console.log('\n' + '='.repeat(80));
    console.log('POST-PATCH VERIFICATION');
    console.log('='.repeat(80));

    const countPostRes = await client.query('SELECT count(*)::int AS cnt FROM public.audit_logs;');
    const finalCount = countPostRes.rows[0].cnt;
    console.log(`Final local audit_logs count: ${finalCount.toLocaleString()} (Expected: 127,666)`);

    const dupRes = await client.query(`
      SELECT count(*)::int as dup_count FROM (
        SELECT id FROM public.audit_logs GROUP BY id HAVING count(*) > 1
      ) d;
    `);
    const duplicateIds = dupRes.rows[0].dup_count;
    console.log(`Duplicate primary-key IDs in table: ${duplicateIds}`);

    const isSuccess = finalCount === 127666 && duplicateIds === 0;
    console.log('\n' + '='.repeat(80));
    console.log(`PATCH OUTCOME: ${isSuccess ? '100% SUCCESS (ALL 127,666 AUDIT LOGS IN KOB_LOCAL)' : 'VERIFICATION WARNING'}`);
    console.log('='.repeat(80));

  } catch (err) {
    console.error('\n' + '!'.repeat(80));
    console.error(`[FATAL PATCH ERROR]: ${err.message}`);
    console.error('!'.repeat(80));
    console.log("Initiating atomic transaction rollback...");
    try {
      await client.query('ROLLBACK;');
      await client.query("SET session_replication_role = 'origin';");
      console.log('[ROLLBACK COMPLETE] Transaction completely rolled back. Zero partial changes committed.');
    } catch (rbErr) {
      console.error('Error during rollback:', rbErr.message);
    }
    throw err;
  } finally {
    await client.end();
  }
}

runPatch().catch(err => {
  console.error('[EXIT]: Process terminated with error.');
  process.exit(1);
});
