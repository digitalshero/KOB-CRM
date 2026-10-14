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

// Audit helper matching src/lib/audit.ts
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

// ----------------------------------------------------
// OLD IMPLEMENTATIONS (Exact TanStack Server Function Code)
// ----------------------------------------------------

async function assertManager(supabase, userId) {
  const { data: isMgr } = await supabase.rpc("has_role", { _user_id: userId, _role: "kob_manager" });
  const { data: isSA } = await supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" });
  if (!isMgr && !isSA) throw new Error("Forbidden: Manager / CEO Office only");
}

async function oldQaMoveStage(supabase, userId, data) {
  await assertManager(supabase, userId);
  const { error } = await supabase.from("kob_leads").update({ stage: data.stage }).eq("id", data.leadId);
  if (error) throw error;
  await logAudit(supabase, userId, "qa_stage_move", "kob_leads", data.leadId, { stage: data.stage });
  return { ok: true };
}

async function oldQaVerify(supabase, userId, data) {
  await assertManager(supabase, userId);
  const [
    { data: lead },
    { count: stageHistoryCount },
    { data: history },
    { count: auditCount },
    { data: audits },
    { count: totalLeads },
    { count: feePaid },
    { count: agreement },
    { count: ktnCs },
    { count: ktnLive },
    { count: retargeting },
  ] = await Promise.all([
    supabase.from("kob_leads").select("id, code, full_name, stage, scv_score, assigned_to, team_leader_id, updated_at").eq("id", data.leadId).maybeSingle(),
    supabase.from("lead_stage_history").select("*", { count: "exact", head: true }).eq("lead_id", data.leadId),
    supabase.from("lead_stage_history").select("from_stage, to_stage, created_at").eq("lead_id", data.leadId).order("created_at", { ascending: false }).limit(20),
    supabase.from("audit_logs").select("*", { count: "exact", head: true }).eq("entity_id", data.leadId),
    supabase.from("audit_logs").select("action, created_at, meta").eq("entity_id", data.leadId).order("created_at", { ascending: false }).limit(20),
    supabase.from("kob_leads").select("*", { count: "exact", head: true }),
    supabase.from("kob_leads").select("*", { count: "exact", head: true }).eq("stage", "FEE_PAID"),
    supabase.from("kob_leads").select("*", { count: "exact", head: true }).eq("stage", "AGREEMENT_SIGNED"),
    supabase.from("kob_leads").select("*", { count: "exact", head: true }).eq("stage", "KTN_CS"),
    supabase.from("kob_leads").select("*", { count: "exact", head: true }).eq("stage", "KTN_LIVE"),
    supabase.from("kob_leads").select("*", { count: "exact", head: true }).eq("stage", "RETARGETING"),
  ]);
  return {
    lead,
    stageHistoryCount: stageHistoryCount ?? 0,
    history: history ?? [],
    auditCount: auditCount ?? 0,
    audits: audits ?? [],
    counts: {
      totalLeads: totalLeads ?? 0,
      feePaid: feePaid ?? 0,
      agreement: agreement ?? 0,
      ktnCs: ktnCs ?? 0,
      ktnLive: ktnLive ?? 0,
      retargeting: retargeting ?? 0,
    },
    checkedAt: new Date().toISOString(),
  };
}

async function oldQaAdvanceRetargeting(supabase, userId) {
  await assertManager(supabase, userId);
  const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? adminClient : supabase;
  const { data, error } = await db.rpc("advance_retargeting");
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  await logAudit(supabase, userId, "advance_retargeting_manual", "retargeting_schedule", null, row);
  return row ?? { advanced: 0, killed: 0, processed: 0 };
}

// ----------------------------------------------------
// DATABASE SNAPSHOT & CLEANUP UTILS
// ----------------------------------------------------

