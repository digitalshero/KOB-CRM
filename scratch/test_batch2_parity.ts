import dotenv from "dotenv";
dotenv.config();

import { app } from "../backend/src/app.js";
import { Route as failedFireRoute } from "../src/routes/api/public/failed-fire.js";
import { Route as leadStageRoute } from "../src/routes/api/public/lead-stage.js";
import { Route as leadsRoute } from "../src/routes/api/public/leads.js";
import { supabaseAdmin } from "../backend/src/integrations/supabase/client.js";
import http from "node:http";

// Start Express server on ephemeral port
const server = http.createServer(app);

async function startServer(): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

// Helpers to call old TanStack handler
async function callOldHandler(
  route: any,
  method: string,
  url: string,
  body?: any,
  headers: Record<string, string> = {}
) {
  const init: RequestInit = {
    method,
    headers: new Headers(headers),
  };
  if (body !== undefined) {
    if (typeof body === "string") {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      (init.headers as Headers).set("content-type", "application/json");
    }
  }
  const req = new Request(url, init);
  const handler = route.options.server.handlers[method];
  const resp: Response = await handler({ request: req });
  const status = resp.status;
  const respHeaders = Object.fromEntries(resp.headers.entries());
  let respBody: any = null;
  const text = await resp.text();
  try {
    respBody = JSON.parse(text);
  } catch {
    respBody = text;
  }
  return { status, headers: respHeaders, body: respBody };
}

// Helper to call new Express server
async function callNewExpress(
  baseUrl: string,
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
) {
  const url = `${baseUrl}${path}`;
  const reqHeaders: Record<string, string> = { ...headers };
  let reqBody: any = undefined;
  if (body !== undefined) {
    if (typeof body === "string") {
      reqBody = body;
    } else {
      reqBody = JSON.stringify(body);
      reqHeaders["content-type"] = "application/json";
    }
  }
  const resp = await fetch(url, {
    method,
    headers: reqHeaders,
    body: reqBody,
  });
  const status = resp.status;
  const respHeaders = Object.fromEntries(resp.headers.entries());
  let respBody: any = null;
  const text = await resp.text();
  try {
    respBody = JSON.parse(text);
  } catch {
    respBody = text;
  }
  return { status, headers: respHeaders, body: respBody };
}

function deepEqual(a: any, b: any, ignoreKeys: string[] = []): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  const keysA = Object.keys(a).filter((k) => !ignoreKeys.includes(k));
  const keysB = Object.keys(b).filter((k) => !ignoreKeys.includes(k));
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!keysB.includes(k)) return false;
    if (!deepEqual(a[k], b[k], ignoreKeys)) return false;
  }
  return true;
}

const TEST_KEY = "test_batch2_secret_key_88888";

async function cleanupLead(phone: string, id?: string) {
  if (id) {
    await supabaseAdmin.from("lead_events").delete().eq("lead_id", id);
    await supabaseAdmin.from("lead_stage_history").delete().eq("lead_id", id);
    await supabaseAdmin.from("audit_logs").delete().eq("entity_id", id);
    await supabaseAdmin.from("kob_leads").delete().eq("id", id);
  }
  if (phone) {
    const { data: leads } = await supabaseAdmin.from("kob_leads").select("id").eq("phone", phone);
    for (const l of leads ?? []) {
      await supabaseAdmin.from("lead_events").delete().eq("lead_id", l.id);
      await supabaseAdmin.from("lead_stage_history").delete().eq("lead_id", l.id);
      await supabaseAdmin.from("audit_logs").delete().eq("entity_id", l.id);
      await supabaseAdmin.from("kob_leads").delete().eq("id", l.id);
    }
  }
}

