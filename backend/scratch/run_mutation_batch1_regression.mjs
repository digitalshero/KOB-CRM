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

// Helper for audit logging in OLD functions
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
// OLD IMPLEMENTATIONS
// ----------------------------------------------------

async function oldUpsertEvaluationQuestion(supabase, userId, data) {
  const payload = {
    question_text: data.question_text.trim(),
    weight: Number(data.weight),
    question_type: data.question_type,
    active: data.active ?? true,
    sort_order: data.sort_order ?? 0,
  };
  let id = data.id;
  if (id) {
    const { error } = await supabase.from("evaluation_questions").update(payload).eq("id", id);
    if (error) throw new Error(error.message);
    await logAudit(supabase, userId, "eval_question_updated", "evaluation_questions", id, payload);
  } else {
    const { data: ins, error } = await supabase.from("evaluation_questions").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    id = ins.id;
    await logAudit(supabase, userId, "eval_question_created", "evaluation_questions", id, payload);
  }
  return { ok: true, id };
}

async function oldDeleteEvaluationQuestion(supabase, userId, data) {
  const { error } = await supabase.from("evaluation_questions").delete().eq("id", data.id);
  if (error) throw new Error(error.message);
  await logAudit(supabase, userId, "eval_question_deleted", "evaluation_questions", data.id, null);
  return { ok: true };
}

async function oldUpsertKpiTarget(supabase, userId, data) {
  const eff = data.effective_from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const { error } = await supabase
    .from("kpi_targets")
    .upsert({ ...data, effective_from: eff }, { onConflict: "metric,period,effective_from" });
  if (error) throw error;
  await logAudit(supabase, userId, "kpi_target_update", "kpi_targets", null, { ...data, effective_from: eff });
  return { ok: true };
}

async function oldDeleteKpiTarget(supabase, userId, data) {
  const { error } = await supabase.from("kpi_targets").delete().eq("id", data.id);
  if (error) throw error;
  await logAudit(supabase, userId, "kpi_target_delete", "kpi_targets", data.id, {});
  return { ok: true };
}

async function oldUpsertMarketingTarget(supabase, userId, data) {
  const period = data.period ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
  const { error } = await supabase
    .from("marketing_kpi_targets")
    .upsert({ metric: data.metric, target_value: data.target_value, period }, { onConflict: "metric,period" });
  if (error) throw new Error(error.message);
  await logAudit(supabase, userId, "marketing_target_upsert", "marketing_kpi_targets", null, {
    metric: data.metric,
    target_value: data.target_value,
    period,
  });
  return { ok: true };
}

async function oldUpsertManualRating(supabase, userId, data) {
  const period = data.period.length === 7 ? `${data.period}-01` : data.period;
  const row = {
    user_id: data.user_id,
    period,
    personal_score: data.personal_score,
    compliance_score: data.compliance_score ?? null,
    notes: data.notes ?? null,
    rated_by: userId,
    rated_at: new Date().toISOString(),
  };
  const { data: saved, error } = await supabase
    .from("scv_manual_ratings")
    .upsert(row, { onConflict: "user_id,period" })
    .select()
    .maybeSingle();
  if (error) throw error;
  await logAudit(supabase, userId, "manual_rating_upsert", "scv_manual_ratings", saved?.id ?? null, row);
  return saved;
}

// ----------------------------------------------------
// RUNNER
// ----------------------------------------------------

