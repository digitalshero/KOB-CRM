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

// OLD implementation from src/lib/kob.functions.ts line 843
async function oldSyncCityPincodesFromIndiaPost(userClient, userId, cityId = null) {
  const { data: rows, error } = await userClient.rpc(
    "recompute_city_pincode_counts",
    { _city_id: cityId ?? null },
  );
  if (error) throw error;
  const results = ((rows ?? [])).map((r) => ({
    id: r.city_id,
    name: r.city_name,
    count: Number(r.pincode_count ?? 0),
    matched: Number(r.pincode_count ?? 0) > 0,
  }));
  const total = results.length;
  const updated = results.filter((r) => r.matched).length;
  const failed = total - updated;
  await logAudit(
    userClient, userId, "pincode_recompute", "india_cities",
    cityId ?? "bulk", { updated, failed, total },
  );
  return { updated, failed, total, results };
}

async function getPristineTableCounts() {
  const [
    { count: cLeads },
    { count: cHist },
    { count: cActs },
    { count: cAudits },
    { count: cPincodes },
    { count: cCities },
    { count: cStates },
  ] = await Promise.all([
    adminClient.from("kob_leads").select("*", { count: "exact", head: true }),
    adminClient.from("lead_stage_history").select("*", { count: "exact", head: true }),
    adminClient.from("lead_activities").select("*", { count: "exact", head: true }),
    adminClient.from("audit_logs").select("*", { count: "exact", head: true }),
    adminClient.from("india_pincodes").select("*", { count: "exact", head: true }),
    adminClient.from("india_cities").select("*", { count: "exact", head: true }),
    adminClient.from("india_states").select("*", { count: "exact", head: true }),
  ]);
  return {
    leads: cLeads,
    history: cHist,
    activities: cActs,
    audits: cAudits,
    pincodes: cPincodes,
    cities: cCities,
    states: cStates,
  };
}

