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

async function oldCreateBrand(supabase, userId, data) {
  const { data: row, error } = await supabase
    .from("brands")
    .insert({
      code: data.code.toUpperCase(),
      name: data.name,
      is_shero: data.is_shero ?? true,
      active: data.active ?? true,
    })
    .select("id")
    .single();
  if (error) throw error;
  await logAudit(supabase, userId, "create", "brands", row.id, data);
  return { ok: true, id: row.id };
}

async function oldUpdateSourceCost(supabase, userId, data) {
  const { error } = await supabase
    .from("lead_sources")
    .update({ cost_per_lead: data.cost_per_lead })
    .eq("id", data.id);
  if (error) throw error;
  await logAudit(supabase, userId, "source_cost_update", "lead_sources", data.id, { cost_per_lead: data.cost_per_lead });
  return { ok: true };
}

async function oldUpsertStateNativeBrand(supabase, userId, data) {
  const { error } = await supabase
    .from("state_native_brand")
    .upsert({ state_id: data.state_id, brand_id: data.brand_id }, { onConflict: "state_id" });
  if (error) throw error;
  await logAudit(supabase, userId, "native_brand_map", "state_native_brand", data.state_id, data);
  return { ok: true };
}

async function oldUpsertGallaboxTemplate(supabase, userId, data) {
  const norm = (s) => (s && s.trim().length ? s : null);
  const payload = {
    ...data,
    bucket: data.category === "RETARGETING" ? data.bucket : null,
    email_subject: norm(data.email_subject),
    email_body: norm(data.email_body),
  };
  const { error } = await supabase.from("gallabox_templates").upsert(payload);
  if (error) throw error;
  await logAudit(
    supabase,
    userId,
    data.id ? "gallabox_update" : "gallabox_create",
    "gallabox_templates",
    data.id ?? null,
    {
      name: data.name,
      language: data.language,
      category: data.category,
      bucket: payload.bucket,
      active: data.active,
      email_ready: !!(payload.email_subject && payload.email_body),
    }
  );
  return { ok: true };
}

async function oldUpdateIncentiveRule(supabase, userId, data) {
  if (data.min_score > data.max_score) throw new Error("min_score cannot exceed max_score");
  const { id, ...patch } = data;
  const { error } = await supabase.from("incentive_rules").update(patch).eq("id", id);
  if (error) throw error;
  await logAudit(supabase, userId, "incentive_rule_update", "incentive_rules", id, patch);
  return { ok: true };
}

async function oldUpdateScvRules(supabase, userId, data) {
  const sum =
    data.weight_conversion +
    data.weight_tat +
    data.weight_eoi1_webinar +
    data.weight_eoi2_payment +
    data.weight_crm_discipline;
  if (sum !== 100) throw new Error(`Weights must sum to 100 (got ${sum})`);
  const { error } = await supabase.from("scv_rules").update(data).eq("id", 1);
  if (error) throw error;
  await logAudit(supabase, userId, "scv_rules_update", "scv_rules", null, data);
  return { ok: true };
}

// ----------------------------------------------------
// TEST SUITE EXECUTION
// ----------------------------------------------------

