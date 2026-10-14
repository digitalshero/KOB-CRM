import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

// Ensure global WebSocket is available for node environment when testing supabase realtime
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('--- PHASE 6 READ-ONLY APPLICATION & QUERY LAYER VERIFICATION ---');
console.log('Supabase URL:', SUPABASE_URL);
console.log('Anon Key Present:', !!SUPABASE_ANON_KEY);
console.log('Service Role Key Present:', !!SUPABASE_SERVICE_ROLE_KEY);

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runTests() {
  const results = {};

  // 1. Required Table Counts
  console.log('\n[1] Checking exact required database counts via Supabase client...');
  const tables = [
    { name: 'kob_leads', target: 4745 },
    { name: 'lead_stage_history', target: 16144 },
    { name: 'lead_activities', target: 16148 },
    { name: 'lead_events', target: 49537 },
    { name: 'audit_logs', target: 127666 }
  ];

  results.counts = {};
  for (const t of tables) {
    const { count, error } = await client
      .from(t.name)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.error(`Error querying ${t.name}:`, error.message);
      results.counts[t.name] = { count: null, target: t.target, pass: false, error: error.message };
    } else {
      const pass = count === t.target;
      console.log(`- ${t.name}: count = ${count} (target: ${t.target}) -> ${pass ? 'PASS' : 'FAIL'}`);
      results.counts[t.name] = { count, target: t.target, pass };
    }
  }

  // 2. Auth Verification (Login, getSession, getClaims)
  console.log('\n[2] Checking Auth (signInWithPassword, getSession, getClaims)...');
  const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
    email: 'ceo@shero.test',
    password: 'Test@12345'
  });
  if (authError || !authData?.session) {
    console.error('Auth Login Failed:', authError);
    results.auth = { pass: false, error: authError };
  } else {
    const token = authData.session.access_token;
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    const pass = !claimsError && claimsData?.claims?.sub === authData.user.id;
    console.log(`- User: ${authData.user.email} (UUID: ${authData.user.id})`);
    console.log(`- Session access token received: yes`);
    console.log(`- getClaims valid: ${pass ? 'PASS' : 'FAIL'}`);
    results.auth = { pass, userId: authData.user.id, role: claimsData?.claims?.role };
  }

  // Authenticated user client (RLS testing)
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${authData?.session?.access_token}`
      }
    },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // 3. User Role RPC check
  console.log('\n[3] Checking RPC get_user_role...');
  const { data: userRole, error: roleError } = await userClient.rpc('get_user_role', {
    _user_id: authData?.user?.id
  });
  console.log(`- RPC get_user_role result: ${userRole} (error: ${roleError?.message || 'none'})`);
  results.rpcRole = { role: userRole, pass: !roleError && !!userRole };

  // 4. Dashboard KPIs & Funnels
  console.log('\n[4] Checking Dashboard Queries & Aggregations...');
  // Leads by mode (auto vs manual)
  const { data: modeCounts, error: modeError } = await client
    .from('kob_leads')
    .select('mode')
    .limit(10);
  console.log(`- Query kob_leads sample: fetched ${modeCounts?.length || 0} rows (error: ${modeError?.message || 'none'})`);

  // Funnel Stage distribution
  const { data: stageSample, error: stageError } = await client
    .from('lead_stage_history')
    .select('to_stage, created_at')
    .limit(10);
  console.log(`- Query lead_stage_history: fetched ${stageSample?.length || 0} rows (error: ${stageError?.message || 'none'})`);

  // Lead activities sample
  const { data: actSample, error: actError } = await client
    .from('lead_activities')
    .select('activity_type, created_at')
    .limit(10);
  console.log(`- Query lead_activities: fetched ${actSample?.length || 0} rows (error: ${actError?.message || 'none'})`);

  // Lead events sample
  const { data: evSample, error: evError } = await client
    .from('lead_events')
    .select('event_type, created_at')
    .limit(10);
  console.log(`- Query lead_events: fetched ${evSample?.length || 0} rows (error: ${evError?.message || 'none'})`);

  // 5. CEO Overview & Settings
  console.log('\n[5] Checking CEO Overview & Configuration...');
  const { data: configs, error: configError } = await client
    .from('kob_configuration')
    .select('*');
  console.log(`- kob_configuration: ${configs?.length || 0} rows (error: ${configError?.message || 'none'})`);

  const { data: kpiTargets, error: kpiError } = await client
    .from('kob_kpi_targets')
    .select('*');
  console.log(`- kob_kpi_targets: ${kpiTargets?.length || 0} rows (error: ${kpiError?.message || 'none'})`);

  const { data: scvConfig, error: scvError } = await client
    .from('scv_mode_config')
    .select('*');
  console.log(`- scv_mode_config: ${scvConfig?.length || 0} rows (error: ${scvError?.message || 'none'})`);

  const { data: scvInputs, error: scvInError } = await client
    .from('scv_mode_inputs')
    .select('*');
  console.log(`- scv_mode_inputs: ${scvInputs?.length || 0} rows (error: ${scvInError?.message || 'none'})`);

  // 6. Lead Detail Query (Single lead + related history + activities + events)
  console.log('\n[6] Checking Lead Detail View query...');
  const { data: firstLead, error: leadError } = await client
    .from('kob_leads')
    .select('*')
    .limit(1)
    .single();

  if (firstLead) {
    console.log(`- Testing single lead: ID ${firstLead.id}, Name: ${firstLead.full_name || 'N/A'}`);
    const [hRes, aRes, eRes] = await Promise.all([
      client.from('lead_stage_history').select('*').eq('lead_id', firstLead.id),
      client.from('lead_activities').select('*').eq('lead_id', firstLead.id),
      client.from('lead_events').select('*').eq('lead_id', firstLead.id)
    ]);
    console.log(`  - Related Stage History: ${hRes.data?.length || 0} rows`);
    console.log(`  - Related Activities: ${aRes.data?.length || 0} rows`);
    console.log(`  - Related Events: ${eRes.data?.length || 0} rows`);
    results.leadDetail = { pass: true, leadId: firstLead.id };
  } else {
    console.error('Failed to fetch sample lead:', leadError);
    results.leadDetail = { pass: false, error: leadError };
  }

  // 7. Webinars
  console.log('\n[7] Checking Webinar Tables & Queries...');
  const { data: webinars, error: webError } = await client
    .from('webinars')
    .select('*')
    .limit(5);
  console.log(`- webinars: ${webinars?.length || 0} rows (error: ${webError?.message || 'none'})`);

  const { data: webAtt, error: webAttError } = await client
    .from('webinar_attendees')
    .select('*')
    .limit(5);
  console.log(`- webinar_attendees: ${webAtt?.length || 0} rows (error: ${webAttError?.message || 'none'})`);

  // 8. Realtime Connection Test
  console.log('\n[8] Checking Supabase Realtime Subscription...');
  const realtimePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Realtime connection timed out after 5000ms'));
    }, 5000);

    const channel = client.channel('public:test_readiness');
    channel
      .on('presence', { event: 'sync' }, () => {})
      .subscribe((status, err) => {
        console.log(`- Realtime subscription status: ${status}`);
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          client.removeChannel(channel);
          resolve(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout);
          client.removeChannel(channel);
          reject(err || new Error(`Channel error: ${status}`));
        }
      });
  });

  try {
    const realtimePass = await realtimePromise;
    console.log('- Realtime connection test: PASS');
    results.realtime = { pass: true };
  } catch (err) {
    console.error('- Realtime connection test FAILED:', err.message);
    results.realtime = { pass: false, error: err.message };
  }

  console.log('\n--- VERIFICATION SUMMARY ---');
  console.log(JSON.stringify(results, null, 2));
}

runTests().catch(err => {
  console.error('Verification script error:', err);
  process.exit(1);
});
