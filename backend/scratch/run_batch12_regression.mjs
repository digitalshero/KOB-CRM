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

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function orgRead(supabase, userId, admin) {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (((role ?? "executive")) === "executive" || !admin) return supabase;
  return admin;
}

async function pageAll(build) {
  const all = [];
  for (let page = 0; page < 60; page++) {
    const { data } = await build().range(page * 1000, page * 1000 + 999);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

// ----------------------------------------------------
// OLD IMPLEMENTATIONS
// ----------------------------------------------------

// 1. oldGetMyRole
async function oldGetMyRole(supabase, userId) {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return { role: role ?? "executive", profile };
}

// 2. oldGetChannelConversion
async function oldGetChannelConversion(supabase, userId, admin, r = {}) {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  const db = ((role ?? "executive")) === "executive" || !admin ? supabase : admin;

  const { data: sources } = await db.from("lead_sources").select("id, name, cost_per_lead");
  const byId = new Map((sources ?? []).map((s) => [s.id, s]));
  const costOf = (name) =>
    Math.round(
      Number(
        (sources ?? []).find(
          (s) => String(s.name).toLowerCase() === name.toLowerCase(),
        )?.cost_per_lead ?? 0,
      ),
    );

  const rows = await pageAll(() => {
    let q = db.from("kob_leads").select("id, stage, source_id");
    if (r.from) q = q.gte("created_at", r.from);
    if (r.to) q = q.lte("created_at", r.to);
    return q;
  });

  const buckets = {
    marketing: { leads: 0, converted: 0 },
    website: { leads: 0, converted: 0 },
    whatsapp: { leads: 0, converted: 0 },
    organic: { leads: 0, converted: 0 },
    other: { leads: 0, converted: 0 },
  };
  for (const l of rows) {
    const name = String(byId.get(l.source_id)?.name ?? "").toLowerCase();
    const key =
      name === "meta ads"
        ? "marketing"
        : name === "website form"
          ? "website"
          : name === "whatsapp broadcast"
            ? "whatsapp"
            : name === "manual" || name === "support"
              ? "organic"
              : "other";
    buckets[key].leads += 1;
    if (l.stage === "KTN_LIVE") buckets[key].converted += 1;
  }

  const shape = (k, cpl) => ({
    leads: buckets[k].leads,
    conv: buckets[k].leads > 0 ? (buckets[k].converted / buckets[k].leads) * 100 : 0,
    cpl,
  });

  return {
    marketing: shape("marketing", costOf("Meta Ads")),
    website: shape("website", costOf("Website Form")),
    whatsapp: shape("whatsapp", costOf("WhatsApp Broadcast")),
    organic: shape("organic", 0),
    other: shape("other", 0),
    total: rows.length,
  };
}

// 3. oldListGallaboxFireQueue
async function oldListGallaboxFireQueue(supabase) {
  const { data, error } = await supabase
    .from("gallabox_fire_queue")
    .select(
      "id, status, channel, created_at, fired_at, error, lead:kob_leads(code, full_name, language, mode, email), template:gallabox_templates(name, language, email_subject, email_body)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

// 4. oldListLeads
async function oldListLeads(supabase, userId, admin, data = {}) {
  const limit = data.limit ?? 200;
  const cols =
    "id, code, full_name, phone, stage, mode, language, tags, auto_fired_status, gallabox_template_sent, av_link_sent, form_link_sent, scv_score, investment_capacity, next_action, assigned_to, created_at, last_activity_at, stage_entered_at, last_message, last_message_at, unread_message_count, has_unread_messages, brand_id, state_id, city_id, source_id, brands(name), india_states(name, code), india_cities(name, tier), lead_sources(name)";

  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  const roleName = role ?? "executive";
  let client = supabase;
  if (roleName !== "executive" && admin) {
    client = admin;
  }

  const PAGE = 1000;
  const out = [];
  const hasRange = Boolean(data.from || data.to);
  const ktnOnly = data.stage === "KTN_CS";
  const dateCol = ktnOnly ? "stage_entered_at" : "created_at";

  const fetchPaged = async (build) => {
    for (let offset = 0; offset < limit; offset += PAGE) {
      const size = Math.min(PAGE, limit - offset);
      const q = build(client.from("kob_leads").select(cols).order("created_at", { ascending: false }));
      const { data: rows, error } = await q.range(offset, offset + size - 1);
      if (error) throw error;
      const page = rows ?? [];
      out.push(...page);
      if (page.length < size) break;
    }
  };

  await fetchPaged((q) => {
    if (data.stage) q = q.eq("stage", data.stage);
    else if (hasRange) q = q.neq("stage", "KTN_CS");
    if (data.from) q = q.gte(dateCol, data.from);
    if (data.to) q = q.lte(dateCol, data.to);
    return q;
  });

  if (!data.stage && hasRange) {
    await fetchPaged((q) => {
      q = q.eq("stage", "KTN_CS");
      if (data.from) q = q.gte("stage_entered_at", data.from);
      if (data.to) q = q.lte("stage_entered_at", data.to);
      return q;
    });
  }

  const assigneeIds = Array.from(new Set(out.map((l) => l.assigned_to).filter(Boolean)));
  if (assigneeIds.length) {
    const nameById = new Map();
    const P = 500;
    for (let i = 0; i < assigneeIds.length; i += P) {
      const { data: profs } = await client
        .from("profiles")
        .select("id, full_name")
        .in("id", assigneeIds.slice(i, i + P));
      for (const p of profs ?? []) nameById.set(p.id, p.full_name);
    }
    for (const l of out) {
      l.assigned_profile = l.assigned_to ? { full_name: nameById.get(l.assigned_to) ?? null } : null;
    }
  } else {
    for (const l of out) l.assigned_profile = null;
  }
  return out;
}

// 5. oldListWhatsappExecutives
async function oldListWhatsappExecutives(supabase, userId, admin) {
  const db = await orgRead(supabase, userId, admin);
  const { data: roles } = await db.from("user_roles").select("user_id, role").eq("role", "executive");
  const execIds = (roles ?? []).map((r) => r.user_id);
  if (!execIds.length) return [];
  const { data: profilesRaw } = await db
    .from("profiles")
    .select("id, full_name")
    .in("id", execIds)
    .order("full_name", { ascending: true });
  return (profilesRaw ?? []).map((p) => ({ id: p.id, full_name: p.full_name }));
}

// 6. oldListWhatsappMessages
async function oldListWhatsappMessages(supabase, userId, admin, data = {}) {
  const client = await orgRead(supabase, userId, admin);
  const limit = data.limit ?? 2000;
  const PAGE = 1000;
  const out = [];
  for (let offset = 0; offset < limit; offset += PAGE) {
    const size = Math.min(PAGE, limit - offset);
    let q = client
      .from("kob_leads")
      .select(
        "id, code, full_name, phone, stage, language, assigned_to, last_message, last_message_at, unread_message_count, has_unread_messages",
      )
      .not("last_message", "is", null)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (data.unreadOnly) q = q.eq("has_unread_messages", true);
    const { data: rows, error } = await q.range(offset, offset + size - 1);
    if (error) throw error;
    const page = rows ?? [];
    out.push(...page);
    if (page.length < size) break;
  }
  return out;
}

// ----------------------------------------------------
// RUN REGRESSION SUITE
// ----------------------------------------------------

async function run() {
  console.log("==================================================");
  console.log("BATCH 12 READ-ONLY REGRESSION TEST SUITE");
  console.log("==================================================");

  // Take DB snapshot counts
  const { count: leadsBefore } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: stageHistBefore } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: profsBefore } = await adminClient.from("profiles").select("*", { count: "exact", head: true });
  const { count: rolesBefore } = await adminClient.from("user_roles").select("*", { count: "exact", head: true });
  const { count: queueBefore } = await adminClient.from("gallabox_fire_queue").select("*", { count: "exact", head: true });
  const { count: actsBefore } = await adminClient.from("lead_activities").select("*", { count: "exact", head: true });
  const { count: rtBefore } = await adminClient.from("retargeting_schedule").select("*", { count: "exact", head: true });

  const TEST_ROLES = [
    { roleKey: "CEO", id: "6502c359-e15f-4dc2-8f6c-4b0238b4fda8", email: "ceo@shero.test" },
    { roleKey: "Manager", id: "25dc86bb-cda4-4bb4-8ec9-5bc6a03df10d", email: "manager@shero.test" },
    { roleKey: "TL", id: "0e73f086-ef69-411f-9948-474f95c3c8fb", email: "tl1@shero.test" },
    { roleKey: "Executive", id: "3f7aad05-a5d6-41f1-95c2-7ce86a9b9170", email: "kob2@shero.in" },
  ];

  const results = [];

  async function testCase(name, path, oldFn, token, rowExtractor = (d) => (Array.isArray(d) ? d.length : Object.keys(d || {}).length)) {
    process.stdout.write(`Testing: ${name}... `);
    const oldRes = await oldFn();
    const resp = await fetch(`${BACKEND_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      console.log(`FAIL ✗ (HTTP ${resp.status})`);
      results.push({ Function: name, Endpoint: path, Status: `HTTP ${resp.status}`, Rows: 0 });
      return false;
    }
    const newRes = await resp.json();
    const match = deepEqual(oldRes, newRes);
    if (!match) {
      console.log("FAIL ✗ (Mismatch)");
      console.log("OLD keys/sample:", typeof oldRes === "object" ? JSON.stringify(oldRes).slice(0, 200) : oldRes);
      console.log("NEW keys/sample:", typeof newRes === "object" ? JSON.stringify(newRes).slice(0, 200) : newRes);
      results.push({ Function: name, Endpoint: path, Status: "MISMATCH", Rows: rowExtractor(newRes) });
      return false;
    }
    console.log("PASS ✓ (Deep Match 100%)");
    results.push({ Function: name, Endpoint: path, Status: "MATCH", Rows: rowExtractor(newRes) });
    return true;
  }

  // 1. getMyRole across ALL 4 roles
  console.log("\n--- Testing 1. getMyRole ---");
  for (const u of TEST_ROLES) {
    const token = createToken(u.id, u.email);
    const userClient = createUserClient(token);
    await testCase(
      `getMyRole (${u.roleKey})`,
      "/api/kob/my-role",
      () => oldGetMyRole(userClient, u.id),
      token,
      (d) => 1,
    );
  }

  // 2. getChannelConversion
  console.log("\n--- Testing 2. getChannelConversion ---");
  const ceoToken = createToken(TEST_ROLES[0].id, TEST_ROLES[0].email);
  const ceoClient = createUserClient(ceoToken);
  await testCase(
    "getChannelConversion (default - CEO)",
    "/api/dashboard/channel-conversion",
    () => oldGetChannelConversion(ceoClient, TEST_ROLES[0].id, adminClient, {}),
    ceoToken,
    (d) => d.total,
  );
  await testCase(
    "getChannelConversion (range - CEO)",
    "/api/dashboard/channel-conversion?from=2026-08-01T00%3A00%3A00.000Z",
    () => oldGetChannelConversion(ceoClient, TEST_ROLES[0].id, adminClient, { from: "2026-08-01T00:00:00.000Z" }),
    ceoToken,
    (d) => d.total,
  );
  const exeToken = createToken(TEST_ROLES[3].id, TEST_ROLES[3].email);
  const exeClient = createUserClient(exeToken);
  await testCase(
    "getChannelConversion (Executive role)",
    "/api/dashboard/channel-conversion",
    () => oldGetChannelConversion(exeClient, TEST_ROLES[3].id, adminClient, {}),
    exeToken,
    (d) => d.total,
  );

  // 3. listGallaboxFireQueue
  console.log("\n--- Testing 3. listGallaboxFireQueue ---");
  await testCase(
    "listGallaboxFireQueue",
    "/api/kob/gallabox-fire-queue",
    () => oldListGallaboxFireQueue(ceoClient),
    ceoToken,
  );

  // 4. listLeads across ALL 4 ROLES + Filters
  console.log("\n--- Testing 4. listLeads across ROLES & FILTERS ---");
  for (const u of TEST_ROLES) {
    const token = createToken(u.id, u.email);
    const client = createUserClient(token);

    // Default
    await testCase(
      `listLeads (${u.roleKey} default limit 200)`,
      "/api/kob/leads",
      () => oldListLeads(client, u.id, adminClient, { limit: 200 }),
      token,
    );

    // Smaller page/limit
    await testCase(
      `listLeads (${u.roleKey} limit 10)`,
      "/api/kob/leads?limit=10",
      () => oldListLeads(client, u.id, adminClient, { limit: 10 }),
      token,
    );

    // Stage filter
    await testCase(
      `listLeads (${u.roleKey} stage=LEAD_INBOX)`,
      "/api/kob/leads?stage=LEAD_INBOX&limit=50",
      () => oldListLeads(client, u.id, adminClient, { stage: "LEAD_INBOX", limit: 50 }),
      token,
    );

    // KTN_CS stage (tests stage_entered_at logic)
    await testCase(
      `listLeads (${u.roleKey} stage=KTN_CS)`,
      "/api/kob/leads?stage=KTN_CS&limit=50",
      () => oldListLeads(client, u.id, adminClient, { stage: "KTN_CS", limit: 50 }),
      token,
    );

    // Date filter
    await testCase(
      `listLeads (${u.roleKey} date range from=2026-08-01)`,
      "/api/kob/leads?from=2026-08-01T00%3A00%3A00.000Z&limit=50",
      () => oldListLeads(client, u.id, adminClient, { from: "2026-08-01T00:00:00.000Z", limit: 50 }),
      token,
    );
  }

  // 5. listWhatsappExecutives
  console.log("\n--- Testing 5. listWhatsappExecutives ---");
  await testCase(
    "listWhatsappExecutives",
    "/api/kob/whatsapp-executives",
    () => oldListWhatsappExecutives(ceoClient, TEST_ROLES[0].id, adminClient),
    ceoToken,
  );

  // 6. listWhatsappMessages
  console.log("\n--- Testing 6. listWhatsappMessages ---");
  await testCase(
    "listWhatsappMessages (default limit 2000)",
    "/api/kob/whatsapp-messages",
    () => oldListWhatsappMessages(ceoClient, TEST_ROLES[0].id, adminClient, { limit: 2000, unreadOnly: false }),
    ceoToken,
  );
  await testCase(
    "listWhatsappMessages (limit 50)",
    "/api/kob/whatsapp-messages?limit=50",
    () => oldListWhatsappMessages(ceoClient, TEST_ROLES[0].id, adminClient, { limit: 50, unreadOnly: false }),
    ceoToken,
  );
  await testCase(
    "listWhatsappMessages (unreadOnly=true)",
    "/api/kob/whatsapp-messages?unreadOnly=true",
    () => oldListWhatsappMessages(ceoClient, TEST_ROLES[0].id, adminClient, { limit: 2000, unreadOnly: true }),
    ceoToken,
  );

  // 7. Auth Failure test
  process.stdout.write("Testing Auth Failure (no token)... ");
  const unauth = await fetch(`${BACKEND_BASE}/api/kob/my-role`);
  if (unauth.status === 401) {
    console.log("PASS ✓ (HTTP 401)");
  } else {
    console.log(`FAIL ✗ (Unexpected status ${unauth.status})`);
  }

  // DB Mutex Check
  console.log("\nDatabase Write Check:");
  const { count: leadsAfter } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: stageHistAfter } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: profsAfter } = await adminClient.from("profiles").select("*", { count: "exact", head: true });
  const { count: rolesAfter } = await adminClient.from("user_roles").select("*", { count: "exact", head: true });
  const { count: queueAfter } = await adminClient.from("gallabox_fire_queue").select("*", { count: "exact", head: true });
  const { count: actsAfter } = await adminClient.from("lead_activities").select("*", { count: "exact", head: true });
  const { count: rtAfter } = await adminClient.from("retargeting_schedule").select("*", { count: "exact", head: true });

  const deltas = [
    ["Leads", leadsAfter - leadsBefore],
    ["Stage history", stageHistAfter - stageHistBefore],
    ["Profiles", profsAfter - profsBefore],
    ["User roles", rolesAfter - rolesBefore],
    ["Gallabox queue", queueAfter - queueBefore],
    ["Lead activities", actsAfter - actsBefore],
    ["Retargeting schedule", rtAfter - rtBefore],
  ];

  let totalDelta = 0;
  for (const [tbl, delta] of deltas) {
    console.log(`  ${tbl} delta: ${delta}`);
    totalDelta += Math.abs(delta);
  }
  console.log(`  Total DB mutations during test: ${totalDelta}`);

  console.log("\n==================================================");
  console.log("BATCH 12 REGRESSION SUMMARY");
  console.log("==================================================");
  console.table(results);

  const allPassed = results.every((r) => r.Status === "MATCH") && unauth.status === 401 && totalDelta === 0;
  console.log(`\nFINAL PARITY RESULT: ${allPassed ? "PASS ✓" : "FAIL ✗"}`);

  if (!allPassed) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("FATAL ERROR IN REGRESSION RUN:", err);
  process.exit(1);
});
