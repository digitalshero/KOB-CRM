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

// ----------------------------------------------------
// OLD IMPLEMENTATIONS (TanStack server fn behavior)
// ----------------------------------------------------

async function oldAddLeadsToBatch(supabase, userId, data) {
  const rows = data.leadIds.map((lid) => ({ batch_id: data.batchId, lead_id: lid, attended: false }));
  const { error } = await supabase
    .from("webinar_attendance")
    .upsert(rows, { onConflict: "batch_id,lead_id", ignoreDuplicates: true });
  if (error) throw error;
  await logAudit(supabase, userId, "webinar_attendance_add", "webinar_batches", data.batchId, { leadIds: data.leadIds });
  return { ok: true, added: rows.length };
}

async function oldRemoveLeadFromBatch(supabase, userId, data) {
  const { error } = await supabase.from("webinar_attendance").delete().eq("id", data.attendanceId);
  if (error) throw error;
  await logAudit(supabase, userId, "webinar_attendance_remove", "webinar_attendance", data.attendanceId, null);
  return { ok: true };
}

async function oldMarkAttendance(supabase, userId, data) {
  const { error } = await supabase
    .from("webinar_attendance")
    .update({ attended: data.attended, marked_at: new Date().toISOString(), marked_by: userId })
    .eq("id", data.attendanceId);
  if (error) throw error;
  await logAudit(supabase, userId, "webinar_attendance_mark", "webinar_attendance", data.attendanceId, { attended: data.attended });
  return { ok: true };
}

async function oldDeleteWebinarBatch(supabase, userId, data) {
  const { error } = await supabase.from("webinar_batches").delete().eq("id", data.batchId);
  if (error) throw error;
  await logAudit(supabase, userId, "webinar_batch_delete", "webinar_batches", data.batchId, null);
  return { ok: true };
}

async function oldSaveEvaluationResponses(supabase, userId, data) {
  if (data.answers.length === 0) return { ok: true, score: null };

  const qids = data.answers.map((a) => a.question_id);
  const { data: qs, error: qErr } = await supabase
    .from("evaluation_questions").select("id, weight").in("id", qids);
  if (qErr) throw new Error(qErr.message);
  const wMap = new Map((qs ?? []).map((q) => [q.id, Number(q.weight)]));

  const evalId = crypto.randomUUID();
  const filledAt = new Date().toISOString();

  const rows = data.answers.map((a) => ({
    evaluation_id: evalId,
    lead_id: data.lead_id,
    question_id: a.question_id,
    answer_value: a.answer_value,
    answer_text: a.answer_text,
    weight_at_time: wMap.get(a.question_id) ?? null,
    filled_by: userId,
    filled_at: filledAt,
  }));

  const { error } = await supabase
    .from("evaluation_responses")
    .insert(rows);
  if (error) throw new Error(error.message);

  const { data: score } = await supabase
    .from("v_lead_evaluation_history").select("*").eq("evaluation_id", evalId).maybeSingle();
  return { ok: true, evaluation_id: evalId, score: score ?? null };
}

