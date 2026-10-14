import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();
const syncLocalEnvPath = path.join(process.cwd(), '.env.sync.local');
if (fs.existsSync(syncLocalEnvPath)) {
  dotenv.config({ path: syncLocalEnvPath, override: true });
}

const rawConn = process.env.LIVE_DATABASE_READ_URL || '';
const poolerPassword = rawConn.includes('<') ? rawConn.match(/:<([^>]+)>/)?.[1] : rawConn.match(/:([^@:]+)@/)?.[1];

const livePg = new pg.Client({
  host: 'aws-0-ap-southeast-2.pooler.supabase.com',
  port: 5432,
  user: 'live_sync_reader.guqjvhptyhfrzkjcykvf',
  password: poolerPassword,
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

const localPg = new pg.Client('postgresql://postgres:postgres@127.0.0.1:54322/postgres');

await livePg.connect();
await localPg.connect();

// Safety: ensure live connection has default_transaction_read_only = on
await livePg.query('SET default_transaction_read_only = on;');

// List of all 54 tables
import { createStrictReadOnlyLiveDbClient } from './sync_live_to_local.mjs';

const auditSummary = [];

// Load table definitions from sync_live_to_local.mjs
const syncContent = fs.readFileSync('scripts/sync_live_to_local.mjs', 'utf8');
const tablesMatch = syncContent.match(/const SYNC_TABLES = (\[[\s\S]*?\n\];)/);
let SYNC_TABLES = [];
if (tablesMatch) {
  // eval safe array of simple objects
  SYNC_TABLES = eval(tablesMatch[1]);
}

console.log(`Auditing and reconciling all ${SYNC_TABLES.length} tables by Primary Key...\n`);

for (const tableConfig of SYNC_TABLES) {
  const tName = tableConfig.name;
  const pkCol = tableConfig.pk;
  const cursorCol = tableConfig.cursor;
  const hasUpdatedAt = cursorCol === 'updated_at';

  // 1. Fetch Local PKs and timestamps
  const localQuery = hasUpdatedAt
    ? `SELECT "${pkCol}" as pk, "updated_at" FROM public."${tName}"`
    : `SELECT "${pkCol}" as pk FROM public."${tName}"`;
  
  const localRes = await localPg.query(localQuery);
  const localMap = new Map();
  for (const r of localRes.rows) {
    const val = r.updated_at ? new Date(r.updated_at).toISOString() : true;
    localMap.set(String(r.pk), val);
  }

  // 2. Fetch Live PKs and timestamps in keyset batches of 25,000
  const livePkSet = new Set();
  const missingInLocalIds = [];
  let changedCount = 0;
  let conflictCount = 0;
  const conflicts = [];

  let lastPk = null;
  let hasMore = true;
  let liveTotalCount = 0;

  while (hasMore) {
    let liveQuery = '';
    const params = [];
    if (lastPk !== null) {
      params.push(lastPk);
      liveQuery = hasUpdatedAt
        ? `SELECT "${pkCol}" as pk, "updated_at" FROM public."${tName}" WHERE "${pkCol}" > $1 ORDER BY "${pkCol}" ASC LIMIT 25000`
        : `SELECT "${pkCol}" as pk FROM public."${tName}" WHERE "${pkCol}" > $1 ORDER BY "${pkCol}" ASC LIMIT 25000`;
    } else {
      liveQuery = hasUpdatedAt
        ? `SELECT "${pkCol}" as pk, "updated_at" FROM public."${tName}" ORDER BY "${pkCol}" ASC LIMIT 25000`
        : `SELECT "${pkCol}" as pk FROM public."${tName}" ORDER BY "${pkCol}" ASC LIMIT 25000`;
    }

    const liveRes = await livePg.query(liveQuery, params);
    const rows = liveRes.rows;
    if (rows.length === 0) {
      hasMore = false;
      break;
    }

    liveTotalCount += rows.length;

    for (const r of rows) {
      const pkStr = String(r.pk);
      livePkSet.add(pkStr);

      if (!localMap.has(pkStr)) {
        missingInLocalIds.push(pkStr);
      } else if (hasUpdatedAt) {
        const localVal = localMap.get(pkStr);
        const liveVal = r.updated_at ? new Date(r.updated_at).toISOString() : null;
        if (localVal && liveVal && localVal !== liveVal) {
          if (localVal > liveVal) {
            conflictCount++;
            conflicts.push({ pk: pkStr, local: localVal, live: liveVal });
          } else {
            changedCount++;
          }
        }
      }
    }

    if (rows.length < 25000) {
      hasMore = false;
    } else {
      lastPk = rows[rows.length - 1].pk;
    }
  }

  // 3. Find local rows absent in live
  const absentInLiveIds = [];
  for (const localPk of localMap.keys()) {
    if (!livePkSet.has(localPk)) {
      absentInLiveIds.push(localPk);
    }
  }

  auditSummary.push({
    table: tName,
    group: tableConfig.group,
    type: tableConfig.type,
    localCount: localMap.size,
    liveCount: liveTotalCount,
    missingInLocalCount: missingInLocalIds.length,
    missingInLocalIds: missingInLocalIds.slice(0, 10), // sample
    allMissingInLocalIds: missingInLocalIds,
    changedCount,
    conflictCount,
    conflicts,
    absentInLiveCount: absentInLiveIds.length,
    absentInLiveIds: absentInLiveIds.slice(0, 10)
  });

  const statusParts = [];
  if (missingInLocalIds.length > 0) statusParts.push(`Missing in Local: ${missingInLocalIds.length}`);
  if (changedCount > 0) statusParts.push(`Changed: ${changedCount}`);
  if (conflictCount > 0) statusParts.push(`Conflicts: ${conflictCount}`);
  if (absentInLiveIds.length > 0) statusParts.push(`Absent in Live: ${absentInLiveIds.length}`);

  const statusStr = statusParts.length > 0 ? statusParts.join(' | ') : 'Fully Synchronized';
  console.log(`- [${tableConfig.group}] ${tName.padEnd(36)} | Live: ${String(liveTotalCount).padStart(6)} | Local: ${String(localMap.size).padStart(6)} | ${statusStr}`);
}

await livePg.end();
await localPg.end();

fs.writeFileSync('scripts/reconciliation_audit_result.json', JSON.stringify(auditSummary, null, 2));
console.log('\nAudit complete! Result saved to scripts/reconciliation_audit_result.json');
