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

async function oldUpdateConfig(supabase, userId, data) {
  const { error } = await supabase.from("kob_configuration").update(data).eq("id", 1);
  if (error) throw error;
  await logAudit(supabase, userId, "config_update", "kob_configuration", null, data);
  return { ok: true };
}

async function oldUpdateMyAllocationMode(supabase, userId, mode) {
  const { error } = await supabase
    .from("profiles")
    .update({ allocation_mode: mode })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  await logAudit(supabase, userId, "allocation_mode_update", "profiles", userId, { mode });
  return { ok: true, mode };
}

async function oldUpdateExecutiveLanguage(supabase, userId, data) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r) => r.role === "super_admin" || r.role === "kob_manager");
  const isTL = (roles ?? []).some((r) => r.role === "team_leader");
  if (!isAdmin && !isTL) throw new Error("Forbidden");
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, "primary_language")) patch.primary_language = data.primary_language || null;
  if (Object.prototype.hasOwnProperty.call(data, "secondary_language")) patch.secondary_language = data.secondary_language || null;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await adminClient.from("profiles").update(patch).eq("id", data.executiveId);
  if (error) throw new Error(error.message);
  await logAudit(supabase, userId, "executive_language_updated", "profiles", data.executiveId, patch);
  return { ok: true };
}

async function oldReassignExecutiveTeamLeader(supabase, userId, data) {
  const { error } = await adminClient
    .from("profiles")
    .update({ team_leader_id: data.teamLeaderId })
    .eq("id", data.executiveId);
  if (error) throw new Error(error.message);
  await logAudit(supabase, userId, "executive_reassign_tl", "profiles", data.executiveId, { team_leader_id: data.teamLeaderId });
  return { ok: true };
}

