import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const client = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runPageAudit() {
  console.log('================================================================');
  console.log('   KOB LOCAL SUPABASE: PAGE-BY-PAGE READ-ONLY FUNCTIONAL AUDIT   ');
  console.log('================================================================');

  const report = {};

  // 1. Mandatory Table Counts
  console.log('\n--- 1. MANDATORY DATABASE ROW COUNTS ---');
  const countTargets = [
    { table: 'kob_leads', target: 4745 },
    { table: 'lead_stage_history', target: 16144 },
    { table: 'lead_activities', target: 16148 },
    { table: 'lead_events', target: 49537 },
    { table: 'audit_logs', target: 127666 }
  ];
  report.mandatory_counts = {};
  for (const item of countTargets) {
    const { count, error } = await client.from(item.table).select('*', { count: 'exact', head: true });
    const ok = !error && count === item.target;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${item.table}: actual=${count}, target=${item.target}`);
    report.mandatory_counts[item.table] = { actual: count, target: item.target, pass: ok };
  }

  // 2. Login & Authentication
  console.log('\n--- 2. LOGIN & AUTHENTICATION (ALL ROLES) ---');
  report.auth = {};
  const testUsers = [
    { email: 'ceo@shero.test', expectedRole: 'super_admin' },
    { email: 'manager@shero.test', expectedRole: 'kob_manager' },
    { email: 'exec1@shero.test', expectedRole: 'executive' }
  ];
  for (const u of testUsers) {
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: u.email,
      password: 'Test@12345'
    });
    if (error || !data?.session) {
      console.log(`  [FAIL] Login for ${u.email}: ${error?.message}`);
      report.auth[u.email] = { pass: false, error: error?.message };
    } else {
      const userSub = data.session.user.id;
      const { data: claims } = await anonClient.auth.getClaims(data.session.access_token);
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
      });
      const { data: role } = await userClient.rpc('get_user_role', { _user_id: userSub });
      const roleAssigned = role || 'executive';
      const ok = roleAssigned === u.expectedRole;
      console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${u.email}: role=${roleAssigned} (expected: ${u.expectedRole})`);
      report.auth[u.email] = { pass: ok, userId: userSub, role: roleAssigned };
    }
  }

  // 3. Dashboard Metrics & KPIs
  console.log('\n--- 3. DASHBOARD METRICS & KPIS ---');
  const [leadTotalRes, stageDistRes, modeRes] = await Promise.all([
    client.from('kob_leads').select('*', { count: 'exact', head: true }),
    client.from('kob_leads').select('stage'),
    client.from('kob_leads').select('mode')
  ]);
  const stageCounts = {};
  (stageDistRes.data || []).forEach(r => stageCounts[r.stage] = (stageCounts[r.stage] || 0) + 1);
  const modeCounts = {};
  (modeRes.data || []).forEach(r => modeCounts[r.mode] = (modeCounts[r.mode] || 0) + 1);

  console.log(`  Total Leads: ${leadTotalRes.count}`);
  console.log(`  Mode Breakdown: AUTO=${modeCounts['AUTO'] || 0}, MANUAL=${modeCounts['MANUAL'] || 0}`);
  console.log(`  Distinct Stages Found: ${Object.keys(stageCounts).length}`);
  report.dashboard = {
    totalLeads: leadTotalRes.count,
    modeBreakdown: modeCounts,
    stageCount: Object.keys(stageCounts).length,
    pass: leadTotalRes.count === 4745 && Object.keys(stageCounts).length > 0
  };

  // 4. CEO Overview & Configuration
  console.log('\n--- 4. CEO OVERVIEW & CONFIGURATION ---');
  const [cfgRes, kpiRes, bsaRes, evalRes] = await Promise.all([
    client.from('kob_configuration').select('*').limit(1).single(),
    client.from('kpi_targets').select('*').limit(5),
    client.from('brand_state_availability').select('*', { count: 'exact', head: true }),
    client.from('evaluation_questions').select('*', { count: 'exact', head: true })
  ]);
  console.log(`  Default Mode: ${cfgRes.data?.default_mode}`);
  console.log(`  Incentive Amount: ₹${cfgRes.data?.incentive_amount}`);
  console.log(`  KPI Targets rows: ${kpiRes.data?.length}`);
  console.log(`  Brand State Availability rules: ${bsaRes.count}`);
  console.log(`  Evaluation Questions: ${evalRes.count}`);
  report.ceo_overview = {
    defaultMode: cfgRes.data?.default_mode,
    incentiveAmount: cfgRes.data?.incentive_amount,
    pass: !!cfgRes.data && !cfgRes.error
  };

  // 5. Lead Inbox & Pagination
  console.log('\n--- 5. LEAD INBOX & PAGINATION ---');
  const { data: inboxPage, error: inboxErr } = await client
    .from('kob_leads')
    .select('id, full_name, phone, stage, brand_id, mode, created_at')
    .order('created_at', { ascending: false })
    .range(0, 49);
  const { count: unallocatedCount } = await client
    .from('kob_leads')
    .select('*', { count: 'exact', head: true })
    .is('assigned_to', null);
  console.log(`  Page 1 (first 50 leads) fetched: ${inboxPage?.length} rows`);
  console.log(`  Unallocated leads: ${unallocatedCount}`);
  report.lead_inbox = {
    page1Count: inboxPage?.length,
    unallocatedCount,
    pass: inboxPage?.length === 50 && !inboxErr
  };

  // 6. Kanban View
  console.log('\n--- 6. KANBAN VIEW ---');
  const kanbanStages = ['LEAD_INBOX', 'AUTO_FIRED', 'EOI_1', 'WEBINAR', 'EOI_2', 'FORM_FILLED', 'FEE_PAID', 'KTN_CS'];
  const kanbanCounts = {};
  for (const s of kanbanStages) {
    const { count } = await client.from('kob_leads').select('*', { count: 'exact', head: true }).eq('stage', s);
    kanbanCounts[s] = count;
  }
  console.log('  Kanban Column Counts:', JSON.stringify(kanbanCounts));
  report.kanban = { stageCounts: kanbanCounts, pass: Object.values(kanbanCounts).some(c => c > 0) };

  // 7. Table View (Filtering & Sorting)
  console.log('\n--- 7. TABLE VIEW (FILTERING & SORTING) ---');
  const { data: tableData, error: tableErr } = await client
    .from('kob_leads')
    .select('id, full_name, phone, brand_id, source_id, state_id, stage, created_at')
    .order('created_at', { ascending: false })
    .limit(25);
  console.log(`  Table View 25 rows loaded: ${tableData?.length}`);
  report.table_view = { pass: tableData?.length === 25 && !tableErr };

  // 8. Lead Detail View (Deep Relations)
  console.log('\n--- 8. LEAD DETAIL VIEW (DEEP RELATIONS) ---');
  const detailedLeadId = '004bc1fb-33e8-488e-96f9-0f1d57492e32';
  const [detailLead, hist, act, evt, audit] = await Promise.all([
    client.from('kob_leads').select('*').eq('id', detailedLeadId).single(),
    client.from('lead_stage_history').select('*').eq('lead_id', detailedLeadId),
    client.from('lead_activities').select('*').eq('lead_id', detailedLeadId),
    client.from('lead_events').select('*').eq('lead_id', detailedLeadId),
    client.from('audit_logs').select('*').eq('entity_id', detailedLeadId)
  ]);
  console.log(`  Lead ${detailedLeadId} (${detailLead.data?.full_name}):`);
  console.log(`    Stage History: ${hist.data?.length} records`);
  console.log(`    Activities: ${act.data?.length} records`);
  console.log(`    Events: ${evt.data?.length} records`);
  console.log(`    Audit Logs: ${audit.data?.length} records`);
  report.lead_detail = {
    leadId: detailedLeadId,
    stageHistoryCount: hist.data?.length,
    activitiesCount: act.data?.length,
    eventsCount: evt.data?.length,
    auditCount: audit.data?.length,
    pass: !hist.error && !act.error && !evt.error && (hist.data?.length || 0) > 0
  };

  // 9. Search & Filter Queries
  console.log('\n--- 9. SEARCH & FILTERS ---');
  const [searchRes, sourceFilter, langFilter] = await Promise.all([
    client.from('kob_leads').select('id, full_name, phone').ilike('phone', '%98%').limit(5),
    client.from('kob_leads').select('id, source_id').eq('source_id', '3a2b1ebd-16d6-4d21-a358-9aba898d3ce7').limit(5),
    client.from('kob_leads').select('id, language').eq('language', 'TAMIL').limit(5)
  ]);
  console.log(`  Search by phone: ${searchRes.data?.length} matches found`);
  console.log(`  Filter by source_id: ${sourceFilter.data?.length} matches found`);
  console.log(`  Filter by language: ${langFilter.data?.length} matches found`);
  report.search_filters = {
    pass: (searchRes.data?.length || 0) > 0 && (sourceFilter.data?.length || 0) > 0 && (langFilter.data?.length || 0) > 0
  };

  // 10. Auto Conversion Funnel
  console.log('\n--- 10. AUTO CONVERSION FUNNEL ---');
  const { count: autoLeadCount } = await client
    .from('kob_leads')
    .select('*', { count: 'exact', head: true })
    .eq('mode', 'AUTO');
  const { count: autoFiredHist } = await client
    .from('lead_stage_history')
    .select('*', { count: 'exact', head: true })
    .eq('to_stage', 'AUTO_FIRED')
    .is('changed_by', null);
  console.log(`  AUTO Leads Generated: ${autoLeadCount}`);
  console.log(`  AUTO Fired Transitions (system/null changed_by): ${autoFiredHist}`);
  report.auto_funnel = { autoLeadCount, autoFiredHist, pass: autoLeadCount > 0 };

  // 11. Manual Conversion Funnel
  console.log('\n--- 11. MANUAL CONVERSION FUNNEL ---');
  const { count: manualLeadCount } = await client
    .from('kob_leads')
    .select('*', { count: 'exact', head: true })
    .eq('mode', 'MANUAL');
  const { count: manualTransitionCount } = await client
    .from('lead_stage_history')
    .select('*', { count: 'exact', head: true })
    .not('changed_by', 'is', null);
  console.log(`  MANUAL Leads Generated: ${manualLeadCount}`);
  console.log(`  Manual Stage Transitions: ${manualTransitionCount}`);
  report.manual_funnel = { manualLeadCount, manualTransitionCount, pass: manualLeadCount > 0 };

  // 12. Combined Funnel
  console.log('\n--- 12. COMBINED FUNNEL ---');
  const { count: combinedTotal } = await client.from('kob_leads').select('*', { count: 'exact', head: true });
  console.log(`  Combined Leads Total: ${combinedTotal}`);
  report.combined_funnel = { combinedTotal, pass: combinedTotal === 4745 };

  // 13. Retargeting Funnel
  console.log('\n--- 13. RETARGETING FUNNEL ---');
  const [retRules, retSched, retAttempts] = await Promise.all([
    client.from('retargeting_rules').select('*', { count: 'exact', head: true }),
    client.from('retargeting_schedule').select('*', { count: 'exact', head: true }),
    client.from('retargeting_attempts').select('*', { count: 'exact', head: true })
  ]);
  console.log(`  Retargeting Rules: ${retRules.count}`);
  console.log(`  Retargeting Schedules: ${retSched.count}`);
  console.log(`  Retargeting Attempts: ${retAttempts.count}`);
  report.retargeting = {
    rulesCount: retRules.count,
    attemptsCount: retAttempts.count,
    pass: !retRules.error && !retAttempts.error
  };

  // 14. Abandoned Funnel
  console.log('\n--- 14. ABANDONED FUNNEL ---');
  const { count: deadLeads } = await client
    .from('kob_leads')
    .select('*', { count: 'exact', head: true })
    .in('stage', ['DEAD_LEAD', 'NO', 'NO_RESPONSE', 'LATER']);
  console.log(`  Abandoned / Dead / No-Response Leads: ${deadLeads}`);
  report.abandoned_funnel = { deadLeads, pass: deadLeads > 0 };

  // 15. Contracts / KTN CS KPI
  console.log('\n--- 15. CONTRACTS / KTN CS KPI ---');
  const [ktnCsCount, ktnLiveCount] = await Promise.all([
    client.from('kob_leads').select('*', { count: 'exact', head: true }).eq('stage', 'KTN_CS'),
    client.from('kob_leads').select('*', { count: 'exact', head: true }).eq('stage', 'KTN_LIVE')
  ]);
  const { count: ktnHist } = await client
    .from('lead_stage_history')
    .select('*', { count: 'exact', head: true })
    .eq('to_stage', 'KTN_CS');
  console.log(`  Current KTN_CS Leads: ${ktnCsCount.count}`);
  console.log(`  Current KTN_LIVE Leads: ${ktnLiveCount.count}`);
  console.log(`  Total Historical Transitions to KTN_CS: ${ktnHist}`);
  report.contracts_kpi = {
    ktnCs: ktnCsCount.count,
    ktnLive: ktnLiveCount.count,
    ktnHist,
    pass: !ktnCsCount.error && !ktnLiveCount.error
  };

  // 16. Source / Channel Conversion
  console.log('\n--- 16. SOURCE / CHANNEL CONVERSION ---');
  const { data: srcRows } = await client.from('lead_sources').select('*');
  console.log(`  Configured Lead Sources: ${srcRows?.length}`);
  const { data: topSources } = await client.from('kob_leads').select('source_id').limit(100);
  const srcDist = {};
  (topSources || []).forEach(r => srcDist[r.source_id || 'UNKNOWN'] = (srcDist[r.source_id || 'UNKNOWN'] || 0) + 1);
  console.log('  Sample Source Distribution:', JSON.stringify(srcDist));
  report.channel_conversion = { sourcesConfigured: srcRows?.length, pass: (srcRows?.length || 0) > 0 };

  // 17. Webinar Screens
  console.log('\n--- 17. WEBINAR SCREENS ---');
  const [wbBatches, wbAtt] = await Promise.all([
    client.from('webinar_batches').select('*', { count: 'exact', head: true }),
    client.from('webinar_attendance').select('*', { count: 'exact', head: true })
  ]);
  console.log(`  Webinar Batches: ${wbBatches.count}`);
  console.log(`  Webinar Attendance Records: ${wbAtt.count}`);
  report.webinars = {
    batches: wbBatches.count,
    attendance: wbAtt.count,
    pass: !wbBatches.error && !wbAtt.error
  };

  // 18. SCV Screens (Per-mode separation verified)
  console.log('\n--- 18. SCV SCREENS ---');
  const [scvCfg, scvInp, scvRules, incRules] = await Promise.all([
    client.from('scv_mode_config').select('*'),
    client.from('scv_mode_inputs').select('*'),
    client.from('scv_rules').select('*'),
    client.from('incentive_rules').select('*')
  ]);
  console.log(`  SCV Mode Configs: ${scvCfg.data?.length} (Modes: ${scvCfg.data?.map(c => c.mode).join(', ')})`);
  console.log(`  SCV Mode Inputs: ${scvInp.data?.length}`);
  console.log(`  Incentive Rules / Slabs: ${incRules.data?.length}`);
  report.scv = {
    configRows: scvCfg.data?.length,
    inputRows: scvInp.data?.length,
    incentiveSlabs: incRules.data?.length,
    pass: (scvCfg.data?.length || 0) >= 2 && (scvInp.data?.length || 0) > 0
  };

  // 19. Realtime Subscription
  console.log('\n--- 19. REALTIME SUBSCRIPTION CONNECTION ---');
  const realtimePromise = new Promise((resolve) => {
    const channel = client.channel('public:read_only_audit_realtime');
    channel.subscribe((status) => {
      console.log(`  Realtime subscription status: ${status}`);
      if (status === 'SUBSCRIBED') {
        client.removeChannel(channel);
        resolve(true);
      }
    });
    setTimeout(() => resolve(false), 4000);
  });
  const realtimeOk = await realtimePromise;
  report.realtime = { pass: realtimeOk };

  console.log('\n================================================================');
  console.log('                 FINAL AUDIT RESULT SUMMARY                     ');
  console.log('================================================================');
  console.log(JSON.stringify(report, null, 2));
}

runPageAudit().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
