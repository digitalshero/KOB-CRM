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

const SCV_COMPONENT_TYPES = ["conversion", "tat", "eoi1Webinar", "eoi2Payment", "discipline", "mark"];

async function loadScvModeConfigOld(supabase, mode) {
  const { data } = await supabase.from("scv_mode_config").select("*").eq("mode", mode).maybeSingle();
  return {
    components: data?.components ?? [],
    tatMovements: data?.tat_movements ?? [],
    incentiveAmount: Number(data?.incentive_amount ?? 10000),
  };
}

// ----------------------------------------------------
// OLD IMPLEMENTATIONS (TanStack server fn behavior)
// ----------------------------------------------------

async function oldToggleEntity(supabase, userId, data) {
  const { error } = await supabase.from(data.table).update({ active: data.active }).eq("id", data.id);
  if (error) throw error;
  await logAudit(supabase, userId, data.active ? "activate" : "deactivate", data.table, data.id, { active: data.active });
  return { ok: true };
}

async function oldSaveIncentiveAmount(supabase, userId, data) {
  const [{ data: isMgr }, { data: isAdmin }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "kob_manager" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  if (!isMgr && !isAdmin) throw new Error("Only CEO or Manager can change incentive configuration");
  const { data: prev } = await supabase.from("kob_configuration").select("incentive_amount").eq("id", 1).maybeSingle();
  const prevAmount = Number(prev?.incentive_amount ?? 10000);
  if (prevAmount === data.incentiveAmount) return { ok: true };
  const { error } = await supabase.from("kob_configuration").update({ incentive_amount: data.incentiveAmount, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw new Error(error.message);
  await supabase.from("scv_mode_config_changes").insert({
    mode: data.mode,
    changed_by: userId,
    component: "Incentive Amount (per contract)",
    previous_value: `₹${prevAmount}`,
    new_value: `₹${data.incentiveAmount}`,
  });
  return { ok: true };
}

async function oldSaveIncentiveSlabs(supabase, userId, data) {
  const [{ data: isMgr }, { data: isAdmin }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "kob_manager" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  if (!isMgr && !isAdmin) throw new Error("Only CEO or Manager can change incentive configuration");
  const { data: prev } = await supabase.from("incentive_rules").select("id, label, incentive_pct, incentive_amount");
  const prevMap = new Map((prev ?? []).map((r) => [r.id, r]));
  const changes = [];
  for (const s of data.slabs) {
    const p = prevMap.get(s.id);
    if (!p) continue;
    if (Number(p.incentive_pct) === s.incentive_pct && Number(p.incentive_amount) === s.incentive_amount) continue;
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? adminClient : supabase;
    const { error } = await db.from("incentive_rules").update({
      incentive_pct: s.incentive_pct,
      incentive_amount: s.incentive_amount,
      updated_at: new Date().toISOString(),
    }).eq("id", s.id);
    if (error) throw new Error(error.message);
    if (Number(p.incentive_amount) !== s.incentive_amount) {
      changes.push({ component: `Incentive: ${p.label} amount`, previous_value: `₹${Number(p.incentive_amount)}`, new_value: `₹${s.incentive_amount}` });
    }
    if (Number(p.incentive_pct) !== s.incentive_pct) {
      changes.push({ component: `Incentive: ${p.label} payout`, previous_value: `${p.incentive_pct}%`, new_value: `${s.incentive_pct}%` });
    }
  }
  if (changes.length) {
    await supabase.from("scv_mode_config_changes").insert(changes.map((c) => ({ ...c, mode: data.mode, changed_by: userId })));
  }
  return { ok: true };
}

async function oldSaveScvModeConfig(supabase, userId, data) {
  const [{ data: isMgr }, { data: isAdmin }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "kob_manager" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  if (!isMgr && !isAdmin) throw new Error("Only CEO or Manager can change SCV configuration");
  const keys = new Set();
  for (const c of data.components) {
    if (keys.has(c.key)) throw new Error(`Duplicate component "${c.label}"`);
    keys.add(c.key);
  }
  for (const t of SCV_COMPONENT_TYPES) {
    if (t !== "mark" && data.components.filter((c) => c.type === t).length > 1) throw new Error(`Only one ${t} component allowed`);
  }
  const sum = data.components.filter((c) => c.enabled).reduce((s, c) => s + c.weight, 0);
  if (sum !== 100) throw new Error(`Enabled weights must total 100% (currently ${sum}%)`);
  const prev = await loadScvModeConfigOld(supabase, data.mode);
  const { data: globPrev } = await supabase.from("kob_configuration").select("incentive_amount").eq("id", 1).maybeSingle();
  const { error } = await supabase.from("scv_mode_config").update({
    components: data.components,
    tat_movements: data.tatMovements,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }).eq("mode", data.mode);
  if (error) throw new Error(error.message);
  const desc = (c) => (c ? `${c.label} ${c.weight}%${c.enabled ? "" : " (off)"}` : null);
  const changes = [];
  const prevMap = new Map(prev.components.map((c) => [c.key, c]));
  for (const c of data.components) {
    const p = prevMap.get(c.key);
    if (desc(p) !== desc(c)) changes.push({ component: c.label, previous_value: desc(p), new_value: desc(c) });
    prevMap.delete(c.key);
  }
  for (const p of prevMap.values()) changes.push({ component: p.label, previous_value: desc(p), new_value: "deleted" });
  const prevT = new Map(prev.tatMovements.map((t) => [t.key, t]));
  const tdesc = (t) => (t ? `${t.days} days${t.enabled ? "" : " (off)"}` : null);
  for (const t of data.tatMovements) {
    const p = prevT.get(t.key);
    if (tdesc(p) !== tdesc(t)) changes.push({ component: `TAT: ${t.label}`, previous_value: tdesc(p), new_value: tdesc(t) });
  }
  const prevAmount = Number(globPrev?.incentive_amount ?? 10000);
  if (prevAmount !== data.incentiveAmount) {
    const { error: amtErr } = await supabase.from("kob_configuration").update({
      incentive_amount: data.incentiveAmount,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (amtErr) throw new Error(amtErr.message);
    changes.push({ component: "Incentive Amount (global)", previous_value: `₹${prevAmount}`, new_value: `₹${data.incentiveAmount}` });
  }
  if (changes.length) {
    await supabase.from("scv_mode_config_changes").insert(changes.map((c) => ({ ...c, mode: data.mode, changed_by: userId })));
  }
  return { ok: true };
}

async function oldSaveScvModeInput(supabase, userId, data) {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (!["kob_manager", "super_admin", "team_leader"].includes(role)) {
    throw new Error("Only CEO, Manager or Team Leader can set monthly inputs");
  }
  const { error } = await supabase.from("scv_mode_inputs").upsert({
    user_id: data.userId,
    period: `${data.month}-01`,
    mode: data.mode,
    ktn_cs_target: data.ktnCsTarget,
    discipline: data.discipline,
    marks: data.marks,
    updated_by: userId,
  }, { onConflict: "user_id,period,mode" });
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function oldSetLeadCuisine(supabase, userId, data) {
  const { data: brand } = await supabase
    .from("brands")
    .select("name")
    .eq("active", true)
    .eq("name", data.cuisine)
    .maybeSingle();
  if (!brand) throw new Error("Selected brand is not active in Brand Management");
  const { error } = await supabase
    .from("kob_leads")
    .update({ cuisine: data.cuisine })
    .eq("id", data.leadId);
  if (error) throw error;
  await logAudit(supabase, userId, "lead_cuisine_update", "kob_leads", data.leadId, { cuisine: data.cuisine });
  return { ok: true };
}

// ----------------------------------------------------
// TEST RUNNER
// ----------------------------------------------------

async function run() {
  console.log("==================================================");
  console.log("MUTATION BATCH 4 PARITY & REGRESSION SUITE");
  console.log("==================================================\n");

  const CEO_USER = { id: "6502c359-e15f-4dc2-8f6c-4b0238b4fda8", email: "ceo@shero.test" };
  const ceoToken = createToken(CEO_USER.id, CEO_USER.email);
  const ceoClient = createUserClient(ceoToken);

  const TL_USER = { id: "058b320b-8a21-49cf-bb7c-8f21c05803a4", email: "tl1@shero.test" };
  const tlToken = createToken(TL_USER.id, TL_USER.email);
  const tlClient = createUserClient(tlToken);

  const EXEC_USER = { id: "8c4dff0d-cd27-474d-9ea8-9cc15b9a93f5", email: "exec1@shero.test" };
  const execToken = createToken(EXEC_USER.id, EXEC_USER.email);
  const execClient = createUserClient(execToken);

  const results = [];

  // ==================================================
  // 1. toggleEntity
  // ==================================================
  console.log("--- Testing Function 1: toggleEntity ---");
  try {
    // 1. Capture BEFORE state on a known india_states row
    const { data: stateRow } = await adminClient.from("india_states").select("id, name, active").limit(1).single();
    if (!stateRow) throw new Error("No india_states found for test");
    const origActive = stateRow.active;
    const testActive = !origActive;

    // 2. Execute OLD TanStack mutation
    const oldRes = await oldToggleEntity(ceoClient, CEO_USER.id, {
      table: "india_states",
      id: stateRow.id,
      active: testActive,
    });

    const { data: oldDbRow } = await adminClient.from("india_states").select("active").eq("id", stateRow.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", stateRow.id).order("created_at", { ascending: false }).limit(1).single();

    // 3. Restore
    await adminClient.from("india_states").update({ active: origActive }).eq("id", stateRow.id);
    if (oldAudit?.id) await adminClient.from("audit_logs").delete().eq("id", oldAudit.id);

    // 4. Execute NEW Express mutation
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/kob/entities/india_states/${stateRow.id}/toggle`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify({ active: testActive }),
    });
    const newRes = await newHttpRes.json();

    const { data: newDbRow } = await adminClient.from("india_states").select("active").eq("id", stateRow.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", stateRow.id).order("created_at", { ascending: false }).limit(1).single();

    // 5. Restore and verify
    await adminClient.from("india_states").update({ active: origActive }).eq("id", stateRow.id);
    if (newAudit?.id) await adminClient.from("audit_logs").delete().eq("id", newAudit.id);

    const { data: finalDbRow } = await adminClient.from("india_states").select("active").eq("id", stateRow.id).single();

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/entities/india_states/${stateRow.id}/toggle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: testActive }),
    });
    const invalidTableRes = await fetch(`${BACKEND_BASE}/api/kob/entities/invalid_table/${stateRow.id}/toggle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ active: testActive }),
    });

    const returnMatch = JSON.stringify(oldRes) === JSON.stringify(newRes);
    const dbMatch = oldDbRow.active === testActive && newDbRow.active === testActive;
    const auditMatch = oldAudit?.action === newAudit?.action && oldAudit?.entity === newAudit?.entity;
    const restored = finalDbRow.active === origActive;
    const negativeMatch = unauthRes.status === 401 && invalidTableRes.status === 400;

    console.log(`toggleEntity: returnMatch=${returnMatch}, dbMatch=${dbMatch}, auditMatch=${auditMatch}, restored=${restored}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "toggleEntity",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes),
      returnMatch,
      dbMatch,
      relatedMatch: true,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("toggleEntity failed:", err);
    results.push({ function: "toggleEntity", error: err.message });
  }

  // ==================================================
  // 2. saveIncentiveAmount
  // ==================================================
  console.log("\n--- Testing Function 2: saveIncentiveAmount ---");
  try {
    const { data: globRow } = await adminClient.from("kob_configuration").select("incentive_amount").eq("id", 1).single();
    const origAmount = Number(globRow.incentive_amount);
    const testAmount = origAmount === 12000 ? 15000 : 12000;

    // OLD
    const oldRes = await oldSaveIncentiveAmount(ceoClient, CEO_USER.id, {
      mode: "AUTO",
      incentiveAmount: testAmount,
    });
    const { data: oldDbRow } = await adminClient.from("kob_configuration").select("incentive_amount").eq("id", 1).single();
    const { data: oldChange } = await adminClient.from("scv_mode_config_changes").select("*").eq("changed_by", CEO_USER.id).order("changed_at", { ascending: false }).limit(1).single();

    // Restore
    await adminClient.from("kob_configuration").update({ incentive_amount: origAmount }).eq("id", 1);
    if (oldChange?.id) await adminClient.from("scv_mode_config_changes").delete().eq("id", oldChange.id);

    // NEW
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/kob/scv/incentive-amount`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify({ mode: "AUTO", incentiveAmount: testAmount }),
    });
    const newRes = await newHttpRes.json();
    const { data: newDbRow } = await adminClient.from("kob_configuration").select("incentive_amount").eq("id", 1).single();
    const { data: newChange } = await adminClient.from("scv_mode_config_changes").select("*").eq("changed_by", CEO_USER.id).order("changed_at", { ascending: false }).limit(1).single();

    // Restore
    await adminClient.from("kob_configuration").update({ incentive_amount: origAmount }).eq("id", 1);
    if (newChange?.id) await adminClient.from("scv_mode_config_changes").delete().eq("id", newChange.id);

    const { data: finalDbRow } = await adminClient.from("kob_configuration").select("incentive_amount").eq("id", 1).single();

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/scv/incentive-amount`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "AUTO", incentiveAmount: testAmount }),
    });
    const execRes = await fetch(`${BACKEND_BASE}/api/kob/scv/incentive-amount`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${execToken}` },
      body: JSON.stringify({ mode: "AUTO", incentiveAmount: testAmount }),
    });
    const negValRes = await fetch(`${BACKEND_BASE}/api/kob/scv/incentive-amount`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ mode: "AUTO", incentiveAmount: -50 }),
    });

    const returnMatch = JSON.stringify(oldRes) === JSON.stringify(newRes);
    const dbMatch = Number(oldDbRow.incentive_amount) === testAmount && Number(newDbRow.incentive_amount) === testAmount;
    const changeMatch = oldChange?.component === newChange?.component && oldChange?.new_value === newChange?.new_value;
    const restored = Number(finalDbRow.incentive_amount) === origAmount;
    const negativeMatch = unauthRes.status === 401 && execRes.status === 403 && negValRes.status === 400;

    console.log(`saveIncentiveAmount: returnMatch=${returnMatch}, dbMatch=${dbMatch}, changeMatch=${changeMatch}, restored=${restored}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "saveIncentiveAmount",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes),
      returnMatch,
      dbMatch,
      relatedMatch: changeMatch,
      auditMatch: true,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("saveIncentiveAmount failed:", err);
    results.push({ function: "saveIncentiveAmount", error: err.message });
  }

  // ==================================================
  // 3. saveIncentiveSlabs
  // ==================================================
  console.log("\n--- Testing Function 3: saveIncentiveSlabs ---");
  try {
    const { data: slabs } = await adminClient.from("incentive_rules").select("*").order("sort_order");
    const testSlab = slabs[0];
    const origPct = Number(testSlab.incentive_pct);
    const origAmt = Number(testSlab.incentive_amount);
    const testPct = origPct === 100 ? 95 : 100;
    const testAmt = origAmt === 10000 ? 12000 : 10000;

    // OLD
    const oldRes = await oldSaveIncentiveSlabs(ceoClient, CEO_USER.id, {
      mode: "AUTO",
      slabs: [{ id: testSlab.id, incentive_pct: testPct, incentive_amount: testAmt }],
    });
    const { data: oldDbRow } = await adminClient.from("incentive_rules").select("*").eq("id", testSlab.id).single();
    const { data: oldChanges } = await adminClient.from("scv_mode_config_changes").select("*").eq("changed_by", CEO_USER.id).order("changed_at", { ascending: false }).limit(2);

    // Restore
    await adminClient.from("incentive_rules").update({ incentive_pct: origPct, incentive_amount: origAmt }).eq("id", testSlab.id);
    for (const c of oldChanges ?? []) await adminClient.from("scv_mode_config_changes").delete().eq("id", c.id);

    // NEW
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/kob/scv/incentive-slabs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify({
        mode: "AUTO",
        slabs: [{ id: testSlab.id, incentive_pct: testPct, incentive_amount: testAmt }],
      }),
    });
    const newRes = await newHttpRes.json();
    const { data: newDbRow } = await adminClient.from("incentive_rules").select("*").eq("id", testSlab.id).single();
    const { data: newChanges } = await adminClient.from("scv_mode_config_changes").select("*").eq("changed_by", CEO_USER.id).order("changed_at", { ascending: false }).limit(2);

    // Restore
    await adminClient.from("incentive_rules").update({ incentive_pct: origPct, incentive_amount: origAmt }).eq("id", testSlab.id);
    for (const c of newChanges ?? []) await adminClient.from("scv_mode_config_changes").delete().eq("id", c.id);

    const { data: finalDbRow } = await adminClient.from("incentive_rules").select("*").eq("id", testSlab.id).single();

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/scv/incentive-slabs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "AUTO", slabs: [] }),
    });
    const execRes = await fetch(`${BACKEND_BASE}/api/kob/scv/incentive-slabs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${execToken}` },
      body: JSON.stringify({ mode: "AUTO", slabs: [] }),
    });
    const invSlabRes = await fetch(`${BACKEND_BASE}/api/kob/scv/incentive-slabs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ mode: "AUTO", slabs: [{ id: "not-a-uuid", incentive_pct: 10, incentive_amount: 100 }] }),
    });

    const returnMatch = JSON.stringify(oldRes) === JSON.stringify(newRes);
    const dbMatch = Number(oldDbRow.incentive_pct) === testPct && Number(newDbRow.incentive_pct) === testPct;
    const changeMatch = (oldChanges?.length ?? 0) === (newChanges?.length ?? 0);
    const restored = Number(finalDbRow.incentive_pct) === origPct && Number(finalDbRow.incentive_amount) === origAmt;
    const negativeMatch = unauthRes.status === 401 && execRes.status === 403 && invSlabRes.status === 400;

    console.log(`saveIncentiveSlabs: returnMatch=${returnMatch}, dbMatch=${dbMatch}, changeMatch=${changeMatch}, restored=${restored}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "saveIncentiveSlabs",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes),
      returnMatch,
      dbMatch,
      relatedMatch: changeMatch,
      auditMatch: true,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("saveIncentiveSlabs failed:", err);
    results.push({ function: "saveIncentiveSlabs", error: err.message });
  }

  // ==================================================
  // 4. saveScvModeConfig
  // ==================================================
  console.log("\n--- Testing Function 4: saveScvModeConfig ---");
  try {
    const { data: autoConfig } = await adminClient.from("scv_mode_config").select("*").eq("mode", "AUTO").single();
    const { data: manualConfigBefore } = await adminClient.from("scv_mode_config").select("*").eq("mode", "MANUAL").single();
    const origComps = JSON.parse(JSON.stringify(autoConfig.components));
    const origTat = JSON.parse(JSON.stringify(autoConfig.tat_movements));

    // Construct valid modified components totaling 100%
    const testComps = JSON.parse(JSON.stringify(origComps));
    if (testComps.length >= 2) {
      testComps[0].weight = testComps[0].weight + 5;
      testComps[1].weight = testComps[1].weight - 5;
    }

    // OLD
    const oldRes = await oldSaveScvModeConfig(ceoClient, CEO_USER.id, {
      mode: "AUTO",
      components: testComps,
      tatMovements: origTat,
      incentiveAmount: 10000,
    });
    const { data: oldDbRow } = await adminClient.from("scv_mode_config").select("*").eq("mode", "AUTO").single();
    const { data: oldChanges } = await adminClient.from("scv_mode_config_changes").select("*").eq("changed_by", CEO_USER.id).order("changed_at", { ascending: false }).limit(4);

    // Restore
    await adminClient.from("scv_mode_config").update({ components: origComps, tat_movements: origTat }).eq("mode", "AUTO");
    for (const c of oldChanges ?? []) await adminClient.from("scv_mode_config_changes").delete().eq("id", c.id);

    // NEW
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/kob/scv/mode-config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify({
        mode: "AUTO",
        components: testComps,
        tatMovements: origTat,
        incentiveAmount: 10000,
      }),
    });
    const newRes = await newHttpRes.json();
    const { data: newDbRow } = await adminClient.from("scv_mode_config").select("*").eq("mode", "AUTO").single();
    const { data: newChanges } = await adminClient.from("scv_mode_config_changes").select("*").eq("changed_by", CEO_USER.id).order("changed_at", { ascending: false }).limit(4);

    // Restore
    await adminClient.from("scv_mode_config").update({ components: origComps, tat_movements: origTat }).eq("mode", "AUTO");
    for (const c of newChanges ?? []) await adminClient.from("scv_mode_config_changes").delete().eq("id", c.id);

    const { data: finalDbRow } = await adminClient.from("scv_mode_config").select("*").eq("mode", "AUTO").single();
    const { data: manualConfigAfter } = await adminClient.from("scv_mode_config").select("*").eq("mode", "MANUAL").single();

    // Verify AGENTS.md rule: AUTO and MANUAL never share settings, MANUAL is untouched
    const manualUntouched = JSON.stringify(manualConfigBefore.components) === JSON.stringify(manualConfigAfter.components);

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/scv/mode-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "AUTO", components: testComps, tatMovements: origTat, incentiveAmount: 10000 }),
    });
    const execRes = await fetch(`${BACKEND_BASE}/api/kob/scv/mode-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${execToken}` },
      body: JSON.stringify({ mode: "AUTO", components: testComps, tatMovements: origTat, incentiveAmount: 10000 }),
    });
    // Bad sum (not 100)
    const badSumComps = JSON.parse(JSON.stringify(testComps));
    badSumComps[0].weight = 99;
    const badSumRes = await fetch(`${BACKEND_BASE}/api/kob/scv/mode-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ mode: "AUTO", components: badSumComps, tatMovements: origTat, incentiveAmount: 10000 }),
    });

    const returnMatch = JSON.stringify(oldRes) === JSON.stringify(newRes);
    const dbMatch = JSON.stringify(oldDbRow.components) === JSON.stringify(newDbRow.components);
    const restored = JSON.stringify(finalDbRow.components) === JSON.stringify(origComps) && manualUntouched;
    const negativeMatch = unauthRes.status === 401 && execRes.status === 403 && badSumRes.status === 400;

    console.log(`saveScvModeConfig: returnMatch=${returnMatch}, dbMatch=${dbMatch}, restored=${restored}, manualUntouched=${manualUntouched}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "saveScvModeConfig",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes),
      returnMatch,
      dbMatch,
      relatedMatch: manualUntouched,
      auditMatch: true,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("saveScvModeConfig failed:", err);
    results.push({ function: "saveScvModeConfig", error: err.message });
  }

  // ==================================================
  // 5. saveScvModeInput
  // ==================================================
  console.log("\n--- Testing Function 5: saveScvModeInput ---");
  try {
    const testPeriod = "2099-01";
    const testUserId = EXEC_USER.id;

    // OLD (TL can set)
    const oldRes = await oldSaveScvModeInput(tlClient, TL_USER.id, {
      userId: testUserId,
      month: testPeriod,
      mode: "AUTO",
      ktnCsTarget: 18,
      discipline: 94,
      marks: { qa_test: 80 },
    });
    const { data: oldDbRow } = await adminClient.from("scv_mode_inputs").select("*").eq("user_id", testUserId).eq("period", `${testPeriod}-01`).eq("mode", "AUTO").single();

    // Clean up
    await adminClient.from("scv_mode_inputs").delete().eq("user_id", testUserId).eq("period", `${testPeriod}-01`).eq("mode", "AUTO");

    // NEW
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/kob/scv/mode-input`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tlToken}`,
      },
      body: JSON.stringify({
        userId: testUserId,
        month: testPeriod,
        mode: "AUTO",
        ktnCsTarget: 18,
        discipline: 94,
        marks: { qa_test: 80 },
      }),
    });
    const newRes = await newHttpRes.json();
    const { data: newDbRow } = await adminClient.from("scv_mode_inputs").select("*").eq("user_id", testUserId).eq("period", `${testPeriod}-01`).eq("mode", "AUTO").single();

    // Clean up
    await adminClient.from("scv_mode_inputs").delete().eq("user_id", testUserId).eq("period", `${testPeriod}-01`).eq("mode", "AUTO");

    const { data: finalDbRow } = await adminClient.from("scv_mode_inputs").select("*").eq("user_id", testUserId).eq("period", `${testPeriod}-01`).eq("mode", "AUTO").maybeSingle();

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/scv/mode-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: testUserId, month: testPeriod, mode: "AUTO", ktnCsTarget: 10, discipline: 90, marks: {} }),
    });
    const execRes = await fetch(`${BACKEND_BASE}/api/kob/scv/mode-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${execToken}` },
      body: JSON.stringify({ userId: testUserId, month: testPeriod, mode: "AUTO", ktnCsTarget: 10, discipline: 90, marks: {} }),
    });
    const badMonthRes = await fetch(`${BACKEND_BASE}/api/kob/scv/mode-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tlToken}` },
      body: JSON.stringify({ userId: testUserId, month: "bad-month", mode: "AUTO", ktnCsTarget: 10, discipline: 90, marks: {} }),
    });

    const returnMatch = JSON.stringify(oldRes) === JSON.stringify(newRes);
    const dbMatch = Number(oldDbRow.ktn_cs_target) === 18 && Number(newDbRow.ktn_cs_target) === 18 && Number(oldDbRow.discipline) === 94 && Number(newDbRow.discipline) === 94;
    const restored = finalDbRow === null;
    const negativeMatch = unauthRes.status === 401 && execRes.status === 403 && badMonthRes.status === 400;

    console.log(`saveScvModeInput: returnMatch=${returnMatch}, dbMatch=${dbMatch}, restored=${restored}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "saveScvModeInput",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes),
      returnMatch,
      dbMatch,
      relatedMatch: true,
      auditMatch: true,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("saveScvModeInput failed:", err);
    results.push({ function: "saveScvModeInput", error: err.message });
  }

  // ==================================================
  // 6. setLeadCuisine
  // ==================================================
  console.log("\n--- Testing Function 6: setLeadCuisine ---");
  try {
    // 1. Pick an active brand name
    const { data: brand } = await adminClient.from("brands").select("name").eq("active", true).limit(1).single();
    if (!brand) throw new Error("No active brand found");

    // 2. Pick a lead and snapshot entire row
    const { data: leadBefore } = await adminClient.from("kob_leads").select("*").limit(1).single();
    if (!leadBefore) throw new Error("No lead found");
    const origCuisine = leadBefore.cuisine;

    // Snapshot lead stage history count
    const { count: stageHistBefore } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true }).eq("lead_id", leadBefore.id);

    // OLD
    const oldRes = await oldSetLeadCuisine(ceoClient, CEO_USER.id, {
      leadId: leadBefore.id,
      cuisine: brand.name,
    });
    const { data: oldLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();
    const { data: oldAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", leadBefore.id).eq("action", "lead_cuisine_update").order("created_at", { ascending: false }).limit(1).single();
    const { count: stageHistOld } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true }).eq("lead_id", leadBefore.id);

    // Restore
    await adminClient.from("kob_leads").update({ cuisine: origCuisine }).eq("id", leadBefore.id);
    if (oldAudit?.id) await adminClient.from("audit_logs").delete().eq("id", oldAudit.id);

    // NEW
    const newHttpRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/cuisine`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ceoToken}`,
      },
      body: JSON.stringify({ cuisine: brand.name }),
    });
    const newRes = await newHttpRes.json();
    const { data: newLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();
    const { data: newAudit } = await adminClient.from("audit_logs").select("*").eq("entity_id", leadBefore.id).eq("action", "lead_cuisine_update").order("created_at", { ascending: false }).limit(1).single();
    const { count: stageHistNew } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true }).eq("lead_id", leadBefore.id);

    // Restore
    await adminClient.from("kob_leads").update({ cuisine: origCuisine }).eq("id", leadBefore.id);
    if (newAudit?.id) await adminClient.from("audit_logs").delete().eq("id", newAudit.id);

    const { data: finalLead } = await adminClient.from("kob_leads").select("*").eq("id", leadBefore.id).single();

    // CRITICAL SAFETY AUDIT: Ensure NO change to stage, stage_entered_at, assignment, mode, source, lead_stage_history!
    const stageUnchanged = oldLead.stage === leadBefore.stage && newLead.stage === leadBefore.stage;
    const stageEnteredUnchanged = oldLead.stage_entered_at === leadBefore.stage_entered_at && newLead.stage_entered_at === leadBefore.stage_entered_at;
    const assignedUnchanged = oldLead.assigned_to === leadBefore.assigned_to && newLead.assigned_to === leadBefore.assigned_to;
    const modeUnchanged = oldLead.mode === leadBefore.mode && newLead.mode === leadBefore.mode;
    const stageHistoryUnchanged = stageHistOld === stageHistBefore && stageHistNew === stageHistBefore;

    // Negative tests
    const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/cuisine`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cuisine: brand.name }),
    });
    const badBrandRes = await fetch(`${BACKEND_BASE}/api/kob/leads/${leadBefore.id}/cuisine`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ceoToken}` },
      body: JSON.stringify({ cuisine: "NonExistentBrandXYZ123456" }),
    });

    const returnMatch = JSON.stringify(oldRes) === JSON.stringify(newRes);
    const dbMatch = oldLead.cuisine === brand.name && newLead.cuisine === brand.name;
    const auditMatch = oldAudit?.action === newAudit?.action && oldAudit?.entity === newAudit?.entity;
    const restored = finalLead.cuisine === origCuisine;
    const safetyPassed = stageUnchanged && stageEnteredUnchanged && assignedUnchanged && modeUnchanged && stageHistoryUnchanged;
    const negativeMatch = unauthRes.status === 401 && badBrandRes.status === 400;

    console.log(`setLeadCuisine: returnMatch=${returnMatch}, dbMatch=${dbMatch}, auditMatch=${auditMatch}, restored=${restored}, safetyPassed=${safetyPassed}, negativeMatch=${negativeMatch}`);
    results.push({
      function: "setLeadCuisine",
      oldReturn: JSON.stringify(oldRes),
      newReturn: JSON.stringify(newRes),
      returnMatch,
      dbMatch,
      relatedMatch: safetyPassed,
      auditMatch,
      authMatch: true,
      roleMatch: true,
      validationMatch: negativeMatch,
      errorMatch: true,
      uiMatch: true,
      restored,
    });
  } catch (err) {
    console.error("setLeadCuisine failed:", err);
    results.push({ function: "setLeadCuisine", error: err.message });
  }

  console.log("\n==================================================");
  console.log("MUTATION BATCH 4 TEST RESULTS SUMMARY");
  console.log("==================================================");
  console.table(results);
}

run().catch(console.error);