async function runBatch2ParityTests() {
  console.log("==================================================");
  console.log("STARTING PUBLIC ROUTE BATCH 2 PARITY TESTS");
  console.log("==================================================");

  const baseUrl = await startServer();
  console.log(`Express test server running at ${baseUrl}`);

  const results: Array<{
    endpoint: string;
    test: string;
    oldStatus: number;
    newStatus: number;
    responseMatch: boolean;
    dbMatch: boolean;
    pass: boolean;
    details?: string;
  }> = [];

  // --------------------------------------------------------------------------
  // SECTION 1: AUTHENTICATION & SECURITY HARDENING (COMMON ACROSS ALL 3)
  // --------------------------------------------------------------------------
  console.log("\n--- Testing Common Auth & Hardening ---");
  const endpoints = [
    { name: "failed-fire", path: "/api/public/failed-fire", route: failedFireRoute },
    { name: "lead-stage", path: "/api/public/lead-stage", route: leadStageRoute },
    { name: "leads", path: "/api/public/leads", route: leadsRoute },
  ];

  const origKey = process.env.LEAD_INTAKE_API_KEY;

  for (const ep of endpoints) {
    // 1. Missing server env key returns 500
    delete process.env.LEAD_INTAKE_API_KEY;
    const oldNoEnv = await callOldHandler(ep.route, "POST", `http://localhost${ep.path}`, {});
    const newNoEnv = await callNewExpress(baseUrl, "POST", ep.path, {});
    const envMatch = oldNoEnv.status === 500 && newNoEnv.status === 500 && deepEqual(oldNoEnv.body, newNoEnv.body);
    results.push({
      endpoint: `POST ${ep.path}`,
      test: "Missing server env key returns 500",
      oldStatus: oldNoEnv.status,
      newStatus: newNoEnv.status,
      responseMatch: envMatch,
      dbMatch: true,
      pass: envMatch,
      details: "Exact 500 error match",
    });

    // 2. Security hardening check: undefined===undefined cannot authenticate
    const undefAttack = await callNewExpress(baseUrl, "POST", ep.path, {}, { "x-api-key": "" });
    const hardenPass = undefAttack.status === 500;
    results.push({
      endpoint: `POST ${ep.path}`,
      test: "Security hardening: Empty env cannot authenticate",
      oldStatus: 500,
      newStatus: undefAttack.status,
      responseMatch: hardenPass,
      dbMatch: true,
      pass: hardenPass,
      details: "Rejected with 500 - undefined===undefined impossible",
    });

    // 3. Invalid client key returns 401
    process.env.LEAD_INTAKE_API_KEY = TEST_KEY;
    const oldBadKey = await callOldHandler(ep.route, "POST", `http://localhost${ep.path}`, {}, { "x-api-key": "wrong_key" });
    const newBadKey = await callNewExpress(baseUrl, "POST", ep.path, {}, { "x-api-key": "wrong_key" });
    const badKeyMatch = oldBadKey.status === 401 && newBadKey.status === 401 && deepEqual(oldBadKey.body, newBadKey.body);
    results.push({
      endpoint: `POST ${ep.path}`,
      test: "Invalid x-api-key returns 401",
      oldStatus: oldBadKey.status,
      newStatus: newBadKey.status,
      responseMatch: badKeyMatch,
      dbMatch: true,
      pass: badKeyMatch,
      details: "Exact 401 error match",
    });

    // 4. Missing client key returns 401
    const oldNoKey = await callOldHandler(ep.route, "POST", `http://localhost${ep.path}`, {});
    const newNoKey = await callNewExpress(baseUrl, "POST", ep.path, {});
    const noKeyMatch = oldNoKey.status === 401 && newNoKey.status === 401 && deepEqual(oldNoKey.body, newNoKey.body);
    results.push({
      endpoint: `POST ${ep.path}`,
      test: "Missing x-api-key returns 401",
      oldStatus: oldNoKey.status,
      newStatus: newNoKey.status,
      responseMatch: noKeyMatch,
      dbMatch: true,
      pass: noKeyMatch,
      details: "Exact 401 error match",
    });

    // 5. CORS OPTIONS returns 204
    const oldOpt = await callOldHandler(ep.route, "OPTIONS", `http://localhost${ep.path}`);
    const newOpt = await callNewExpress(baseUrl, "OPTIONS", ep.path);
    const optMatch = oldOpt.status === 204 && newOpt.status === 204;
    results.push({
      endpoint: `OPTIONS ${ep.path}`,
      test: "CORS preflight returns 204",
      oldStatus: oldOpt.status,
      newStatus: newOpt.status,
      responseMatch: optMatch,
      dbMatch: true,
      pass: optMatch,
      details: "204 Preflight match",
    });
  }

  process.env.LEAD_INTAKE_API_KEY = TEST_KEY;
  const authHeaders = { "x-api-key": TEST_KEY };

  // --------------------------------------------------------------------------
  // SECTION 2: POST /api/public/lead-stage
  // --------------------------------------------------------------------------
  console.log("\n--- Testing 2: lead-stage ---");

  // 2a. Malformed JSON body
  const badJsonHeaders = { ...authHeaders, "content-type": "application/json" };
  const oldStageBadJson = await callOldHandler(leadStageRoute, "POST", "http://localhost/api/public/lead-stage", "{invalid", badJsonHeaders);
  const newStageBadJson = await callNewExpress(baseUrl, "POST", "/api/public/lead-stage", "{invalid", badJsonHeaders);
  results.push({
    endpoint: "POST /api/public/lead-stage",
    test: "Malformed JSON body returns 400",
    oldStatus: oldStageBadJson.status,
    newStatus: newStageBadJson.status,
    responseMatch: oldStageBadJson.status === 400 && newStageBadJson.status === 400 && deepEqual(oldStageBadJson.body, newStageBadJson.body),
    dbMatch: true,
    pass: oldStageBadJson.status === 400 && newStageBadJson.status === 400 && deepEqual(oldStageBadJson.body, newStageBadJson.body),
    details: `400 Invalid JSON body (Old: ${JSON.stringify(oldStageBadJson.body)}, New: ${JSON.stringify(newStageBadJson.body)})`,
  });

  // 2b. Missing both lead_id and phone
  const oldStageNoTarget = await callOldHandler(leadStageRoute, "POST", "http://localhost/api/public/lead-stage", { stage: "EOI_1" }, authHeaders);
  const newStageNoTarget = await callNewExpress(baseUrl, "POST", "/api/public/lead-stage", { stage: "EOI_1" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/lead-stage",
    test: "Missing lead_id & phone returns 400 validation failed",
    oldStatus: oldStageNoTarget.status,
    newStatus: newStageNoTarget.status,
    responseMatch: oldStageNoTarget.status === 400 && newStageNoTarget.status === 400 && deepEqual(oldStageNoTarget.body, newStageNoTarget.body),
    dbMatch: true,
    pass: oldStageNoTarget.status === 400 && newStageNoTarget.status === 400,
    details: "400 Validation failed",
  });

  // 2c. Invalid target stage
  const oldStageBadStage = await callOldHandler(leadStageRoute, "POST", "http://localhost/api/public/lead-stage", { phone: "9876543210", stage: "INVALID_STAGE" }, authHeaders);
  const newStageBadStage = await callNewExpress(baseUrl, "POST", "/api/public/lead-stage", { phone: "9876543210", stage: "INVALID_STAGE" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/lead-stage",
    test: "Invalid target stage returns 400 Unknown stage",
    oldStatus: oldStageBadStage.status,
    newStatus: newStageBadStage.status,
    responseMatch: oldStageBadStage.status === 400 && newStageBadStage.status === 400 && deepEqual(oldStageBadStage.body, newStageBadStage.body),
    dbMatch: true,
    pass: oldStageBadStage.status === 400 && newStageBadStage.status === 400,
    details: "400 Unknown stage",
  });

  // 2d. Unknown lead returns 404
  const oldStageUnknown = await callOldHandler(leadStageRoute, "POST", "http://localhost/api/public/lead-stage", { phone: "9999999991", stage: "EOI_1" }, authHeaders);
  const newStageUnknown = await callNewExpress(baseUrl, "POST", "/api/public/lead-stage", { phone: "9999999991", stage: "EOI_1" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/lead-stage",
    test: "Unknown lead returns 404",
    oldStatus: oldStageUnknown.status,
    newStatus: newStageUnknown.status,
    responseMatch: oldStageUnknown.status === 404 && newStageUnknown.status === 404 && deepEqual(oldStageUnknown.body, newStageUnknown.body),
    dbMatch: true,
    pass: oldStageUnknown.status === 404 && newStageUnknown.status === 404,
    details: "404 Lead not found",
  });

  // 2e. Lead already in target stage
  const testPhoneAlready = "9988770001";
  await cleanupLead(testPhoneAlready);
  const { data: leadAlready } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-99901",
    full_name: "Test Already In Stage",
    phone: `+91${testPhoneAlready}`,
    stage: "EOI_1",
  }).select("id").single();

  const oldAlready = await callOldHandler(leadStageRoute, "POST", "http://localhost/api/public/lead-stage", { lead_id: leadAlready?.id, stage: "EOI_1" }, authHeaders);
  const newAlready = await callNewExpress(baseUrl, "POST", "/api/public/lead-stage", { lead_id: leadAlready?.id, stage: "EOI_1" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/lead-stage",
    test: "Lead already in target stage returns 200 stage_updated:false",
    oldStatus: oldAlready.status,
    newStatus: newAlready.status,
    responseMatch: oldAlready.status === 200 && newAlready.status === 200 && deepEqual(oldAlready.body, newAlready.body),
    dbMatch: true,
    pass: oldAlready.status === 200 && newAlready.status === 200 && deepEqual(oldAlready.body, newAlready.body),
    details: "Lead already in target stage matched",
  });
  await cleanupLead(testPhoneAlready, leadAlready?.id);

  // 2f. Forward walking by lead_id (LEAD_INBOX -> EOI_1 walks AUTO_FIRED -> EOI_1)
  const testPhoneWalk = "9988770002";
  await cleanupLead(testPhoneWalk);
  const { data: leadWalk1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-99902",
    full_name: "Test Forward Walk 1",
    phone: `+91${testPhoneWalk}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const oldWalkRes = await callOldHandler(leadStageRoute, "POST", "http://localhost/api/public/lead-stage", { lead_id: leadWalk1?.id, stage: "EOI_1", note: "testing walk" }, authHeaders);
  const { data: oldLeadAfter } = await supabaseAdmin.from("kob_leads").select("stage, code").eq("id", leadWalk1?.id).single();
  const { data: oldAudits } = await supabaseAdmin.from("audit_logs").select("action, meta").eq("entity_id", leadWalk1?.id);
  await cleanupLead(testPhoneWalk, leadWalk1?.id);

  // Setup same for Express
  const { data: leadWalk2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-99902",
    full_name: "Test Forward Walk 1",
    phone: `+91${testPhoneWalk}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const newWalkRes = await callNewExpress(baseUrl, "POST", "/api/public/lead-stage", { lead_id: leadWalk2?.id, stage: "EOI_1", note: "testing walk" }, authHeaders);
  const { data: newLeadAfter } = await supabaseAdmin.from("kob_leads").select("stage, code").eq("id", leadWalk2?.id).single();
  const { data: newAudits } = await supabaseAdmin.from("audit_logs").select("action, meta").eq("entity_id", leadWalk2?.id);
  await cleanupLead(testPhoneWalk, leadWalk2?.id);

  const stageRespMatch = oldWalkRes.status === 200 && newWalkRes.status === 200 &&
    oldWalkRes.body.stage_updated === true && newWalkRes.body.stage_updated === true &&
    oldWalkRes.body.current_stage === newWalkRes.body.current_stage;
  const stageDbMatch = oldLeadAfter?.stage === "EOI_1" && newLeadAfter?.stage === "EOI_1" &&
    oldAudits?.length === newAudits?.length;

  results.push({
    endpoint: "POST /api/public/lead-stage",
    test: "Lookup by lead_id: forward funnel walking & audit logs",
    oldStatus: oldWalkRes.status,
    newStatus: newWalkRes.status,
    responseMatch: stageRespMatch,
    dbMatch: stageDbMatch,
    pass: stageRespMatch && stageDbMatch,
    details: `Stages matched: ${oldLeadAfter?.stage} === ${newLeadAfter?.stage}, Audits: ${oldAudits?.length} === ${newAudits?.length}`,
  });

  // 2g. Lookup by 10-digit phone
  const testPhoneLookup = "9988770003";
  await cleanupLead(testPhoneLookup);
  const { data: leadLookup1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-99903",
    full_name: "Test Phone Lookup",
    phone: `+91${testPhoneLookup}`,
    stage: "EOI_1",
  }).select("id").single();

  const oldPhoneRes = await callOldHandler(leadStageRoute, "POST", "http://localhost/api/public/lead-stage", { phone: testPhoneLookup, stage: "WEBINAR" }, authHeaders);
  const { data: oldLeadPhone } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", leadLookup1?.id).single();
  await cleanupLead(testPhoneLookup, leadLookup1?.id);

  const { data: leadLookup2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-99903",
    full_name: "Test Phone Lookup",
    phone: `+91${testPhoneLookup}`,
    stage: "EOI_1",
  }).select("id").single();

  const newPhoneRes = await callNewExpress(baseUrl, "POST", "/api/public/lead-stage", { phone: testPhoneLookup, stage: "WEBINAR" }, authHeaders);
  const { data: newLeadPhone } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", leadLookup2?.id).single();
  await cleanupLead(testPhoneLookup, leadLookup2?.id);

  const phoneMatch = oldPhoneRes.status === 200 && newPhoneRes.status === 200 &&
    oldLeadPhone?.stage === "WEBINAR" && newLeadPhone?.stage === "WEBINAR";

  results.push({
    endpoint: "POST /api/public/lead-stage",
    test: "Lookup by 10-digit phone: stage update to WEBINAR",
    oldStatus: oldPhoneRes.status,
    newStatus: newPhoneRes.status,
    responseMatch: phoneMatch,
    dbMatch: phoneMatch,
    pass: phoneMatch,
    details: `Updated stage by phone: ${oldLeadPhone?.stage} === ${newLeadPhone?.stage}`,
  });

  // --------------------------------------------------------------------------
  // SECTION 3: POST /api/public/leads (INBOUND CREATION)
  // --------------------------------------------------------------------------
  console.log("\n--- Testing 3: leads ---");

  // 3a. Malformed JSON body
  const oldLeadsBadJson = await callOldHandler(leadsRoute, "POST", "http://localhost/api/public/leads", "{invalid", badJsonHeaders);
  const newLeadsBadJson = await callNewExpress(baseUrl, "POST", "/api/public/leads", "{invalid", badJsonHeaders);
  results.push({
    endpoint: "POST /api/public/leads",
    test: "Malformed JSON body returns 400",
    oldStatus: oldLeadsBadJson.status,
    newStatus: newLeadsBadJson.status,
    responseMatch: oldLeadsBadJson.status === 400 && newLeadsBadJson.status === 400 && deepEqual(oldLeadsBadJson.body, newLeadsBadJson.body),
    dbMatch: true,
    pass: oldLeadsBadJson.status === 400 && newLeadsBadJson.status === 400 && deepEqual(oldLeadsBadJson.body, newLeadsBadJson.body),
    details: `400 Invalid JSON body (Old: ${JSON.stringify(oldLeadsBadJson.body)}, New: ${JSON.stringify(newLeadsBadJson.body)})`,
  });

  // 3b. Missing required name
  const oldLeadsNoName = await callOldHandler(leadsRoute, "POST", "http://localhost/api/public/leads", { phone: "9876543210", source: "Website" }, authHeaders);
  const newLeadsNoName = await callNewExpress(baseUrl, "POST", "/api/public/leads", { phone: "9876543210", source: "Website" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/leads",
    test: "Missing name returns 400 validation failed",
    oldStatus: oldLeadsNoName.status,
    newStatus: newLeadsNoName.status,
    responseMatch: oldLeadsNoName.status === 400 && newLeadsNoName.status === 400 && deepEqual(oldLeadsNoName.body, newLeadsNoName.body),
    dbMatch: true,
    pass: oldLeadsNoName.status === 400 && newLeadsNoName.status === 400,
    details: "400 Validation failed",
  });

  // 3c. Missing required phone
  const oldLeadsNoPhone = await callOldHandler(leadsRoute, "POST", "http://localhost/api/public/leads", { name: "Alice", source: "Website" }, authHeaders);
  const newLeadsNoPhone = await callNewExpress(baseUrl, "POST", "/api/public/leads", { name: "Alice", source: "Website" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/leads",
    test: "Missing phone returns 400 validation failed",
    oldStatus: oldLeadsNoPhone.status,
    newStatus: newLeadsNoPhone.status,
    responseMatch: oldLeadsNoPhone.status === 400 && newLeadsNoPhone.status === 400 && deepEqual(oldLeadsNoPhone.body, newLeadsNoPhone.body),
    dbMatch: true,
    pass: oldLeadsNoPhone.status === 400 && newLeadsNoPhone.status === 400,
    details: "400 Validation failed",
  });

  // 3d. Create valid lead with source alias (zoho form -> Website Form) & language mapping
  const testPhoneCreate1 = "9988770011";
  await cleanupLead(testPhoneCreate1);
  const oldLeadCreate = await callOldHandler(
    leadsRoute,
    "POST",
    "http://localhost/api/public/leads",
    { name: "John Doe", phone: testPhoneCreate1, source: "zoho form", language: "tamil", pincode: "600028" },
    authHeaders
  );
  const { data: oldCreatedRow } = await supabaseAdmin.from("kob_leads").select("*").eq("id", oldLeadCreate.body?.id).single();
  await cleanupLead(testPhoneCreate1, oldLeadCreate.body?.id);

  const testPhoneCreate2 = "9988770012";
  await cleanupLead(testPhoneCreate2);
  const newLeadCreate = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/leads",
    { name: "John Doe", phone: testPhoneCreate2, source: "zoho form", language: "tamil", pincode: "600028" },
    authHeaders
  );
  const { data: newCreatedRow } = await supabaseAdmin.from("kob_leads").select("*").eq("id", newLeadCreate.body?.id).single();
  await cleanupLead(testPhoneCreate2, newLeadCreate.body?.id);

  const createStatusMatch = oldLeadCreate.status === 201 && newLeadCreate.status === 201;
  const createFieldMatch = oldCreatedRow?.stage === "LEAD_INBOX" && newCreatedRow?.stage === "LEAD_INBOX" &&
    oldCreatedRow?.language === "TAMIL" && newCreatedRow?.language === "TAMIL" &&
    oldCreatedRow?.notes === newCreatedRow?.notes &&
    oldLeadCreate.body?.source === newLeadCreate.body?.source &&
    oldLeadCreate.body?.source_id === newLeadCreate.body?.source_id;

  results.push({
    endpoint: "POST /api/public/leads",
    test: "Create valid lead with source alias & language mapping",
    oldStatus: oldLeadCreate.status,
    newStatus: newLeadCreate.status,
    responseMatch: createStatusMatch && createFieldMatch,
    dbMatch: createFieldMatch,
    pass: createStatusMatch && createFieldMatch,
    details: `Source: ${oldLeadCreate.body?.source}, Lang: ${oldCreatedRow?.language}, Stage: ${oldCreatedRow?.stage}`,
  });

  // 3e. Create lead with unmatched source (stores warning & notes)
  const testPhoneUnmatched = "9988770013";
  await cleanupLead(testPhoneUnmatched);
  const oldUnmatched = await callOldHandler(
    leadsRoute,
    "POST",
    "http://localhost/api/public/leads",
    { name: "Bob", phone: testPhoneUnmatched, source: "unknown_custom_source_xyz" },
    authHeaders
  );
  const { data: oldUnmatchedRow } = await supabaseAdmin.from("kob_leads").select("notes, stage").eq("id", oldUnmatched.body?.id).single();
  await cleanupLead(testPhoneUnmatched, oldUnmatched.body?.id);

  const newUnmatched = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/leads",
    { name: "Bob", phone: testPhoneUnmatched, source: "unknown_custom_source_xyz" },
    authHeaders
  );
  const { data: newUnmatchedRow } = await supabaseAdmin.from("kob_leads").select("notes, stage").eq("id", newUnmatched.body?.id).single();
  await cleanupLead(testPhoneUnmatched, newUnmatched.body?.id);

  const unmatchedPass = oldUnmatched.status === 201 && newUnmatched.status === 201 &&
    oldUnmatchedRow?.notes === newUnmatchedRow?.notes &&
    Boolean(oldUnmatched.body?.warning) && Boolean(newUnmatched.body?.warning);

  results.push({
    endpoint: "POST /api/public/leads",
    test: "Create lead with unmatched source: warning & notes captured",
    oldStatus: oldUnmatched.status,
    newStatus: newUnmatched.status,
    responseMatch: unmatchedPass,
    dbMatch: unmatchedPass,
    pass: unmatchedPass,
    details: `Unmatched notes matched: ${oldUnmatchedRow?.notes}`,
  });

  // --------------------------------------------------------------------------
  // SECTION 4: POST /api/public/failed-fire
  // --------------------------------------------------------------------------
  console.log("\n--- Testing 4: failed-fire ---");

  // 4a. Malformed JSON
  const oldFfBadJson = await callOldHandler(failedFireRoute, "POST", "http://localhost/api/public/failed-fire", "{invalid", badJsonHeaders);
  const newFfBadJson = await callNewExpress(baseUrl, "POST", "/api/public/failed-fire", "{invalid", badJsonHeaders);
  results.push({
    endpoint: "POST /api/public/failed-fire",
    test: "Malformed JSON body returns 400",
    oldStatus: oldFfBadJson.status,
    newStatus: newFfBadJson.status,
    responseMatch: oldFfBadJson.status === 400 && newFfBadJson.status === 400 && deepEqual(oldFfBadJson.body, newFfBadJson.body),
    dbMatch: true,
    pass: oldFfBadJson.status === 400 && newFfBadJson.status === 400 && deepEqual(oldFfBadJson.body, newFfBadJson.body),
    details: `400 Invalid JSON body (Old: ${JSON.stringify(oldFfBadJson.body)}, New: ${JSON.stringify(newFfBadJson.body)})`,
  });

  // 4b. Missing phone or phone < 6 digits
  const oldFfShortPhone = await callOldHandler(failedFireRoute, "POST", "http://localhost/api/public/failed-fire", { phone: "123", messageId: "msg_123", status: "failed" }, authHeaders);
  const newFfShortPhone = await callNewExpress(baseUrl, "POST", "/api/public/failed-fire", { phone: "123", messageId: "msg_123", status: "failed" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/failed-fire",
    test: "Short phone returns 400 Invalid failed fire event",
    oldStatus: oldFfShortPhone.status,
    newStatus: newFfShortPhone.status,
    responseMatch: oldFfShortPhone.status === 400 && newFfShortPhone.status === 400 && deepEqual(oldFfShortPhone.body, newFfShortPhone.body),
    dbMatch: true,
    pass: oldFfShortPhone.status === 400 && newFfShortPhone.status === 400,
    details: "400 Invalid failed fire event",
  });

  // 4c. Missing messageId
  const oldFfNoMsgId = await callOldHandler(failedFireRoute, "POST", "http://localhost/api/public/failed-fire", { phone: "9876543210", status: "failed" }, authHeaders);
  const newFfNoMsgId = await callNewExpress(baseUrl, "POST", "/api/public/failed-fire", { phone: "9876543210", status: "failed" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/failed-fire",
    test: "Missing messageId returns 400 Invalid failed fire event",
    oldStatus: oldFfNoMsgId.status,
    newStatus: newFfNoMsgId.status,
    responseMatch: oldFfNoMsgId.status === 400 && newFfNoMsgId.status === 400 && deepEqual(oldFfNoMsgId.body, newFfNoMsgId.body),
    dbMatch: true,
    pass: oldFfNoMsgId.status === 400 && newFfNoMsgId.status === 400,
    details: "400 Invalid failed fire event",
  });

  // 4d. Not a failure event
  const oldFfNotFail = await callOldHandler(failedFireRoute, "POST", "http://localhost/api/public/failed-fire", { phone: "9876543210", messageId: "msg_123", status: "delivered" }, authHeaders);
  const newFfNotFail = await callNewExpress(baseUrl, "POST", "/api/public/failed-fire", { phone: "9876543210", messageId: "msg_123", status: "delivered" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/failed-fire",
    test: "Status delivered (not failure) returns 400",
    oldStatus: oldFfNotFail.status,
    newStatus: newFfNotFail.status,
    responseMatch: oldFfNotFail.status === 400 && newFfNotFail.status === 400 && deepEqual(oldFfNotFail.body, newFfNotFail.body),
    dbMatch: true,
    pass: oldFfNotFail.status === 400 && newFfNotFail.status === 400,
    details: "400 Not a failure event",
  });

  // 4e. Valid failed payload with unconfigured/different template returns ignored: true
  const testPhoneIgnored = "9988770020";
  const oldFfIgnored = await callOldHandler(
    failedFireRoute,
    "POST",
    "http://localhost/api/public/failed-fire",
    { phone: testPhoneIgnored, messageId: "msg_unconf_999", status: "failed", reason: "undelivered" },
    authHeaders
  );
  const newFfIgnored = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/failed-fire",
    { phone: testPhoneIgnored, messageId: "msg_unconf_999", status: "failed", reason: "undelivered" },
    authHeaders
  );
  const ignoredMatch = oldFfIgnored.status === 200 && newFfIgnored.status === 200 &&
    oldFfIgnored.body.ignored === true && newFfIgnored.body.ignored === true &&
    deepEqual(oldFfIgnored.body, newFfIgnored.body);

  results.push({
    endpoint: "POST /api/public/failed-fire",
    test: "Valid failure with unmatched template returns 200 ignored:true",
    oldStatus: oldFfIgnored.status,
    newStatus: newFfIgnored.status,
    responseMatch: ignoredMatch,
    dbMatch: true,
    pass: ignoredMatch,
    details: "Ignored true response matched",
  });

  // 4f. Full pipeline test with Mocked Gallabox fetch (resolving FAILED_FIRE_TEMPLATE_ID):
  // Tests: phone tail lookup, transition to FAILED_FIRE, lead_events insert, audit_logs insert, and idempotency!
  const FAILED_FIRE_TEMPLATE_ID = "6a619af9797a751542542897";
  const origFetch = globalThis.fetch;

  // Intercept fetch to server.gallabox.com to return mock template response without external network calls!
  globalThis.fetch = async (input: any, init?: any) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input?.url ?? "";
    if (urlStr.includes("server.gallabox.com")) {
      return new Response(JSON.stringify({
        data: {
          whatsapp: {
            template: {
              templateId: FAILED_FIRE_TEMPLATE_ID,
            },
          },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return origFetch(input, init);
  };

  // Insert dummy credentials into integration_settings so resolveTemplateIdFromGallabox proceeds to fetch
  await supabaseAdmin.from("integration_settings").upsert([
    { key: "gallabox_api_key", value: "test_key" },
    { key: "gallabox_api_secret", value: "test_secret" },
  ]);

  // Test 4f(1): Unknown phone returns 404
  const oldFfUnknown = await callOldHandler(
    failedFireRoute,
    "POST",
    "http://localhost/api/public/failed-fire",
    { phone: "9999999999", messageId: "msg_matched_000", status: "failed" },
    authHeaders
  );
  const newFfUnknown = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/failed-fire",
    { phone: "9999999999", messageId: "msg_matched_000", status: "failed" },
    authHeaders
  );
  const unknownFfMatch = oldFfUnknown.status === 404 && newFfUnknown.status === 404 && deepEqual(oldFfUnknown.body, newFfUnknown.body);
  results.push({
    endpoint: "POST /api/public/failed-fire",
    test: "Matching template with unknown phone returns 404",
    oldStatus: oldFfUnknown.status,
    newStatus: newFfUnknown.status,
    responseMatch: unknownFfMatch,
    dbMatch: true,
    pass: unknownFfMatch,
    details: "404 Lead not found matched",
  });

  // Test 4f(2): Full valid failed fire execution on existing lead
  const testPhoneFf = "9988770025";
  await cleanupLead(testPhoneFf);
  const { data: leadFfOld } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-99925",
    full_name: "Test Failed Fire Old",
    phone: `+91${testPhoneFf}`,
    stage: "AUTO_FIRED",
  }).select("id").single();

  const msgIdOld = "msg_ff_test_old_111";
  const oldFfSuccess = await callOldHandler(
    failedFireRoute,
    "POST",
    "http://localhost/api/public/failed-fire",
    { phone: testPhoneFf, messageId: msgIdOld, status: "failed", reason: "undelivered" },
    authHeaders
  );
  const { data: oldFfLeadAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", leadFfOld?.id).single();
  const { data: oldFfEvents } = await supabaseAdmin.from("lead_events").select("event, status").eq("lead_id", leadFfOld?.id);
  const { data: oldFfAudits } = await supabaseAdmin.from("audit_logs").select("action").eq("entity_id", leadFfOld?.id);
  await cleanupLead(testPhoneFf, leadFfOld?.id);

  // Setup same for Express
  const { data: leadFfNew } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-99925",
    full_name: "Test Failed Fire New",
    phone: `+91${testPhoneFf}`,
    stage: "AUTO_FIRED",
  }).select("id").single();

  const msgIdNew = "msg_ff_test_new_222";
  const newFfSuccess = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/failed-fire",
    { phone: testPhoneFf, messageId: msgIdNew, status: "failed", reason: "undelivered" },
    authHeaders
  );
  const { data: newFfLeadAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", leadFfNew?.id).single();
  const { data: newFfEvents } = await supabaseAdmin.from("lead_events").select("event, status").eq("lead_id", leadFfNew?.id);
  const { data: newFfAudits } = await supabaseAdmin.from("audit_logs").select("action").eq("entity_id", leadFfNew?.id);

  const ffStatusMatch = oldFfSuccess.status === 200 && newFfSuccess.status === 200 &&
    oldFfSuccess.body.stage === "FAILED_FIRE" && newFfSuccess.body.stage === "FAILED_FIRE" &&
    oldFfSuccess.body.stage_updated === true && newFfSuccess.body.stage_updated === true;
  const ffDbMatch = oldFfLeadAfter?.stage === "FAILED_FIRE" && newFfLeadAfter?.stage === "FAILED_FIRE" &&
    oldFfEvents?.[0]?.event === "GALLABOX_FAILED_FIRE" && newFfEvents?.[0]?.event === "GALLABOX_FAILED_FIRE" &&
    oldFfAudits?.some((a) => a.action === "GALLABOX_FAILED_FIRE") && newFfAudits?.some((a) => a.action === "GALLABOX_FAILED_FIRE");

  results.push({
    endpoint: "POST /api/public/failed-fire",
    test: "Valid failure moves lead to FAILED_FIRE, logs event & audit",
    oldStatus: oldFfSuccess.status,
    newStatus: newFfSuccess.status,
    responseMatch: ffStatusMatch,
    dbMatch: Boolean(ffDbMatch),
    pass: Boolean(ffStatusMatch && ffDbMatch),
    details: `Lead stage updated to ${newFfLeadAfter?.stage}, Event: ${newFfEvents?.[0]?.event}`,
  });

  // Test 4f(3): Idempotency check with same messageId
  const oldIdemp = await callOldHandler(
    failedFireRoute,
    "POST",
    "http://localhost/api/public/failed-fire",
    { phone: testPhoneFf, messageId: msgIdNew, status: "failed" },
    authHeaders
  );
  const newIdemp = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/failed-fire",
    { phone: testPhoneFf, messageId: msgIdNew, status: "failed" },
    authHeaders
  );
  const idempMatch = oldIdemp.status === 200 && newIdemp.status === 200 &&
    oldIdemp.body.already_processed === true && newIdemp.body.already_processed === true &&
    deepEqual(oldIdemp.body, newIdemp.body);

  results.push({
    endpoint: "POST /api/public/failed-fire",
    test: "Idempotency check: duplicate messageId returns already_processed",
    oldStatus: oldIdemp.status,
    newStatus: newIdemp.status,
    responseMatch: idempMatch,
    dbMatch: true,
    pass: idempMatch,
    details: "already_processed matched",
  });

  // Clean up
  await cleanupLead(testPhoneFf, leadFfNew?.id);
  await supabaseAdmin.from("integration_settings").delete().in("key", ["gallabox_api_key", "gallabox_api_secret"]);
  globalThis.fetch = origFetch;

  // Restore environment
  if (origKey !== undefined) {
    process.env.LEAD_INTAKE_API_KEY = origKey;
  } else {
    delete process.env.LEAD_INTAKE_API_KEY;
  }

  await stopServer();

  console.log("\n==================================================");
  console.log("PARITY TEST SUMMARY RESULTS:");
  console.log("==================================================");
  console.table(results);

  const allPassed = results.every((r) => r.pass);
  console.log(`\nOVERALL BATCH 2 PARITY STATUS: ${allPassed ? "ALL PASS" : "FAIL"}`);
  return allPassed;
}

runBatch2ParityTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
