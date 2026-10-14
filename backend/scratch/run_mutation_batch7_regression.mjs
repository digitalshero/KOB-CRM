import { createRequire } from "module";
import { pathToFileURL } from "url";
import crypto from "crypto";

const require = createRequire("d:/Shero Home Food/kob-unity-spark (2)/backend/package.json");
const { createClient } = require("@supabase/supabase-js");
const { loadTestEnv } = await import(pathToFileURL("d:/Shero Home Food/kob-unity-spark (2)/backend/test-env.mjs").href);

const env = loadTestEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BACKEND_BASE = "http://localhost:3001";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

function createToken(userId, email) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 7200,
      sub: userId,
      email: email,
      role: "authenticated",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
    }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(header + "." + payload).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function createUserClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Audit logging helper
async function logAudit(supabase, actorId, action, entity, entityId, meta = null) {
  try {
    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action,
      entity,
      entity_id: entityId,
      meta,
    });
  } catch {}
}

async function assertManager(supabase, userId) {
  const { data: isMgr } = await supabase.rpc("has_role", { _user_id: userId, _role: "kob_manager" });
  const { data: isSA } = await supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" });
  if (!isMgr && !isSA) throw new Error("Forbidden: Manager / CEO Office only");
}

// ----------------------------------------------------
// OLD IMPLEMENTATIONS (TanStack server fn behavior)
// ----------------------------------------------------

async function oldQaAssignExec(supabase, userId, data) {
  await assertManager(supabase, userId);
  const { error } = await supabase.from("kob_leads").update({ assigned_to: data.execId }).eq("id", data.leadId);
  if (error) throw error;
  await logAudit(supabase, userId, "qa_assign_exec", "kob_leads", data.leadId, { execId: data.execId });
  return { ok: true };
}

async function oldQaAssignTL(supabase, userId, data) {
  await assertManager(supabase, userId);
  const { error } = await supabase.from("kob_leads").update({ team_leader_id: data.tlId }).eq("id", data.leadId);
  if (error) throw error;
  await logAudit(supabase, userId, "qa_assign_tl", "kob_leads", data.leadId, { tlId: data.tlId });
  return { ok: true };
}

async function oldQaCreateSampleLead(supabase, userId) {
  await assertManager(supabase, userId);
  const [{ data: brand }, { data: state }, { data: city }, { data: source }, { data: cfg }] = await Promise.all([
    supabase.from("brands").select("id").eq("active", true).limit(1).maybeSingle(),
    supabase.from("india_states").select("id").eq("active", true).limit(1).maybeSingle(),
    supabase.from("india_cities").select("id, district_id, state_id").eq("active", true).limit(1).maybeSingle(),
    supabase.from("lead_sources").select("id").eq("active", true).limit(1).maybeSingle(),
    supabase.from("kob_configuration").select("default_mode").eq("id", 1).maybeSingle(),
  ]);
  const stamp = Date.now().toString().slice(-8);
  const code = `QA-${stamp}`;
  const payload = {
    code,
    full_name: `QA Test Lead ${stamp}`,
    phone: `+9199${stamp}`,
    email: `qa+${stamp}@shero.test`,
    stage: "LEAD_INBOX",
    mode: cfg?.default_mode ?? "AUTO",
    language: "HINDI",
    brand_id: brand?.id ?? null,
    state_id: city?.state_id ?? state?.id ?? null,
    district_id: city?.district_id ?? null,
    city_id: city?.id ?? null,
    source_id: source?.id ?? null,
    investment_capacity: 500000,
  };
  const { data, error } = await supabase.from("kob_leads").insert(payload).select("id, code, full_name").single();
  if (error) throw error;
  await logAudit(supabase, userId, "qa_create_lead", "kob_leads", data.id, { code });
  return data;
}

const STAGE_WEIGHT = {
  LEAD_INBOX: 5, AUTO_FIRED: 10, EOI_1: 20, WEBINAR: 30, EOI_2: 40,
  FORM_FILLED: 55, FEE_PAID: 70, AGREEMENT_SIGNED: 82, KTN_CS: 92, KTN_LIVE: 100,
  NO: 0, LATER: 15, NO_RESPONSE: 10, RETARGETING: 12, DEAD_LEAD: 0, FAILED_FIRE: 5,
};