async function run() {
  console.log("==================================================");
  console.log("MUTATION BATCH 1 PARITY & REGRESSION SUITE");
  console.log("==================================================");

  // Snapshot before counts
  const { count: evalQBefore } = await adminClient.from("evaluation_questions").select("*", { count: "exact", head: true });
  const { count: kpiTgtBefore } = await adminClient.from("kpi_targets").select("*", { count: "exact", head: true });
  const { count: mktTgtBefore } = await adminClient.from("marketing_kpi_targets").select("*", { count: "exact", head: true });
  const { count: manRatBefore } = await adminClient.from("scv_manual_ratings").select("*", { count: "exact", head: true });

  const CEO_USER = { id: "6502c359-e15f-4dc2-8f6c-4b0238b4fda8", email: "ceo@shero.test" };
  const ceoToken = createToken(CEO_USER.id, CEO_USER.email);
  const ceoClient = createUserClient(ceoToken);

  let fixturesCreated = 0;
  let fixturesCleaned = 0;
  const results = [];

  // --------------------------------------------------
  // 1. upsertEvaluationQuestion
  // --------------------------------------------------
  console.log("\n--- Testing 1. upsertEvaluationQuestion ---");
  {
    // Fixture A: OLD function
    const qA = {
      question_text: "__TEST_MUTATION_B1_Q_A",
      weight: 15,
      question_type: "SCALE_1_5",
      active: true,
      sort_order: 88,
    };
    fixturesCreated++;
    const oldResCreate = await oldUpsertEvaluationQuestion(ceoClient, CEO_USER.id, qA);
    const { data: oldRowA } = await adminClient.from("evaluation_questions").select("*").eq("id", oldResCreate.id).single();
    const { data: oldAuditCreate } = await adminClient.from("audit_logs").select("*").eq("entity_id", oldResCreate.id).single();

    // Update Fixture A
    const oldResUpdate = await oldUpsertEvaluationQuestion(ceoClient, CEO_USER.id, {
      ...qA,
      id: oldResCreate.id,
      question_text: "__TEST_MUTATION_B1_Q_A_UPDATED",
      weight: 20,
    });
    const { data: oldRowAUpdated } = await adminClient.from("evaluation_questions").select("*").eq("id", oldResCreate.id).single();
    const { data: oldAuditUpdate } = await adminClient.from("audit_logs").select("*").eq("entity_id", oldResCreate.id).eq("action", "eval_question_updated").single();

    // Clean Fixture A
    await adminClient.from("evaluation_questions").delete().eq("id", oldResCreate.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", oldResCreate.id);
    fixturesCleaned++;

    // Fixture B: NEW Express endpoint
    const qB = {
      question_text: "__TEST_MUTATION_B1_Q_B",
      weight: 15,
      question_type: "SCALE_1_5",
      active: true,
      sort_order: 88,
    };
    fixturesCreated++;
    const newHttpCreate = await fetch(`${BACKEND_BASE}/api/evaluation/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify(qB),
    });
    const newResCreate = await newHttpCreate.json();
    const { data: newRowB } = await adminClient.from("evaluation_questions").select("*").eq("id", newResCreate.id).single();
    const { data: newAuditCreate } = await adminClient.from("audit_logs").select("*").eq("entity_id", newResCreate.id).single();

    // Update Fixture B
    const newHttpUpdate = await fetch(`${BACKEND_BASE}/api/evaluation/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ ...qB, id: newResCreate.id, question_text: "__TEST_MUTATION_B1_Q_B_UPDATED", weight: 20 }),
    });
    const newResUpdate = await newHttpUpdate.json();
    const { data: newRowBUpdated } = await adminClient.from("evaluation_questions").select("*").eq("id", newResCreate.id).single();
    const { data: newAuditUpdate } = await adminClient.from("audit_logs").select("*").eq("entity_id", newResCreate.id).eq("action", "eval_question_updated").single();

    // Clean Fixture B
    await adminClient.from("evaluation_questions").delete().eq("id", newResCreate.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", newResCreate.id);
    fixturesCleaned++;

    // Compare side effects
    const returnMatch = oldResCreate.ok === newResCreate.ok && oldResUpdate.ok === newResUpdate.ok;
    const dbSideEffectMatch =
      newRowB.weight === oldRowA.weight &&
      newRowB.question_type === oldRowA.question_type &&
      newRowBUpdated.weight === oldRowAUpdated.weight &&
      newRowBUpdated.active === oldRowAUpdated.active;
    const auditMatch =
      newAuditCreate.action === oldAuditCreate.action &&
      newAuditCreate.actor_id === oldAuditCreate.actor_id &&
      newAuditUpdate.action === oldAuditUpdate.action &&
      newAuditUpdate.actor_id === oldAuditUpdate.actor_id;

    const pass = returnMatch && dbSideEffectMatch && auditMatch;
    console.log(`upsertEvaluationQuestion: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "upsertEvaluationQuestion",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbSideEffectMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // --------------------------------------------------
  // 2. deleteEvaluationQuestion
  // --------------------------------------------------
  console.log("\n--- Testing 2. deleteEvaluationQuestion ---");
  {
    // Fixture A: create then OLD delete
    const { data: insA } = await adminClient.from("evaluation_questions").insert({
      question_text: "__TEST_MUTATION_B1_DEL_A",
      weight: 10,
      question_type: "TEXT",
      active: true,
      sort_order: 1,
    }).select("id").single();
    fixturesCreated++;

    const oldResDel = await oldDeleteEvaluationQuestion(ceoClient, CEO_USER.id, { id: insA.id });
    const { data: oldRowCheck } = await adminClient.from("evaluation_questions").select("*").eq("id", insA.id).maybeSingle();
    const { data: oldAuditDel } = await adminClient.from("audit_logs").select("*").eq("entity_id", insA.id).single();
    await adminClient.from("audit_logs").delete().eq("entity_id", insA.id);
    fixturesCleaned++;

    // Fixture B: create then NEW delete
    const { data: insB } = await adminClient.from("evaluation_questions").insert({
      question_text: "__TEST_MUTATION_B1_DEL_B",
      weight: 10,
      question_type: "TEXT",
      active: true,
      sort_order: 1,
    }).select("id").single();
    fixturesCreated++;

    const newHttpDel = await fetch(`${BACKEND_BASE}/api/evaluation/questions/${insB.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ceoToken}` },
    });
    const newResDel = await newHttpDel.json();
    const { data: newRowCheck } = await adminClient.from("evaluation_questions").select("*").eq("id", insB.id).maybeSingle();
    const { data: newAuditDel } = await adminClient.from("audit_logs").select("*").eq("entity_id", insB.id).single();
    await adminClient.from("audit_logs").delete().eq("entity_id", insB.id);
    fixturesCleaned++;

    const returnMatch = oldResDel.ok === newResDel.ok && newHttpDel.status === 200;
    const dbSideEffectMatch = oldRowCheck === null && newRowCheck === null;
    const auditMatch = newAuditDel.action === oldAuditDel.action && newAuditDel.actor_id === oldAuditDel.actor_id;

    const pass = returnMatch && dbSideEffectMatch && auditMatch;
    console.log(`deleteEvaluationQuestion: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "deleteEvaluationQuestion",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbSideEffectMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // --------------------------------------------------
  // 3. upsertKpiTarget
  // --------------------------------------------------
  console.log("\n--- Testing 3. upsertKpiTarget ---");
  {
    const tgtA = {
      metric: "__TEST_KPI_TARGET_A",
      period: "monthly",
      target_value: 500,
      effective_from: "2099-01-01",
    };
    fixturesCreated++;
    const oldResCreate = await oldUpsertKpiTarget(ceoClient, CEO_USER.id, tgtA);
    const { data: oldRowA } = await adminClient.from("kpi_targets").select("*").eq("metric", tgtA.metric).single();
    const { data: oldAuditCreate } = await adminClient.from("audit_logs").select("*").eq("action", "kpi_target_update").contains("meta", { metric: tgtA.metric }).single();

    // Clean Fixture A
    await adminClient.from("kpi_targets").delete().eq("metric", tgtA.metric);
    await adminClient.from("audit_logs").delete().eq("id", oldAuditCreate.id);
    fixturesCleaned++;

    const tgtB = {
      metric: "__TEST_KPI_TARGET_B",
      period: "monthly",
      target_value: 500,
      effective_from: "2099-01-01",
    };
    fixturesCreated++;
    const newHttpCreate = await fetch(`${BACKEND_BASE}/api/kob/kpi-targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify(tgtB),
    });
    const newResCreate = await newHttpCreate.json();
    const { data: newRowB } = await adminClient.from("kpi_targets").select("*").eq("metric", tgtB.metric).single();
    const { data: newAuditCreate } = await adminClient.from("audit_logs").select("*").eq("action", "kpi_target_update").contains("meta", { metric: tgtB.metric }).single();

    // Clean Fixture B
    await adminClient.from("kpi_targets").delete().eq("metric", tgtB.metric);
    await adminClient.from("audit_logs").delete().eq("id", newAuditCreate.id);
    fixturesCleaned++;

    const returnMatch = oldResCreate.ok === newResCreate.ok && newHttpCreate.status === 200;
    const dbSideEffectMatch = newRowB.target_value === oldRowA.target_value && newRowB.period === oldRowA.period;
    const auditMatch = newAuditCreate.action === oldAuditCreate.action && newAuditCreate.actor_id === oldAuditCreate.actor_id;

    const pass = returnMatch && dbSideEffectMatch && auditMatch;
    console.log(`upsertKpiTarget: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "upsertKpiTarget",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbSideEffectMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // --------------------------------------------------
  // 4. deleteKpiTarget
  // --------------------------------------------------
  console.log("\n--- Testing 4. deleteKpiTarget ---");
  {
    // Fixture A: create then OLD delete
    const { data: insA } = await adminClient.from("kpi_targets").insert({
      metric: "__TEST_KPI_DEL_A",
      period: "monthly",
      target_value: 777,
      effective_from: "2099-02-01",
    }).select("id").single();
    fixturesCreated++;

    const oldResDel = await oldDeleteKpiTarget(ceoClient, CEO_USER.id, { id: insA.id });
    const { data: oldRowCheck } = await adminClient.from("kpi_targets").select("*").eq("id", insA.id).maybeSingle();
    const { data: oldAuditDel } = await adminClient.from("audit_logs").select("*").eq("entity_id", insA.id).single();
    await adminClient.from("audit_logs").delete().eq("entity_id", insA.id);
    fixturesCleaned++;

    // Fixture B: create then NEW delete
    const { data: insB } = await adminClient.from("kpi_targets").insert({
      metric: "__TEST_KPI_DEL_B",
      period: "monthly",
      target_value: 777,
      effective_from: "2099-02-01",
    }).select("id").single();
    fixturesCreated++;

    const newHttpDel = await fetch(`${BACKEND_BASE}/api/kob/kpi-targets/${insB.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ceoToken}` },
    });
    const newResDel = await newHttpDel.json();
    const { data: newRowCheck } = await adminClient.from("kpi_targets").select("*").eq("id", insB.id).maybeSingle();
    const { data: newAuditDel } = await adminClient.from("audit_logs").select("*").eq("entity_id", insB.id).single();
    await adminClient.from("audit_logs").delete().eq("entity_id", insB.id);
    fixturesCleaned++;

    const returnMatch = oldResDel.ok === newResDel.ok && newHttpDel.status === 200;
    const dbSideEffectMatch = oldRowCheck === null && newRowCheck === null;
    const auditMatch = newAuditDel.action === oldAuditDel.action && newAuditDel.actor_id === oldAuditDel.actor_id;

    const pass = returnMatch && dbSideEffectMatch && auditMatch;
    console.log(`deleteKpiTarget: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "deleteKpiTarget",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbSideEffectMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // --------------------------------------------------
  // 5. upsertMarketingTarget
  // --------------------------------------------------
  console.log("\n--- Testing 5. upsertMarketingTarget ---");
  {
    const tgtA = {
      metric: "SPEND",
      target_value: 123456,
      period: "2099-11-01",
    };
    fixturesCreated++;
    const oldResCreate = await oldUpsertMarketingTarget(ceoClient, CEO_USER.id, tgtA);
    const { data: oldRowA } = await adminClient.from("marketing_kpi_targets").select("*").eq("metric", tgtA.metric).eq("period", tgtA.period).single();
    const { data: oldAuditCreate } = await adminClient.from("audit_logs").select("*").eq("action", "marketing_target_upsert").contains("meta", { period: tgtA.period }).single();

    // Clean Fixture A
    await adminClient.from("marketing_kpi_targets").delete().eq("metric", tgtA.metric).eq("period", tgtA.period);
    await adminClient.from("audit_logs").delete().eq("id", oldAuditCreate.id);
    fixturesCleaned++;

    const tgtB = {
      metric: "SPEND",
      target_value: 123456,
      period: "2099-12-01",
    };
    fixturesCreated++;
    const newHttpCreate = await fetch(`${BACKEND_BASE}/api/kob/marketing-targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify(tgtB),
    });
    const newResCreate = await newHttpCreate.json();
    const { data: newRowB } = await adminClient.from("marketing_kpi_targets").select("*").eq("metric", tgtB.metric).eq("period", tgtB.period).single();
    const { data: newAuditCreate } = await adminClient.from("audit_logs").select("*").eq("action", "marketing_target_upsert").contains("meta", { period: tgtB.period }).single();

    // Clean Fixture B
    await adminClient.from("marketing_kpi_targets").delete().eq("metric", tgtB.metric).eq("period", tgtB.period);
    await adminClient.from("audit_logs").delete().eq("id", newAuditCreate.id);
    fixturesCleaned++;

    const returnMatch = oldResCreate.ok === newResCreate.ok && newHttpCreate.status === 200;
    const dbSideEffectMatch = newRowB.target_value === oldRowA.target_value && newRowB.metric === oldRowA.metric;
    const auditMatch = newAuditCreate.action === oldAuditCreate.action && newAuditCreate.actor_id === oldAuditCreate.actor_id;

    const pass = returnMatch && dbSideEffectMatch && auditMatch;
    console.log(`upsertMarketingTarget: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "upsertMarketingTarget",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbSideEffectMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // --------------------------------------------------
  // 6. upsertManualRating
  // --------------------------------------------------
  console.log("\n--- Testing 6. upsertManualRating ---");
  {
    const targetUserId = "3f7aad05-a5d6-41f1-95c2-7ce86a9b9170"; // existing local user Gokula Krishnan
    const ratA = {
      user_id: targetUserId,
      period: "2099-10-01",
      personal_score: 85,
      compliance_score: 90,
      notes: "__TEST_RATING_OLD",
    };
    fixturesCreated++;
    const oldResCreate = await oldUpsertManualRating(ceoClient, CEO_USER.id, ratA);
    const { data: oldRowA } = await adminClient.from("scv_manual_ratings").select("*").eq("user_id", targetUserId).eq("period", ratA.period).single();
    const { data: oldAuditCreate } = await adminClient.from("audit_logs").select("*").eq("entity_id", oldResCreate.id).single();

    // Clean Fixture A
    await adminClient.from("scv_manual_ratings").delete().eq("id", oldResCreate.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", oldResCreate.id);
    fixturesCleaned++;

    const ratB = {
      user_id: targetUserId,
      period: "2099-11-01",
      personal_score: 85,
      compliance_score: 90,
      notes: "__TEST_RATING_NEW",
    };
    fixturesCreated++;
    const newHttpCreate = await fetch(`${BACKEND_BASE}/api/kob/manual-ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify(ratB),
    });
    const newResCreate = await newHttpCreate.json();
    const { data: newRowB } = await adminClient.from("scv_manual_ratings").select("*").eq("user_id", targetUserId).eq("period", ratB.period).single();
    const { data: newAuditCreate } = await adminClient.from("audit_logs").select("*").eq("entity_id", newResCreate.id).single();

    // Clean Fixture B
    await adminClient.from("scv_manual_ratings").delete().eq("id", newResCreate.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", newResCreate.id);
    fixturesCleaned++;

    const returnMatch =
      newResCreate.user_id === oldResCreate.user_id &&
      newResCreate.personal_score === oldResCreate.personal_score &&
      newResCreate.compliance_score === oldResCreate.compliance_score &&
      newResCreate.rated_by === oldResCreate.rated_by;
    const dbSideEffectMatch =
      newRowB.personal_score === oldRowA.personal_score &&
      newRowB.compliance_score === oldRowA.compliance_score &&
      newRowB.rated_by === oldRowA.rated_by;
    const auditMatch = newAuditCreate.action === oldAuditCreate.action && newAuditCreate.actor_id === oldAuditCreate.actor_id;

    const pass = returnMatch && dbSideEffectMatch && auditMatch;
    console.log(`upsertManualRating: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "upsertManualRating",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbSideEffectMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // --------------------------------------------------
  // NEGATIVE TESTS
  // --------------------------------------------------
  console.log("\n--- Testing Negative Cases ---");
  {
    // 1. Unauthenticated requests
    const unauthQ = await fetch(`${BACKEND_BASE}/api/evaluation/questions`, { method: "POST", body: "{}" });
    const unauthKpi = await fetch(`${BACKEND_BASE}/api/kob/kpi-targets`, { method: "POST", body: "{}" });
    const unauthMkt = await fetch(`${BACKEND_BASE}/api/kob/marketing-targets`, { method: "POST", body: "{}" });
    const unauthRat = await fetch(`${BACKEND_BASE}/api/kob/manual-ratings`, { method: "POST", body: "{}" });
    const unauthPass = [unauthQ, unauthKpi, unauthMkt, unauthRat].every((r) => r.status === 401);
    console.log(`Unauthenticated rejected (401): ${unauthPass ? "PASS ✓" : "FAIL ✗"}`);

    // 2. Invalid Payload / Missing fields
    const badQ = await fetch(`${BACKEND_BASE}/api/evaluation/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ question_text: "", weight: 10, question_type: "INVALID_TYPE" }),
    });
    console.log(`Invalid question rejected (400): ${badQ.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

    const badKpi = await fetch(`${BACKEND_BASE}/api/kob/kpi-targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ metric: "", target_value: "invalid" }),
    });
    console.log(`Invalid KPI target rejected (400): ${badKpi.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

    const badMkt = await fetch(`${BACKEND_BASE}/api/kob/marketing-targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ metric: "INVALID_METRIC", target_value: -5 }),
    });
    console.log(`Invalid marketing target rejected (400): ${badMkt.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

    const badRat = await fetch(`${BACKEND_BASE}/api/kob/manual-ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ user_id: "", period: "", personal_score: 999 }),
    });
    console.log(`Invalid manual rating rejected (400): ${badRat.status === 400 ? "PASS ✓" : "FAIL ✗"}`);
  }

  // --------------------------------------------------
  // POST-TEST DATABASE INTEGRITY
  // --------------------------------------------------
  console.log("\n--- Post-Test Database Integrity Check ---");
  const { count: evalQAfter } = await adminClient.from("evaluation_questions").select("*", { count: "exact", head: true });
  const { count: kpiTgtAfter } = await adminClient.from("kpi_targets").select("*", { count: "exact", head: true });
  const { count: mktTgtAfter } = await adminClient.from("marketing_kpi_targets").select("*", { count: "exact", head: true });
  const { count: manRatAfter } = await adminClient.from("scv_manual_ratings").select("*", { count: "exact", head: true });

  const diffEvalQ = evalQAfter - evalQBefore;
  const diffKpiTgt = kpiTgtAfter - kpiTgtBefore;
  const diffMktTgt = mktTgtAfter - mktTgtBefore;
  const diffManRat = manRatAfter - manRatBefore;

  console.log(`evaluation_questions net delta: ${diffEvalQ}`);
  console.log(`kpi_targets net delta: ${diffKpiTgt}`);
  console.log(`marketing_kpi_targets net delta: ${diffMktTgt}`);
  console.log(`scv_manual_ratings net delta: ${diffManRat}`);
  console.log(`Test fixtures created: ${fixturesCreated}, cleaned: ${fixturesCleaned}`);

  console.log("\n==================================================");
  console.log("MUTATION BATCH 1 RESULTS SUMMARY");
  console.log("==================================================");
  console.table(results);

  const netClean = diffEvalQ === 0 && diffKpiTgt === 0 && diffMktTgt === 0 && diffManRat === 0;
  console.log(`\nINTEGRITY AUDIT: ${netClean ? "0 UNINTENDED CHANGES ✓" : "LEAK DETECTED ✗"}`);

  if (!netClean || results.some((r) => r.ReturnMatch !== "YES" || r.DbMatch !== "YES" || r.AuditMatch !== "YES")) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("FATAL ERROR IN MUTATION BATCH 1 TEST:", err);
  process.exit(1);
});