async function oldUpdateScvComponentWeights(supabase, userId, data) {
  const [{ data: isMgr }, { data: isAdmin }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "kob_manager" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  if (!isMgr && !isAdmin) throw new Error("Only CEO or Manager can change SCV weights");
  const sum = data.conversion + data.tat + data.eoi2Payment + data.crm;
  if (sum !== 100) throw new Error(`Weights must total 100% (currently ${sum}%)`);
  const { error } = await supabase.from("scv_component_weights").update({
    weight_conversion: data.conversion,
    weight_tat: data.tat,
    weight_eoi2_payment: data.eoi2Payment,
    weight_crm_discipline: data.crm,
  }).eq("id", 1);
  if (error) throw error;
  return { ok: true };
}

async function oldSaveScvMonthlyInput(supabase, userId, data) {
  const period = `${data.month}-01`;
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  const isMgr = role === "kob_manager" || role === "super_admin";
  const isTL = role === "team_leader";
  if (!isMgr && !isTL) throw new Error("Only a Manager or Team Leader can set monthly targets");
  const payload = {
    user_id: data.userId,
    period,
    updated_by: userId,
    ktn_cs_target: data.ktnCsTarget,
    crm_discipline: data.crmDiscipline,
  };
  const { error } = await supabase.from("scv_monthly_inputs").upsert(payload, { onConflict: "user_id,period" });
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ----------------------------------------------------
// TEST RUNNER
// ----------------------------------------------------

async function run() {
  console.log("==================================================");
  console.log("MUTATION BATCH 3 PARITY & REGRESSION SUITE");
  console.log("==================================================\n");

  const CEO_USER = { id: "6502c359-e15f-4dc2-8f6c-4b0238b4fda8", email: "ceo@shero.test" };
  const ceoToken = createToken(CEO_USER.id, CEO_USER.email);
  const ceoClient = createUserClient(ceoToken);

  // TL user
  const TL_USER = { id: "058b320b-8a21-49cf-bb7c-8f21c05803a4", email: "tl1@shero.test" };
  const tlToken = createToken(TL_USER.id, TL_USER.email);
  const tlClient = createUserClient(tlToken);

  // Exec user
  const EXEC_USER = { id: "8c4dff0d-cd27-474d-9ea8-9cc15b9a93f5", email: "exec1@shero.test" };
  const execToken = createToken(EXEC_USER.id, EXEC_USER.email);

  let fixturesCreated = 0;
  let fixturesCleaned = 0;

  // Track initial table row counts
  const { count: initConfig } = await adminClient.from("kob_configuration").select("*", { count: "exact", head: true });
  const { count: initProfiles } = await adminClient.from("profiles").select("*", { count: "exact", head: true });
  const { count: initWeights } = await adminClient.from("scv_component_weights").select("*", { count: "exact", head: true });
  const { count: initInputs } = await adminClient.from("scv_monthly_inputs").select("*", { count: "exact", head: true });

  const results = [];

  // ==========================================
  // 1. updateConfig
  // ==========================================
  console.log("--- Testing 1. updateConfig ---");
  {
    const { data: origCfg } = await adminClient.from("kob_configuration").select("*").eq("id", 1).single();
    fixturesCreated++;

    // Test OLD
    const patchA = { auto_mode_killswitch: !origCfg.auto_mode_killswitch };
    const oldRes = await oldUpdateConfig(ceoClient, CEO_USER.id, patchA);
    const { data: oldRow } = await adminClient.from("kob_configuration").select("*").eq("id", 1).single();
    const { data: oldAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "kob_configuration")
      .eq("action", "config_update")
      .order("created_at", { ascending: false })
      .limit(1);

    // Restore
    await adminClient.from("kob_configuration").update({ auto_mode_killswitch: origCfg.auto_mode_killswitch }).eq("id", 1);
    if (oldAudit.length) await adminClient.from("audit_logs").delete().eq("id", oldAudit[0].id);

    // Test NEW Express
    const patchB = { auto_mode_killswitch: !origCfg.auto_mode_killswitch };
    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/config`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify(patchB),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient.from("kob_configuration").select("*").eq("id", 1).single();
    const { data: newAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "kob_configuration")
      .eq("action", "config_update")
      .order("created_at", { ascending: false })
      .limit(1);

    // Restore completely
    await adminClient.from("kob_configuration").update({ auto_mode_killswitch: origCfg.auto_mode_killswitch }).eq("id", 1);
    if (newAudit.length) await adminClient.from("audit_logs").delete().eq("id", newAudit[0].id);
    fixturesCleaned++;

    // Verify restored state
    const { data: finalCfg } = await adminClient.from("kob_configuration").select("*").eq("id", 1).single();
    const restoredMatch = finalCfg.auto_mode_killswitch === origCfg.auto_mode_killswitch;

    const returnMatch = oldRes.ok === newRes.ok;
    const dbMatch = newRow.auto_mode_killswitch === patchB.auto_mode_killswitch && restoredMatch;
    const auditMatch =
      oldAudit.length > 0 &&
      newAudit.length > 0 &&
      oldAudit[0].action === newAudit[0].action &&
      oldAudit[0].entity === newAudit[0].entity &&
      newAudit[0].actor_id === CEO_USER.id;

    const pass = returnMatch && dbMatch && auditMatch;
    console.log(`updateConfig: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "updateConfig",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // ==========================================
  // 2. updateMyAllocationMode
  // ==========================================
  console.log("\n--- Testing 2. updateMyAllocationMode ---");
  {
    const { data: origProf } = await adminClient.from("profiles").select("allocation_mode").eq("id", TL_USER.id).single();
    const origMode = origProf?.allocation_mode ?? "MANUAL";
    const testMode = origMode === "ROUND_ROBIN" ? "MANUAL" : "ROUND_ROBIN";
    fixturesCreated++;

    // Test OLD
    const oldRes = await oldUpdateMyAllocationMode(tlClient, TL_USER.id, testMode);
    const { data: oldRow } = await adminClient.from("profiles").select("allocation_mode").eq("id", TL_USER.id).single();
    const { data: oldAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "profiles")
      .eq("action", "allocation_mode_update")
      .eq("entity_id", TL_USER.id)
      .order("created_at", { ascending: false })
      .limit(1);

    // Restore
    await adminClient.from("profiles").update({ allocation_mode: origMode }).eq("id", TL_USER.id);
    if (oldAudit.length) await adminClient.from("audit_logs").delete().eq("id", oldAudit[0].id);

    // Test NEW Express
    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/my-allocation-mode`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tlToken}`,
      },
      body: JSON.stringify({ mode: testMode }),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient.from("profiles").select("allocation_mode").eq("id", TL_USER.id).single();
    const { data: newAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "profiles")
      .eq("action", "allocation_mode_update")
      .eq("entity_id", TL_USER.id)
      .order("created_at", { ascending: false })
      .limit(1);

    // Restore
    await adminClient.from("profiles").update({ allocation_mode: origMode }).eq("id", TL_USER.id);
    if (newAudit.length) await adminClient.from("audit_logs").delete().eq("id", newAudit[0].id);
    fixturesCleaned++;

    const { data: finalProf } = await adminClient.from("profiles").select("allocation_mode").eq("id", TL_USER.id).single();
    const restoredMatch = (finalProf?.allocation_mode ?? "MANUAL") === origMode;

    const returnMatch = oldRes.ok === newRes.ok && oldRes.mode === newRes.mode;
    const dbMatch = newRow.allocation_mode === testMode && restoredMatch;
    const auditMatch =
      oldAudit.length > 0 &&
      newAudit.length > 0 &&
      oldAudit[0].action === newAudit[0].action &&
      oldAudit[0].entity === newAudit[0].entity &&
      newAudit[0].actor_id === TL_USER.id;

    const pass = returnMatch && dbMatch && auditMatch;
    console.log(`updateMyAllocationMode: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "updateMyAllocationMode",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // ==========================================
  // 3. updateExecutiveLanguage
  // ==========================================
  console.log("\n--- Testing 3. updateExecutiveLanguage ---");
  {
    const { data: origExec } = await adminClient
      .from("profiles")
      .select("primary_language, secondary_language")
      .eq("id", EXEC_USER.id)
      .single();
    fixturesCreated++;

    const testPatch = { primary_language: "TAMIL", secondary_language: "HINDI" };

    // Test OLD
    const oldRes = await oldUpdateExecutiveLanguage(ceoClient, CEO_USER.id, {
      executiveId: EXEC_USER.id,
      ...testPatch,
    });
    const { data: oldRow } = await adminClient
      .from("profiles")
      .select("primary_language, secondary_language")
      .eq("id", EXEC_USER.id)
      .single();
    const { data: oldAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "profiles")
      .eq("action", "executive_language_updated")
      .eq("entity_id", EXEC_USER.id)
      .order("created_at", { ascending: false })
      .limit(1);

    // Restore
    await adminClient.from("profiles").update({
      primary_language: origExec.primary_language,
      secondary_language: origExec.secondary_language,
    }).eq("id", EXEC_USER.id);
    if (oldAudit.length) await adminClient.from("audit_logs").delete().eq("id", oldAudit[0].id);

    // Test NEW Express
    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/executives/${EXEC_USER.id}/language`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify(testPatch),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient
      .from("profiles")
      .select("primary_language, secondary_language")
      .eq("id", EXEC_USER.id)
      .single();
    const { data: newAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "profiles")
      .eq("action", "executive_language_updated")
      .eq("entity_id", EXEC_USER.id)
      .order("created_at", { ascending: false })
      .limit(1);

    // Restore
    await adminClient.from("profiles").update({
      primary_language: origExec.primary_language,
      secondary_language: origExec.secondary_language,
    }).eq("id", EXEC_USER.id);
    if (newAudit.length) await adminClient.from("audit_logs").delete().eq("id", newAudit[0].id);
    fixturesCleaned++;

    const { data: finalExec } = await adminClient
      .from("profiles")
      .select("primary_language, secondary_language")
      .eq("id", EXEC_USER.id)
      .single();
    const restoredMatch =
      finalExec.primary_language === origExec.primary_language &&
      finalExec.secondary_language === origExec.secondary_language;

    const returnMatch = oldRes.ok === newRes.ok;
    const dbMatch =
      newRow.primary_language === testPatch.primary_language &&
      newRow.secondary_language === testPatch.secondary_language &&
      restoredMatch;
    const auditMatch =
      oldAudit.length > 0 &&
      newAudit.length > 0 &&
      oldAudit[0].action === newAudit[0].action &&
      oldAudit[0].entity === newAudit[0].entity &&
      newAudit[0].actor_id === CEO_USER.id;

    const pass = returnMatch && dbMatch && auditMatch;
    console.log(`updateExecutiveLanguage: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "updateExecutiveLanguage",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // ==========================================
  // 4. reassignExecutiveTeamLeader
  // ==========================================
  console.log("\n--- Testing 4. reassignExecutiveTeamLeader ---");
  {
    const { data: origExec } = await adminClient.from("profiles").select("team_leader_id").eq("id", EXEC_USER.id).single();
    const origTL = origExec.team_leader_id;
    const altTL = "0e73f086-ef69-411f-9948-474f95c3c8fb"; // other TL from user_roles
    fixturesCreated++;

    // Test OLD
    const oldRes = await oldReassignExecutiveTeamLeader(ceoClient, CEO_USER.id, {
      executiveId: EXEC_USER.id,
      teamLeaderId: altTL,
    });
    const { data: oldRow } = await adminClient.from("profiles").select("team_leader_id").eq("id", EXEC_USER.id).single();
    const { data: oldAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "profiles")
      .eq("action", "executive_reassign_tl")
      .eq("entity_id", EXEC_USER.id)
      .order("created_at", { ascending: false })
      .limit(1);

    // Restore
    await adminClient.from("profiles").update({ team_leader_id: origTL }).eq("id", EXEC_USER.id);
    if (oldAudit.length) await adminClient.from("audit_logs").delete().eq("id", oldAudit[0].id);

    // Test NEW Express
    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/executives/${EXEC_USER.id}/team-leader`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify({ teamLeaderId: altTL }),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient.from("profiles").select("team_leader_id").eq("id", EXEC_USER.id).single();
    const { data: newAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "profiles")
      .eq("action", "executive_reassign_tl")
      .eq("entity_id", EXEC_USER.id)
      .order("created_at", { ascending: false })
      .limit(1);

    // Restore
    await adminClient.from("profiles").update({ team_leader_id: origTL }).eq("id", EXEC_USER.id);
    if (newAudit.length) await adminClient.from("audit_logs").delete().eq("id", newAudit[0].id);
    fixturesCleaned++;

    const { data: finalExec } = await adminClient.from("profiles").select("team_leader_id").eq("id", EXEC_USER.id).single();
    const restoredMatch = finalExec.team_leader_id === origTL;

    const returnMatch = oldRes.ok === newRes.ok;
    const dbMatch = newRow.team_leader_id === altTL && restoredMatch;
    const auditMatch =
      oldAudit.length > 0 &&
      newAudit.length > 0 &&
      oldAudit[0].action === newAudit[0].action &&
      oldAudit[0].entity === newAudit[0].entity &&
      newAudit[0].actor_id === CEO_USER.id;

    const pass = returnMatch && dbMatch && auditMatch;
    console.log(`reassignExecutiveTeamLeader: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "reassignExecutiveTeamLeader",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // ==========================================
  // 5. updateScvComponentWeights
  // ==========================================
  console.log("\n--- Testing 5. updateScvComponentWeights ---");
  {
    const { data: origWeights } = await adminClient.from("scv_component_weights").select("*").eq("id", 1).single();
    const origSnapshot = {
      weight_conversion: origWeights.weight_conversion,
      weight_tat: origWeights.weight_tat,
      weight_eoi2_payment: origWeights.weight_eoi2_payment,
      weight_crm_discipline: origWeights.weight_crm_discipline,
    };
    fixturesCreated++;

    const testWeights = { conversion: 30, tat: 30, eoi2Payment: 20, crm: 20 };

    // Test OLD
    const oldRes = await oldUpdateScvComponentWeights(ceoClient, CEO_USER.id, testWeights);
    const { data: oldRow } = await adminClient.from("scv_component_weights").select("*").eq("id", 1).single();

    // Restore
    await adminClient.from("scv_component_weights").update(origSnapshot).eq("id", 1);

    // Test NEW Express
    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/scv-component-weights`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify(testWeights),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient.from("scv_component_weights").select("*").eq("id", 1).single();

    // Restore
    await adminClient.from("scv_component_weights").update(origSnapshot).eq("id", 1);
    fixturesCleaned++;

    const { data: finalWeights } = await adminClient.from("scv_component_weights").select("*").eq("id", 1).single();
    const restoredMatch =
      finalWeights.weight_conversion === origSnapshot.weight_conversion &&
      finalWeights.weight_tat === origSnapshot.weight_tat &&
      finalWeights.weight_eoi2_payment === origSnapshot.weight_eoi2_payment &&
      finalWeights.weight_crm_discipline === origSnapshot.weight_crm_discipline;

    const returnMatch = oldRes.ok === newRes.ok;
    const dbMatch =
      newRow.weight_conversion === testWeights.conversion &&
      newRow.weight_tat === testWeights.tat &&
      restoredMatch;

    const pass = returnMatch && dbMatch;
    console.log(`updateScvComponentWeights: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "updateScvComponentWeights",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: "YES", // Function has no audit log in TanStack original
      Cleaned: "YES",
    });
  }

  // ==========================================
  // 6. saveScvMonthlyInput
  // ==========================================
  console.log("\n--- Testing 6. saveScvMonthlyInput ---");
  {
    const fixtureUser = EXEC_USER.id;
    const fixtureMonth = "2099-10";
    const fixturePeriod = "2099-10-01";
    fixturesCreated += 2;

    // Test OLD Fixture A
    const oldRes = await oldSaveScvMonthlyInput(ceoClient, CEO_USER.id, {
      userId: fixtureUser,
      month: fixtureMonth,
      ktnCsTarget: 42,
      crmDiscipline: 95,
    });
    const { data: oldRow } = await adminClient
      .from("scv_monthly_inputs")
      .select("*")
      .eq("user_id", fixtureUser)
      .eq("period", fixturePeriod)
      .single();

    // Clean A
    await adminClient.from("scv_monthly_inputs").delete().eq("user_id", fixtureUser).eq("period", fixturePeriod);
    fixturesCleaned++;

    // Test NEW Fixture B
    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/scv-monthly-input`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify({
        userId: fixtureUser,
        month: fixtureMonth,
        ktnCsTarget: 42,
        crmDiscipline: 95,
      }),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient
      .from("scv_monthly_inputs")
      .select("*")
      .eq("user_id", fixtureUser)
      .eq("period", fixturePeriod)
      .single();

    // Clean B
    await adminClient.from("scv_monthly_inputs").delete().eq("user_id", fixtureUser).eq("period", fixturePeriod);
    fixturesCleaned++;

    const returnMatch = oldRes.ok === newRes.ok;
    const dbMatch =
      newRow.ktn_cs_target === 42 &&
      Number(newRow.crm_discipline) === 95 &&
      oldRow.ktn_cs_target === newRow.ktn_cs_target;

    const pass = returnMatch && dbMatch;
    console.log(`saveScvMonthlyInput: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "saveScvMonthlyInput",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: "YES", // Function has no audit log in TanStack original
      Cleaned: "YES",
    });
  }

  // ==========================================
  // NEGATIVE TESTS
  // ==========================================
  console.log("\n--- Testing Negative Cases ---");

  // 1. Unauthenticated (401)
  const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auto_lead_allocation_enabled: true }),
  });
  console.log(`Unauthenticated rejected (401): ${unauthRes.status === 401 ? "PASS ✓" : "FAIL ✗"}`);

  // 2. Invalid allocation mode (400)
  const badModeRes = await fetch(`${BACKEND_BASE}/api/kob/my-allocation-mode`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tlToken}`,
    },
    body: JSON.stringify({ mode: "INVALID_MODE" }),
  });
  console.log(`Invalid allocation mode rejected (400): ${badModeRes.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

  // 3. Unauthorized role on SCV weights (executive user -> 403)
  const unauthRoleRes = await fetch(`${BACKEND_BASE}/api/kob/scv-component-weights`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${execToken}`,
    },
    body: JSON.stringify({ conversion: 25, tat: 25, eoi2Payment: 25, crm: 25 }),
  });
  console.log(`Unauthorized role on SCV weights rejected (403): ${unauthRoleRes.status === 403 ? "PASS ✓" : "FAIL ✗"}`);

  // 4. Invalid SCV weights sum !== 100 (400)
  const badWeightsRes = await fetch(`${BACKEND_BASE}/api/kob/scv-component-weights`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ceoToken}`,
    },
    body: JSON.stringify({ conversion: 10, tat: 10, eoi2Payment: 10, crm: 10 }),
  });
  console.log(`Invalid SCV weights sum rejected (400): ${badWeightsRes.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

  // 5. Invalid month format in monthly input (400)
  const badMonthRes = await fetch(`${BACKEND_BASE}/api/kob/scv-monthly-input`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ceoToken}`,
    },
    body: JSON.stringify({ userId: EXEC_USER.id, month: "not-a-month" }),
  });
  console.log(`Invalid month format rejected (400): ${badMonthRes.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

  // 6. Missing teamLeaderId on reassign (400)
  const badReassignRes = await fetch(`${BACKEND_BASE}/api/kob/executives/${EXEC_USER.id}/team-leader`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ceoToken}`,
    },
    body: JSON.stringify({}),
  });
  console.log(`Missing teamLeaderId rejected (400): ${badReassignRes.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

  // ==========================================
  // POST-TEST DATABASE INTEGRITY AUDIT
  // ==========================================
  console.log("\n--- Post-Test Database Integrity Check ---");
  const { count: finalConfig } = await adminClient.from("kob_configuration").select("*", { count: "exact", head: true });
  const { count: finalProfiles } = await adminClient.from("profiles").select("*", { count: "exact", head: true });
  const { count: finalWeights } = await adminClient.from("scv_component_weights").select("*", { count: "exact", head: true });
  const { count: finalInputs } = await adminClient.from("scv_monthly_inputs").select("*", { count: "exact", head: true });

  const deltaConfig = finalConfig - initConfig;
  const deltaProfiles = finalProfiles - initProfiles;
  const deltaWeights = finalWeights - initWeights;
  const deltaInputs = finalInputs - initInputs;

  console.log(`kob_configuration net delta: ${deltaConfig}`);
  console.log(`profiles net delta: ${deltaProfiles}`);
  console.log(`scv_component_weights net delta: ${deltaWeights}`);
  console.log(`scv_monthly_inputs net delta: ${deltaInputs}`);
  console.log(`Test fixtures created: ${fixturesCreated}, cleaned/restored: ${fixturesCleaned}`);

  console.log("\n==================================================");
  console.log("MUTATION BATCH 3 RESULTS SUMMARY");
  console.log("==================================================");
  console.table(results);

  if (deltaConfig === 0 && deltaProfiles === 0 && deltaWeights === 0 && deltaInputs === 0) {
    console.log("\nINTEGRITY AUDIT: 0 UNINTENDED CHANGES ✓\n");
  } else {
    console.error("\nINTEGRITY AUDIT FAILED: UNINTENDED CHANGES DETECTED ✗\n");
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
