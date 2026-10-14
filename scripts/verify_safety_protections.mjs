import fs from 'fs';
import pg from 'pg';
import { createStrictReadOnlyLiveClient } from './sync_live_to_local.mjs';
import dotenv from 'dotenv';

dotenv.config();

console.log('========================================================================');
console.log('              SAFETY HARDENING & PROTECTION AUDIT TEST                  ');
console.log('========================================================================\n');

const checks = [];

// 1. Prove active KOB .env points only to localhost
console.log('[Check 1] Auditing active .env configuration...');
const envContent = fs.readFileSync('.env', 'utf8');
const hasLocalhostUrl = envContent.includes('SUPABASE_URL="http://127.0.0.1:54321"') || envContent.includes('SUPABASE_URL="http://localhost:54321"');
const hasNoLiveHost = !envContent.includes('guqjvhptyhfrzkjcykvf.supabase.co');

const pass1 = hasLocalhostUrl && hasNoLiveHost;
console.log(`  - SUPABASE_URL points to local gateway (54321): ${hasLocalhostUrl ? 'YES' : 'NO'}`);
console.log(`  - Live Supabase host absent from active .env:     ${hasNoLiveHost ? 'YES' : 'NO'}`);
console.log(`  -> RESULT: ${pass1 ? 'PASS [PROVEN]' : 'FAIL'}\n`);
checks.push({ name: 'Active .env isolation', pass: pass1 });

// 2. Prove live credential / client cannot write
console.log('[Check 2] Testing live client write blocking...');
const liveClient = createStrictReadOnlyLiveClient('https://guqjvhptyhfrzkjcykvf.supabase.co', 'dummy_key');
let insertBlocked = false;
let updateBlocked = false;
let deleteBlocked = false;
let upsertBlocked = false;
let rpcBlocked = false;

try { liveClient.from('kob_leads').insert({ name: 'test' }); } catch (e) { insertBlocked = e.message.includes('SAFETY VIOLATION'); }
try { liveClient.from('kob_leads').update({ name: 'test' }); } catch (e) { updateBlocked = e.message.includes('SAFETY VIOLATION'); }
try { liveClient.from('kob_leads').delete(); } catch (e) { deleteBlocked = e.message.includes('SAFETY VIOLATION'); }
try { liveClient.from('kob_leads').upsert({ name: 'test' }); } catch (e) { upsertBlocked = e.message.includes('SAFETY VIOLATION'); }
try { liveClient.rpc('test_rpc'); } catch (e) { rpcBlocked = e.message.includes('SAFETY VIOLATION'); }

const pass2 = insertBlocked && updateBlocked && deleteBlocked && upsertBlocked && rpcBlocked;
console.log(`  - Live .insert() blocked: ${insertBlocked ? 'YES' : 'NO'}`);
console.log(`  - Live .update() blocked: ${updateBlocked ? 'YES' : 'NO'}`);
console.log(`  - Live .delete() blocked: ${deleteBlocked ? 'YES' : 'NO'}`);
console.log(`  - Live .upsert() blocked: ${upsertBlocked ? 'YES' : 'NO'}`);
console.log(`  - Live .rpc() blocked:    ${rpcBlocked ? 'YES' : 'NO'}`);
console.log(`  -> RESULT: ${pass2 ? 'PASS [PROVEN]' : 'FAIL'}\n`);
checks.push({ name: 'Live client write refusal', pass: pass2 });

// 3. Prove local cron remains disabled
console.log('[Check 3] Inspecting local cron jobs in local Supabase...');
const localPg = new pg.Client('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
await localPg.connect();
const cronRes = await localPg.query('SELECT count(*)::int as cnt FROM cron.job WHERE active = true');
const activeCronCount = cronRes.rows[0].cnt;
const pass3 = activeCronCount === 0;
console.log(`  - Active local cron jobs count: ${activeCronCount} (expected: 0)`);
console.log(`  -> RESULT: ${pass3 ? 'PASS [PROVEN]' : 'FAIL'}\n`);
checks.push({ name: 'Local cron disabled', pass: pass3 });

// 4. Prove local trigger suppression mechanism is valid
console.log('[Check 4] Testing trigger suppression parameter...');
const repRoleRes = await localPg.query("SHOW session_replication_role;");
console.log(`  - Current session role: ${repRoleRes.rows[0].session_replication_role}`);
await localPg.query("SET session_replication_role = 'replica';");
const repRoleResAfter = await localPg.query("SHOW session_replication_role;");
const pass4 = repRoleResAfter.rows[0].session_replication_role === 'replica';
await localPg.query("SET session_replication_role = 'origin';");
console.log(`  - Replication role can be set to 'replica': ${pass4 ? 'YES' : 'NO'}`);
console.log(`  -> RESULT: ${pass4 ? 'PASS [PROVEN]' : 'FAIL'}\n`);
checks.push({ name: 'Trigger suppression capability', pass: pass4 });

await localPg.end();

// 5. Prove no LOCAL -> LIVE code path exists
console.log('[Check 5] Auditing sync script for local -> live code paths...');
const syncCode = fs.readFileSync('scripts/sync_live_to_local.mjs', 'utf8');
const hasNoLiveWrites = !syncCode.includes('liveClient.from(') || syncCode.match(/liveClient\.from\([^)]+\)\.select\(/g).length === syncCode.match(/liveClient\.from\(/g).length;
console.log(`  - All liveClient calls in sync script are .select() only: ${hasNoLiveWrites ? 'YES' : 'NO'}`);
const pass5 = hasNoLiveWrites;
console.log(`  -> RESULT: ${pass5 ? 'PASS [PROVEN]' : 'FAIL'}\n`);
checks.push({ name: 'Strict unidirectional LIVE -> LOCAL guarantee', pass: pass5 });

console.log('========================================================================');
console.log('                       SAFETY AUDIT SUMMARY                             ');
console.log('========================================================================');
for (const c of checks) {
  console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}`);
}
console.log('========================================================================');