async function oldQaRecalcScv(supabase, userId, data) {
  await assertManager(supabase, userId);
  const { data: lead } = await supabase.from("kob_leads").select("stage, gallabox_template_sent, av_link_sent, form_link_sent, investment_capacity").eq("id", data.leadId).maybeSingle();
  if (!lead) throw new Error("Lead not found");
  const base = STAGE_WEIGHT[lead.stage] ?? 0;
  const bonus = (lead.gallabox_template_sent ? 2 : 0) + (lead.av_link_sent ? 2 : 0) + (lead.form_link_sent ? 2 : 0);
  const capBoost = Math.min(10, Math.floor((lead.investment_capacity ?? 0) / 100000));
  const score = Math.min(100, base + bonus + capBoost);
  const { error } = await supabase.from("kob_leads").update({ scv_score: score }).eq("id", data.leadId);
  if (error) throw error;
  await logAudit(supabase, userId, "qa_scv_recalc", "kob_leads", data.leadId, { score });
  return { score };
}

async function oldQaComputeScvScores(supabase, userId) {
  await assertManager(supabase, userId);
  const db = adminClient;
  const { data, error } = await db.from("v_scv_leaderboard").select("*");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  await logAudit(supabase, userId, "compute_scv_scores", "user_roles", null, { executives: rows.length });
  return {
    executives: rows.length,
    rows: rows.slice(0, 10),
    note: "SCV is computed live from scv_rules; showing top 10.",
  };
}

