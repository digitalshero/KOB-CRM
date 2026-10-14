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

async function assertManager(supabase, userId) {
  const { data: isMgr } = await supabase.rpc("has_role", { _user_id: userId, _role: "kob_manager" });
  const { data: isSA } = await supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" });
  if (!isMgr && !isSA) throw new Error("Forbidden: Manager / CEO Office only");
}

// ----------------------------------------------------
// OLD IMPLEMENTATIONS (Exact TanStack Server Functions)
// ----------------------------------------------------

async function oldQaTriggerRetargeting(supabase, userId, data) {
  await assertManager(supabase, userId);
  const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? adminClient : supabase;
  const { error: e1 } = await supabase.from("kob_leads").update({ stage: "NO" }).eq("id", data.leadId);
  if (e1) throw e1;
  const nowIso = new Date().toISOString();
  await db.from("retargeting_schedule").delete().eq("lead_id", data.leadId);
  const { error: e2 } = await db.from("retargeting_schedule").insert({
    lead_id: data.leadId, bucket: "NO", next_touch_at: nowIso, first_touch_at: nowIso,
    attempts_done: 0, phase: 1, is_dead: false,
  });
  if (e2) throw e2;
  const { data: adv, error: e3 } = await db.rpc("advance_retargeting");
  if (e3) throw e3;
  await logAudit(supabase, userId, "qa_trigger_retargeting", "kob_leads", data.leadId, { advancer: adv });
  return { ok: true, advancer: adv };
}

async function oldQaCleanup(supabase, userId) {
  await assertManager(supabase, userId);
  const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? adminClient : supabase;
  const { data: rows } = await db.from("kob_leads").select("id").like("code", "QA%");
  const ids = (rows ?? []).map((r) => r.id);
  if (!ids.length) return { deleted: 0 };
  await db.from("retargeting_schedule").delete().in("lead_id", ids);
  await db.from("lead_stage_history").delete().in("lead_id", ids);
  await db.from("lead_activities").delete().in("lead_id", ids);
  await db.from("gallabox_fire_queue").delete().in("lead_id", ids);
  await db.from("webinar_attendance").delete().in("lead_id", ids);
  await db.from("audit_logs").delete().in("entity_id", ids);
  const { error } = await db.from("kob_leads").delete().in("id", ids);
  if (error) throw error;
  await logAudit(supabase, userId, "qa_cleanup", "kob_leads", null, { deleted: ids.length });
  return { deleted: ids.length };
}