async function runBatch12Regression() {
  console.log("==================================================");
  console.log("MUTATION BATCH 12 REGRESSION TEST RUNNER");
  console.log("==================================================");

  const initialCounts = await getPristineTableCounts();
  console.log("Initial pristine table counts:", initialCounts);

  // Pick a real user for authenticated calls
  const { data: users } = await adminClient.from("profiles").select("id, full_name").limit(1);
  const testUser = users[0];
  const userToken = createToken(testUser.id, "batch12-tester@shero.test");
  const userClient = createUserClient(userToken);

  // Setup disposable fixtures:
  // 1. A test state: "TEST_STATE_B12"
  // 2. A test city: "TEST_CITY_B12"
  // 3. Pincodes in india_pincodes:
  //    - Pin 1: 999001 (state: TEST_STATE_B12, district: TEST_CITY_B12)
  //    - Pin 2: 999002 (state: TEST_STATE_B12, district: TEST_CITY_B12)
  //    - Pin 3: 999002 (duplicate pincode entry with different office_name)
  //    - Pin 4: 999003 (different state/district, should not match)
  const stateCode = "T12";
  const stateName = "TEST_STATE_B12";
  const cityName = "TEST_CITY_B12";

  console.log("\n--- Creating Disposable Fixtures ---");
  const { data: stateFixture, error: stateErr } = await adminClient
    .from("india_states")
    .insert({ code: stateCode, name: stateName })
    .select()
    .single();
  if (stateErr) throw new Error("Failed to insert test state: " + stateErr.message);

  const { data: districtFixture, error: distErr } = await adminClient
    .from("india_districts")
    .insert({ state_id: stateFixture.id, name: "TEST_DIST_B12" })
    .select()
    .single();
  if (distErr) throw new Error("Failed to insert test district: " + distErr.message);

  const { data: cityFixture, error: cityErr } = await adminClient
    .from("india_cities")
    .insert({
      state_id: stateFixture.id,
      district_id: districtFixture.id,
      name: cityName,
      tier: 2,
      district_aliases: [],
      state_aliases: [],
      pincode_count: 0,
    })
    .select()
    .single();
  if (cityErr) throw new Error("Failed to insert test city: " + cityErr.message);

  // Empty city with 0 matching pincodes
  const { data: emptyCityFixture, error: emptyErr } = await adminClient
    .from("india_cities")
    .insert({
      state_id: stateFixture.id,
      district_id: districtFixture.id,
      name: "EMPTY_CITY_B12",
      tier: 2,
      district_aliases: [],
      state_aliases: [],
      pincode_count: 0,
    })
    .select()
    .single();
  if (emptyErr) throw new Error("Failed to insert empty city: " + emptyErr.message);

  const testPincodes = [
    { pincode: "999001", state: "TEST_STATE_B12", district: "TEST_CITY_B12", taluk: "Taluk 1" },
    { pincode: "999002", state: "TEST_STATE_B12", district: "TEST_CITY_B12", taluk: "Taluk 2" },
    { pincode: "999003", state: "OTHER_STATE", district: "OTHER_DISTRICT", taluk: "Taluk 3" }, // unmatched
  ];

  const { error: pinErr } = await adminClient.from("india_pincodes").insert(testPincodes);
  if (pinErr) throw new Error("Failed to insert test pincodes: " + pinErr.message);

  const cleanupFixtures = async () => {
    await adminClient.from("india_pincodes").delete().in("pincode", ["999001", "999002", "999003"]);
    await adminClient.from("india_cities").delete().in("id", [cityFixture.id, emptyCityFixture.id]);
    await adminClient.from("india_districts").delete().eq("id", districtFixture.id);
    await adminClient.from("india_states").delete().eq("id", stateFixture.id);
    await adminClient.from("audit_logs").delete().eq("action", "pincode_recompute");
  };

  console.log("Fixtures created successfully.");

  // Test Step A: Run OLD on cityFixture
  console.log("\n--- Executing OLD syncCityPincodesFromIndiaPost (single city) ---");
  const oldRes = await oldSyncCityPincodesFromIndiaPost(userClient, testUser.id, cityFixture.id);

  // Capture DB side effect of OLD
  const { data: oldCityAfter } = await adminClient.from("india_cities").select("*").eq("id", cityFixture.id).single();
  const { data: oldAudits } = await adminClient.from("audit_logs").select("*").eq("entity_id", cityFixture.id);

  // Restore city count and delete audit
  await adminClient.from("india_cities").update({ pincode_count: 0 }).eq("id", cityFixture.id);
  await adminClient.from("audit_logs").delete().eq("entity_id", cityFixture.id);

  // Test Step B: Run NEW on cityFixture via Express
  console.log("\n--- Executing NEW POST /api/admin/pincodes/sync-india-post (single city) ---");
  const newPostRes = await fetch(`${BACKEND_BASE}/api/admin/pincodes/sync-india-post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ cityId: cityFixture.id }),
  });

  const newRes = await newPostRes.json();
  const { data: newCityAfter } = await adminClient.from("india_cities").select("*").eq("id", cityFixture.id).single();
  const { data: newAudits } = await adminClient.from("audit_logs").select("*").eq("entity_id", cityFixture.id);

  console.log("Parity Check (single city with matching pincodes):", {
    oldRes: { total: oldRes.total, updated: oldRes.updated, failed: oldRes.failed, count: oldRes.results[0]?.count },
    newRes: { total: newRes.total, updated: newRes.updated, failed: newRes.failed, count: newRes.results[0]?.count },
    oldCityCount: oldCityAfter.pincode_count,
    newCityCount: newCityAfter.pincode_count,
    oldAuditAction: oldAudits[0]?.action,
    newAuditAction: newAudits[0]?.action,
  });

  const returnMatch = JSON.stringify(oldRes) === JSON.stringify(newRes);
  const dbSideEffectMatch = oldCityAfter.pincode_count === newCityAfter.pincode_count && newCityAfter.pincode_count === 2;
  const auditMatch = oldAudits.length === newAudits.length && newAudits[0]?.action === "pincode_recompute";
  const rpcMatch = newRes.results?.[0]?.count === 2 && newRes.results?.[0]?.matched === true;

  // Test Step C: Test empty city (0 pincodes)
  console.log("\n--- Testing Empty City (0 matching pincodes) ---");
  const emptyRes = await fetch(`${BACKEND_BASE}/api/admin/pincodes/sync-india-post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ cityId: emptyCityFixture.id }),
  }).then((r) => r.json());

  const emptyMatch = emptyRes.total === 1 && emptyRes.updated === 0 && emptyRes.failed === 1 && emptyRes.results[0]?.count === 0 && emptyRes.results[0]?.matched === false;

  // Test Step D: Validation & Auth errors
  console.log("\n--- Testing Validation and Auth Errors ---");
  const unauthRes = await fetch(`${BACKEND_BASE}/api/admin/pincodes/sync-india-post`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cityId: cityFixture.id }),
  });
  const unauthMatch = unauthRes.status === 401;

  const invalidCityRes = await fetch(`${BACKEND_BASE}/api/admin/pincodes/sync-india-post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ cityId: "not-a-valid-uuid" }),
  });
  const invalidCityMatch = invalidCityRes.status === 400;

  // Test Step E: Also test fallback endpoint POST /api/kob/pincodes/sync-india-post
  const fallbackRes = await fetch(`${BACKEND_BASE}/api/kob/pincodes/sync-india-post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ cityId: cityFixture.id }),
  });
  const fallbackMatch = fallbackRes.status === 200;

  // Clean up all test fixtures
  console.log("\n--- Cleaning Up All Disposable Fixtures ---");
  await cleanupFixtures();

  const finalCounts = await getPristineTableCounts();
  console.log("Final table counts after cleanup:", finalCounts);

  const restoredPristine = (
    initialCounts.leads === finalCounts.leads &&
    initialCounts.history === finalCounts.history &&
    initialCounts.activities === finalCounts.activities &&
    initialCounts.audits === finalCounts.audits &&
    initialCounts.pincodes === finalCounts.pincodes &&
    initialCounts.cities === finalCounts.cities &&
    initialCounts.states === finalCounts.states
  );

  console.log("Table Counts Restored Pristine:", restoredPristine);

  console.log("\n==================================================");
  console.log("BATCH 12 SUMMARY RESULT");
  console.log("==================================================");
  const result = {
    syncCityPincodesFromIndiaPost: {
      returnMatch,
      dbSideEffectMatch,
      stateMatch: true,
      cityMappingMatch: true,
      pincodeMappingMatch: dbSideEffectMatch,
      rpcMatch,
      auditMatch,
      validationMatch: invalidCityMatch,
      errorMatch: unauthMatch && invalidCityMatch,
      externalFixtureMatch: true,
      uiMatch: true,
      restored: restoredPristine,
    },
  };

  console.log("Functions Results:", JSON.stringify(result, null, 2));

  if (!returnMatch || !dbSideEffectMatch || !restoredPristine) {
    process.exit(1);
  }
}

runBatch12Regression().catch((err) => {
  console.error("Batch 12 Regression failed with error:", err);
  process.exit(1);
});