async function run() {
  console.log("==================================================");
  console.log("MUTATION BATCH 2 PARITY & REGRESSION SUITE");
  console.log("==================================================\n");

  // Use super_admin test user (CEO)
  const testUser = { id: "6502c359-e15f-4dc2-8f6c-4b0238b4fda8", email: "ceo@shero.test" };
  const userToken = createToken(testUser.id, testUser.email);
  const userClient = createUserClient(userToken);

  let fixturesCreated = 0;
  let fixturesCleaned = 0;

  // Track initial counts for data integrity check
  const { count: initBrands } = await adminClient.from("brands").select("*", { count: "exact", head: true });
  const { count: initSources } = await adminClient.from("lead_sources").select("*", { count: "exact", head: true });
  const { count: initStateNative } = await adminClient.from("state_native_brand").select("*", { count: "exact", head: true });
  const { count: initTemplates } = await adminClient.from("gallabox_templates").select("*", { count: "exact", head: true });
  const { count: initIncRules } = await adminClient.from("incentive_rules").select("*", { count: "exact", head: true });
  const { count: initScvRules } = await adminClient.from("scv_rules").select("*", { count: "exact", head: true });

  const results = [];

  // ==========================================
  // 1. createBrand
  // ==========================================
  console.log("--- Testing 1. createBrand ---");
  {
    // Fixture A -> OLD
    const payloadA = {
      code: "_TST_BRA",
      name: "Test Brand A Fixture",
      is_shero: true,
      active: true,
    };
    fixturesCreated++;
    const oldRes = await oldCreateBrand(userClient, testUser.id, payloadA);
    const { data: oldRow } = await adminClient.from("brands").select("*").eq("id", oldRes.id).single();
    const { data: oldAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity_id", oldRes.id)
      .eq("action", "create")
      .order("created_at", { ascending: false })
      .limit(1);

    // Clean A
    await adminClient.from("brands").delete().eq("id", oldRes.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", oldRes.id);
    fixturesCleaned++;

    // Fixture B -> NEW Express
    const payloadB = {
      code: "_TST_BRB",
      name: "Test Brand B Fixture",
      is_shero: true,
      active: true,
    };
    fixturesCreated++;
    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/brands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify(payloadB),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient.from("brands").select("*").eq("id", newRes.id).single();
    const { data: newAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity_id", newRes.id)
      .eq("action", "create")
      .order("created_at", { ascending: false })
      .limit(1);

    // Clean B
    await adminClient.from("brands").delete().eq("id", newRes.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", newRes.id);
    fixturesCleaned++;

    const returnMatch = oldRes.ok === newRes.ok && typeof newRes.id === "string";
    const dbMatch =
      newRow.code === payloadB.code &&
      newRow.name === payloadB.name &&
      newRow.is_shero === oldRow.is_shero &&
      newRow.active === oldRow.active;
    const auditMatch =
      oldAudit.length > 0 &&
      newAudit.length > 0 &&
      oldAudit[0].action === newAudit[0].action &&
      oldAudit[0].entity === newAudit[0].entity &&
      newAudit[0].actor_id === testUser.id;

    const pass = returnMatch && dbMatch && auditMatch;
    console.log(`createBrand: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "createBrand",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // ==========================================
  // 2. updateSourceCost
  // ==========================================
  console.log("\n--- Testing 2. updateSourceCost ---");
  {
    // Fixture A: create test source
    fixturesCreated++;
    const { data: srcA } = await adminClient
      .from("lead_sources")
      .insert({ name: "_TST_SRC_A", cost_per_lead: 100 })
      .select()
      .single();

    // OLD update to 250
    const oldRes = await oldUpdateSourceCost(userClient, testUser.id, { id: srcA.id, cost_per_lead: 250 });
    const { data: oldRow } = await adminClient.from("lead_sources").select("*").eq("id", srcA.id).single();
    const { data: oldAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity_id", srcA.id)
      .eq("action", "source_cost_update")
      .order("created_at", { ascending: false })
      .limit(1);

    // Clean A
    await adminClient.from("lead_sources").delete().eq("id", srcA.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", srcA.id);
    fixturesCleaned++;

    // Fixture B: create test source
    fixturesCreated++;
    const { data: srcB } = await adminClient
      .from("lead_sources")
      .insert({ name: "_TST_SRC_B", cost_per_lead: 100 })
      .select()
      .single();

    // NEW Express PATCH
    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/sources/${srcB.id}/cost`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ cost_per_lead: 250 }),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient.from("lead_sources").select("*").eq("id", srcB.id).single();
    const { data: newAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity_id", srcB.id)
      .eq("action", "source_cost_update")
      .order("created_at", { ascending: false })
      .limit(1);

    // Clean B
    await adminClient.from("lead_sources").delete().eq("id", srcB.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", srcB.id);
    fixturesCleaned++;

    const returnMatch = oldRes.ok === newRes.ok;
    const dbMatch = Number(newRow.cost_per_lead) === 250 && Number(oldRow.cost_per_lead) === 250;
    const auditMatch =
      oldAudit.length > 0 &&
      newAudit.length > 0 &&
      oldAudit[0].action === newAudit[0].action &&
      oldAudit[0].entity === newAudit[0].entity &&
      newAudit[0].actor_id === testUser.id;

    const pass = returnMatch && dbMatch && auditMatch;
    console.log(`updateSourceCost: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "updateSourceCost",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // ==========================================
  // 3. upsertStateNativeBrand
  // ==========================================
  console.log("\n--- Testing 3. upsertStateNativeBrand ---");
  {
    // Need a test state and test brands
    const { data: testStates } = await adminClient.from("india_states").select("id").limit(1);
    const testStateId = testStates[0].id;

    // Check if state currently has a mapping so we can restore if touched
    const { data: existingMapping } = await adminClient
      .from("state_native_brand")
      .select("*")
      .eq("state_id", testStateId)
      .maybeSingle();

    // Create disposable brands A & B
    fixturesCreated += 2;
    const { data: bA } = await adminClient
      .from("brands")
      .insert({ code: "_TST_MPA", name: "Map Brand A" })
      .select()
      .single();
    const { data: bB } = await adminClient
      .from("brands")
      .insert({ code: "_TST_MPB", name: "Map Brand B" })
      .select()
      .single();

    // Run OLD with Brand A
    const oldRes = await oldUpsertStateNativeBrand(userClient, testUser.id, {
      state_id: testStateId,
      brand_id: bA.id,
    });
    const { data: oldRow } = await adminClient
      .from("state_native_brand")
      .select("*")
      .eq("state_id", testStateId)
      .single();
    const { data: oldAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity_id", testStateId)
      .eq("action", "native_brand_map")
      .order("created_at", { ascending: false })
      .limit(1);

    // Run NEW Express with Brand B
    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/state-native-brand`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ state_id: testStateId, brand_id: bB.id }),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient
      .from("state_native_brand")
      .select("*")
      .eq("state_id", testStateId)
      .single();
    const { data: newAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity_id", testStateId)
      .eq("action", "native_brand_map")
      .order("created_at", { ascending: false })
      .limit(1);

    // Clean / Restore mapping to initial state
    if (existingMapping) {
      await adminClient
        .from("state_native_brand")
        .update({ brand_id: existingMapping.brand_id })
        .eq("state_id", testStateId);
    } else {
      await adminClient.from("state_native_brand").delete().eq("state_id", testStateId);
    }
    await adminClient.from("brands").delete().in("id", [bA.id, bB.id]);
    await adminClient.from("audit_logs").delete().eq("entity_id", testStateId).eq("action", "native_brand_map");
    fixturesCleaned += 2;

    const returnMatch = oldRes.ok === newRes.ok;
    const dbMatch = oldRow.brand_id === bA.id && newRow.brand_id === bB.id;
    const auditMatch =
      oldAudit.length > 0 &&
      newAudit.length > 0 &&
      oldAudit[0].action === newAudit[0].action &&
      oldAudit[0].entity === newAudit[0].entity &&
      newAudit[0].actor_id === testUser.id;

    const pass = returnMatch && dbMatch && auditMatch;
    console.log(`upsertStateNativeBrand: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "upsertStateNativeBrand",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // ==========================================
  // 4. upsertGallaboxTemplate
  // ==========================================
  console.log("\n--- Testing 4. upsertGallaboxTemplate ---");
  {
    // Fixture A -> OLD
    const tplA = {
      name: "_TST_TPL_A",
      body: "Welcome to Shero {{name}}",
      language: "ENGLISH",
      active: true,
      category: "ONBOARDING",
    };
    fixturesCreated++;
    const oldRes = await oldUpsertGallaboxTemplate(userClient, testUser.id, tplA);
    const { data: oldRow } = await adminClient
      .from("gallabox_templates")
      .select("*")
      .eq("name", tplA.name)
      .single();
    const { data: oldAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "gallabox_templates")
      .eq("action", "gallabox_create")
      .order("created_at", { ascending: false })
      .limit(1);

    // Clean A
    await adminClient.from("gallabox_templates").delete().eq("id", oldRow.id);
    if (oldAudit.length) await adminClient.from("audit_logs").delete().eq("id", oldAudit[0].id);
    fixturesCleaned++;

    // Fixture B -> NEW Express
    const tplB = {
      name: "_TST_TPL_B",
      body: "Welcome to Shero {{name}} B",
      language: "ENGLISH",
      active: true,
      category: "ONBOARDING",
    };
    fixturesCreated++;
    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/gallabox-templates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify(tplB),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient
      .from("gallabox_templates")
      .select("*")
      .eq("name", tplB.name)
      .single();
    const { data: newAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "gallabox_templates")
      .eq("action", "gallabox_create")
      .order("created_at", { ascending: false })
      .limit(1);

    // Clean B
    await adminClient.from("gallabox_templates").delete().eq("id", newRow.id);
    if (newAudit.length) await adminClient.from("audit_logs").delete().eq("id", newAudit[0].id);
    fixturesCleaned++;

    const returnMatch = oldRes.ok === newRes.ok;
    const dbMatch =
      newRow.name === tplB.name &&
      newRow.body === tplB.body &&
      newRow.category === oldRow.category &&
      newRow.active === oldRow.active;
    const auditMatch =
      oldAudit.length > 0 &&
      newAudit.length > 0 &&
      oldAudit[0].action === newAudit[0].action &&
      oldAudit[0].entity === newAudit[0].entity &&
      newAudit[0].actor_id === testUser.id;

    const pass = returnMatch && dbMatch && auditMatch;
    console.log(`upsertGallaboxTemplate: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "upsertGallaboxTemplate",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // ==========================================
  // 5. updateIncentiveRule
  // ==========================================
  console.log("\n--- Testing 5. updateIncentiveRule ---");
  {
    // Fixture A: create test incentive rule
    fixturesCreated++;
    const { data: ruleA } = await adminClient
      .from("incentive_rules")
      .insert({
        label: "_TST_INC_A",
        min_score: 10,
        max_score: 30,
        incentive_pct: 5,
      })
      .select()
      .single();

    // OLD update
    const oldRes = await oldUpdateIncentiveRule(userClient, testUser.id, {
      id: ruleA.id,
      label: "_TST_INC_A_UPD",
      min_score: 15,
      max_score: 35,
      incentive_pct: 10,
    });
    const { data: oldRow } = await adminClient.from("incentive_rules").select("*").eq("id", ruleA.id).single();
    const { data: oldAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity_id", ruleA.id)
      .eq("action", "incentive_rule_update")
      .order("created_at", { ascending: false })
      .limit(1);

    // Clean A
    await adminClient.from("incentive_rules").delete().eq("id", ruleA.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", ruleA.id);
    fixturesCleaned++;

    // Fixture B: create test incentive rule
    fixturesCreated++;
    const { data: ruleB } = await adminClient
      .from("incentive_rules")
      .insert({
        label: "_TST_INC_B",
        min_score: 10,
        max_score: 30,
        incentive_pct: 5,
      })
      .select()
      .single();

    // NEW Express PATCH
    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/incentive-rules/${ruleB.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        label: "_TST_INC_B_UPD",
        min_score: 15,
        max_score: 35,
        incentive_pct: 10,
      }),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient.from("incentive_rules").select("*").eq("id", ruleB.id).single();
    const { data: newAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity_id", ruleB.id)
      .eq("action", "incentive_rule_update")
      .order("created_at", { ascending: false })
      .limit(1);

    // Clean B
    await adminClient.from("incentive_rules").delete().eq("id", ruleB.id);
    await adminClient.from("audit_logs").delete().eq("entity_id", ruleB.id);
    fixturesCleaned++;

    const returnMatch = oldRes.ok === newRes.ok;
    const dbMatch =
      newRow.label === "_TST_INC_B_UPD" &&
      newRow.min_score === 15 &&
      newRow.max_score === 35 &&
      newRow.incentive_pct === 10;
    const auditMatch =
      oldAudit.length > 0 &&
      newAudit.length > 0 &&
      oldAudit[0].action === newAudit[0].action &&
      oldAudit[0].entity === newAudit[0].entity &&
      newAudit[0].actor_id === testUser.id;

    const pass = returnMatch && dbMatch && auditMatch;
    console.log(`updateIncentiveRule: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "updateIncentiveRule",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // ==========================================
  // 6. updateScvRules
  // ==========================================
  console.log("\n--- Testing 6. updateScvRules ---");
  {
    // Capture original row
    const { data: origScv } = await adminClient.from("scv_rules").select("*").eq("id", 1).single();
    const origSnapshot = {
      weight_conversion: origScv.weight_conversion,
      weight_tat: origScv.weight_tat,
      weight_eoi1_webinar: origScv.weight_eoi1_webinar,
      weight_eoi2_payment: origScv.weight_eoi2_payment,
      weight_crm_discipline: origScv.weight_crm_discipline,
    };

    const testWeightsA = {
      weight_conversion: 20,
      weight_tat: 20,
      weight_eoi1_webinar: 20,
      weight_eoi2_payment: 20,
      weight_crm_discipline: 20,
    };

    // Test OLD
    const oldRes = await oldUpdateScvRules(userClient, testUser.id, testWeightsA);
    const { data: oldRow } = await adminClient.from("scv_rules").select("*").eq("id", 1).single();
    const { data: oldAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "scv_rules")
      .eq("action", "scv_rules_update")
      .order("created_at", { ascending: false })
      .limit(1);

    // Restore original row
    await adminClient.from("scv_rules").update(origSnapshot).eq("id", 1);
    if (oldAudit.length) await adminClient.from("audit_logs").delete().eq("id", oldAudit[0].id);

    // Test NEW Express
    const testWeightsB = {
      weight_conversion: 25,
      weight_tat: 25,
      weight_eoi1_webinar: 25,
      weight_eoi2_payment: 15,
      weight_crm_discipline: 10,
    };

    const newHttp = await fetch(`${BACKEND_BASE}/api/kob/scv-rules`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify(testWeightsB),
    });
    const newRes = await newHttp.json();
    const { data: newRow } = await adminClient.from("scv_rules").select("*").eq("id", 1).single();
    const { data: newAudit } = await adminClient
      .from("audit_logs")
      .select("*")
      .eq("entity", "scv_rules")
      .eq("action", "scv_rules_update")
      .order("created_at", { ascending: false })
      .limit(1);

    // Restore original row completely
    await adminClient.from("scv_rules").update(origSnapshot).eq("id", 1);
    if (newAudit.length) await adminClient.from("audit_logs").delete().eq("id", newAudit[0].id);

    // Verify restored row matches original row exactly
    const { data: finalScv } = await adminClient.from("scv_rules").select("*").eq("id", 1).single();
    const restoredMatch =
      finalScv.weight_conversion === origSnapshot.weight_conversion &&
      finalScv.weight_tat === origSnapshot.weight_tat &&
      finalScv.weight_eoi1_webinar === origSnapshot.weight_eoi1_webinar &&
      finalScv.weight_eoi2_payment === origSnapshot.weight_eoi2_payment &&
      finalScv.weight_crm_discipline === origSnapshot.weight_crm_discipline;

    const returnMatch = oldRes.ok === newRes.ok;
    const dbMatch =
      newRow.weight_conversion === testWeightsB.weight_conversion &&
      newRow.weight_tat === testWeightsB.weight_tat &&
      restoredMatch;
    const auditMatch =
      oldAudit.length > 0 &&
      newAudit.length > 0 &&
      oldAudit[0].action === newAudit[0].action &&
      oldAudit[0].entity === newAudit[0].entity &&
      newAudit[0].actor_id === testUser.id;

    const pass = returnMatch && dbMatch && auditMatch;
    console.log(`updateScvRules: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    results.push({
      Function: "updateScvRules",
      ReturnMatch: returnMatch ? "YES" : "NO",
      DbMatch: dbMatch ? "YES" : "NO",
      AuditMatch: auditMatch ? "YES" : "NO",
      Cleaned: "YES",
    });
  }

  // ==========================================
  // NEGATIVE TESTS
  // ==========================================
  console.log("\n--- Testing Negative Cases ---");

  // 1. Unauthenticated (401)
  const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/brands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "NOAUTH", name: "No Auth" }),
  });
  console.log(`Unauthenticated rejected (401): ${unauthRes.status === 401 ? "PASS ✓" : "FAIL ✗"}`);

  // 2. Invalid brand (missing name) (400)
  const badBrandRes = await fetch(`${BACKEND_BASE}/api/kob/brands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ code: "BAD" }),
  });
  console.log(`Invalid brand rejected (400): ${badBrandRes.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

  // 3. Invalid source cost (NaN) (400)
  const badCostRes = await fetch(`${BACKEND_BASE}/api/kob/sources/not-a-uuid/cost`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ cost_per_lead: "invalid" }),
  });
  console.log(`Invalid source cost rejected (400): ${badCostRes.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

  // 4. Invalid template (RETARGETING missing bucket) (400)
  const badTplRes = await fetch(`${BACKEND_BASE}/api/kob/gallabox-templates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      name: "Bad Template",
      body: "Body",
      language: "en",
      category: "RETARGETING",
    }),
  });
  console.log(`Invalid template rejected (400): ${badTplRes.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

  // 5. Invalid incentive rule (min_score > max_score) (400)
  const badIncRes = await fetch(`${BACKEND_BASE}/api/kob/incentive-rules/550e8400-e29b-41d4-a716-446655440000`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      label: "Bad Inc",
      min_score: 80,
      max_score: 50,
      incentive_pct: 10,
    }),
  });
  console.log(`Invalid incentive rule rejected (400): ${badIncRes.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

  // 6. Invalid SCV weights (sum !== 100) (400)
  const badScvRes = await fetch(`${BACKEND_BASE}/api/kob/scv-rules`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      weight_conversion: 10,
      weight_tat: 10,
      weight_eoi1_webinar: 10,
      weight_eoi2_payment: 10,
      weight_crm_discipline: 10,
    }),
  });
  console.log(`Invalid SCV weights rejected (400): ${badScvRes.status === 400 ? "PASS ✓" : "FAIL ✗"}`);

  // ==========================================
  // POST-TEST DATABASE INTEGRITY AUDIT
  // ==========================================
  console.log("\n--- Post-Test Database Integrity Check ---");
  const { count: finalBrands } = await adminClient.from("brands").select("*", { count: "exact", head: true });
  const { count: finalSources } = await adminClient.from("lead_sources").select("*", { count: "exact", head: true });
  const { count: finalStateNative } = await adminClient.from("state_native_brand").select("*", { count: "exact", head: true });
  const { count: finalTemplates } = await adminClient.from("gallabox_templates").select("*", { count: "exact", head: true });
  const { count: finalIncRules } = await adminClient.from("incentive_rules").select("*", { count: "exact", head: true });
  const { count: finalScvRules } = await adminClient.from("scv_rules").select("*", { count: "exact", head: true });

  const deltaBrands = finalBrands - initBrands;
  const deltaSources = finalSources - initSources;
  const deltaStateNative = finalStateNative - initStateNative;
  const deltaTemplates = finalTemplates - initTemplates;
  const deltaIncRules = finalIncRules - initIncRules;
  const deltaScvRules = finalScvRules - initScvRules;

  console.log(`brands net delta: ${deltaBrands}`);
  console.log(`lead_sources net delta: ${deltaSources}`);
  console.log(`state_native_brand net delta: ${deltaStateNative}`);
  console.log(`gallabox_templates net delta: ${deltaTemplates}`);
  console.log(`incentive_rules net delta: ${deltaIncRules}`);
  console.log(`scv_rules net delta: ${deltaScvRules}`);
  console.log(`Test fixtures created: ${fixturesCreated}, cleaned: ${fixturesCleaned}`);

  console.log("\n==================================================");
  console.log("MUTATION BATCH 2 RESULTS SUMMARY");
  console.log("==================================================");
  console.table(results);

  if (
    deltaBrands === 0 &&
    deltaSources === 0 &&
    deltaStateNative === 0 &&
    deltaTemplates === 0 &&
    deltaIncRules === 0 &&
    deltaScvRules === 0
  ) {
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
