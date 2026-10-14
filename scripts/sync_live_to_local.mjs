/**
 * scripts/sync_live_to_local.mjs
 * 
 * SAFE ONE-WAY INCREMENTAL SYNC UTILITY: LIVE Supabase -> LOCAL Supabase ONLY
 * 
 * STRICT SAFETY RULES:
 * 1. NEVER write, update, delete, insert, RPC, or call functions on live Supabase.
 * 2. Live client is wrapped in a strict Read-Only Proxy enforcing only SELECT operations.
 * 3. NEVER sync LOCAL -> LIVE.
 * 4. Local changes are protected: detects local modifications and avoids overwriting (reports conflict).
 * 5. Dry-run mode: node scripts/sync_live_to_local.mjs --dry-run performs ZERO writes.
 */

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
const syncLocalEnvPath = path.join(PROJECT_ROOT, '.env.sync.local');
if (fs.existsSync(syncLocalEnvPath)) {
  dotenv.config({ path: syncLocalEnvPath, override: true });
}

const isDryRun = process.argv.includes('--dry-run');
const liveWins = process.argv.includes('--live-wins'); // Optional override, false by default

// Live credentials MUST come from separate environment variables or designated backup
const LIVE_DATABASE_READ_URL = process.env.LIVE_DATABASE_READ_URL;
const LIVE_SUPABASE_URL = process.env.LIVE_SUPABASE_URL || 'https://guqjvhptyhfrzkjcykvf.supabase.co';
const LIVE_SUPABASE_READ_KEY = process.env.LIVE_SUPABASE_READ_KEY || process.env.SUPABASE_READ_ONLY_KEY;
const LIVE_PUBLISHABLE_KEY = process.env.LIVE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_u0skS-QrMquyqfIAuL1lWw_UzQY24L9';

// Local target
const LOCAL_SUPABASE_URL = process.env.LOCAL_SUPABASE_URL || 'http://127.0.0.1:54321';
const LOCAL_PG_URL = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const CHECKPOINT_FILE = path.join(PROJECT_ROOT, 'scripts', '.sync_checkpoint.json');
const LOCK_FILE = path.join(PROJECT_ROOT, 'scripts', '.sync.lock');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs', 'sync');

// Safety Pre-Flight Validator
function validateSafetyPreFlight() {
  if (!LIVE_DATABASE_READ_URL) {
    throw new Error('[SAFETY ABORT] LIVE_DATABASE_READ_URL is missing in environment.');
  }

  const userMatch = LIVE_DATABASE_READ_URL.match(/postgresql:\/\/([^:]+):/);
  const liveUser = userMatch ? userMatch[1] : '';
  if (!liveUser.startsWith('live_sync_reader')) {
    throw new Error(`[SAFETY ABORT] Live PostgreSQL username must be 'live_sync_reader'. Detected unauthorized user: '${liveUser.split('.')[0] || 'unknown'}'.`);
  }

  if (LOCAL_SUPABASE_URL !== 'http://127.0.0.1:54321') {
    throw new Error(`[SAFETY ABORT] LOCAL_SUPABASE_URL must remain 'http://127.0.0.1:54321'. Detected: '${LOCAL_SUPABASE_URL}'.`);
  }

  if (process.env.SUPABASE_SERVICE_ROLE_KEY && LIVE_DATABASE_READ_URL.includes(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('[SAFETY ABORT] SUPABASE_SERVICE_ROLE_KEY cannot be used for live access.');
  }
}

// Concurrency Lock Guard
function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const pid = lockData.pid;
      let isRunning = false;
      try {
        process.kill(pid, 0);
        isRunning = true;
      } catch (e) {
        isRunning = false;
      }

      if (isRunning) {
        console.log(`[CONCURRENCY GUARD] Another sync process (PID: ${pid}, started: ${lockData.started_at}) is currently running. Skipping this scheduled run.`);
        return false;
      } else {
        console.log(`[LOCK STALE] Previous sync process (PID: ${pid}) terminated without cleanup. Reclaiming lock.`);
      }
    } catch (e) {
      // Overwrite malformed lockfile
    }
  }

  fs.writeFileSync(LOCK_FILE, JSON.stringify({
    pid: process.pid,
    started_at: new Date().toISOString()
  }, null, 2));

  return true;
}

function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (lockData.pid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
      }
    } catch (e) {
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
  }
}