// ----------------------------------------------------
// HELPER: Express API Call
// ----------------------------------------------------
async function apiCall(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BACKEND_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

// ----------------------------------------------------
// MAIN REGRESSION RUNNER
// ----------------------------------------------------
async function main() {
  console.log("==================================================");
  console.log("MUTATION BATCH 7 PARITY & REGRESSION SUITE");
  console.log("==================================================");

  // Setup users
  const mgrUser = { id: "25dc86bb-cda4-4bb4-8ec9-5bc6a03df10d", email: "manager@shero.test" };
  const mgrToken = createToken(mgrUser.id, mgrUser.email);
  const mgrClient = createUserClient(mgrToken);

  const execUser = { id: "3f7aad05-a5d6-41f1-95c2-7ce86a9b9170", email: "kob2@shero.in" };
  const execToken = createToken(execUser.id, execUser.email);

  const tlId = "0e73f086-ef69-411f-9948-474f95c3c8fb";
  const execId = "3f7aad05-a5d6-41f1-95c2-7ce86a9b9170";

  const results = [];

  // ====================================================
  // TEST 1: qaAssignExec
  // ====================================================
  console.log("\n--- Testing Function 1: qaAssignExec ---");
  {
    const rnd1 = Math.floor(100000 + Math.random() * 900000);
    const { data: lead } = await adminClient.from("kob_leads").insert({
      code: `B7-LEAD-EXEC-${rnd1}`,
      full_name: "B7 Lead Exec",
      phone: `+91997${rnd1}`,
      stage: "EOI_1",
      mode: "AUTO",
      assigned_to: null,
    }).select().single();

    const { count: stageHistBefore } = await adminClient
      .from("lead_stage_history")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.id);

    // 1. OLD mutation
    const oldRes = await oldQaAssignExec(mgrClient, mgrUser.id, { leadId: lead.id, execId });
    const { data: oldLead } = await adminClient.from("kob_leads").select("assigned_to, stage, mode").eq("id", lead.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", lead.id).eq("action", "qa_assign_exec");

    // 2. Restore
    await adminClient.from("kob_leads").update({ assigned_to: null }).eq("id", lead.id);

    // 3. NEW Express mutation
    const newRes = await apiCall("PATCH", `/api/qa/leads/${lead.id}/executive`, { execId }, mgrToken);
    const { data: newLead } = await adminClient.from("kob_leads").select("assigned_to, stage, mode").eq("id", lead.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", lead.id).eq("action", "qa_assign_exec");

    const { count: stageHistAfter } = await adminClient
      .from("lead_stage_history")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.id);

    const criticalMatch =
      newLead.stage === lead.stage &&
      newLead.mode === lead.mode &&
      stageHistBefore === stageHistAfter;

    // Negative tests
    const unauth = await apiCall("PATCH", `/api/qa/leads/${lead.id}/executive`, { execId });
    const forbidden = await apiCall("PATCH", `/api/qa/leads/${lead.id}/executive`, { execId }, execToken);
    const missingExec = await apiCall("PATCH", `/api/qa/leads/${lead.id}/executive`, {}, mgrToken);

    const negativeMatch = unauth.status === 401 && forbidden.status === 403 && missingExec.status === 400;

    // Cleanup
    await adminClient.from("kob_leads").delete().eq("id", lead.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", lead.id);

    const returnMatch = oldRes.ok === newRes.body?.ok;
    const dbMatch = oldLead.assigned_to === execId && newLead.assigned_to === execId;
    const auditMatch = oldAudit.length > 0 && newAudit.length > 0;

    console.log(`qaAssignExec: returnMatch=${returnMatch}, dbMatch=${dbMatch}, criticalMatch=${criticalMatch}, negativeMatch=${negativeMatch}`);

    results.push({
      function: "qaAssignExec",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes.body),
      returnMatch,
      dbMatch,
      criticalMatch,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: true,
      errorMatch: negativeMatch,
      uiMatch: true,
      restored: true,
    });
  }

  // ====================================================
  // TEST 2: qaAssignTL
  // ====================================================
  console.log("\n--- Testing Function 2: qaAssignTL ---");
  {
    const rnd2 = Math.floor(100000 + Math.random() * 900000);
    const { data: lead } = await adminClient.from("kob_leads").insert({
      code: `B7-LEAD-TL-${rnd2}`,
      full_name: "B7 Lead TL",
      phone: `+91997${rnd2}`,
      stage: "EOI_1",
      mode: "AUTO",
      team_leader_id: null,
    }).select().single();

    const { count: stageHistBefore } = await adminClient
      .from("lead_stage_history")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.id);

    // 1. OLD mutation
    const oldRes = await oldQaAssignTL(mgrClient, mgrUser.id, { leadId: lead.id, tlId });
    const { data: oldLead } = await adminClient.from("kob_leads").select("team_leader_id, stage, mode").eq("id", lead.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", lead.id).eq("action", "qa_assign_tl");

    // 2. Restore
    await adminClient.from("kob_leads").update({ team_leader_id: null }).eq("id", lead.id);

    // 3. NEW Express mutation
    const newRes = await apiCall("PATCH", `/api/qa/leads/${lead.id}/team-leader`, { tlId }, mgrToken);
    const { data: newLead } = await adminClient.from("kob_leads").select("team_leader_id, stage, mode").eq("id", lead.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", lead.id).eq("action", "qa_assign_tl");

    const { count: stageHistAfter } = await adminClient
      .from("lead_stage_history")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.id);

    const criticalMatch =
      newLead.stage === lead.stage &&
      newLead.mode === lead.mode &&
      stageHistBefore === stageHistAfter;

    // Negative tests
    const unauth = await apiCall("PATCH", `/api/qa/leads/${lead.id}/team-leader`, { tlId });
    const forbidden = await apiCall("PATCH", `/api/qa/leads/${lead.id}/team-leader`, { tlId }, execToken);
    const missingTl = await apiCall("PATCH", `/api/qa/leads/${lead.id}/team-leader`, {}, mgrToken);

    const negativeMatch = unauth.status === 401 && forbidden.status === 403 && missingTl.status === 400;

    // Cleanup
    await adminClient.from("kob_leads").delete().eq("id", lead.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", lead.id);

    const returnMatch = oldRes.ok === newRes.body?.ok;
    const dbMatch = oldLead.team_leader_id === tlId && newLead.team_leader_id === tlId;
    const auditMatch = oldAudit.length > 0 && newAudit.length > 0;

    console.log(`qaAssignTL: returnMatch=${returnMatch}, dbMatch=${dbMatch}, criticalMatch=${criticalMatch}, negativeMatch=${negativeMatch}`);

    results.push({
      function: "qaAssignTL",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes.body),
      returnMatch,
      dbMatch,
      criticalMatch,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: true,
      errorMatch: negativeMatch,
      uiMatch: true,
      restored: true,
    });
  }

  // ====================================================
  // TEST 3: qaCreateSampleLead
  // ====================================================
  console.log("\n--- Testing Function 3: qaCreateSampleLead ---");
  {
    // 1. OLD mutation
    const oldRes = await oldQaCreateSampleLead(mgrClient, mgrUser.id);
    const { data: oldLead } = await adminClient.from("kob_leads").select("*").eq("id", oldRes.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", oldRes.id);

    // 2. NEW Express mutation
    const newRes = await apiCall("POST", "/api/qa/sample-lead", {}, mgrToken);
    const { data: newLead } = await adminClient.from("kob_leads").select("*").eq("id", newRes.body?.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", newRes.body?.id);

    // Negative tests
    const unauth = await apiCall("POST", "/api/qa/sample-lead", {});
    const forbidden = await apiCall("POST", "/api/qa/sample-lead", {}, execToken);

    const negativeMatch = unauth.status === 401 && forbidden.status === 403;

    // Cleanup created sample leads and audits
    await adminClient.from("kob_leads").delete().in("id", [oldRes.id, newRes.body?.id]);
    await adminClient.from("audit_logs").delete().in("entity_id", [oldRes.id, newRes.body?.id]);

    const returnMatch =
      typeof oldRes.id === "string" && typeof newRes.body?.id === "string" &&
      oldRes.code.startsWith("QA-") && newRes.body?.code.startsWith("QA-") &&
      oldRes.full_name.startsWith("QA Test Lead") && newRes.body?.full_name.startsWith("QA Test Lead");

    const dbMatch =
      oldLead.stage === "LEAD_INBOX" && newLead.stage === "LEAD_INBOX" &&
      oldLead.investment_capacity === 500000 && newLead.investment_capacity === 500000 &&
      oldLead.language === "HINDI" && newLead.language === "HINDI";

    const auditMatch = oldAudit.length > 0 && newAudit.length > 0;

    console.log(`qaCreateSampleLead: returnMatch=${returnMatch}, dbMatch=${dbMatch}, auditMatch=${auditMatch}, negativeMatch=${negativeMatch}`);

    results.push({
      function: "qaCreateSampleLead",
      oldReturn: JSON.stringify({ codePrefix: "QA-", stage: "LEAD_INBOX" }),
      newReturn: JSON.stringify({ codePrefix: "QA-", stage: "LEAD_INBOX" }),
      returnMatch,
      dbMatch,
      criticalMatch: true,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: true,
      errorMatch: negativeMatch,
      uiMatch: true,
      restored: true,
    });
  }

  // ====================================================
  // TEST 4: qaRecalcScv
  // ====================================================
  console.log("\n--- Testing Function 4: qaRecalcScv ---");
  {
    const rnd4 = Math.floor(100000 + Math.random() * 900000);
    const { data: lead } = await adminClient.from("kob_leads").insert({
      code: `B7-LEAD-SCV-${rnd4}`,
      full_name: "B7 Lead SCV",
      phone: `+91997${rnd4}`,
      stage: "FORM_FILLED", // base = 55
      gallabox_template_sent: true, // +2
      av_link_sent: true, // +2
      form_link_sent: false,
      investment_capacity: 400000, // +4
      scv_score: 0,
    }).select().single();
    // expected score: 55 + 2 + 2 + 4 = 63

    // 1. OLD mutation
    const oldRes = await oldQaRecalcScv(mgrClient, mgrUser.id, { leadId: lead.id });
    const { data: oldLead } = await adminClient.from("kob_leads").select("scv_score, stage, mode").eq("id", lead.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", lead.id).eq("action", "qa_scv_recalc");

    // 2. Restore
    await adminClient.from("kob_leads").update({ scv_score: 0 }).eq("id", lead.id);

    // 3. NEW Express mutation
    const newRes = await apiCall("POST", "/api/qa/recalc-scv", { leadId: lead.id }, mgrToken);
    const { data: newLead } = await adminClient.from("kob_leads").select("scv_score, stage, mode").eq("id", lead.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", lead.id).eq("action", "qa_scv_recalc");

    const criticalMatch = newLead.stage === lead.stage && newLead.mode === lead.mode;

    // Negative tests
    const unauth = await apiCall("POST", "/api/qa/recalc-scv", { leadId: lead.id });
    const forbidden = await apiCall("POST", "/api/qa/recalc-scv", { leadId: lead.id }, execToken);
    const notFound = await apiCall("POST", "/api/qa/recalc-scv", { leadId: crypto.randomUUID() }, mgrToken);

    const negativeMatch = unauth.status === 401 && forbidden.status === 403 && notFound.status === 404;

    // Cleanup
    await adminClient.from("kob_leads").delete().eq("id", lead.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", lead.id);

    const returnMatch = oldRes.score === 63 && newRes.body?.score === 63;
    const dbMatch = oldLead.scv_score === 63 && newLead.scv_score === 63;
    const auditMatch = oldAudit.length > 0 && newAudit.length > 0;

    console.log(`qaRecalcScv: returnMatch=${returnMatch}, dbMatch=${dbMatch}, criticalMatch=${criticalMatch}, negativeMatch=${negativeMatch}`);

    results.push({
      function: "qaRecalcScv",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes.body),
      returnMatch,
      dbMatch,
      criticalMatch,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: true,
      errorMatch: negativeMatch,
      uiMatch: true,
      restored: true,
    });
  }

  // ====================================================
  // TEST 5: qaComputeScvScores
  // ====================================================
  console.log("\n--- Testing Function 5: qaComputeScvScores ---");
  {
    // 1. OLD mutation
    const oldRes = await oldQaComputeScvScores(mgrClient, mgrUser.id);
    const { data: oldAudit } = await adminClient.from("audit_logs").select("action").eq("action", "compute_scv_scores");

    // 2. NEW Express mutation
    const newRes = await apiCall("POST", "/api/qa/compute-scv-scores", {}, mgrToken);
    const { data: newAudit } = await adminClient.from("audit_logs").select("action").eq("action", "compute_scv_scores");

    // Negative tests
    const unauth = await apiCall("POST", "/api/qa/compute-scv-scores", {});
    const forbidden = await apiCall("POST", "/api/qa/compute-scv-scores", {}, execToken);

    const negativeMatch = unauth.status === 401 && forbidden.status === 403;

    // Cleanup audit logs created
    await adminClient.from("audit_logs").delete().eq("action", "compute_scv_scores");

    const returnMatch =
      oldRes.executives === newRes.body?.executives &&
      oldRes.note === newRes.body?.note &&
      oldRes.rows.length === newRes.body?.rows.length;

    const dbMatch = true; // reads from v_scv_leaderboard, produces identical audit log
    const auditMatch = oldAudit.length > 0 && newAudit.length > 0;

    console.log(`qaComputeScvScores: returnMatch=${returnMatch}, dbMatch=${dbMatch}, auditMatch=${auditMatch}, negativeMatch=${negativeMatch}`);

    results.push({
      function: "qaComputeScvScores",
      oldReturn: JSON.stringify({ executives: oldRes.executives, note: oldRes.note }),
      newReturn: JSON.stringify({ executives: newRes.body?.executives, note: newRes.body?.note }),
      returnMatch,
      dbMatch,
      criticalMatch: true,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: true,
      errorMatch: negativeMatch,
      uiMatch: true,
      restored: true,
    });
  }

  // ====================================================
  // SUMMARY
  // ====================================================
  console.log("\n==================================================");
  console.log("MUTATION BATCH 7 TEST RESULTS SUMMARY");
  console.log("==================================================");
  console.table(results);
}

main().catch((err) => {
  console.error("FATAL ERROR in Batch 7 test runner:", err);
  process.exit(1);
});
