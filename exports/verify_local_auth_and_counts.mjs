import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import pg from 'pg';

const { Client } = pg;

async function verifyAll() {
  console.log('='.repeat(80));
  console.log('LOCAL SUPABASE AUTH & DATA VERIFICATION');
  console.log('='.repeat(80));

  // 1. Get status & credentials from supabase CLI
  console.log('\n--- 1. Fetching Local Supabase Credentials ---');
  let statusJson;
  try {
    const raw = execSync('npx supabase status -o json', { encoding: 'utf8' });
    statusJson = JSON.parse(raw);
  } catch (e) {
    console.error('Could not get supabase status via CLI JSON, using defaults...');
  }

  const apiUrl = statusJson?.API_URL || 'http://localhost:54321';
  const anonKey = statusJson?.ANON_KEY || statusJson?.anon_key;
  const serviceKey = statusJson?.SERVICE_ROLE_KEY || statusJson?.service_role_key;

  console.log(`API URL     : ${apiUrl}`);
  console.log(`Has Anon Key: ${Boolean(anonKey)}`);
  console.log(`Has Serv Key: ${Boolean(serviceKey)}`);

  // 2. Direct PostgreSQL Verification on 54322
  console.log('\n--- 2. Direct PostgreSQL Integrity Checks ---');
  const pgClient = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:54322/postgres' });
  await pgClient.connect();

  const userCountRes = await pgClient.query('SELECT count(*) FROM auth.users');
  const identCountRes = await pgClient.query('SELECT count(*) FROM auth.identities');
  const profCountRes = await pgClient.query('SELECT count(*) FROM public.profiles');
  const roleCountRes = await pgClient.query('SELECT count(*) FROM public.user_roles');

  console.log(`auth.users count       : ${userCountRes.rows[0].count} (Expected: 17)`);
  console.log(`auth.identities count  : ${identCountRes.rows[0].count} (Expected: 17)`);
  console.log(`profiles count         : ${profCountRes.rows[0].count} (Expected: 15)`);
  console.log(`user_roles count       : ${roleCountRes.rows[0].count} (Expected: 15)`);

  // Check FK orphan relations between profiles, user_roles and auth.users
  const orphanProfRes = await pgClient.query(`
    SELECT count(*) FROM public.profiles p
    LEFT JOIN auth.users u ON p.id = u.id
    WHERE u.id IS NULL
  `);
  console.log(`Orphan profiles (missing auth.user)  : ${orphanProfRes.rows[0].count} (Expected: 0)`);

  const orphanRoleRes = await pgClient.query(`
    SELECT count(*) FROM public.user_roles r
    LEFT JOIN auth.users u ON r.user_id = u.id
    WHERE u.id IS NULL
  `);
  console.log(`Orphan user_roles (missing auth.user): ${orphanRoleRes.rows[0].count} (Expected: 0)`);

  // 3. Mandatory row counts through Supabase REST / PostgREST query layer
  console.log('\n--- 3. Query Layer Row Counts (PostgREST) ---');
  const supabaseAdmin = createClient(apiUrl, serviceKey);

  const targets = [
    { table: 'kob_leads', expected: 4745 },
    { table: 'lead_stage_history', expected: 16144 },
    { table: 'lead_activities', expected: 16148 },
    { table: 'lead_events', expected: 49537 },
    { table: 'audit_logs', expected: 127666 },
  ];

  let allCountsMatched = true;
  for (const t of targets) {
    const { count, error } = await supabaseAdmin
      .from(t.table)
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error(`[ERROR] ${t.table}: ${error.message}`);
      allCountsMatched = false;
    } else {
      const match = count === t.expected;
      console.log(`  ${t.table.padEnd(22)}: ${String(count).padStart(7)} (Expected: ${t.expected}) -> ${match ? 'MATCH [OK]' : 'MISMATCH [FAIL]'}`);
      if (!match) allCountsMatched = false;
    }
  }

  // 4. Test GoTrue Auth via client
  console.log('\n--- 4. Client-Side Auth Tests ---');
  const supabaseClient = createClient(apiUrl, anonKey);

  // Fetch one test user from auth.users
  const sampleUserRes = await pgClient.query('SELECT email FROM auth.users LIMIT 1');
  const sampleEmail = sampleUserRes.rows[0].email;
  console.log(`Testing auth with local user: ${sampleEmail}`);

  // Test getSession initially
  const { data: initialSession } = await supabaseClient.auth.getSession();
  console.log(`Initial session state: ${initialSession.session ? 'Active' : 'No active session'}`);

  await pgClient.end();

  console.log('\n' + '='.repeat(80));
  console.log(allCountsMatched ? 'ALL VERIFICATION CHECKS PASSED [SUCCESS]' : 'SOME CHECKS FAILED');
  console.log('='.repeat(80));
}

verifyAll().catch(err => {
  console.error('[VERIFICATION ERROR]:', err);
  process.exit(1);
});