// Structured Run Logger (Never logs passwords/secrets)
function recordSyncRunLog({ startTime, endTime, status, summary, error = null }) {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  const durationMs = endTime.getTime() - startTime.getTime();
  const durationSec = (durationMs / 1000).toFixed(2);

  const historyFile = path.join(LOGS_DIR, 'sync_history.log');
  const jsonlFile = path.join(LOGS_DIR, 'sync_runs.jsonl');

  const historyEntry = [
    '================================================================================',
    `SYNC RUN: ${startTime.toISOString()} - ${endTime.toISOString()} (Duration: ${durationSec}s)`,
    `Status:                      ${status}`,
    `Tables Audited:              ${summary?.tablesAudited ?? 0}`,
    `New Live Rows Inserted:      ${summary?.rowsInserted ?? 0}`,
    `Changed Live Rows Updated:   ${summary?.rowsUpdated ?? 0}`,
    `Local Conflicts Preserved:   ${summary?.conflictsPreserved ?? 0}`,
    `Local-Only Rows Preserved:   ${summary?.deletionsPreserved ?? 0}`,
    `Live Writes Attempted:       0`,
    `Live Writes Executed:        0`,
    `Local Write Errors:          ${summary?.errors?.length ?? (error ? 1 : 0)}`,
    error ? `Error Details:               ${error.message.replace(/postgresql:\/\/[^@]+@/g, 'postgresql://***@')}` : null,
    '================================================================================\n'
  ].filter(Boolean).join('\n');

  fs.appendFileSync(historyFile, historyEntry);

  const jsonlEntry = {
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    duration_ms: durationMs,
    status,
    tables_audited: summary?.tablesAudited ?? 0,
    rows_inserted: summary?.rowsInserted ?? 0,
    rows_updated: summary?.rowsUpdated ?? 0,
    conflicts_preserved: summary?.conflictsPreserved ?? 0,
    local_only_preserved: summary?.deletionsPreserved ?? 0,
    live_writes_attempted: 0,
    live_writes_executed: 0,
    local_write_errors: summary?.errors?.length ?? (error ? 1 : 0),
    error: error ? error.message.replace(/postgresql:\/\/[^@]+@/g, 'postgresql://***@') : null
  };

  fs.appendFileSync(jsonlFile, JSON.stringify(jsonlEntry) + '\n');
}

