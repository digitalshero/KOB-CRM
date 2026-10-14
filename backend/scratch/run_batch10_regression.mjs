import { createRequire } from "module";
import { pathToFileURL } from "url";

const require = createRequire("d:/Shero Home Food/kob-unity-spark (2)/backend/package.json");
const { createClient } = require("@supabase/supabase-js");
const { loadTestEnv } = await import(pathToFileURL("d:/Shero Home Food/kob-unity-spark (2)/backend/test-env.mjs").href);

const env = loadTestEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BACKEND_BASE = "http://localhost:3001";

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function orgRead(supabase, userId, adminClient) {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (((role ?? "executive")) === "executive" || !adminClient) return supabase;
  return adminClient;
}

// ----------------------------------------------------
// OLD IMPLEMENTATIONS
// ----------------------------------------------------

// 1. oldGetVariantStageResponseSplitTable
async function pageAll(build) {
  const all = [];
  for (let page = 0; page < 200; page++) {
    const { data, error } = await build().range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

async function autoCohortResponses(supabase, windows, sources, targets, manual = false) {
  const leads = new Map();
  for (const w of windows) {
    const rows = await pageAll(() =>
      supabase
        .from("kob_leads")
        .select("id, created_at")
        .gte("created_at", w.from)
        .lte("created_at", w.to)
        .order("created_at", { ascending: true }),
    );
    for (const l of rows) leads.set(l.id, l.created_at);
  }
  const ids = [...leads.keys()];
  const hist = [];
  for (let c = 0; c < ids.length; c += 200) {
    const chunk = ids.slice(c, c + 200);
    hist.push(
      ...(await pageAll(() =>
        supabase
          .from("lead_stage_history")
          .select("id, lead_id, to_stage")
          .filter("changed_by", manual ? "not.is" : "is", null)
          .in("lead_id", chunk)
          .in("from_stage", sources)
          .in("to_stage", targets)
          .order("id", { ascending: true }),
      )),
    );
  }
  return { leads, hist };
}

async function oldGetVariantStageResponseSplitTable(supabase, data) {
  const IST_MS = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + IST_MS);
  const istDay = (iso) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
  const todayIst = nowIst.toISOString().slice(0, 10);
  const days = [];
  for (let i = 1; i <= 5; i++) {
    const d = new Date(nowIst.getTime() - i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }
  const monthStart = todayIst.slice(0, 8) + "01";

  let rows = [];
  let successTargets;

  const keys = ["INTERESTED", "NO", "NO_RESPONSE", "LATER"];
  const buckets = {};
  for (const k of keys) {
    buckets[k] = { lifetime: new Set(), mtd: new Set() };
    for (const d of days) buckets[k][d] = new Set();
  }

  if (data.variant === "auto") {
    const SOURCES = {
      AUTO_FIRED: ["AUTO_FIRED", "EOI_1"],
      WEBINAR: ["WEBINAR"],
      EOI_2: ["EOI_2"],
      EOI_1: ["EOI_1", "AUTO_FIRED"],
    };
    const SUCCESS = {
      AUTO_FIRED: ["WEBINAR"],
      WEBINAR: ["EOI_2"],
      EOI_2: ["FORM_FILLED", "FEE_PAID"],
      EOI_1: ["WEBINAR"],
    };
    const sources = SOURCES[data.stageKey];
    successTargets = SUCCESS[data.stageKey];
    const monthStartIso = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS).toISOString();
    const fiveAgo = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() - 5) - IST_MS).toISOString();
    const { leads, hist } = await autoCohortResponses(supabase, [
      { from: data.from ?? monthStartIso, to: data.to ?? new Date().toISOString() },
      { from: monthStartIso < fiveAgo ? monthStartIso : fiveAgo, to: new Date().toISOString() },
    ], sources, [...successTargets, "NO", "NO_RESPONSE", "LATER"]);
    const inRange = (ts) => (!data.from || ts >= data.from) && (!data.to || ts <= data.to);
    for (const r of hist) {
      const created = leads.get(r.lead_id);
      if (!created) continue;
      const k = successTargets.includes(r.to_stage) ? "INTERESTED" : r.to_stage;
      if (!buckets[k]) continue;
      const day = istDay(created);
      if (inRange(created)) buckets[k].lifetime.add(r.lead_id);
      if (day >= monthStart && day <= todayIst) buckets[k].mtd.add(r.lead_id);
      if (buckets[k][day]) buckets[k][day].add(r.lead_id);
    }
  } else {
    const SUCCESS = {
      EOI_1: ["WEBINAR"],
      WEBINAR: ["EOI_2"],
      EOI_2: ["FORM_FILLED", "FEE_PAID", "KTN_CS"],
      AUTO_FIRED: ["WEBINAR"],
    };
    successTargets = SUCCESS[data.stageKey];
    const monthStartIso = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS).toISOString();
    const fiveAgo = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() - 5) - IST_MS).toISOString();
    const { leads, hist } = await autoCohortResponses(supabase, [
      { from: data.from ?? monthStartIso, to: data.to ?? new Date().toISOString() },
      { from: monthStartIso < fiveAgo ? monthStartIso : fiveAgo, to: new Date().toISOString() },
    ], [data.stageKey], [...successTargets, "NO", "NO_RESPONSE", "LATER"], true);
    const inRange = (ts) => (!data.from || ts >= data.from) && (!data.to || ts <= data.to);
    for (const r of hist) {
      const created = leads.get(r.lead_id);
      if (!created) continue;
      const k = successTargets.includes(r.to_stage) ? "INTERESTED" : r.to_stage;
      if (!buckets[k]) continue;
      const day = istDay(created);
      if (inRange(created)) buckets[k].lifetime.add(r.lead_id);
      if (day >= monthStart && day <= todayIst) buckets[k].mtd.add(r.lead_id);
      if (buckets[k][day]) buckets[k][day].add(r.lead_id);
    }
  }

  const rowsOut = keys.map((k) => ({
    key: k,
    daily: days.map((d) => buckets[k][d].size),
    mtd: buckets[k].mtd.size,
    lifetime: buckets[k].lifetime.size,
  }));
  return { days, rows: rowsOut };
}

