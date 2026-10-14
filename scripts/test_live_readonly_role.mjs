import fs from 'fs';
import pg from 'pg';

// 1. Read .env.sync.local
const envContent = fs.readFileSync('.env.sync.local', 'utf8');
const match = envContent.match(/LIVE_DATABASE_READ_URL\s*=\s*["']?([^"'\r\n]+)["']?/);
if (!match) {
  console.error('LIVE_DATABASE_READ_URL not found in .env.sync.local');
  process.exit(1);
}

const rawUrl = match[1].trim();
console.log('========================================================================');
console.log('              LIVE READ-ONLY ROLE VERIFICATION TEST                    ');
console.log('========================================================================');
console.log('Source config in .env.sync.local:');
console.log(`  ${rawUrl}\n`);

// 2. Test Direct Connection URL from .env.sync.local
console.log('[Phase 1] Testing exact LIVE_DATABASE_READ_URL from .env.sync.local...');
let directConnectPass = false;
let directConnectError = null;

const directClient = new pg.Client({
  connectionString: rawUrl.replace(/<([^>]+)>/, '$1'), // also handling stripped angle brackets if present
  ssl: { rejectUnauthorized: false }
});

try {
  await directClient.connect();
  directConnectPass = true;
  console.log('  Direct connection: SUCCESS');
} catch (err) {
  directConnectError = err.message;
  console.log(`  Direct connection result: FAILED (${err.message})`);
  console.log('  -> Root Cause: Supabase direct DB host (db.guqjvhptyhfrzkjcykvf.supabase.co) is IPv6-only.');
  console.log('                 The local network environment has no IPv6 route to AWS.');
} finally {
  try { await directClient.end(); } catch {}
}

// 3. Test via Supabase Connection Pooler (IPv4 route for ap-southeast-2)
console.log('\n[Phase 2] Connecting to Live Supabase via IPv4 Connection Pooler...');
const poolerHost = 'aws-0-ap-southeast-2.pooler.supabase.com';
const poolerPort = 5432;
const poolerUser = 'live_sync_reader.guqjvhptyhfrzkjcykvf';
const poolerPassword = rawUrl.includes('<') ? rawUrl.match(/:<([^>]+)>/)?.[1] : rawUrl.match(/:([^@:]+)@/)?.[1];

const poolerClient = new pg.Client({
  host: poolerHost,
  port: poolerPort,
  user: poolerUser,
  password: poolerPassword,
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

let poolerConnected = false;
try {
  await poolerClient.connect();
  poolerConnected = true;
  console.log('  connection successful: YES');
} catch (err) {
  console.error(`  connection successful: NO (${err.message})`);
  process.exit(1);
}

try {
  // Test 1: SELECT count
  console.log('\n[Phase 3] Testing SELECT query on public.kob_leads...');
  let selectSuccessful = false;
  let countResult = null;
  try {
    const res = await poolerClient.query('SELECT COUNT(*) FROM public.kob_leads;');
    selectSuccessful = true;
    countResult = res.rows[0].count;
    console.log('  SELECT successful: YES');
    console.log(`  kob_leads count:   ${countResult}`);
  } catch (err) {
    console.error(`  SELECT successful: NO (${err.message})`);
  }

  // Check RLS context
  const rlsCheck = await poolerClient.query(
    "SELECT current_user, session_user, current_setting('default_transaction_read_only') as read_only;"
  );
  console.log(`  Active role:       ${rlsCheck.rows[0].current_user}`);
  console.log(`  Transaction mode:  default_transaction_read_only = ${rlsCheck.rows[0].read_only}`);

  // Test 2: Attempt safe INSERT
  console.log('\n[Phase 4] Testing INSERT refusal (Safe probe: non-existent dummy UUID)...');
  let insertBlocked = false;
  let insertError = null;
  try {
    await poolerClient.query(`
      INSERT INTO public.kob_leads (id, code, full_name, phone) 
      VALUES ('00000000-0000-0000-0000-000000000000', 'PROBE-TEST', 'Probe', '9999999999');
    `);
    console.error('CRITICAL SAFETY FAILURE: INSERT SUCCEEDED!');
    process.exit(2);
  } catch (err) {
    insertBlocked = true;
    insertError = err.message;
    console.log('  INSERT blocked: YES');
    console.log(`  -> Rejected by engine: "${insertError}"`);
  }

  // Test 3: Attempt safe UPDATE
  console.log('\n[Phase 5] Testing UPDATE refusal (Safe probe: non-existent dummy UUID)...');
  let updateBlocked = false;
  let updateError = null;
  try {
    await poolerClient.query(`
      UPDATE public.kob_leads 
      SET full_name = 'PROBE-TEST-UPDATE' 
      WHERE id = '00000000-0000-0000-0000-000000000000';
    `);
    console.error('CRITICAL SAFETY FAILURE: UPDATE SUCCEEDED!');
    process.exit(2);
  } catch (err) {
    updateBlocked = true;
    updateError = err.message;
    console.log('  UPDATE blocked: YES');
    console.log(`  -> Rejected by engine: "${updateError}"`);
  }

  // Test 4: Attempt safe DELETE
  console.log('\n[Phase 6] Testing DELETE refusal (Safe probe: non-existent dummy UUID)...');
  let deleteBlocked = false;
  let deleteError = null;
  try {
    await poolerClient.query(`
      DELETE FROM public.kob_leads 
      WHERE id = '00000000-0000-0000-0000-000000000000';
    `);
    console.error('CRITICAL SAFETY FAILURE: DELETE SUCCEEDED!');
    process.exit(2);
  } catch (err) {
    deleteBlocked = true;
    deleteError = err.message;
    console.log('  DELETE blocked: YES');
    console.log(`  -> Rejected by engine: "${deleteError}"`);
  }

  // Check privileges
  const privRes = await poolerClient.query(`
    SELECT privilege_type, count(*)::int as table_count
    FROM information_schema.table_privileges
    WHERE grantee = 'live_sync_reader' AND table_schema = 'public'
    GROUP BY privilege_type;
  `);
  console.log('\n[Phase 7] Inspecting table privileges for live_sync_reader:');
  console.log(privRes.rows);

  const roleAttrs = await poolerClient.query("SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'live_sync_reader';");
  console.log('Role attributes:', roleAttrs.rows[0]);

  console.log('\n========================================================================');
  console.log('                       ROLE AUDIT SUMMARY                               ');
  console.log('========================================================================');
  console.log(`  connection successful: ${poolerConnected ? 'YES' : 'NO'}`);
  console.log(`  SELECT successful:     ${selectSuccessful ? 'YES' : 'NO'}`);
  console.log(`  kob_leads count:       ${countResult}`);
  console.log(`  default_transaction_read_only = ${rlsCheck.rows[0].read_only}`);
  console.log(`  BYPASSRLS enabled:     ${roleAttrs.rows[0].rolbypassrls ? 'YES' : 'NO'}`);
  console.log(`  INSERT blocked:        ${insertBlocked ? 'YES' : 'NO'}`);
  console.log(`  UPDATE blocked:        ${updateBlocked ? 'YES' : 'NO'}`);
  console.log(`  DELETE blocked:        ${deleteBlocked ? 'YES' : 'NO'}`);
  console.log('========================================================================');

} finally {
  await poolerClient.end();
}