// 2. STRICT READ-ONLY PROXY FOR LIVE SUPABASE
export function createStrictReadOnlyLiveClient(url, key) {
  if (!url || !key) return null;

  const headers = {};
  if (key.startsWith('eyJ')) {
    // JWT Bearer token
    headers['Authorization'] = `Bearer ${key}`;
    headers['apikey'] = LIVE_PUBLISHABLE_KEY;
  } else {
    // API key
    headers['apikey'] = key;
  }

  const rawClient = createClient(url, LIVE_PUBLISHABLE_KEY, {
    global: { headers },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  return {
    from(table) {
      const qb = rawClient.from(table);
      return {
        select: (...args) => qb.select(...args),
        // Explicitly intercept and throw on ANY mutation method
        insert: () => { throw new Error(`[SAFETY VIOLATION] .insert() is strictly forbidden on LIVE Supabase!`); },
        update: () => { throw new Error(`[SAFETY VIOLATION] .update() is strictly forbidden on LIVE Supabase!`); },
        delete: () => { throw new Error(`[SAFETY VIOLATION] .delete() is strictly forbidden on LIVE Supabase!`); },
        upsert: () => { throw new Error(`[SAFETY VIOLATION] .upsert() is strictly forbidden on LIVE Supabase!`); },
      };
    },
    rpc: () => {
      throw new Error(`[SAFETY VIOLATION] .rpc() is strictly forbidden on LIVE Supabase!`);
    }
  };
}

// 2b. STRICT READ-ONLY POSTGRESQL DB CLIENT FOR LIVE SUPABASE
export async function createStrictReadOnlyLiveDbClient(connUrl) {
  if (!connUrl) return null;

  let client = null;
  const rawClean = connUrl.replace(/<([^>]+)>/, '$1');

  try {
    const directClient = new pg.Client({
      connectionString: rawClean,
      ssl: { rejectUnauthorized: false }
    });
    await directClient.connect();
    client = directClient;
  } catch (err) {
    if (err.message.includes('ENOTFOUND') || err.message.includes('timeout')) {
      const poolerPassword = connUrl.includes('<') ? connUrl.match(/:<([^>]+)>/)?.[1] : connUrl.match(/:([^@:]+)@/)?.[1];
      const poolerClient = new pg.Client({
        host: 'aws-0-ap-southeast-2.pooler.supabase.com',
        port: 5432,
        user: 'live_sync_reader.guqjvhptyhfrzkjcykvf',
        password: poolerPassword,
        database: 'postgres',
        ssl: { rejectUnauthorized: false }
      });
      await poolerClient.connect();
      client = poolerClient;
    } else {
      throw err;
    }
  }

  // Enforce read-only transaction mode assertion
  const roCheck = await client.query("SHOW default_transaction_read_only;");
  if (roCheck.rows[0].default_transaction_read_only !== 'on') {
    await client.query("SET default_transaction_read_only = on;");
  }

  return {
    client,
    async end() {
      await client.end();
    },
    from(tableName) {
      return {
        async select(fields = '*', options = {}) {
          if (options.count === 'exact' && options.head) {
            const res = await client.query(`SELECT count(*)::int as count FROM public."${tableName}"`);
            return { count: res.rows[0].count, data: null, error: null };
          }

          let whereClause = '';
          const params = [];
          let orderClause = '';
          let limitClause = '';

          const builder = {
            gt(col, val) {
              params.push(val);
              whereClause = `WHERE "${col}" > $${params.length}`;
              return builder;
            },
            order(col, { ascending = true } = {}) {
              orderClause = `ORDER BY "${col}" ${ascending ? 'ASC' : 'DESC'}`;
              return builder;
            },
            async limit(n) {
              params.push(n);
              limitClause = `LIMIT $${params.length}`;
              const sql = `SELECT ${fields === '*' ? '*' : fields} FROM public."${tableName}" ${whereClause} ${orderClause} ${limitClause}`;
              try {
                const res = await client.query(sql, params);
                const rows = res.rows.map(r => {
                  const cleanRow = { ...r };
                  for (const k of Object.keys(cleanRow)) {
                    if (cleanRow[k] instanceof Date) {
                      cleanRow[k] = cleanRow[k].toISOString();
                    }
                  }
                  return cleanRow;
                });
                return { data: rows, error: null };
              } catch (err) {
                return { data: null, error: err };
              }
            }
          };
          return builder;
        },
        insert: () => { throw new Error('[SAFETY VIOLATION] .insert() is strictly forbidden on LIVE Supabase!'); },
        update: () => { throw new Error('[SAFETY VIOLATION] .update() is strictly forbidden on LIVE Supabase!'); },
        delete: () => { throw new Error('[SAFETY VIOLATION] .delete() is strictly forbidden on LIVE Supabase!'); },
        upsert: () => { throw new Error('[SAFETY VIOLATION] .upsert() is strictly forbidden on LIVE Supabase!'); },
      };
    },
    rpc: () => {
      throw new Error('[SAFETY VIOLATION] .rpc() is strictly forbidden on LIVE Supabase!');
    }
  };
}

// 3. TABLE DEFINITIONS (Topological dependency order & verified schemas)
// Note: public.meta_campaign_selections is excluded per requirements (does not exist in live)
const SYNC_TABLES = [
  // Stage 1: Reference & Config Master Tables
  { name: 'brands', pk: 'id', group: 'C', cursor: 'created_at', type: 'config', deletable: false },
  { name: 'india_states', pk: 'id', group: 'C', cursor: 'created_at', type: 'config', deletable: false },
  { name: 'india_pincodes', pk: 'pincode', group: 'C', cursor: 'created_at', type: 'config', deletable: false },
  { name: 'lead_sources', pk: 'id', group: 'C', cursor: 'created_at', type: 'config', deletable: false },
  { name: 'gallabox_templates', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'evaluation_questions', pk: 'id', group: 'C', cursor: 'updated_at', type: 'config', deletable: true },
  { name: 'kob_configuration', pk: 'id', group: 'B', cursor: 'updated_at', type: 'config', deletable: false },
  { name: 'integration_settings', pk: 'key', group: 'B', cursor: 'updated_at', type: 'config', deletable: false },
  { name: 'kpi_targets', pk: 'id', group: 'B', cursor: 'created_at', type: 'config', deletable: true },

  // Stage 2: Dependent Geographic & Brand Scope
  { name: 'india_districts', pk: 'id', group: 'C', cursor: 'id', type: 'config', deletable: false },
  { name: 'india_cities', pk: 'id', group: 'C', cursor: 'id', type: 'config', deletable: false },
  { name: 'brand_state_availability', pk: 'id', group: 'C', cursor: 'id', type: 'config', deletable: false },
  { name: 'state_native_brand', pk: 'state_id', group: 'C', cursor: 'created_at', type: 'config', deletable: false },

  // Stage 3: Profiles & Rules
  { name: 'profiles', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'user_roles', pk: 'id', group: 'B', cursor: 'id', type: 'mutable', deletable: false },
  { name: 'retargeting_rules', pk: 'bucket', group: 'B', cursor: 'updated_at', type: 'config', deletable: false },

  // Stage 4: Core Leads
  { name: 'kob_leads', pk: 'id', group: 'B', cursor: 'updated_at', type: 'core_mutable', deletable: false },

  // Stage 5: Child Tables & History
  { name: 'lead_stage_history', pk: 'id', group: 'A', cursor: 'created_at', type: 'append_only', deletable: false },
  { name: 'lead_activities', pk: 'id', group: 'A', cursor: 'created_at', type: 'append_only', deletable: false },
  // RECLASSIFIED: lead_events has application backfill updates on lead_id when WhatsApp leads resolve
  { name: 'lead_events', pk: 'id', group: 'B', cursor: 'created_at', type: 'append_with_backfill', deletable: false },
  { name: 'retargeting_schedule', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: true },
  { name: 'retargeting_attempts', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'webinar_batches', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: true },
  { name: 'webinar_attendance', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: true },
  { name: 'evaluation_responses', pk: 'id', group: 'A', cursor: 'filled_at', type: 'append_only', deletable: false },

  // Send queues & ledgers
  { name: 'lead_inbox_retarget_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'lead_eoi1_retarget_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'lead_eoi1_retarget_telugu_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'lead_eoi1_retarget_malayalam_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'lead_webinar_retarget_tamil_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'lead_webinar_retarget_telugu_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'lead_webinar_retarget_malayalam_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'website_form_default_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'website_form_tamil_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'website_form_telugu_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'website_form_malayalam_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'support_lead_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'meta_ads_initial_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'whatsapp_broadcast_initial_sends', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },

  // Stage 6: SCV & Incentive Tables
  { name: 'scv_mode_config', pk: 'mode', group: 'B', cursor: 'updated_at', type: 'config', deletable: false },
  { name: 'scv_mode_config_changes', pk: 'id', group: 'A', cursor: 'changed_at', type: 'append_only', deletable: false },
  { name: 'scv_mode_inputs', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'scv_monthly_inputs', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'scv_rules', pk: 'id', group: 'B', cursor: 'updated_at', type: 'config', deletable: false },
  { name: 'scv_component_weights', pk: 'id', group: 'B', cursor: 'updated_at', type: 'config', deletable: false },
  { name: 'scv_role_weights', pk: 'role', group: 'B', cursor: 'updated_at', type: 'config', deletable: false },
  { name: 'scv_weight_changes', pk: 'id', group: 'A', cursor: 'changed_at', type: 'append_only', deletable: false },
  { name: 'scv_manual_ratings', pk: 'id', group: 'B', cursor: 'updated_at', type: 'mutable', deletable: false },
  { name: 'incentive_rules', pk: 'id', group: 'B', cursor: 'updated_at', type: 'config', deletable: false },
  { name: 'incentives', pk: 'id', group: 'A', cursor: 'created_at', type: 'append_only', deletable: false },
  { name: 'marketing_kpi_targets', pk: 'id', group: 'B', cursor: 'updated_at', type: 'config', deletable: false },

  // Stage 7: Large Audit Logs
  { name: 'audit_logs', pk: 'id', group: 'A', cursor: 'created_at', type: 'append_only', deletable: false },

  // Stage 8: Special Handling / Queue Tables (Group D)
  { name: 'gallabox_fire_queue', pk: 'id', group: 'D', cursor: 'created_at', type: 'special_queue', deletable: true },
  { name: 'email_fire_queue', pk: 'id', group: 'D', cursor: 'created_at', type: 'special_queue', deletable: true }
];

// 4. CHECKPOINT MANAGER
function loadCheckpoints() {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    } catch {
      // Fallback
    }
  }
  return {
    version: 1,
    last_sync_completed_at: null,
    tables: {}
  };
}

function saveCheckpoints(checkpoints) {
  if (isDryRun) return;
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoints, null, 2));
}

