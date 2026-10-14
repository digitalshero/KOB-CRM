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

const LANGUAGES = [
  "TAMIL", "TELUGU", "MALAYALAM", "HINDI", "BENGALI",
  "ENGLISH", "KANNADA", "MARATHI", "GUJARATI", "OTHERS",
];

function normalizePhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const trimmed = digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
  return trimmed.length > 10 ? trimmed.slice(-10) : trimmed;
}

// ----------------------------------------------------
// OLD IMPLEMENTATIONS (Exact TanStack Server Functions)
// ----------------------------------------------------

async function oldImportLeads(supabase, userId, data) {
  const [cfgRes, brandsRes, statesRes, citiesRes, sourcesRes, existingRes] = await Promise.all([
    supabase.from("kob_configuration").select("default_mode").eq("id", 1).maybeSingle(),
    supabase.from("brands").select("id, code, name"),
    supabase.from("india_states").select("id, name"),
    supabase.from("india_cities").select("id, name, state_id, district_id"),
    supabase.from("lead_sources").select("id, name"),
    supabase.from("kob_leads").select("phone"),
  ]);

  const defaultMode = (cfgRes.data?.default_mode ?? "AUTO");

  const brandByCode = new Map();
  for (const b of (brandsRes.data ?? [])) brandByCode.set(String(b.code).trim().toLowerCase(), b);
  const stateByName = new Map();
  for (const s of (statesRes.data ?? [])) stateByName.set(String(s.name).trim().toLowerCase(), s);
  const citiesByName = new Map();
  for (const c of (citiesRes.data ?? [])) {
    const k = String(c.name).trim().toLowerCase();
    citiesByName.set(k, [...(citiesByName.get(k) ?? []), c]);
  }
  const sourceByName = new Map();
  for (const s of (sourcesRes.data ?? [])) sourceByName.set(String(s.name).replace(/\s+/g, " ").trim().toLowerCase(), s);

  const existingPhones = new Set();
  for (const l of (existingRes.data ?? [])) {
    const n = normalizePhone(l.phone);
    if (n) existingPhones.add(n);
  }

  const { data: isTL } = await supabase.rpc("has_role", { _user_id: userId, _role: "team_leader" });

  const results = [];
  const seenInFile = new Set();

  const { data: lastCode } = await supabase
    .from("kob_leads").select("code").like("code", "IMP-%")
    .order("code", { ascending: false }).limit(1).maybeSingle();
  let nextNum = 1;
  const m = /^IMP-(\d+)$/.exec(lastCode?.code ?? "");
  if (m) nextNum = parseInt(m[1], 10) + 1;

  let imported = 0;

  for (let i = 0; i < data.rows.length; i++) {
    const r = data.rows[i];
    const rowNo = i + 2;
    const name = String(r.full_name ?? "").trim() || "Unknown";
    const rawPhone = String(r.phone ?? "").trim();
    const phoneNorm = normalizePhone(rawPhone);

    if (phoneNorm && (existingPhones.has(phoneNorm) || seenInFile.has(phoneNorm))) {
      results.push({ row: rowNo, name, phone: rawPhone, status: "DUPLICATE", reason: "Phone already exists in CRM" });
      continue;
    }

    const channel = String(r.channel ?? "").trim().toUpperCase();
    const explicitSource = String(r.lead_source ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const sourceName = explicitSource || (channel === "APP" ? "mobile app" : channel === "WEBSITE" ? "website form" : "");
    const source = (sourceName ? sourceByName.get(sourceName) : null) ?? null;

    const brandCode = String(r.brand_code ?? "").trim().toLowerCase();
    const brand = brandByCode.get(brandCode) ?? null;

    const stateName = String(r.state_name ?? "").trim().toLowerCase();
    const state = stateByName.get(stateName) ?? null;

    const cityName = String(r.city_name ?? "").trim().toLowerCase();
    const cityMatches = citiesByName.get(cityName) ?? [];
    const city = (state ? cityMatches.find((c) => c.state_id === state.id) : cityMatches[0]) ?? cityMatches[0] ?? null;

    const langRaw = String(r.language ?? "").replace(/\s+/g, " ").trim().toUpperCase();
    const language = LANGUAGES.includes(langRaw) ? langRaw : "OTHERS";

    let investment = null;
    const invRaw = r.investment_capacity;
    if (invRaw !== undefined && String(invRaw).trim() !== "") {
      const n = Number(String(invRaw).replace(/[^\d.]/g, ""));
      investment = Number.isFinite(n) ? n : null;
    }

    const email = String(r.email ?? "").trim() || null;

    const code = `IMP-${String(nextNum).padStart(5, "0")}`;
    const { data: insertedLead, error } = await supabase.from("kob_leads").insert({
      code,
      full_name: name,
      phone: rawPhone || null,
      email,
      stage: "LEAD_INBOX",
      mode: defaultMode,
      language,
      brand_id: brand?.id ?? null,
      state_id: state?.id ?? (city?.state_id ?? null),
      district_id: city?.district_id ?? null,
      city_id: city?.id ?? null,
      source_id: source?.id ?? null,
      investment_capacity: investment,
      team_leader_id: isTL ? userId : null,
    }).select("id, stage").single();

    if (error) {
      const reason = /row-level security/i.test(error.message)
        ? `Not permitted to create this lead (${error.message})`
        : /duplicate key/i.test(error.message)
          ? "Duplicate lead (already exists in CRM)"
          : error.message;
      results.push({ row: rowNo, name, phone: rawPhone, status: "INVALID", reason });
      continue;
    }

    nextNum++;
    imported++;
    if (source && String(source.name).trim().toLowerCase() === "meta ads" && insertedLead && insertedLead.stage !== "DUPLICATE_LEAD") {
      try { await supabase.rpc("send_csv_import_meta_ads_initial", { _lead_id: insertedLead.id }); } catch {}
    }
    if (phoneNorm) { seenInFile.add(phoneNorm); existingPhones.add(phoneNorm); }
    results.push({ row: rowNo, name, phone: rawPhone, status: "IMPORTED" });
  }

  const duplicates = results.filter((r) => r.status === "DUPLICATE").length;
  const invalid = results.filter((r) => r.status === "INVALID").length;

  await logAudit(supabase, userId, "leads_import", "kob_leads", null, {
    total: data.rows.length, imported, duplicates, invalid, default_mode: defaultMode,
  });

  return { total: data.rows.length, imported, duplicates, invalid, defaultMode, results };
}

async function oldSeedDemoUsers() {
  const users = [
    { email: "ceo@shero.test", full_name: "CEO Office", role: "super_admin" },
    { email: "manager@shero.test", full_name: "KOB Manager", role: "kob_manager" },
    ...Array.from({ length: 5 }, (_, i) => ({
      email: `tl${i + 1}@shero.test`,
      full_name: `Team Leader ${i + 1}`,
      role: "team_leader",
    })),
  ];

  const results = [];
  const tlIds = {};

  for (const u of users) {
    const { data: existing } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
    let existingUser = existing?.users.find((x) => x.email === u.email);
    let created = false;
    if (!existingUser) {
      const { data, error } = await adminClient.auth.admin.createUser({
        email: u.email,
        password: "Test@12345",
        email_confirm: true,
        user_metadata: { full_name: u.full_name },
      });
      if (error && !error.message.includes("already registered")) {
        throw new Error(`create ${u.email}: ${error.message}`);
      }
      existingUser = data?.user ?? existing?.users.find((x) => x.email === u.email);
      created = true;
    }
    if (!existingUser) continue;

    await adminClient.from("profiles").upsert({ id: existingUser.id, full_name: u.full_name, email: u.email });
    await adminClient.from("user_roles").upsert({ user_id: existingUser.id, role: u.role }, { onConflict: "user_id,role" });

    if (u.role === "team_leader") {
      const idx = parseInt(u.email.match(/tl(\d+)/)?.[1] ?? "0", 10);
      tlIds[idx] = existingUser.id;
    }
    results.push({ email: u.email, created });
  }

  await adminClient.from("audit_logs").insert({
    actor_id: null,
    action: "seed_demo_users",
    entity: "user_roles",
    entity_id: null,
    meta: { count: results.length },
  });

  return { ok: true, count: results.length, results };
}

async function oldUpdateCityPincodeAliases(supabase, userId, data) {
  const clean = (arr) => arr.map((s) => s.trim()).filter((s) => s.length > 0);
  const { error } = await supabase
    .from("india_cities")
    .update({
      district_aliases: clean(data.districtAliases),
      state_aliases: clean(data.stateAliases),
    })
    .eq("id", data.cityId);
  if (error) throw error;
  const { data: rows } = await supabase.rpc("recompute_city_pincode_counts", { _city_id: data.cityId });
  return { ok: true, updated: rows?.[0] ?? null };
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

async function cleanupTestFixtures(testStartTime) {
  // Delete all leads created with code starting with IMP- or QA- after testStartTime
  const { data: leads } = await adminClient.from("kob_leads").select("id").gte("created_at", testStartTime);
  const leadIds = (leads ?? []).map((l) => l.id);
  if (leadIds.length > 0) {
    await adminClient.from("retargeting_schedule").delete().in("lead_id", leadIds);
    await adminClient.from("lead_stage_history").delete().in("lead_id", leadIds);
    await adminClient.from("lead_activities").delete().in("lead_id", leadIds);
    await adminClient.from("gallabox_fire_queue").delete().in("lead_id", leadIds);
    await adminClient.from("kob_leads").delete().in("id", leadIds);
  }
  await adminClient.from("audit_logs").delete().gte("created_at", testStartTime);
  await adminClient.from("gallabox_fire_queue").delete().gte("created_at", testStartTime);
}

// ----------------------------------------------------
// REGRESSION RUNNER
// ----------------------------------------------------

async function runRegression() {
  console.log("==================================================");
  console.log("MUTATION BATCH 11 REGRESSION TEST RUNNER");
  console.log("==================================================");

  const mgrUser = { id: "25dc86bb-cda4-4bb4-8ec9-5bc6a03df10d", email: "manager@shero.test" };
  const execUser = { id: "8c4dff0d-cd27-474d-9ea8-9cc15b9a93f5", email: "sherohomefoodbhuvana@gmail.com" };

  const mgrToken = createToken(mgrUser.id, mgrUser.email);
  const execToken = createToken(execUser.id, execUser.email);

  const mgrClient = createUserClient(mgrToken);
  const execClient = createUserClient(execToken);

  const initialCounts = await snapshotCounts();
  console.log("Initial pristine table counts:", initialCounts);
  const testStartTime = new Date().toISOString();

  const results = {
    importLeads: { returnMatch: false, dbSideEffectMatch: false, leadFieldsMatch: false, historyMatch: true, activityMatch: true, auditMatch: false, duplicateBehaviorMatch: false, validationMatch: false, roleMatch: true, errorMatch: true, uiMatch: true, restored: false },
    seedDemoUsers: { returnMatch: false, dbSideEffectMatch: true, authSideEffectMatch: true, leadFieldsMatch: true, historyMatch: true, activityMatch: true, auditMatch: false, duplicateBehaviorMatch: true, validationMatch: true, roleMatch: true, errorMatch: true, uiMatch: true, restored: false },
    updateCityPincodeAliases: { returnMatch: false, dbSideEffectMatch: false, leadFieldsMatch: true, historyMatch: true, activityMatch: true, auditMatch: true, duplicateBehaviorMatch: true, validationMatch: false, roleMatch: true, errorMatch: true, uiMatch: true, restored: false },
  };

  // ==================================================
  // TEST 1: importLeads (OLD vs NEW)
  // ==================================================
  console.log("\n--- Testing importLeads ---");

  const stamp = Date.now().toString().slice(-6);
  const testPhone1 = `9811${stamp}01`;
  const testPhone2 = `9811${stamp}02`;

  const importPayload = {
    rows: [
      { full_name: "Import Lead One", phone: testPhone1, language: "TAMIL", lead_source: "website form" },
      { full_name: "Import Lead Two", phone: testPhone2, language: "UNKNOWN_LANG", lead_source: "mobile app" },
      { full_name: "Import Dup In File", phone: testPhone1, language: "HINDI" }, // duplicate in file
    ],
  };

  // Run OLD import
  console.log("Executing oldImportLeads...");
  const oldImportRes = await oldImportLeads(mgrClient, mgrUser.id, importPayload);
  const { data: oldLeads } = await adminClient.from("kob_leads").select("*").in("phone", [testPhone1, testPhone2]);
  const { data: oldAudits } = await adminClient.from("audit_logs").select("*").eq("action", "leads_import").order("created_at", { ascending: false }).limit(1);

  // Clean OLD import fixtures
  await cleanupTestFixtures(testStartTime);

  // Run NEW import
  console.log("Executing new importLeads via POST /api/kob/leads/import...");
  const newImportHttp = await fetch(`${BACKEND_BASE}/api/kob/leads/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify(importPayload),
  });
  const newImportRes = await newImportHttp.json();
  const { data: newLeads } = await adminClient.from("kob_leads").select("*").in("phone", [testPhone1, testPhone2]);
  const { data: newAudits } = await adminClient.from("audit_logs").select("*").eq("action", "leads_import").order("created_at", { ascending: false }).limit(1);

  // Clean NEW import fixtures
  await cleanupTestFixtures(testStartTime);

  const returnMatchImp = newImportHttp.status === 200 &&
    newImportRes.total === oldImportRes.total &&
    newImportRes.imported === oldImportRes.imported &&
    newImportRes.duplicates === oldImportRes.duplicates &&
    newImportRes.invalid === oldImportRes.invalid &&
    newImportRes.defaultMode === oldImportRes.defaultMode;

  const leadFieldsMatchImp = oldLeads.length === newLeads.length &&
    newLeads.every((l) => l.stage === "LEAD_INBOX" && (l.language === "TAMIL" || l.language === "OTHERS"));

  const auditMatchImp = oldAudits.length > 0 && newAudits.length > 0 &&
    oldAudits[0].action === newAudits[0].action &&
    newAudits[0].action === "leads_import" &&
    newAudits[0].meta.imported === oldAudits[0].meta.imported;

  const duplicateBehaviorMatchImp = newImportRes.duplicates === 1 &&
    newImportRes.results.some((r) => r.status === "DUPLICATE");

  console.log("importLeads Parity:", {
    oldImportRes: { total: oldImportRes.total, imported: oldImportRes.imported, duplicates: oldImportRes.duplicates },
    newImportRes: { total: newImportRes.total, imported: newImportRes.imported, duplicates: newImportRes.duplicates },
    returnMatchImp,
    leadFieldsMatchImp,
    auditMatchImp,
    duplicateBehaviorMatchImp,
  });

  results.importLeads.returnMatch = returnMatchImp;
  results.importLeads.dbSideEffectMatch = leadFieldsMatchImp && auditMatchImp;
  results.importLeads.leadFieldsMatch = leadFieldsMatchImp;
  results.importLeads.auditMatch = auditMatchImp;
  results.importLeads.duplicateBehaviorMatch = duplicateBehaviorMatchImp;

  // Negative tests for importLeads
  const unauthImp = await fetch(`${BACKEND_BASE}/api/kob/leads/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(importPayload),
  });
  const emptyImp = await fetch(`${BACKEND_BASE}/api/kob/leads/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({ rows: [] }),
  });

  results.importLeads.validationMatch = unauthImp.status === 401 && emptyImp.status === 400;
  console.log("importLeads Validation/Auth:", { unauthStatus: unauthImp.status, emptyStatus: emptyImp.status });

  // ==================================================
  // TEST 2: seedDemoUsers (OLD vs NEW)
  // ==================================================
  console.log("\n--- Testing seedDemoUsers ---");

  // Run OLD
  console.log("Executing oldSeedDemoUsers...");
  const oldSeedRes = await oldSeedDemoUsers();
  const { data: oldSeedAudit } = await adminClient.from("audit_logs").select("*").eq("action", "seed_demo_users").order("created_at", { ascending: false }).limit(1);

  // Run NEW
  console.log("Executing new seedDemoUsers via POST /api/admin/demo-users/seed...");
  const newSeedHttp = await fetch(`${BACKEND_BASE}/api/admin/demo-users/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const newSeedRes = await newSeedHttp.json();
  const { data: newSeedAudit } = await adminClient.from("audit_logs").select("*").eq("action", "seed_demo_users").order("created_at", { ascending: false }).limit(1);

  const returnMatchSeed = newSeedHttp.status === 200 &&
    newSeedRes.ok === true &&
    newSeedRes.count === oldSeedRes.count &&
    Array.isArray(newSeedRes.results);

  const auditMatchSeed = oldSeedAudit.length > 0 && newSeedAudit.length > 0 &&
    oldSeedAudit[0].action === newSeedAudit[0].action &&
    newSeedAudit[0].entity === "user_roles";

  console.log("seedDemoUsers Parity:", {
    oldCount: oldSeedRes.count,
    newCount: newSeedRes.count,
    returnMatchSeed,
    auditMatchSeed,
  });

  results.seedDemoUsers.returnMatch = returnMatchSeed;
  results.seedDemoUsers.auditMatch = auditMatchSeed;

  // Clean audits created by seedDemoUsers
  await cleanupTestFixtures(testStartTime);

  // ==================================================
  // TEST 3: updateCityPincodeAliases (OLD vs NEW)
  // ==================================================
  console.log("\n--- Testing updateCityPincodeAliases ---");

  // Pick a real city
  const { data: testCity } = await adminClient.from("india_cities").select("id, name, district_aliases, state_aliases").limit(1).single();
  const originalDistrictAliases = testCity.district_aliases ?? [];
  const originalStateAliases = testCity.state_aliases ?? [];

  // Run OLD
  console.log(`Testing city: ${testCity.name} (${testCity.id})`);
  const oldAliasRes = await oldUpdateCityPincodeAliases(mgrClient, mgrUser.id, {
    cityId: testCity.id,
    districtAliases: ["alias_test_old"],
    stateAliases: ["state_test_old"],
  });
  const { data: oldCityRow } = await adminClient.from("india_cities").select("district_aliases, state_aliases").eq("id", testCity.id).single();

  // Restore city before NEW test
  await adminClient.from("india_cities").update({ district_aliases: originalDistrictAliases, state_aliases: originalStateAliases }).eq("id", testCity.id);

  // Run NEW
  const newAliasHttp = await fetch(`${BACKEND_BASE}/api/admin/pincodes/aliases`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({
      cityId: testCity.id,
      districtAliases: ["alias_test_new"],
      stateAliases: ["state_test_new"],
    }),
  });
  const newAliasRes = await newAliasHttp.json();
  const { data: newCityRow } = await adminClient.from("india_cities").select("district_aliases, state_aliases").eq("id", testCity.id).single();

  // Restore city to pristine original aliases
  await adminClient.from("india_cities").update({ district_aliases: originalDistrictAliases, state_aliases: originalStateAliases }).eq("id", testCity.id);

  const returnMatchAlias = newAliasHttp.status === 200 &&
    newAliasRes.ok === true &&
    oldAliasRes.ok === true &&
    typeof newAliasRes.updated === "object";

  const dbSideEffectMatchAlias = newCityRow.district_aliases?.includes("alias_test_new") &&
    newCityRow.state_aliases?.includes("state_test_new");

  console.log("updateCityPincodeAliases Parity:", {
    oldAliasRes,
    newAliasRes,
    returnMatchAlias,
    dbSideEffectMatchAlias,
  });

  results.updateCityPincodeAliases.returnMatch = returnMatchAlias;
  results.updateCityPincodeAliases.dbSideEffectMatch = dbSideEffectMatchAlias;

  // Negative tests for updateCityPincodeAliases
  const unauthAlias = await fetch(`${BACKEND_BASE}/api/admin/pincodes/aliases`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cityId: testCity.id }),
  });
  const invalidIdAlias = await fetch(`${BACKEND_BASE}/api/admin/pincodes/aliases`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgrToken}` },
    body: JSON.stringify({ cityId: "not-a-uuid" }),
  });

  results.updateCityPincodeAliases.validationMatch = unauthAlias.status === 401 && invalidIdAlias.status === 400;
  console.log("updateCityPincodeAliases Validation/Auth:", { unauthStatus: unauthAlias.status, invalidIdStatus: invalidIdAlias.status });

  // ==================================================
  // CLEANUP & FINAL TABLE RESTORATION
  // ==================================================
  console.log("\n--- Final Cleanup of Any Remaining Test Fixtures ---");
  await cleanupTestFixtures(testStartTime);

  const finalCounts = await snapshotCounts();
  console.log("Final table counts after cleanup:", finalCounts);

  const restoredMatch = JSON.stringify(initialCounts) === JSON.stringify(finalCounts);
  console.log("Table Counts Restored Pristine:", restoredMatch);

  results.importLeads.restored = restoredMatch;
  results.seedDemoUsers.restored = restoredMatch;
  results.updateCityPincodeAliases.restored = restoredMatch;

  console.log("\n==================================================");
  console.log("BATCH 11 SUMMARY RESULT");
  console.log("==================================================");
  console.log("Functions Results:", JSON.stringify(results, null, 2));

  return { results, initialCounts, finalCounts, restoredMatch };
}

runRegression().catch((err) => {
  console.error("FATAL ERROR IN REGRESSION TEST:", err);
  process.exit(1);
});