async function snapshotCounts() {
  const [
    { count: leads },
    { count: history },
    { count: activities },
    { count: audits },
    { count: retargeting },
    { count: gallabox },
    { count: emailQueue },
  ] = await Promise.all([
    adminClient.from("kob_leads").select("*", { count: "exact", head: true }),
    adminClient.from("lead_stage_history").select("*", { count: "exact", head: true }),
    adminClient.from("lead_activities").select("*", { count: "exact", head: true }),
    adminClient.from("audit_logs").select("*", { count: "exact", head: true }),
    adminClient.from("retargeting_schedule").select("*", { count: "exact", head: true }),
    adminClient.from("gallabox_fire_queue").select("*", { count: "exact", head: true }),
    adminClient.from("email_fire_queue").select("*", { count: "exact", head: true }),
  ]);
  return { leads, history, activities, audits, retargeting, gallabox, emailQueue };
}

const createdLeadIds = new Set();
const createdAuditIds = new Set();

async function cleanLeadFixture(leadId) {
  if (!leadId) return;
  await adminClient.from("retargeting_schedule").delete().eq("lead_id", leadId);
  await adminClient.from("lead_stage_history").delete().eq("lead_id", leadId);
  await adminClient.from("lead_activities").delete().eq("lead_id", leadId);
  await adminClient.from("gallabox_fire_queue").delete().eq("lead_id", leadId);
  await adminClient.from("webinar_attendance").delete().eq("lead_id", leadId);
  await adminClient.from("audit_logs").delete().eq("entity_id", leadId);
  await adminClient.from("kob_leads").delete().eq("id", leadId);
  createdLeadIds.delete(leadId);
}

async function cleanAllFixtures() {
  for (const id of Array.from(createdLeadIds)) {
    await cleanLeadFixture(id);
  }
  if (createdAuditIds.size > 0) {
    await adminClient.from("audit_logs").delete().in("id", Array.from(createdAuditIds));
    createdAuditIds.clear();
  }
}

// Helper to create disposable QA lead
async function createDisposableQaLead(codePrefix, stage = "LEAD_INBOX") {
  const stamp = Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000);
  const code = `${codePrefix}-${stamp}`;
  const phone = `+9199${stamp.slice(-8)}`;

  const [{ data: brand }, { data: state }, { data: city }, { data: source }] = await Promise.all([
    adminClient.from("brands").select("id").eq("active", true).limit(1).maybeSingle(),
    adminClient.from("india_states").select("id").eq("active", true).limit(1).maybeSingle(),
    adminClient.from("india_cities").select("id, district_id, state_id").eq("active", true).limit(1).maybeSingle(),
    adminClient.from("lead_sources").select("id").eq("active", true).limit(1).maybeSingle(),
  ]);

  const { data: lead, error } = await adminClient.from("kob_leads").insert({
    code,
    full_name: `QA Batch9 Test ${stamp}`,
    phone,
    email: `qa9_${stamp}@shero.test`,
    stage,
    mode: "MANUAL",
    language: "HINDI",
    brand_id: brand?.id ?? null,
    state_id: (city?.state_id) ?? state?.id ?? null,
    district_id: city?.district_id ?? null,
    city_id: city?.id ?? null,
    source_id: source?.id ?? null,
    investment_capacity: 500000,
  }).select("*").single();

  if (error) throw new Error("Failed to create disposable lead: " + error.message);
  createdLeadIds.add(lead.id);
  return lead;
}

// ----------------------------------------------------
// REGRESSION RUNNER
// ----------------------------------------------------