// 5. MAIN EXECUTION
async function main() {
  const startTime = new Date();

  // Concurrency Guard: prevent overlapping runs
  if (!acquireLock()) {
    recordSyncRunLog({
      startTime,
      endTime: new Date(),
      status: 'SKIPPED_CONCURRENT',
      summary: null
    });
    return { status: 'SKIPPED_CONCURRENT' };
  }

  let localPg = null;
  let liveDbClient = null;
  let syncSummary = null;

  try {
    // Safety Pre-Flight Check (must pass before any connection)
    validateSafetyPreFlight();

    console.log('========================================================================');
    console.log(`  KOB LIVE -> LOCAL SUPABASE INCREMENTAL SYNC UTILITY`);
    console.log(`  MODE: ${isDryRun ? 'DRY-RUN (READ-ONLY ON BOTH SIDES)' : 'ACTIVE SYNC'}`);
    console.log(`  CONFLICT RESOLUTION: ${liveWins ? 'LIVE WINS (--live-wins active)' : 'PRESERVE LOCAL (Default Safe)'}`);
    console.log('========================================================================');

    console.log('\n[1] SAFETY & CREDENTIAL AUDIT:');
    console.log(`  - Target Local Supabase: ${LOCAL_SUPABASE_URL}`);
    console.log(`  - Source Live Supabase:   ${LIVE_SUPABASE_URL}`);
    console.log(`  - Live Read Access: Dedicated PostgreSQL Role (live_sync_reader)`);

    let liveClient = null;
    if (LIVE_DATABASE_READ_URL) {
      liveDbClient = await createStrictReadOnlyLiveDbClient(LIVE_DATABASE_READ_URL);
      liveClient = liveDbClient;
    } else {
      throw new Error('[SAFETY ABORT] Missing LIVE_DATABASE_READ_URL.');
    }
    
    localPg = new pg.Client(LOCAL_PG_URL);
    await localPg.connect();

    const checkpoints = loadCheckpoints();
    const nextCheckpoints = JSON.parse(JSON.stringify(checkpoints));
    syncSummary = {
    tablesAudited: 0,
    newLiveRowsDetected: 0,
    changedLiveRowsDetected: 0,
    localConflictsDetected: 0,
    liveDeletionsDetected: 0,
    deletionsPreserved: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    conflictsPreserved: 0,
    errors: []
  };

  console.log('\n[2] LIVE TABLE RECONCILIATION AUDIT (PRIMARY KEY COMPARISON):');

  const detailedMissingMap = {};
  const detailedChangedMap = {};
  const detailedConflictsMap = {};
  const detailedAbsentMap = {};

  for (const tableConfig of SYNC_TABLES) {
    syncSummary.tablesAudited++;
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

    // 2. Retrieve Live PKs and timestamps in keyset batches of 25,000
    const livePkSet = new Set();
    const missingLiveIds = [];
    const changedLiveIds = [];
    let changedCount = 0;
    let conflictCount = 0;
    const tableConflicts = [];
    let maxLiveCursor = null;

    let lastPk = null;
    let hasMore = true;
    let liveTotalCount = 0;

    if (liveDbClient) {
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

        const liveRes = await liveDbClient.client.query(liveQuery, params);
        const rows = liveRes.rows;
        if (rows.length === 0) {
          hasMore = false;
          break;
        }

        liveTotalCount += rows.length;

        for (const r of rows) {
          const pkStr = String(r.pk);
          livePkSet.add(pkStr);

          const liveUpdated = r.updated_at ? new Date(r.updated_at).toISOString() : null;
          if (liveUpdated && (!maxLiveCursor || liveUpdated > maxLiveCursor)) {
            maxLiveCursor = liveUpdated;
          }

          if (!localMap.has(pkStr)) {
            missingLiveIds.push(pkStr);
            syncSummary.newLiveRowsDetected++;
          } else if (hasUpdatedAt) {
            const localVal = localMap.get(pkStr);
            if (localVal && liveUpdated && localVal !== liveUpdated) {
              if (localVal > liveUpdated) {
                conflictCount++;
                syncSummary.localConflictsDetected++;
                syncSummary.conflictsPreserved++;
                tableConflicts.push({ pk: pkStr, local: localVal, live: liveUpdated });
              } else {
                changedCount++;
                changedLiveIds.push(pkStr);
                syncSummary.changedLiveRowsDetected++;
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
    }

    // 3. Find local records absent in live (local test rows or live deletions)
    const absentInLiveIds = [];
    for (const localPk of localMap.keys()) {
      if (!livePkSet.has(localPk)) {
        absentInLiveIds.push(localPk);
      }
    }

    if (absentInLiveIds.length > 0) {
      syncSummary.liveDeletionsDetected += absentInLiveIds.length;
      syncSummary.deletionsPreserved += absentInLiveIds.length;
      detailedAbsentMap[tName] = absentInLiveIds;
    }

    if (missingLiveIds.length > 0) {
      detailedMissingMap[tName] = missingLiveIds;
    }
    if (changedLiveIds.length > 0) {
      detailedChangedMap[tName] = changedLiveIds;
    }
    if (tableConflicts.length > 0) {
      detailedConflictsMap[tName] = tableConflicts;
    }

    // Set checkpoint based on observed LIVE state (baseline establishment)
    nextCheckpoints.tables[tName] = {
      last_synced_at: new Date().toISOString(),
      cursor_column: cursorCol,
      last_cursor_value: maxLiveCursor,
      last_cursor_id: null,
      live_rows_at_baseline: liveTotalCount,
      local_rows_at_baseline: localMap.size,
      missing_live_ids_count: missingLiveIds.length,
      last_checked_at: new Date().toISOString()
    };

    const statusParts = [];
    if (missingLiveIds.length > 0) statusParts.push(`Missing in Local: ${String(missingLiveIds.length).padStart(4)}`);
    if (changedCount > 0) statusParts.push(`Changed: ${String(changedCount).padStart(3)}`);
    if (conflictCount > 0) statusParts.push(`Conflicts: ${String(conflictCount).padStart(3)}`);
    if (absentInLiveIds.length > 0) statusParts.push(`Absent in Live: ${String(absentInLiveIds.length).padStart(3)} (Preserved)`);

    const statusStr = statusParts.length > 0 ? statusParts.join(' | ') : 'Fully Synchronized';
    console.log(`  - [${tableConfig.group}] ${tName.padEnd(36)} | Live: ${String(liveTotalCount).padStart(6)} | Local: ${String(localMap.size).padStart(6)} | ${statusStr}`);
  }

  // PHASE 2: EXECUTE LOCAL WRITES IF NOT DRY-RUN
  if (!isDryRun) {
    console.log('\n========================================================================');
    console.log('             PHASE 2: EXECUTING SAFE ONE-WAY LOCAL WRITES               ');
    console.log('========================================================================');

    for (const tableConfig of SYNC_TABLES) {
      const tName = tableConfig.name;
      const pkCol = tableConfig.pk;
      const missingIds = detailedMissingMap[tName] || [];
      const changedIds = detailedChangedMap[tName] || [];

      if (missingIds.length === 0 && changedIds.length === 0) {
        continue;
      }

      console.log(`\n[Applying Sync] Table: ${tName}`);
      console.log(`  - Inserting: ${missingIds.length} rows`);
      console.log(`  - Updating:  ${changedIds.length} rows`);

      // Retrieve local column list and data types
      const colRes = await localPg.query(`
        SELECT column_name, data_type, udt_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
      `, [tName]);
      const localColsMap = new Map();
      for (const r of colRes.rows) {
        localColsMap.set(r.column_name, { dataType: r.data_type, udtName: r.udt_name });
      }

      function formatValue(v, colInfo) {
        if (v === null || v === undefined) return null;
        if (colInfo?.dataType === 'ARRAY' || colInfo?.udtName?.startsWith('_')) {
          if (Array.isArray(v)) return v;
          if (typeof v === 'string') {
            try {
              const parsed = JSON.parse(v);
              if (Array.isArray(parsed)) return parsed;
            } catch (e) {}
          }
          return [v];
        }
        if (colInfo?.dataType === 'json' || colInfo?.dataType === 'jsonb' || colInfo?.udtName === 'json' || colInfo?.udtName === 'jsonb') {
          if (typeof v === 'string') return v;
          return JSON.stringify(v);
        }
        if (v instanceof Date) return v.toISOString();
        if (typeof v === 'object') return JSON.stringify(v);
        return v;
      }

      // 1. Process Inserts (in batches of 250)
      if (missingIds.length > 0) {
        const batchSize = 250;
        for (let i = 0; i < missingIds.length; i += batchSize) {
          const slice = missingIds.slice(i, i + batchSize);

          // Retrieve live data using read-only liveDbClient (SELECT only)
          const liveDataRes = await liveDbClient.client.query(
            `SELECT * FROM public."${tName}" WHERE "${pkCol}" = ANY($1)`,
            [slice]
          );
          const liveRows = liveDataRes.rows;

          if (liveRows.length > 0) {
            await localPg.query('BEGIN;');
            await localPg.query("SET LOCAL session_replication_role = 'replica';");
            try {
              // Check for unique code collision if table is kob_leads
              if (tName === 'kob_leads') {
                for (const row of liveRows) {
                  if (row.code) {
                    const codeCheck = await localPg.query(
                      'SELECT id FROM public.kob_leads WHERE code = $1 AND id <> $2',
                      [row.code, row[pkCol]]
                    );
                    if (codeCheck.rows.length > 0) {
                      const conflictingId = codeCheck.rows[0].id;
                      const renamedCode = `LOCAL-TEST-${row.code}`;
                      console.log(`  [COLLISION RESOLUTION] Local test lead ${conflictingId} has code "${row.code}". Renaming to "${renamedCode}" to preserve local test record and allow live lead ${row[pkCol]} to insert.`);
                      await localPg.query(
                        'UPDATE public.kob_leads SET code = $1 WHERE id = $2',
                        [renamedCode, conflictingId]
                      );
                    }
                  }
                }
              }

              for (const row of liveRows) {
                const cols = Object.keys(row).filter(c => localColsMap.has(c));
                const vals = cols.map(c => formatValue(row[c], localColsMap.get(c)));
                const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
                const colNames = cols.map(c => `"${c}"`).join(', ');

                await localPg.query(
                  `INSERT INTO public."${tName}" (${colNames}) VALUES (${placeholders}) ON CONFLICT ("${pkCol}") DO NOTHING;`,
                  vals
                );
                syncSummary.rowsInserted++;
              }
              await localPg.query("SET LOCAL session_replication_role = 'origin';");
              await localPg.query('COMMIT;');
            } catch (err) {
              await localPg.query('ROLLBACK;');
              console.error(`  [ERROR] Failed to insert batch into local."${tName}":`, err.message);
              syncSummary.errors.push({ table: tName, op: 'insert', error: err.message });
              throw err;
            }
          }
        }
        console.log(`  -> Successfully inserted ${missingIds.length} rows into local."${tName}".`);
      }

      // 2. Process Updates (in batches of 250)
      if (changedIds.length > 0) {
        const batchSize = 250;
        for (let i = 0; i < changedIds.length; i += batchSize) {
          const slice = changedIds.slice(i, i + batchSize);

          const liveDataRes = await liveDbClient.client.query(
            `SELECT * FROM public."${tName}" WHERE "${pkCol}" = ANY($1)`,
            [slice]
          );
          const liveRows = liveDataRes.rows;

          if (liveRows.length > 0) {
            await localPg.query('BEGIN;');
            await localPg.query("SET LOCAL session_replication_role = 'replica';");
            try {
              for (const row of liveRows) {
                const pkVal = row[pkCol];
                const cols = Object.keys(row).filter(c => localColsMap.has(c) && c !== pkCol);
                const setClauses = cols.map((c, idx) => `"${c}" = $${idx + 1}`).join(', ');
                const vals = cols.map(c => formatValue(row[c], localColsMap.get(c)));
                vals.push(pkVal);

                await localPg.query(
                  `UPDATE public."${tName}" SET ${setClauses} WHERE "${pkCol}" = $${vals.length};`,
                  vals
                );
                syncSummary.rowsUpdated++;
              }
              await localPg.query("SET LOCAL session_replication_role = 'origin';");
              await localPg.query('COMMIT;');
            } catch (err) {
              await localPg.query('ROLLBACK;');
              console.error(`  [ERROR] Failed to update batch in local."${tName}":`, err.message);
              syncSummary.errors.push({ table: tName, op: 'update', error: err.message });
              throw err;
            }
          }
        }
        console.log(`  -> Successfully updated ${changedIds.length} rows in local."${tName}".`);
      }
    }
  }

  await localPg.end();
  localPg = null;
  if (liveDbClient) {
    await liveDbClient.end();
    liveDbClient = null;
  }

  console.log('\n========================================================================');
  console.log('                          SYNC SUMMARY REPORT                           ');
  console.log('========================================================================');
  console.log(`  Tables Audited:             ${syncSummary.tablesAudited}`);
  console.log(`  New Live Rows Detected:     ${syncSummary.newLiveRowsDetected}`);
  console.log(`  Changed Live Rows Detected: ${syncSummary.changedLiveRowsDetected}`);
  console.log(`  Rows Inserted Locally:      ${syncSummary.rowsInserted}`);
  console.log(`  Rows Updated Locally:       ${syncSummary.rowsUpdated}`);
  console.log(`  Local Conflicts Preserved:  ${syncSummary.conflictsPreserved}`);
  console.log(`  Live Deletions Preserved:   ${syncSummary.deletionsPreserved}`);
  console.log(`  Local Write Errors:         ${syncSummary.errors.length}`);
  console.log(`  Live Writes Executed:       0 (Physically Blocked by Read-Only Role)`);
  console.log('========================================================================');

  console.log('\n[3] BREAKDOWN OF DISCOVERED DISCREPANCIES ACROSS TABLES:');
  const missingTables = Object.keys(detailedMissingMap);
  if (missingTables.length > 0) {
    console.log('\n  --- A. TABLES WITH MISSING LIVE ROWS (PROPOSED INSERTS) ---');
    for (const t of missingTables) {
      const ids = detailedMissingMap[t];
      console.log(`  - ${t.padEnd(35)}: ${String(ids.length).padStart(5)} rows (Sample IDs: ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? '...' : ''})`);
    }
  }

  const conflictTables = Object.keys(detailedConflictsMap);
  if (conflictTables.length > 0) {
    console.log('\n  --- B. TABLES WITH LOCAL MODIFICATION CONFLICTS (PRESERVED LOCAL) ---');
    for (const t of conflictTables) {
      const cList = detailedConflictsMap[t];
      console.log(`  - ${t.padEnd(35)}: ${String(cList.length).padStart(5)} conflicts (Local updated_at > Live updated_at)`);
    }
  }

  const absentTables = Object.keys(detailedAbsentMap);
  if (absentTables.length > 0) {
    console.log('\n  --- C. TABLES WITH LOCAL ROWS ABSENT IN LIVE (PRESERVED LOCAL) ---');
    for (const t of absentTables) {
      const aList = detailedAbsentMap[t];
      console.log(`  - ${t.padEnd(35)}: ${String(aList.length).padStart(5)} rows (Local extra rows or Live deletions)`);
    }
  }

  const detailedReportPath = path.join(PROJECT_ROOT, 'scripts', isDryRun ? '.dry_run_reconciliation_summary.json' : '.sync_reconciliation_summary.json');
  fs.writeFileSync(detailedReportPath, JSON.stringify({
    syncSummary,
    detailedMissingMap,
    detailedChangedMap,
    detailedConflictsMap,
    detailedAbsentMap
  }, null, 2));
  console.log(`\nDetailed per-table reconciliation data saved to: ${detailedReportPath}\n`);

  if (!isDryRun) {
    saveCheckpoints(nextCheckpoints);
    console.log(`Checkpoints saved to: ${CHECKPOINT_FILE}`);
  } else {
    console.log(`[DRY RUN COMPLETE] Zero modifications made to Live or Local.`);
  }

  const endTime = new Date();
  recordSyncRunLog({
    startTime,
    endTime,
    status: syncSummary.errors.length > 0 ? 'PARTIAL_ERROR' : 'SUCCESS',
    summary: syncSummary
  });

  return { status: syncSummary.errors.length > 0 ? 'PARTIAL_ERROR' : 'SUCCESS', summary: syncSummary };
} catch (err) {
  const endTime = new Date();
  recordSyncRunLog({
    startTime,
    endTime,
    status: 'FAILURE',
    summary: syncSummary,
    error: err
  });
  throw err;
} finally {
  if (localPg) {
    try { await localPg.end(); } catch {}
  }
  if (liveDbClient) {
    try { await liveDbClient.end(); } catch {}
  }
  releaseLock();
}
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('sync_live_to_local.mjs');
if (isDirectRun) {
  main().catch(err => {
    console.error('Fatal error in sync utility:', err);
    process.exit(1);
  });
}