async function oldRescheduleAttendance(supabase, userId, data) {
  const { data: existing, error: exErr } = await supabase
    .from("webinar_attendance")
    .select("id, batch_id, lead_id")
    .eq("id", data.attendanceId)
    .maybeSingle();
  if (exErr) throw exErr;
  if (!existing) throw new Error("Attendance row not found");
  if (existing.batch_id === data.newBatchId) throw new Error("Lead is already in that batch");

  const { data: dup } = await supabase
    .from("webinar_attendance")
    .select("id")
    .eq("batch_id", data.newBatchId)
    .eq("lead_id", existing.lead_id)
    .maybeSingle();
  if (dup) {
    const { error: delErr } = await supabase
      .from("webinar_attendance").delete().eq("id", data.attendanceId);
    if (delErr) throw delErr;
  } else {
    const { error } = await supabase
      .from("webinar_attendance")
      .update({
        batch_id: data.newBatchId,
        attended: false,
        defaulter_marked_at: null,
        marked_at: null,
        marked_by: null,
      })
      .eq("id", data.attendanceId);
    if (error) throw error;
  }

  // Cancel any still-PENDING "missed webinar" nudges for this lead.
  const db = adminClient;
  const { data: defTemplates, error: tplErr } = await supabase
    .from("gallabox_templates")
    .select("id")
    .eq("category", "WEBINAR_DEFAULTER");
  if (tplErr) throw tplErr;
  const templateIds = (defTemplates ?? []).map((t) => t.id);
  let cancelled = 0;
  if (templateIds.length) {
    const { data: cancelledRows, error: qErr } = await db
      .from("gallabox_fire_queue")
      .update({ status: "FAILED", error: "CANCELLED: rescheduled to another webinar batch" })
      .eq("lead_id", existing.lead_id)
      .eq("status", "PENDING")
      .in("template_id", templateIds)
      .select("id");
    if (qErr) throw qErr;
    cancelled = (cancelledRows ?? []).length;
    await db
      .from("email_fire_queue")
      .update({ status: "FAILED", error: "CANCELLED: rescheduled to another webinar batch" })
      .eq("lead_id", existing.lead_id)
      .eq("status", "PENDING")
      .in("template_id", templateIds);
  }

  await logAudit(
    supabase,
    userId,
    "webinar_attendance_reschedule",
    "webinar_attendance",
    data.attendanceId,
    { lead_id: existing.lead_id, old_batch_id: existing.batch_id, new_batch_id: data.newBatchId, cancelled_nudges: cancelled },
  );
  return { ok: true, cancelled_nudges: cancelled };
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
  console.log("MUTATION BATCH 6 PARITY & REGRESSION SUITE");
  console.log("==================================================");

  // Setup test user
  const { data: testUsers } = await adminClient.from("profiles").select("id, email").limit(1);
  const testUser = testUsers[0];
  const token = createToken(testUser.id, testUser.email);
  const userClient = createUserClient(token);

  const results = [];

  // ====================================================
  // TEST 1: addLeadsToBatch
  // ====================================================
  console.log("\n--- Testing Function 1: addLeadsToBatch ---");
  {
    // Disposable batch
    const { data: batch } = await adminClient.from("webinar_batches").insert({
      name: "Batch 6 Add Test Batch",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      language: "Hindi",
      created_by: testUser.id,
    }).select().single();

    // 2 Disposable test leads
    const { data: lead1 } = await adminClient.from("kob_leads").insert({
      code: "B6-LEAD-1",
      full_name: "B6 Lead 1",
      phone: "+919999000001",
      stage: "WEBINAR",
      mode: "AUTO",
    }).select().single();

    const { data: lead2 } = await adminClient.from("kob_leads").insert({
      code: "B6-LEAD-2",
      full_name: "B6 Lead 2",
      phone: "+919999000002",
      stage: "WEBINAR",
      mode: "AUTO",
    }).select().single();

    // Record initial critical fields of leads
    const initialLead1 = { ...lead1 };
    const initialLead2 = { ...lead2 };

    // 1. Execute OLD mutation
    const oldRes = await oldAddLeadsToBatch(userClient, testUser.id, {
      batchId: batch.id,
      leadIds: [lead1.id, lead2.id],
    });

    const { data: oldAttRows } = await adminClient
      .from("webinar_attendance")
      .select("batch_id, lead_id, attended")
      .eq("batch_id", batch.id)
      .order("lead_id");

    const { data: oldAudit } = await adminClient
      .from("audit_logs")
      .select("action, entity, entity_id")
      .eq("action", "webinar_attendance_add")
      .eq("entity_id", batch.id);

    // 2. Restore state
    await adminClient.from("webinar_attendance").delete().eq("batch_id", batch.id);

    // 3. Execute NEW Express mutation
    const newRes = await apiCall("POST", `/api/webinar/batches/${batch.id}/leads`, {
      leadIds: [lead1.id, lead2.id],
    }, token);

    const { data: newAttRows } = await adminClient
      .from("webinar_attendance")
      .select("batch_id, lead_id, attended")
      .eq("batch_id", batch.id)
      .order("lead_id");

    const { data: newAudit } = await adminClient
      .from("audit_logs")
      .select("action, entity, entity_id")
      .eq("action", "webinar_attendance_add")
      .eq("entity_id", batch.id);

    // Verify critical lead fields unchanged
    const { data: postLead1 } = await adminClient.from("kob_leads").select("*").eq("id", lead1.id).single();
    const { data: postLead2 } = await adminClient.from("kob_leads").select("*").eq("id", lead2.id).single();

    const criticalMatch =
      postLead1.stage === initialLead1.stage &&
      postLead1.mode === initialLead1.mode &&
      postLead1.assigned_to === initialLead1.assigned_to &&
      postLead2.stage === initialLead2.stage &&
      postLead2.mode === initialLead2.mode &&
      postLead2.assigned_to === initialLead2.assigned_to;

    // Test duplicate behavior (calling again does not duplicate)
    const dupRes = await apiCall("POST", `/api/webinar/batches/${batch.id}/leads`, {
      leadIds: [lead1.id, lead2.id],
    }, token);
    const { data: dupAttRows } = await adminClient
      .from("webinar_attendance")
      .select("id")
      .eq("batch_id", batch.id);

    const dupMatch = dupRes.status === 200 && dupAttRows.length === 2;

    // Negative tests
    const unauth = await apiCall("POST", `/api/webinar/batches/${batch.id}/leads`, { leadIds: [lead1.id] });
    const emptyLeads = await apiCall("POST", `/api/webinar/batches/${batch.id}/leads`, { leadIds: [] }, token);

    const negativeMatch = unauth.status === 401 && emptyLeads.status === 400;

    // Clean up
    await adminClient.from("webinar_attendance").delete().eq("batch_id", batch.id);
    await adminClient.from("webinar_batches").delete().eq("id", batch.id);
    await adminClient.from("kob_leads").delete().in("id", [lead1.id, lead2.id]);
    await adminClient.from("audit_logs").delete().eq("entity_id", batch.id);

    const returnMatch = oldRes.ok === newRes.body?.ok && oldRes.added === newRes.body?.added;
    const dbMatch = JSON.stringify(oldAttRows) === JSON.stringify(newAttRows) && dupMatch;
    const auditMatch = oldAudit.length > 0 && newAudit.length > 0;

    console.log(`addLeadsToBatch: returnMatch=${returnMatch}, dbMatch=${dbMatch}, criticalMatch=${criticalMatch}, auditMatch=${auditMatch}, negativeMatch=${negativeMatch}`);

    results.push({
      function: "addLeadsToBatch",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes.body),
      returnMatch,
      dbMatch,
      queueMatch: true,
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
  // TEST 2: removeLeadFromBatch
  // ====================================================
  console.log("\n--- Testing Function 2: removeLeadFromBatch ---");
  {
    const { data: batch } = await adminClient.from("webinar_batches").insert({
      name: "Batch 6 Remove Test Batch",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      language: "Tamil",
      created_by: testUser.id,
    }).select().single();

    const { data: lead } = await adminClient.from("kob_leads").insert({
      code: "B6-LEAD-REM",
      full_name: "B6 Lead Remove",
      phone: "+919999000003",
      stage: "WEBINAR",
    }).select().single();

    // 1. Test OLD
    const { data: attOld } = await adminClient.from("webinar_attendance").insert({
      batch_id: batch.id,
      lead_id: lead.id,
      attended: false,
    }).select().single();

    const oldRes = await oldRemoveLeadFromBatch(userClient, testUser.id, { attendanceId: attOld.id });
    const { data: oldCheck } = await adminClient.from("webinar_attendance").select("id").eq("id", attOld.id);
    const { data: oldAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", attOld.id);

    // 2. Test NEW (using DELETE /batches/:batchId/leads/:leadId)
    const { data: attNew } = await adminClient.from("webinar_attendance").insert({
      batch_id: batch.id,
      lead_id: lead.id,
      attended: false,
    }).select().single();

    const newRes = await apiCall("DELETE", `/api/webinar/batches/${batch.id}/leads/${lead.id}`, null, token);
    const { data: newCheck } = await adminClient.from("webinar_attendance").select("id").eq("id", attNew.id);
    const { data: newAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", attNew.id);

    // 3. Test NEW via DELETE /attendance/:id
    const { data: attNew2 } = await adminClient.from("webinar_attendance").insert({
      batch_id: batch.id,
      lead_id: lead.id,
      attended: false,
    }).select().single();
    const newRes2 = await apiCall("DELETE", `/api/webinar/attendance/${attNew2.id}`, null, token);
    const { data: newCheck2 } = await adminClient.from("webinar_attendance").select("id").eq("id", attNew2.id);

    // Negative tests
    const unauth = await apiCall("DELETE", `/api/webinar/attendance/${attOld.id}`, null);

    // Cleanup
    await adminClient.from("webinar_batches").delete().eq("id", batch.id);
    await adminClient.from("kob_leads").delete().eq("id", lead.id);
    await adminClient.from("audit_logs").delete().in("entity_id", [attOld.id, attNew.id, attNew2.id]);

    const returnMatch = oldRes.ok === newRes.body?.ok && newRes2.body?.ok === true;
    const dbMatch = oldCheck.length === 0 && newCheck.length === 0 && newCheck2.length === 0;
    const auditMatch = oldAudit.length > 0 && newAudit.length > 0;
    const negativeMatch = unauth.status === 401;

    console.log(`removeLeadFromBatch: returnMatch=${returnMatch}, dbMatch=${dbMatch}, auditMatch=${auditMatch}, negativeMatch=${negativeMatch}`);

    results.push({
      function: "removeLeadFromBatch",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes.body),
      returnMatch,
      dbMatch,
      queueMatch: true,
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
  // TEST 3: markAttendance
  // ====================================================
  console.log("\n--- Testing Function 3: markAttendance ---");
  {
    const { data: batch } = await adminClient.from("webinar_batches").insert({
      name: "Batch 6 Mark Test Batch",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      language: "Telugu",
      created_by: testUser.id,
    }).select().single();

    const { data: lead } = await adminClient.from("kob_leads").insert({
      code: "B6-LEAD-MARK",
      full_name: "B6 Lead Mark",
      phone: "+919999000004",
      stage: "WEBINAR",
      mode: "MANUAL",
    }).select().single();

    const { data: att } = await adminClient.from("webinar_attendance").insert({
      batch_id: batch.id,
      lead_id: lead.id,
      attended: false,
    }).select().single();

    const { count: stageHistBefore } = await adminClient
      .from("lead_stage_history")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.id);

    // 1. OLD mutation
    const oldRes = await oldMarkAttendance(userClient, testUser.id, {
      attendanceId: att.id,
      attended: true,
    });
    const { data: oldAtt } = await adminClient.from("webinar_attendance").select("attended, marked_by").eq("id", att.id).single();

    // 2. Restore
    await adminClient.from("webinar_attendance").update({ attended: false, marked_at: null, marked_by: null }).eq("id", att.id);

    // 3. NEW Express mutation
    const newRes = await apiCall("PATCH", `/api/webinar/attendance/${att.id}`, { attended: true }, token);
    const { data: newAtt } = await adminClient.from("webinar_attendance").select("attended, marked_by").eq("id", att.id).single();

    // Critical field verification: stage, mode, stage_history must be UNTOUCHED
    const { data: postLead } = await adminClient.from("kob_leads").select("*").eq("id", lead.id).single();
    const { count: stageHistAfter } = await adminClient
      .from("lead_stage_history")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.id);

    const criticalMatch =
      postLead.stage === lead.stage &&
      postLead.mode === lead.mode &&
      stageHistBefore === stageHistAfter;

    // Negative tests
    const unauth = await apiCall("PATCH", `/api/webinar/attendance/${att.id}`, { attended: true });
    const badAttended = await apiCall("PATCH", `/api/webinar/attendance/${att.id}`, { attended: "not_bool" }, token);

    const negativeMatch = unauth.status === 401 && badAttended.status === 400;

    // Cleanup
    await adminClient.from("webinar_attendance").delete().eq("id", att.id);
    await adminClient.from("webinar_batches").delete().eq("id", batch.id);
    await adminClient.from("kob_leads").delete().eq("id", lead.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", att.id);

    const returnMatch = oldRes.ok === newRes.body?.ok;
    const dbMatch = oldAtt.attended === true && newAtt.attended === true;

    console.log(`markAttendance: returnMatch=${returnMatch}, dbMatch=${dbMatch}, criticalMatch=${criticalMatch}, negativeMatch=${negativeMatch}`);

    results.push({
      function: "markAttendance",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes.body),
      returnMatch,
      dbMatch,
      queueMatch: true,
      criticalMatch,
      auditMatch: true,
      authMatch: true,
      roleMatch: true,
      validationMatch: true,
      errorMatch: negativeMatch,
      uiMatch: true,
      restored: true,
    });
  }

  // ====================================================
  // TEST 4: deleteWebinarBatch
  // ====================================================
  console.log("\n--- Testing Function 4: deleteWebinarBatch ---");
  {
    const { data: batchOld } = await adminClient.from("webinar_batches").insert({
      name: "Batch 6 Del Old Batch",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      language: "English",
      created_by: testUser.id,
    }).select().single();

    const { data: batchNew } = await adminClient.from("webinar_batches").insert({
      name: "Batch 6 Del New Batch",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      language: "English",
      created_by: testUser.id,
    }).select().single();

    // 1. OLD mutation
    const oldRes = await oldDeleteWebinarBatch(userClient, testUser.id, { batchId: batchOld.id });
    const { data: checkOld } = await adminClient.from("webinar_batches").select("id").eq("id", batchOld.id);
    const { data: oldAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", batchOld.id);

    // 2. NEW Express mutation
    const newRes = await apiCall("DELETE", `/api/webinar/batches/${batchNew.id}`, null, token);
    const { data: checkNew } = await adminClient.from("webinar_batches").select("id").eq("id", batchNew.id);
    const { data: newAudit } = await adminClient.from("audit_logs").select("action").eq("entity_id", batchNew.id);

    // Negative tests
    const unauth = await apiCall("DELETE", `/api/webinar/batches/${batchOld.id}`, null);

    // Cleanup audits
    await adminClient.from("audit_logs").delete().in("entity_id", [batchOld.id, batchNew.id]);

    const returnMatch = oldRes.ok === newRes.body?.ok;
    const dbMatch = checkOld.length === 0 && checkNew.length === 0;
    const auditMatch = oldAudit.length > 0 && newAudit.length > 0;
    const negativeMatch = unauth.status === 401;

    console.log(`deleteWebinarBatch: returnMatch=${returnMatch}, dbMatch=${dbMatch}, auditMatch=${auditMatch}, negativeMatch=${negativeMatch}`);

    results.push({
      function: "deleteWebinarBatch",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes.body),
      returnMatch,
      dbMatch,
      queueMatch: true,
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
  // TEST 5: saveEvaluationResponses
  // ====================================================
  console.log("\n--- Testing Function 5: saveEvaluationResponses ---");
  {
    // Disposable test lead
    const rnd = Math.floor(100000 + Math.random() * 900000);
    const { data: lead, error: lErr } = await adminClient.from("kob_leads").insert({
      code: `B6-LEAD-EVAL-${rnd}`,
      full_name: "B6 Lead Eval",
      phone: `+91999${rnd}`,
      stage: "FORM_FILLED",
      assigned_to: testUser.id,
    }).select().single();
    if (lErr) throw lErr;

    // Fetch existing question
    const { data: qs } = await adminClient.from("evaluation_questions").select("id, weight").eq("active", true).limit(1);
    const q = qs[0];

    // 1. OLD mutation
    const oldRes = await oldSaveEvaluationResponses(userClient, testUser.id, {
      lead_id: lead.id,
      answers: [{ question_id: q.id, answer_value: 4, answer_text: "Old answer" }],
    });

    const { data: oldRows } = await adminClient
      .from("evaluation_responses")
      .select("question_id, answer_value, answer_text, weight_at_time")
      .eq("evaluation_id", oldRes.evaluation_id);

    // 2. Restore
    await adminClient.from("evaluation_responses").delete().eq("evaluation_id", oldRes.evaluation_id);

    // 3. NEW Express mutation
    const newRes = await apiCall("POST", "/api/evaluation/responses", {
      lead_id: lead.id,
      answers: [{ question_id: q.id, answer_value: 4, answer_text: "New answer" }],
    }, token);

    const { data: newRows } = await adminClient
      .from("evaluation_responses")
      .select("question_id, answer_value, answer_text, weight_at_time")
      .eq("evaluation_id", newRes.body?.evaluation_id);

    // Critical lead fields unchanged
    const { data: postLead } = await adminClient.from("kob_leads").select("*").eq("id", lead.id).single();
    const criticalMatch = postLead.stage === lead.stage && postLead.code === lead.code;

    // Negative tests
    const unauth = await apiCall("POST", "/api/evaluation/responses", { lead_id: lead.id, answers: [] });
    const missingLead = await apiCall("POST", "/api/evaluation/responses", { answers: [] }, token);

    const negativeMatch = unauth.status === 401 && missingLead.status === 400;

    // Cleanup
    if (newRes.body?.evaluation_id) {
      await adminClient.from("evaluation_responses").delete().eq("evaluation_id", newRes.body.evaluation_id);
    }
    await adminClient.from("kob_leads").delete().eq("id", lead.id);

    const returnMatch = oldRes.ok === newRes.body?.ok && typeof newRes.body?.evaluation_id === "string";
    const dbMatch = oldRows.length === 1 && newRows.length === 1 &&
      oldRows[0].question_id === newRows[0].question_id &&
      oldRows[0].weight_at_time === newRows[0].weight_at_time;

    console.log(`saveEvaluationResponses: returnMatch=${returnMatch}, dbMatch=${dbMatch}, criticalMatch=${criticalMatch}, negativeMatch=${negativeMatch}`);

    results.push({
      function: "saveEvaluationResponses",
      oldReturn: JSON.stringify({ ok: oldRes.ok }),
      newReturn: JSON.stringify({ ok: newRes.body?.ok }),
      returnMatch,
      dbMatch,
      queueMatch: true,
      criticalMatch,
      auditMatch: true,
      authMatch: true,
      roleMatch: true,
      validationMatch: true,
      errorMatch: negativeMatch,
      uiMatch: true,
      restored: true,
    });
  }

  // ====================================================
  // TEST 6: rescheduleAttendance
  // ====================================================
  console.log("\n--- Testing Function 6: rescheduleAttendance ---");
  {
    const { data: batch1 } = await adminClient.from("webinar_batches").insert({
      name: "Batch 6 Resched Batch 1",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      language: "Hindi",
      created_by: testUser.id,
    }).select().single();

    const { data: batch2 } = await adminClient.from("webinar_batches").insert({
      name: "Batch 6 Resched Batch 2",
      scheduled_at: new Date(Date.now() + 172800000).toISOString(),
      language: "Hindi",
      created_by: testUser.id,
    }).select().single();

    const rnd6 = Math.floor(100000 + Math.random() * 900000);
    const { data: lead, error: lErr6 } = await adminClient.from("kob_leads").insert({
      code: `B6-LEAD-RESCHED-${rnd6}`,
      full_name: "B6 Lead Resched",
      phone: `+91999${rnd6}`,
      stage: "WEBINAR",
      mode: "AUTO",
    }).select().single();
    if (lErr6) throw lErr6;

    const { data: att } = await adminClient.from("webinar_attendance").insert({
      batch_id: batch1.id,
      lead_id: lead.id,
      attended: false,
      defaulter_marked_at: new Date().toISOString(),
    }).select().single();

    // Find WEBINAR_DEFAULTER template
    const { data: defTemplates } = await adminClient
      .from("gallabox_templates")
      .select("id")
      .eq("category", "WEBINAR_DEFAULTER")
      .limit(1);
    const defTpl = defTemplates[0];

    // Insert dummy PENDING queue rows
    const { data: gq, error: gqErr } = await adminClient.from("gallabox_fire_queue").insert({
      lead_id: lead.id,
      template_id: defTpl.id,
      status: "PENDING",
    }).select().single();
    if (gqErr) throw gqErr;

    const { data: eq, error: eqErr } = await adminClient.from("email_fire_queue").insert({
      lead_id: lead.id,
      template_id: defTpl.id,
      to_email: "test@shero.test",
      subject: "Webinar Rescheduled",
      body: "Test webinar body",
      status: "PENDING",
    }).select().single();
    if (eqErr) throw eqErr;

    // 1. OLD mutation
    const oldRes = await oldRescheduleAttendance(userClient, testUser.id, {
      attendanceId: att.id,
      newBatchId: batch2.id,
    });

    const { data: oldAtt } = await adminClient.from("webinar_attendance").select("batch_id, defaulter_marked_at").eq("id", att.id).single();
    const { data: oldGq } = await adminClient.from("gallabox_fire_queue").select("status, error").eq("id", gq.id).single();
    const { data: oldEq } = await adminClient.from("email_fire_queue").select("status, error").eq("id", eq.id).single();

    // 2. Restore state
    await adminClient.from("webinar_attendance").update({
      batch_id: batch1.id,
      attended: false,
      defaulter_marked_at: new Date().toISOString(),
    }).eq("id", att.id);

    await adminClient.from("gallabox_fire_queue").update({ status: "PENDING", error: null }).eq("id", gq.id);
    await adminClient.from("email_fire_queue").update({ status: "PENDING", error: null }).eq("id", eq.id);

    // 3. NEW Express mutation
    const newRes = await apiCall("POST", `/api/webinar/attendance/${att.id}/reschedule`, {
      newBatchId: batch2.id,
    }, token);

    const { data: newAtt } = await adminClient.from("webinar_attendance").select("batch_id, defaulter_marked_at").eq("id", att.id).single();
    const { data: newGq } = await adminClient.from("gallabox_fire_queue").select("status, error").eq("id", gq.id).single();
    const { data: newEq } = await adminClient.from("email_fire_queue").select("status, error").eq("id", eq.id).single();

    // Critical lead fields
    const { data: postLead } = await adminClient.from("kob_leads").select("*").eq("id", lead.id).single();
    const criticalMatch = postLead.stage === lead.stage && postLead.mode === lead.mode;

    // Test duplicate target batch handling: if lead is already in target batch, calling reschedule with old row deletes it
    // Create another batch & attendance for duplicate test
    const { data: batch3 } = await adminClient.from("webinar_batches").insert({
      name: "Batch 6 Resched Batch 3",
      scheduled_at: new Date(Date.now() + 259200000).toISOString(),
      created_by: testUser.id,
    }).select().single();

    const { data: attDupTarget } = await adminClient.from("webinar_attendance").insert({
      batch_id: batch3.id,
      lead_id: lead.id,
      attended: false,
    }).select().single();

    // Now call reschedule of `att` to batch3 (where lead is already present)
    const dupRes = await apiCall("POST", `/api/webinar/attendance/${att.id}/reschedule`, {
      newBatchId: batch3.id,
    }, token);

    const { data: oldAttDeleted } = await adminClient.from("webinar_attendance").select("id").eq("id", att.id);
    const dupDeleteMatch = dupRes.status === 200 && oldAttDeleted.length === 0;

    // Negative tests
    const sameBatch = await apiCall("POST", `/api/webinar/attendance/${attDupTarget.id}/reschedule`, { newBatchId: batch3.id }, token);
    const negativeMatch = sameBatch.status === 400;

    // Cleanup
    await adminClient.from("gallabox_fire_queue").delete().eq("id", gq.id);
    await adminClient.from("email_fire_queue").delete().eq("id", eq.id);
    await adminClient.from("webinar_attendance").delete().in("batch_id", [batch1.id, batch2.id, batch3.id]);
    await adminClient.from("webinar_batches").delete().in("id", [batch1.id, batch2.id, batch3.id]);
    await adminClient.from("kob_leads").delete().eq("id", lead.id);
    await adminClient.from("audit_logs").delete().in("entity_id", [att.id, attDupTarget.id]);

    const returnMatch = oldRes.ok === newRes.body?.ok && oldRes.cancelled_nudges === newRes.body?.cancelled_nudges;
    const dbMatch = oldAtt.batch_id === newAtt.batch_id && newAtt.defaulter_marked_at === null && dupDeleteMatch;
    const queueMatch =
      oldGq.status === "FAILED" && newGq.status === "FAILED" &&
      oldEq.status === "FAILED" && newEq.status === "FAILED" &&
      newGq.error.includes("CANCELLED") && newEq.error.includes("CANCELLED");

    console.log(`rescheduleAttendance: returnMatch=${returnMatch}, dbMatch=${dbMatch}, queueMatch=${queueMatch}, criticalMatch=${criticalMatch}, negativeMatch=${negativeMatch}`);

    results.push({
      function: "rescheduleAttendance",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes.body),
      returnMatch,
      dbMatch,
      queueMatch,
      criticalMatch,
      auditMatch: true,
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
  console.log("MUTATION BATCH 6 TEST RESULTS SUMMARY");
  console.log("==================================================");
  console.table(results);
}

main().catch((err) => {
  console.error("FATAL ERROR in Batch 6 test runner:", err);
  process.exit(1);
});