// 2. oldListActiveExecutives
async function oldListActiveExecutives(supabase, userId, adminClient) {
  const db = await orgRead(supabase, userId, adminClient);
  const { data: roles } = await db.from("user_roles").select("user_id, role").eq("role", "executive");
  const execIds = (roles ?? []).map((r) => r.user_id);
  if (!execIds.length) return [];
  const { data: profilesRaw } = await db
    .from("profiles")
    .select("id, full_name, assignment_active")
    .in("id", execIds)
    .order("full_name", { ascending: true });
  return (profilesRaw ?? [])
    .filter((p) => p.assignment_active !== false)
    .map((p) => ({ id: p.id, full_name: p.full_name }));
}

// 3. oldListAllExecutives
async function oldListAllExecutives(supabase) {
  const { data: roles } = await supabase.from("user_roles").select("user_id, role").eq("role", "executive");
  const execIds = (roles ?? []).map((r) => r.user_id);
  if (execIds.length === 0) return [];
  const { data: profsRaw } = await supabase
    .from("profiles")
    .select("id, full_name, email, team_leader_id, primary_language, secondary_language, assignment_active")
    .in("id", execIds);

  const { data: leads } = await supabase
    .from("kob_leads")
    .select("assigned_to, language")
    .in("assigned_to", execIds);
  const langByExec = {};
  for (const l of leads ?? []) {
    const a = l.assigned_to;
    const lang = l.language;
    if (!a || !lang) continue;
    (langByExec[a] ??= {})[lang] = (langByExec[a]?.[lang] ?? 0) + 1;
  }
  return (profsRaw ?? []).map((p) => {
    const langs = Object.entries(langByExec[p.id] ?? {}).sort((a, b) => b[1] - a[1]);
    return {
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      team_leader_id: p.team_leader_id,
      primary_language: p.primary_language ?? langs[0]?.[0] ?? null,
      secondary_language: p.secondary_language ?? null,
      languages: langs.map(([l]) => l),
      assignment_active: p.assignment_active !== false,
    };
  });
}