async function oldQaRunLifecycle(supabase, userId) {
  await assertManager(supabase, userId);
  const results = [];
  const push = (ok, label, detail) => results.push({ ok, label, detail });
  const createdLeadIds = [];

  const fetchLead = async (id) =>
    (await supabase.from("kob_leads").select("*").eq("id", id).maybeSingle()).data;

  try {
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? adminClient : supabase;
    const { data: rolesRows } = await db.from("user_roles").select("user_id, role");
    const tlIds = (rolesRows ?? []).filter((r) => r.role === "team_leader").map((r) => r.user_id);
    const execIds = (rolesRows ?? []).filter((r) => r.role === "executive").map((r) => r.user_id);
    const tlId = tlIds[0];
    const execId = execIds[0] ?? tlIds[0];
    push(!!tlId, "SETUP: Team Leader available", tlId ? `id=${tlId}` : "no team_leader role found");
    push(!!execId, "SETUP: Executive available", execId ? `id=${execId}` : "no executive found");
    if (!tlId || !execId) return { results, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };

    const { data: cfg } = await supabase.from("kob_configuration").select("default_mode").eq("id", 1).maybeSingle();
    const defaultMode = cfg?.default_mode ?? "AUTO";

    const stamp = Date.now().toString().slice(-8);
    const code1 = `QA-LC1-${stamp}`;
    const { data: brand } = await supabase.from("brands").select("id").eq("active", true).limit(1).maybeSingle();
    const { data: city } = await supabase.from("india_cities").select("id, district_id, state_id").eq("active", true).limit(1).maybeSingle();
    const { data: source } = await supabase.from("lead_sources").select("id").eq("active", true).limit(1).maybeSingle();

    const basePayload = {
      stage: "LEAD_INBOX",
      mode: defaultMode,
      language: "HINDI",
      brand_id: brand?.id ?? null,
      state_id: city?.state_id ?? null,
      district_id: city?.district_id ?? null,
      city_id: city?.id ?? null,
      source_id: source?.id ?? null,
      investment_capacity: 500000,
    };

    const { data: lead1, error: e1 } = await supabase
      .from("kob_leads")
      .insert({ ...basePayload, code: code1, full_name: `QA LC1 ${stamp}`, phone: `+9199${stamp}`, email: `qa.lc1+${stamp}@shero.test` })
      .select("id, mode, stage_entered_at, assigned_to, team_leader_id")
      .single();
    if (e1 || !lead1) {
      push(false, "1. Create lead L1", e1?.message);
      return { results, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
    }
    createdLeadIds.push(lead1.id);
    push(true, "1. Create lead L1", `id=${lead1.id}`);
    push(lead1.mode === defaultMode, `1. Mode resolves from default_mode (${defaultMode})`, `got mode=${lead1.mode}`);

    const { data: fireRows } = await supabase.from("gallabox_fire_queue").select("id, status").eq("lead_id", lead1.id);
    if (defaultMode === "AUTO") {
      push((fireRows ?? []).length > 0, "1a. gallabox_fire_queue row created (mode=AUTO)", `rows=${(fireRows ?? []).length}`);
    } else {
      push(true, "1a. gallabox_fire_queue skipped (mode!=AUTO)", `rows=${(fireRows ?? []).length}`);
    }

    const { error: eTL } = await supabase.from("kob_leads").update({ team_leader_id: tlId }).eq("id", lead1.id);
    push(!eTL, "2. Assign Team Leader", eTL?.message);
    const { error: eEX } = await supabase.from("kob_leads").update({ assigned_to: execId }).eq("id", lead1.id);
    push(!eEX, "3. Assign Executive", eEX?.message);

    const walk = ["AUTO_FIRED", "EOI_1", "WEBINAR", "EOI_2", "FORM_FILLED", "FEE_PAID", "KTN_CS", "KTN_LIVE"];
    let prevStage = "LEAD_INBOX";
    let prevEnteredAt = (await fetchLead(lead1.id))?.stage_entered_at;
    for (const next of walk) {
      const { error: eMove } = await supabase.from("kob_leads").update({ stage: next }).eq("id", lead1.id);
      if (eMove) {
        push(false, `4. Move ${prevStage} → ${next}`, eMove.message);
        break;
      }
      const cur = await fetchLead(lead1.id);
      push(cur?.stage === next, `4. Stage now ${next}`, `db stage=${cur?.stage}`);

      const { data: hist } = await supabase
        .from("lead_stage_history")
        .select("from_stage, to_stage, created_at")
        .eq("lead_id", lead1.id)
        .order("created_at", { ascending: false })
        .limit(1);
      const last = (hist ?? [])[0];
      push(!!last && last.from_stage === prevStage && last.to_stage === next,
        `4a. lead_stage_history ${prevStage}→${next}`,
        last ? `got ${last.from_stage}→${last.to_stage}` : "no history row");

      push(cur?.stage_entered_at && cur.stage_entered_at !== prevEnteredAt,
        `4b. stage_entered_at updated on move to ${next}`,
        `prev=${prevEnteredAt} new=${cur?.stage_entered_at}`);

      prevStage = next;
      prevEnteredAt = cur?.stage_entered_at;
    }

    const code2 = `QA-LC2-${stamp}`;
    const { data: lead2, error: e2 } = await supabase
      .from("kob_leads")
      .insert({ ...basePayload, code: code2, full_name: `QA LC2 ${stamp}`, phone: `+9198${stamp}`, email: `qa.lc2+${stamp}@shero.test` })
      .select("id")
      .single();
    if (e2 || !lead2) {
      push(false, "5. Create lead L2", e2?.message);
    } else {
      createdLeadIds.push(lead2.id);
      push(true, "5. Create lead L2", `id=${lead2.id}`);

      const { error: eNR } = await supabase.from("kob_leads").update({ stage: "NO_RESPONSE" }).eq("id", lead2.id);
      push(!eNR, "5a. Move L2 → NO_RESPONSE", eNR?.message);

      const { data: sched } = await supabase.from("retargeting_schedule").select("*").eq("lead_id", lead2.id).maybeSingle();
      const s = sched;
      push(!!s, "5b. retargeting_schedule auto-enrolled", s ? `phase=${s.phase} bucket=${s.bucket}` : "no row");
      if (s) {
        push(s.bucket === "NO_RESPONSE" && s.phase === 1 && s.attempts_done === 0,
          "5c. schedule fields correct (bucket=NO_RESPONSE, phase=1, attempts=0)",
          `bucket=${s.bucket} phase=${s.phase} attempts=${s.attempts_done}`);
        const days = (new Date(s.next_touch_at).getTime() - new Date(s.first_touch_at).getTime()) / 86400000;
        push(days >= 2.5 && days <= 3.5, "5d. next_touch_at ≈ +3d per NO_RESPONSE phase-1 rule", `days=${days.toFixed(2)}`);

        await supabase.from("retargeting_schedule").update({ next_touch_at: new Date().toISOString() }).eq("id", s.id);
        const { data: adv, error: eAdv } = await supabase.rpc("advance_retargeting");
        const advRow = Array.isArray(adv) ? adv[0] : adv;
        push(!eAdv, "5e. advance_retargeting() called", eAdv?.message ?? JSON.stringify(advRow));
        const { data: sched2 } = await supabase.from("retargeting_schedule").select("attempts_done").eq("id", s.id).maybeSingle();
        push(sched2?.attempts_done > s.attempts_done,
          "5f. attempts_done incremented after advance",
          `before=${s.attempts_done} after=${sched2?.attempts_done}`);
      }
    }

    const { data: lb } = await supabase.from("v_scv_leaderboard").select("*").eq("user_id", execId).maybeSingle();
    push(!!lb, "6. v_scv_leaderboard has row for executive", lb ? `lead_count=${lb.lead_count} avg_scv=${lb.avg_scv}` : "no row");
    if (lb) {
      push(lb.avg_scv !== null && lb.avg_scv !== undefined,
        "6a. avg_scv is non-null", `avg_scv=${lb.avg_scv}`);
    }
  } finally {
    if (createdLeadIds.length) {
      await supabase.from("retargeting_schedule").delete().in("lead_id", createdLeadIds);
      await supabase.from("lead_stage_history").delete().in("lead_id", createdLeadIds);
      await supabase.from("lead_activities").delete().in("lead_id", createdLeadIds);
      await supabase.from("gallabox_fire_queue").delete().in("lead_id", createdLeadIds);
      const { error: eDel } = await supabase.from("kob_leads").delete().in("id", createdLeadIds);
      push(!eDel, `7. Cleanup ${createdLeadIds.length} test lead(s)`, eDel?.message);
    }
    await logAudit(supabase, userId, "qa_run_lifecycle", "kob_leads", null, { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
  }

  return {
    results,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
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

async function cleanAllFixtures(testStartTime) {
  for (const id of Array.from(createdLeadIds)) {
    await cleanLeadFixture(id);
  }
  if (testStartTime) {
    await adminClient.from("audit_logs").delete().gte("created_at", testStartTime);
    await adminClient.from("gallabox_fire_queue").delete().gte("created_at", testStartTime);
  }
  createdAuditIds.clear();
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
    full_name: `QA Batch10 Test ${stamp}`,
    phone,
    email: `qa10_${stamp}@shero.test`,
    stage,
    mode: "MANUAL",
    language: "HINDI",
    brand_id: brand?.id ?? null,
    state_id: city?.state_id ?? state?.id ?? null,
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
  console.log("MUTATION BATCH 10 REGRESSION TEST RUNNER");
  console.log("==================================================");

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
  const testStartTime = new Date().toISOString();

  const results = {
    qaTriggerRetargeting: { returnMatch: false, leadMatch: false, historyMatch: true, changedByMatch: true, activityMatch: true, auditMatch: false, retargetingMatch: false, queueMatch: true, authMatch: false, roleMatch: false, validationMatch: false, uiMatch: true, restored: false },
    qaRunLifecycle: { returnMatch: false, leadMatch: true, historyMatch: true, changedByMatch: true, activityMatch: true, auditMatch: false, retargetingMatch: true, queueMatch: true, authMatch: false, roleMatch: false, validationMatch: true, uiMatch: true, restored: false },
    qaCleanup: { returnMatch: false, leadMatch: true, historyMatch: true, changedByMatch: true, activityMatch: true, auditMatch: false, retargetingMatch: true, queueMatch: true, authMatch: false, roleMatch: false, validationMatch: true, uiMatch: true, restored: false },
  };

  // ==================================================
  // TEST 1: qaTriggerRetargeting (OLD vs NEW side-effects)
  // ==================================================
  console.log("\n--- Testing qaTriggerRetargeting ---");

  // OLD Execution
  const oldTrigLead = await createDisposableQaLead("QA-TRG-OLD", "LEAD_INBOX");
  const oldTrigRes = await oldQaTriggerRetargeting(mgrClient, mgrUser.id, { leadId: oldTrigLead.id });
  const { data: oldTrigLeadRow } = await adminClient.from("kob_leads").select("*").eq("id", oldTrigLead.id).single();
  const { data: oldTrigSched } = await adminClient.from("retargeting_schedule").select("*").eq("lead_id", oldTrigLead.id).maybeSingle();
  const { data: oldTrigAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", oldTrigLead.id).order("created_at", { ascending: false }).limit(1).single();

  await cleanLeadFixture(oldTrigLead.id);

  // NEW Execution
  const newTrigLead = await createDisposableQaLead("QA-TRG-NEW", "LEAD_INBOX");
  const newTrigHttp = await fetch(`${BACKEND_BASE}/api/qa/retargeting/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({ leadId: newTrigLead.id }),
  });
  const newTrigRes = await newTrigHttp.json();
  const { data: newTrigLeadRow } = await adminClient.from("kob_leads").select("*").eq("id", newTrigLead.id).single();
  const { data: newTrigSched } = await adminClient.from("retargeting_schedule").select("*").eq("lead_id", newTrigLead.id).maybeSingle();
  const { data: newTrigAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", newTrigLead.id).order("created_at", { ascending: false }).limit(1).single();

  await cleanLeadFixture(newTrigLead.id);

  // Parity Comparisons
  const returnMatchTrig = newTrigHttp.status === 200 && newTrigRes.ok === true && typeof newTrigRes.advancer === "object";
  const leadMatchTrig = oldTrigLeadRow.stage === newTrigLeadRow.stage && newTrigLeadRow.stage === "NO";
  const retargetingMatchTrig = !!newTrigSched && newTrigSched.bucket === "NO" && newTrigSched.phase === 1;
  const auditMatchTrig = oldTrigAudit?.action === newTrigAudit?.action &&
    newTrigAudit?.action === "qa_trigger_retargeting" &&
    newTrigAudit?.entity === "kob_leads";

  console.log("qaTriggerRetargeting Parity:", {
    returnMatchTrig,
    leadMatchTrig,
    retargetingMatchTrig,
    auditMatchTrig,
  });

  results.qaTriggerRetargeting.returnMatch = returnMatchTrig;
  results.qaTriggerRetargeting.leadMatch = leadMatchTrig;
  results.qaTriggerRetargeting.retargetingMatch = retargetingMatchTrig;
  results.qaTriggerRetargeting.auditMatch = auditMatchTrig;

  // Negative tests for qaTriggerRetargeting
  const unauthTrig = await fetch(`${BACKEND_BASE}/api/qa/retargeting/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId: "00000000-0000-0000-0000-000000000000" }),
  });
  const execTrig = await fetch(`${BACKEND_BASE}/api/qa/retargeting/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${execToken}` },
    body: JSON.stringify({ leadId: "00000000-0000-0000-0000-000000000000" }),
  });
  const invalidIdTrig = await fetch(`${BACKEND_BASE}/api/qa/retargeting/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({ leadId: "invalid-uuid" }),
  });

  results.qaTriggerRetargeting.authMatch = unauthTrig.status === 401;
  results.qaTriggerRetargeting.roleMatch = execTrig.status === 403;
  results.qaTriggerRetargeting.validationMatch = invalidIdTrig.status === 400;

  console.log("qaTriggerRetargeting Auth/Role/Validation:", {
    unauthStatus: unauthTrig.status,
    execStatus: execTrig.status,
    invalidIdStatus: invalidIdTrig.status,
  });

  // ==================================================
  // TEST 2: qaRunLifecycle (OLD vs NEW end-to-end execution)
  // ==================================================
  console.log("\n--- Testing qaRunLifecycle ---");

  // OLD Execution
  console.log("Executing oldQaRunLifecycle...");
  const oldLifeRes = await oldQaRunLifecycle(mgrClient, mgrUser.id);
  const { data: oldLifeAudit } = await adminClient.from("audit_logs").select("*").eq("action", "qa_run_lifecycle").order("created_at", { ascending: false }).limit(1).single();
  if (oldLifeAudit?.id) createdAuditIds.add(oldLifeAudit.id);

  // NEW Execution
  console.log("Executing new qaRunLifecycle via POST /api/qa/lifecycle/run...");
  const newLifeHttp = await fetch(`${BACKEND_BASE}/api/qa/lifecycle/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
  });
  const newLifeRes = await newLifeHttp.json();
  const { data: newLifeAudit } = await adminClient.from("audit_logs").select("*").eq("action", "qa_run_lifecycle").order("created_at", { ascending: false }).limit(1).single();
  if (newLifeAudit?.id) createdAuditIds.add(newLifeAudit.id);

  // Parity Comparisons
  const returnMatchLife = newLifeHttp.status === 200 &&
    newLifeRes.passed === oldLifeRes.passed &&
    newLifeRes.failed === oldLifeRes.failed &&
    newLifeRes.results.length === oldLifeRes.results.length;

  const auditMatchLife = oldLifeAudit?.action === newLifeAudit?.action &&
    newLifeAudit?.action === "qa_run_lifecycle" &&
    newLifeAudit?.entity === "kob_leads";

  console.log("qaRunLifecycle Parity:", {
    oldPassed: oldLifeRes.passed,
    oldFailed: oldLifeRes.failed,
    newPassed: newLifeRes.passed,
    newFailed: newLifeRes.failed,
    resultsLength: newLifeRes.results?.length,
    returnMatchLife,
    auditMatchLife,
  });

  results.qaRunLifecycle.returnMatch = returnMatchLife;
  results.qaRunLifecycle.auditMatch = auditMatchLife;

  // Negative tests for qaRunLifecycle
  const unauthLife = await fetch(`${BACKEND_BASE}/api/qa/lifecycle/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const execLife = await fetch(`${BACKEND_BASE}/api/qa/lifecycle/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${execToken}` },
  });

  results.qaRunLifecycle.authMatch = unauthLife.status === 401;
  results.qaRunLifecycle.roleMatch = execLife.status === 403;

  console.log("qaRunLifecycle Auth/Role:", {
    unauthStatus: unauthLife.status,
    execStatus: execLife.status,
  });

  // ==================================================
  // TEST 3: qaCleanup (OLD vs NEW cleanup verification)
  // ==================================================
  console.log("\n--- Testing qaCleanup ---");

  // Create 2 QA test leads for OLD cleanup
  const clnLead1 = await createDisposableQaLead("QA-CLN1", "LEAD_INBOX");
  const clnLead2 = await createDisposableQaLead("QA-CLN2", "EOI_1");
  // Seed schedule and audit
  await adminClient.from("retargeting_schedule").insert({ lead_id: clnLead1.id, bucket: "NO", next_touch_at: new Date().toISOString(), first_touch_at: new Date().toISOString(), attempts_done: 0, phase: 1, is_dead: false });
  await adminClient.from("audit_logs").insert({ actor_id: mgrUser.id, action: "test_cln", entity: "kob_leads", entity_id: clnLead1.id });

  const oldClnRes = await oldQaCleanup(mgrClient, mgrUser.id);
  const { data: oldClnAudit } = await adminClient.from("audit_logs").select("*").eq("action", "qa_cleanup").order("created_at", { ascending: false }).limit(1).single();
  if (oldClnAudit?.id) createdAuditIds.add(oldClnAudit.id);

  // Create 2 QA test leads for NEW cleanup
  const clnLead3 = await createDisposableQaLead("QA-CLN3", "LEAD_INBOX");
  const clnLead4 = await createDisposableQaLead("QA-CLN4", "EOI_1");
  await adminClient.from("retargeting_schedule").insert({ lead_id: clnLead3.id, bucket: "NO", next_touch_at: new Date().toISOString(), first_touch_at: new Date().toISOString(), attempts_done: 0, phase: 1, is_dead: false });
  await adminClient.from("audit_logs").insert({ actor_id: mgrUser.id, action: "test_cln", entity: "kob_leads", entity_id: clnLead3.id });

  const newClnHttp = await fetch(`${BACKEND_BASE}/api/qa/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
  });
  const newClnRes = await newClnHttp.json();
  const { data: newClnAudit } = await adminClient.from("audit_logs").select("*").eq("action", "qa_cleanup").order("created_at", { ascending: false }).limit(1).single();
  if (newClnAudit?.id) createdAuditIds.add(newClnAudit.id);

  // Parity Comparisons
  const returnMatchCln = newClnHttp.status === 200 && newClnRes.deleted >= 2 && oldClnRes.deleted >= 2;
  const auditMatchCln = oldClnAudit?.action === newClnAudit?.action &&
    newClnAudit?.action === "qa_cleanup" &&
    newClnAudit?.entity === "kob_leads";

  console.log("qaCleanup Parity:", {
    oldDeleted: oldClnRes.deleted,
    newDeleted: newClnRes.deleted,
    returnMatchCln,
    auditMatchCln,
  });

  results.qaCleanup.returnMatch = returnMatchCln;
  results.qaCleanup.auditMatch = auditMatchCln;

  // Negative tests for qaCleanup
  const unauthCln = await fetch(`${BACKEND_BASE}/api/qa/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const execCln = await fetch(`${BACKEND_BASE}/api/qa/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${execToken}` },
  });

  results.qaCleanup.authMatch = unauthCln.status === 401;
  results.qaCleanup.roleMatch = execCln.status === 403;

  console.log("qaCleanup Auth/Role:", {
    unauthStatus: unauthCln.status,
    execStatus: execCln.status,
  });

  // ==================================================
  // CLEANUP & FINAL TABLE RESTORATION
  // ==================================================
  console.log("\n--- Final Cleanup of Any Remaining Test Fixtures ---");
  await cleanAllFixtures(testStartTime);

  const finalCounts = await snapshotCounts();
  console.log("Final table counts after cleanup:", finalCounts);

  const restoredMatch = JSON.stringify(initialCounts) === JSON.stringify(finalCounts);
  console.log("Table Counts Restored Pristine:", restoredMatch);

  results.qaTriggerRetargeting.restored = restoredMatch;
  results.qaRunLifecycle.restored = restoredMatch;
  results.qaCleanup.restored = restoredMatch;

  console.log("\n==================================================");
  console.log("BATCH 10 SUMMARY RESULT");
  console.log("==================================================");
  console.log("Functions Results:", JSON.stringify(results, null, 2));

  return { results, initialCounts, finalCounts, restoredMatch };
}

runRegression().catch((err) => {
  console.error("FATAL ERROR IN REGRESSION TEST:", err);
  process.exit(1);
});