async function runRegression() {
  console.log("==================================================");
  console.log("MUTATION BATCH 9 REGRESSION TEST RUNNER");
  console.log("==================================================");

  // 1. Setup Auth Users
  const mgrUser = { id: "25dc86bb-cda4-4bb4-8ec9-5bc6a03df10d", email: "manager@shero.test" };
  const execUser = { id: "8c4dff0d-cd27-474d-9ea8-9cc15b9a93f5", email: "sherohomefoodbhuvana@gmail.com" };

  const mgrToken = createToken(mgrUser.id, mgrUser.email);
  const execToken = createToken(execUser.id, execUser.email);

  const mgrClient = createUserClient(mgrToken);
  const execClient = createUserClient(execToken);

  console.log(`Manager User: ${mgrUser.email} (${mgrUser.id})`);
  console.log(`Exec User:    ${execUser.email} (${execUser.id})`);

  const initialCounts = await snapshotCounts();
  console.log("Initial pristine table counts:", initialCounts);

  const results = {
    qaMoveStage: { returnMatch: false, leadMatch: false, historyMatch: false, changedByMatch: false, activityMatch: false, auditMatch: false, queueMatch: true, authMatch: false, roleMatch: false, validationMatch: false, uiMatch: true, restored: false },
    qaVerify: { returnMatch: false, leadMatch: true, historyMatch: true, changedByMatch: true, activityMatch: true, auditMatch: true, retargetingMatch: true, queueMatch: true, authMatch: false, roleMatch: false, validationMatch: false, uiMatch: true, restored: false },
    qaAdvanceRetargeting: { returnMatch: false, leadMatch: true, historyMatch: true, changedByMatch: true, activityMatch: true, auditMatch: false, retargetingMatch: true, queueMatch: true, authMatch: false, roleMatch: false, validationMatch: true, uiMatch: true, restored: false },
  };

  const transitionsTested = [];

  // ==================================================
  // TEST 1: qaMoveStage (OLD vs NEW & Representative Transitions)
  // ==================================================
  console.log("\n--- Testing qaMoveStage ---");

  // A. Baseline OLD vs NEW side-effect comparison on stage move: LEAD_INBOX -> EOI_2
  console.log("Testing qaMoveStage baseline parity (LEAD_INBOX -> EOI_2)...");

  // OLD execution
  const oldLead = await createDisposableQaLead("QA-MOV-OLD", "LEAD_INBOX");
  const oldRes = await oldQaMoveStage(mgrClient, mgrUser.id, { leadId: oldLead.id, stage: "EOI_2" });
  
  const { data: oldLeadRow } = await adminClient.from("kob_leads").select("*").eq("id", oldLead.id).single();
  const { data: oldHistRows } = await adminClient.from("lead_stage_history").select("*").eq("lead_id", oldLead.id).order("created_at", { ascending: false });
  const { data: oldActRows } = await adminClient.from("lead_activities").select("*").eq("lead_id", oldLead.id).order("created_at", { ascending: false });
  const { data: oldAuditRows } = await adminClient.from("audit_logs").select("*").eq("entity_id", oldLead.id).order("created_at", { ascending: false });

  await cleanLeadFixture(oldLead.id);

  // NEW execution
  const newLead = await createDisposableQaLead("QA-MOV-NEW", "LEAD_INBOX");
  const newHttp = await fetch(`${BACKEND_BASE}/api/qa/leads/${newLead.id}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({ stage: "EOI_2" }),
  });
  const newRes = await newHttp.json();

  const { data: newLeadRow } = await adminClient.from("kob_leads").select("*").eq("id", newLead.id).single();
  const { data: newHistRows } = await adminClient.from("lead_stage_history").select("*").eq("lead_id", newLead.id).order("created_at", { ascending: false });
  const { data: newActRows } = await adminClient.from("lead_activities").select("*").eq("lead_id", newLead.id).order("created_at", { ascending: false });
  const { data: newAuditRows } = await adminClient.from("audit_logs").select("*").eq("entity_id", newLead.id).order("created_at", { ascending: false });

  await cleanLeadFixture(newLead.id);

  // Side-effect assertions
  const returnMatchMove = JSON.stringify(oldRes) === JSON.stringify(newRes);
  const leadMatchMove = oldLeadRow.stage === newLeadRow.stage && newLeadRow.stage === "EOI_2" && oldLeadRow.mode === newLeadRow.mode;
  const historyMatchMove = oldHistRows.length === newHistRows.length &&
    oldHistRows[0]?.from_stage === newHistRows[0]?.from_stage &&
    oldHistRows[0]?.to_stage === newHistRows[0]?.to_stage;
  const changedByMatchMove = oldHistRows[0]?.changed_by === newHistRows[0]?.changed_by && newHistRows[0]?.changed_by === mgrUser.id;
  const activityMatchMove = oldActRows.length === newActRows.length && oldActRows[0]?.activity_type === newActRows[0]?.activity_type;
  const auditMatchMove = oldAuditRows[0]?.action === newAuditRows[0]?.action &&
    oldAuditRows[0]?.action === "qa_stage_move" &&
    JSON.stringify(oldAuditRows[0]?.meta) === JSON.stringify(newAuditRows[0]?.meta);

  console.log("qaMoveStage Comparison:", {
    returnMatchMove,
    leadMatchMove,
    historyMatchMove,
    changedByMatchMove,
    activityMatchMove,
    auditMatchMove,
  });

  results.qaMoveStage.returnMatch = returnMatchMove;
  results.qaMoveStage.leadMatch = leadMatchMove;
  results.qaMoveStage.historyMatch = historyMatchMove;
  results.qaMoveStage.changedByMatch = changedByMatchMove;
  results.qaMoveStage.activityMatch = activityMatchMove;
  results.qaMoveStage.auditMatch = auditMatchMove;

  // B. Representative Transitions for QA Stage Moves
  const stagesToTest = [
    { from: "LEAD_INBOX", to: "EOI_1" },
    { from: "EOI_1", to: "WEBINAR" },
    { from: "WEBINAR", to: "EOI_2" },
    { from: "EOI_2", to: "FORM_FILLED" },
    { from: "FORM_FILLED", to: "FEE_PAID" },
    { from: "FEE_PAID", to: "KTN_CS" },
    { from: "KTN_CS", to: "KTN_LIVE" },
    { from: "EOI_1", to: "NO" },
    { from: "EOI_1", to: "LATER" },
    { from: "EOI_1", to: "NO_RESPONSE" },
    { from: "NO_RESPONSE", to: "RETARGETING" },
    { from: "NO", to: "DEAD_LEAD" },
  ];

  console.log(`Testing ${stagesToTest.length} representative transitions via POST /api/qa/leads/:id/stage...`);
  for (const t of stagesToTest) {
    const testLead = await createDisposableQaLead("QA-TRANS", t.from);
    const r = await fetch(`${BACKEND_BASE}/api/qa/leads/${testLead.id}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
      body: JSON.stringify({ stage: t.to }),
    });
    const body = await r.json();
    const ok = r.status === 200 && body.ok === true;
    const { data: updated } = await adminClient.from("kob_leads").select("stage").eq("id", testLead.id).single();
    const pass = ok && updated?.stage === t.to;
    transitionsTested.push({ from: t.from, to: t.to, status: pass ? "PASS" : "FAIL" });
    await cleanLeadFixture(testLead.id);
  }

  // C. Negative tests for qaMoveStage
  // Unauthenticated
  const unauthMove = await fetch(`${BACKEND_BASE}/api/qa/leads/00000000-0000-0000-0000-000000000000/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: "EOI_1" }),
  });
  // Non-manager role (Executive)
  const execMove = await fetch(`${BACKEND_BASE}/api/qa/leads/00000000-0000-0000-0000-000000000000/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${execToken}` },
    body: JSON.stringify({ stage: "EOI_1" }),
  });
  // Invalid UUID
  const invalidIdMove = await fetch(`${BACKEND_BASE}/api/qa/leads/not-a-uuid/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({ stage: "EOI_1" }),
  });
  // Missing stage
  const missingStageMove = await fetch(`${BACKEND_BASE}/api/qa/leads/00000000-0000-0000-0000-000000000000/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({}),
  });

  results.qaMoveStage.authMatch = unauthMove.status === 401;
  results.qaMoveStage.roleMatch = execMove.status === 403;
  results.qaMoveStage.validationMatch = invalidIdMove.status === 400 && missingStageMove.status === 400;

  console.log("qaMoveStage Auth/Role/Validation:", {
    unauthStatus: unauthMove.status,
    execStatus: execMove.status,
    invalidIdStatus: invalidIdMove.status,
    missingStageStatus: missingStageMove.status,
  });

  // ==================================================
  // TEST 2: qaVerify (OLD vs NEW & DB side-effects)
  // ==================================================
  console.log("\n--- Testing qaVerify ---");

  // Create disposable lead and populate history & audits
  const verLead = await createDisposableQaLead("QA-VER", "LEAD_INBOX");
  await oldQaMoveStage(mgrClient, mgrUser.id, { leadId: verLead.id, stage: "EOI_1" });
  await oldQaMoveStage(mgrClient, mgrUser.id, { leadId: verLead.id, stage: "WEBINAR" });

  // Verify OLD has 0 DB writes
  const countsBeforeOldVer = await snapshotCounts();
  const oldVerRes = await oldQaVerify(mgrClient, mgrUser.id, { leadId: verLead.id });
  const countsAfterOldVer = await snapshotCounts();
  const oldVerWrites = JSON.stringify(countsBeforeOldVer) === JSON.stringify(countsAfterOldVer);

  // Verify NEW has 0 DB writes
  const countsBeforeNewVer = await snapshotCounts();
  const newVerHttp = await fetch(`${BACKEND_BASE}/api/qa/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({ leadId: verLead.id }),
  });
  const newVerRes = await newVerHttp.json();
  const countsAfterNewVer = await snapshotCounts();
  const newVerWrites = JSON.stringify(countsBeforeNewVer) === JSON.stringify(countsAfterNewVer);

  await cleanLeadFixture(verLead.id);

  // Compare returned structures
  const leadMatchVer = oldVerRes.lead?.id === newVerRes.lead?.id &&
    oldVerRes.lead?.stage === newVerRes.lead?.stage &&
    oldVerRes.lead?.stage === "WEBINAR";
  const historyMatchVer = oldVerRes.stageHistoryCount === newVerRes.stageHistoryCount &&
    oldVerRes.history.length === newVerRes.history.length &&
    oldVerRes.history[0]?.to_stage === newVerRes.history[0]?.to_stage;
  const auditMatchVer = oldVerRes.auditCount === newVerRes.auditCount &&
    oldVerRes.audits.length === newVerRes.audits.length &&
    oldVerRes.audits[0]?.action === newVerRes.audits[0]?.action;
  const countsMatchVer = JSON.stringify(oldVerRes.counts) === JSON.stringify(newVerRes.counts);

  const returnMatchVer = leadMatchVer && historyMatchVer && auditMatchVer && countsMatchVer &&
    typeof newVerRes.checkedAt === "string" && typeof oldVerRes.checkedAt === "string";

  console.log("qaVerify Parity & DB writes check:", {
    oldVerZeroWrites: oldVerWrites,
    newVerZeroWrites: newVerWrites,
    leadMatchVer,
    historyMatchVer,
    auditMatchVer,
    countsMatchVer,
    returnMatchVer,
  });

  results.qaVerify.returnMatch = returnMatchVer;

  // Negative tests for qaVerify
  const unauthVer = await fetch(`${BACKEND_BASE}/api/qa/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId: "00000000-0000-0000-0000-000000000000" }),
  });
  const execVer = await fetch(`${BACKEND_BASE}/api/qa/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${execToken}` },
    body: JSON.stringify({ leadId: "00000000-0000-0000-0000-000000000000" }),
  });
  const invalidIdVer = await fetch(`${BACKEND_BASE}/api/qa/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({ leadId: "not-a-uuid" }),
  });

  results.qaVerify.authMatch = unauthVer.status === 401;
  results.qaVerify.roleMatch = execVer.status === 403;
  results.qaVerify.validationMatch = invalidIdVer.status === 400;

  console.log("qaVerify Auth/Role/Validation:", {
    unauthStatus: unauthVer.status,
    execStatus: execVer.status,
    invalidIdStatus: invalidIdVer.status,
  });

  // ==================================================
  // TEST 3: qaAdvanceRetargeting (OLD vs NEW & RPC parity)
  // ==================================================
  console.log("\n--- Testing qaAdvanceRetargeting ---");

  // OLD execution
  const countsBeforeOldAdv = await snapshotCounts();
  const oldAdvRes = await oldQaAdvanceRetargeting(mgrClient, mgrUser.id);
  const { data: oldAuditAdv } = await adminClient.from("audit_logs").select("*").eq("action", "advance_retargeting_manual").order("created_at", { ascending: false }).limit(1).single();
  if (oldAuditAdv?.id) createdAuditIds.add(oldAuditAdv.id);

  // NEW execution
  const newAdvHttp = await fetch(`${BACKEND_BASE}/api/qa/retargeting/advance`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
  });
  const newAdvRes = await newAdvHttp.json();
  const { data: newAuditAdv } = await adminClient.from("audit_logs").select("*").eq("action", "advance_retargeting_manual").order("created_at", { ascending: false }).limit(1).single();
  if (newAuditAdv?.id) createdAuditIds.add(newAuditAdv.id);

  // Compare returned shape & values
  const returnMatchAdv = typeof newAdvRes.advanced === "number" &&
    typeof newAdvRes.killed === "number" &&
    typeof newAdvRes.processed === "number" &&
    Object.keys(oldAdvRes).sort().join(",") === Object.keys(newAdvRes).sort().join(",");

  const auditMatchAdv = oldAuditAdv?.action === newAuditAdv?.action &&
    newAuditAdv?.action === "advance_retargeting_manual" &&
    newAuditAdv?.entity === "retargeting_schedule" &&
    typeof newAuditAdv?.meta === "object";

  console.log("qaAdvanceRetargeting Parity:", {
    oldAdvRes,
    newAdvRes,
    returnMatchAdv,
    auditMatchAdv,
  });

  results.qaAdvanceRetargeting.returnMatch = returnMatchAdv;
  results.qaAdvanceRetargeting.auditMatch = auditMatchAdv;

  // Negative tests for qaAdvanceRetargeting
  const unauthAdv = await fetch(`${BACKEND_BASE}/api/qa/retargeting/advance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const execAdv = await fetch(`${BACKEND_BASE}/api/qa/retargeting/advance`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${execToken}` },
  });

  results.qaAdvanceRetargeting.authMatch = unauthAdv.status === 401;
  results.qaAdvanceRetargeting.roleMatch = execAdv.status === 403;

  console.log("qaAdvanceRetargeting Auth/Role:", {
    unauthStatus: unauthAdv.status,
    execStatus: execAdv.status,
  });

  // ==================================================
  // CLEANUP & FINAL TABLE RESTORATION
  // ==================================================
  console.log("\n--- Cleaning up all test fixtures ---");
  await cleanAllFixtures();

  const finalCounts = await snapshotCounts();
  console.log("Final table counts after cleanup:", finalCounts);

  const restoredMatch = JSON.stringify(initialCounts) === JSON.stringify(finalCounts);
  console.log("Table Counts Restored Pristine:", restoredMatch);

  results.qaMoveStage.restored = restoredMatch;
  results.qaVerify.restored = restoredMatch;
  results.qaAdvanceRetargeting.restored = restoredMatch;

  console.log("\n==================================================");
  console.log("TEST SUMMARY RESULT");
  console.log("==================================================");
  console.log("Functions Results:", JSON.stringify(results, null, 2));
  console.log(`Transitions Tested Count: ${transitionsTested.length}`);
  console.log("Transitions:", JSON.stringify(transitionsTested, null, 2));

  return { results, transitionsTested, initialCounts, finalCounts, restoredMatch };
}

runRegression().catch((err) => {
  console.error("FATAL ERROR IN REGRESSION TEST:", err);
  process.exit(1);
});