// 4. oldListAllocatableExecutives
async function oldListAllocatableExecutives(supabase) {
  const { data: roles } = await supabase.from("user_roles").select("user_id, role").eq("role", "executive");
  const execIds = (roles ?? []).map((r) => r.user_id);
  if (execIds.length === 0) return [];
  const { data: profsRaw } = await supabase
    .from("profiles")
    .select("id, full_name, email, team_leader_id, primary_language, secondary_language, assignment_active")
    .in("id", execIds);
  const profs = (profsRaw ?? []).filter((p) => p.assignment_active !== false);

  const { data: leads } = await supabase
    .from("kob_leads")
    .select("assigned_to, language")
    .in("assigned_to", execIds);
  const langByExec = {};
  for (const l of leads ?? []) {
    const a = l.assigned_to;
    const lang = l.language;
    if (!a || !lang) continue;
    (langByExec[a] ??= {})[lang] = (langByExec[a]?.[lang] ?? 0) + 1;
  }
  return (profs ?? []).map((p) => {
    const langs = Object.entries(langByExec[p.id] ?? {}).sort((a, b) => b[1] - a[1]);
    return {
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      team_leader_id: p.team_leader_id,
      primary_language: p.primary_language ?? langs[0]?.[0] ?? null,
      secondary_language: p.secondary_language ?? null,
      languages: langs.map(([l]) => l),
    };
  });
}

// 5. oldListBatchAttendance
async function oldListBatchAttendance(supabase, adminClient, data) {
  const { data: rows, error } = await supabase
    .from("webinar_attendance")
    .select("id, lead_id, attended, marked_at, defaulter_marked_at")
    .eq("batch_id", data.batchId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const list = rows ?? [];
  const ids = [...new Set(list.map((r) => r.lead_id).filter(Boolean))];
  const leadMap = {};
  if (ids.length) {
    const db = adminClient || supabase;
    const { data: leads, error: lErr } = await db
      .from("kob_leads")
      .select("id, code, full_name, phone, stage, language")
      .in("id", ids);
    if (lErr) throw lErr;
    for (const l of leads ?? []) leadMap[l.id] = l;
  }
  return list.map((r) => ({ ...r, kob_leads: leadMap[r.lead_id] ?? null }));
}

// 6. oldListExecutivesWithStats
async function oldListExecutivesWithStats(supabase, userId, adminClient) {
  const db = await orgRead(supabase, userId, adminClient);
  const { data: roles } = await db.from("user_roles").select("user_id, role");
  const execIds = (roles ?? []).filter((r) => r.role === "executive").map((r) => r.user_id);
  if (!execIds.length) return [];
  const profQ = db
    .from("profiles")
    .select("id, full_name, email, team_leader_id, assignment_active")
    .in("id", execIds);
  const { data: profilesRaw } = await profQ;
  const profiles = (profilesRaw ?? []).filter((p) => p.assignment_active !== false);

  const tlIds = Array.from(new Set((profiles ?? []).map((p) => p.team_leader_id).filter(Boolean)));
  const { data: tls } = tlIds.length
    ? await db.from("profiles").select("id, full_name").in("id", tlIds)
    : { data: [] };
  const tlName = new Map((tls ?? []).map((t) => [t.id, t.full_name]));
  const scopedExecIds = (profiles ?? []).map((p) => p.id);
  const leads = [];
  if (scopedExecIds.length) {
    const PAGE = 1000;
    for (let i = 0; ; i += PAGE) {
      const { data, error } = await db
        .from("kob_leads")
        .select("id, assigned_to, stage")
        .in("assigned_to", scopedExecIds)
        .order("id", { ascending: true })
        .range(i, i + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = data ?? [];
      leads.push(...page);
      if (page.length < PAGE) break;
    }
  }
  const byExec = {};
  for (const l of leads) {
    const bag = (byExec[l.assigned_to] ??= new Map());
    bag.set(l.id, l);
  }
  return (profiles ?? []).map((p) => {
    const el = Array.from((byExec[p.id] ?? new Map()).values());
    const c = (s) => el.filter((l) => l.stage === s).length;
    const ktnLive = c("KTN_LIVE");

    return {
      id: p.id,
      name: p.full_name,
      email: p.email,
      teamLeaderId: p.team_leader_id,
      teamLeaderName: p.team_leader_id ? (tlName.get(p.team_leader_id) ?? "—") : "—",
      leads: el.length,
      eoi1: c("EOI_1"), webinar: c("WEBINAR"), eoi2: c("EOI_2"),
      feePaid: c("FEE_PAID"), agreement: c("AGREEMENT_SIGNED"),
      ktnCs: c("KTN_CS"), ktnLive,
      conversion: el.length ? Math.round((ktnLive / el.length) * 100) : 0,
    };
  });
}

// 7. oldListLeadEvaluationHistory
async function oldListLeadEvaluationHistory(supabase, data) {
  const { data: rows, error } = await supabase
    .from("v_lead_evaluation_history")
    .select("*")
    .eq("lead_id", data.lead_id)
    .order("filled_at", { ascending: false });
  if (error) throw new Error(error.message);
  return rows ?? [];
}

// 8. oldListLeadsForEvaluation
async function oldListLeadsForEvaluation(supabase, userId) {
  const { data: roles } = await supabase
    .from("user_roles").select("role").eq("user_id", userId);
  const rs = (roles ?? []).map((r) => r.role);
  const isMgr = rs.includes("super_admin") || rs.includes("kob_manager");
  const isTL = rs.includes("team_leader");

  let q = supabase
    .from("kob_leads")
    .select("id, code, full_name, phone, stage, language, assigned_to, team_leader_id, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (!isMgr) {
    if (isTL) q = q.or(`team_leader_id.eq.${userId},assigned_to.eq.${userId}`);
    else q = q.eq("assigned_to", userId);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ----------------------------------------------------
// RUNNER
// ----------------------------------------------------
async function run() {
  console.log("==================================================");
  console.log("STARTING BATCH 10 REGRESSION SUITE");
  console.log("==================================================");

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Authenticate test user
  const { data: authData, error: authErr } = await client.auth.signInWithPassword({
    email: env.TEST_USER_EMAIL,
    password: env.TEST_USER_PASSWORD,
  });
  if (authErr || !authData.session) {
    console.error("Failed to authenticate test user:", authErr);
    process.exit(1);
  }
  const token = authData.session.access_token;
  const userId = authData.user.id;
  console.log(`Authenticated as: ${env.TEST_USER_EMAIL} (${userId})`);

  // DB Count Snapshot
  const { count: leadsCountBefore } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: histCountBefore } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: attCountBefore } = await adminClient.from("webinar_attendance").select("*", { count: "exact", head: true });
  const { count: evalCountBefore } = await adminClient.from("evaluation_responses").select("*", { count: "exact", head: true });

  const results = [];

  async function check(name, oldFn, path) {
    process.stdout.write(`Testing ${name}... `);
    const oldRes = await oldFn();
    const res = await fetch(`${BACKEND_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const errTxt = await res.text();
      console.log(`FAILED! HTTP ${res.status}: ${errTxt}`);
      results.push({ Function: name, Status: "HTTP_FAIL", Match: "NO" });
      process.exit(1);
    }
    const newRes = await res.json();
    const match = deepEqual(oldRes, newRes);
    if (!match) {
      console.log("MISMATCH!");
      console.log("OLD:", JSON.stringify(oldRes, null, 2).slice(0, 500));
      console.log("NEW:", JSON.stringify(newRes, null, 2).slice(0, 500));
      results.push({ Function: name, Status: "MISMATCH", Match: "NO" });
      process.exit(1);
    }
    console.log("PASS ✓ (Deep Match)");
    results.push({ Function: name, Status: "PASS", Match: "YES" });
  }

  // 1. getVariantStageResponseSplitTable
  await check(
    "getVariantStageResponseSplitTable (auto, AUTO_FIRED, no dates)",
    () => oldGetVariantStageResponseSplitTable(client, { stageKey: "AUTO_FIRED", variant: "auto" }),
    `/api/dashboard/variant-stage-response-split-table?stageKey=AUTO_FIRED&variant=auto`,
  );
  await check(
    "getVariantStageResponseSplitTable (auto, EOI_1, custom range)",
    () => oldGetVariantStageResponseSplitTable(client, { stageKey: "EOI_1", variant: "auto", from: "2026-06-01T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z" }),
    `/api/dashboard/variant-stage-response-split-table?stageKey=EOI_1&variant=auto&from=2026-06-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z`,
  );
  await check(
    "getVariantStageResponseSplitTable (manual, EOI_1, no dates)",
    () => oldGetVariantStageResponseSplitTable(client, { stageKey: "EOI_1", variant: "manual" }),
    `/api/dashboard/variant-stage-response-split-table?stageKey=EOI_1&variant=manual`,
  );
  await check(
    "getVariantStageResponseSplitTable (manual, WEBINAR, custom range)",
    () => oldGetVariantStageResponseSplitTable(client, { stageKey: "WEBINAR", variant: "manual", from: "2026-06-01T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z" }),
    `/api/dashboard/variant-stage-response-split-table?stageKey=WEBINAR&variant=manual&from=2026-06-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z`,
  );

  // 2. listActiveExecutives
  await check(
    "listActiveExecutives",
    () => oldListActiveExecutives(client, userId, adminClient),
    `/api/kob/active-executives`,
  );

  // 3. listAllExecutives
  await check(
    "listAllExecutives",
    () => oldListAllExecutives(client),
    `/api/kob/all-executives`,
  );

  // 4. listAllocatableExecutives
  await check(
    "listAllocatableExecutives",
    () => oldListAllocatableExecutives(client),
    `/api/kob/allocatable-executives`,
  );

  // 5. listBatchAttendance
  const sampleBatchId = "77afe898-1942-436e-9de7-c374f18a7e1c";
  await check(
    "listBatchAttendance (valid batch)",
    () => oldListBatchAttendance(client, adminClient, { batchId: sampleBatchId }),
    `/api/webinar/batch-attendance?batchId=${sampleBatchId}`,
  );

  // 6. listExecutivesWithStats
  await check(
    "listExecutivesWithStats",
    () => oldListExecutivesWithStats(client, userId, adminClient),
    `/api/kob/executives-with-stats`,
  );

  // 7. listLeadEvaluationHistory
  const sampleLeadId = "004bc1fb-33e8-488e-96f9-0f1d57492e32";
  await check(
    "listLeadEvaluationHistory (valid lead)",
    () => oldListLeadEvaluationHistory(client, { lead_id: sampleLeadId }),
    `/api/evaluation/history?lead_id=${sampleLeadId}`,
  );

  // 8. listLeadsForEvaluation
  await check(
    "listLeadsForEvaluation",
    () => oldListLeadsForEvaluation(client, userId),
    `/api/evaluation/leads`,
  );

  // 9. Auth Failure Verification (401 when no token)
  process.stdout.write("Testing Auth Failure (no token)... ");
  const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/active-executives`);
  if (unauthRes.status !== 401) {
    console.log(`FAILED! Expected 401, got ${unauthRes.status}`);
    process.exit(1);
  }
  console.log("PASS ✓ (HTTP 401)");

  // 10. Database Writes Verification
  const { count: leadsCountAfter } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: histCountAfter } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: attCountAfter } = await adminClient.from("webinar_attendance").select("*", { count: "exact", head: true });
  const { count: evalCountAfter } = await adminClient.from("evaluation_responses").select("*", { count: "exact", head: true });

  const leadsDelta = leadsCountAfter - leadsCountBefore;
  const histDelta = histCountAfter - histCountBefore;
  const attDelta = attCountAfter - attCountBefore;
  const evalDelta = evalCountAfter - evalCountBefore;
  const totalDelta = leadsDelta + histDelta + attDelta + evalDelta;

  console.log("\nDatabase Write Check:");
  console.log(`  Leads delta: ${leadsDelta}`);
  console.log(`  Stage history delta: ${histDelta}`);
  console.log(`  Webinar attendance delta: ${attDelta}`);
  console.log(`  Evaluation responses delta: ${evalDelta}`);
  console.log(`  Total DB mutations during test: ${totalDelta}`);

  if (totalDelta !== 0) {
    console.error("ERROR: Database mutations detected during read-only tests!");
    process.exit(1);
  }

  console.log("\n==================================================");
  console.log("BATCH 10 REGRESSION SUMMARY");
  console.log("==================================================");
  console.table(results);
  console.log("\nFINAL PARITY RESULT: PASS ✓");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
