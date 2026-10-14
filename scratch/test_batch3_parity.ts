import dotenv from "dotenv";
dotenv.config();

import { app } from "../backend/src/app.js";
import { Route as leadEventsRoute } from "../src/routes/api/public/lead-events.js";
import { Route as templateStageRoute } from "../src/routes/api/public/template-stage.js";
import { Route as whatsappMessageRoute } from "../src/routes/api/public/whatsapp-message.js";
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

const TEST_KEY = "test_batch3_secret_key_99999";

async function cleanupLead(phone: string, id?: string) {
  if (id) {
    await supabaseAdmin.from("lead_events").delete().eq("lead_id", id);
    await supabaseAdmin.from("lead_stage_history").delete().eq("lead_id", id);
    await supabaseAdmin.from("retargeting_schedule").delete().eq("lead_id", id);
    await supabaseAdmin.from("audit_logs").delete().eq("entity_id", id);
    await supabaseAdmin.from("kob_leads").delete().eq("id", id);
  }
  if (phone) {
    const tail = phone.replace(/\D+/g, "").slice(-10);
    const { data: leads } = await supabaseAdmin.from("kob_leads").select("id").ilike("phone", `%${tail}`);
    for (const l of leads ?? []) {
      await supabaseAdmin.from("lead_events").delete().eq("lead_id", l.id);
      await supabaseAdmin.from("lead_stage_history").delete().eq("lead_id", l.id);
      await supabaseAdmin.from("retargeting_schedule").delete().eq("lead_id", l.id);
      await supabaseAdmin.from("audit_logs").delete().eq("entity_id", l.id);
      await supabaseAdmin.from("kob_leads").delete().eq("id", l.id);
    }
    // Also delete any unassociated lead_events for this phone
    await supabaseAdmin.from("lead_events").delete().ilike("phone", `%${tail}`);
  }
}

async function runBatch3ParityTests() {
  console.log("==================================================");
  console.log("STARTING FINAL PUBLIC ROUTE BATCH PARITY TESTS");
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

  const endpoints = [
    { name: "lead-events", path: "/api/public/lead-events", route: leadEventsRoute },
    { name: "template-stage", path: "/api/public/template-stage", route: templateStageRoute },
    { name: "whatsapp-message", path: "/api/public/whatsapp-message", route: whatsappMessageRoute },
  ];

  const origKey = process.env.LEAD_INTAKE_API_KEY;

  // --------------------------------------------------------------------------
  // SECTION 1: AUTHENTICATION & SECURITY HARDENING (COMMON ACROSS ALL 3)
  // --------------------------------------------------------------------------
  console.log("\n--- Testing Common Auth & Hardening ---");

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
  // SECTION 2: POST /api/public/lead-events
  // --------------------------------------------------------------------------
  console.log("\n--- Testing 1: lead-events ---");

  // 2a. Malformed JSON body
  const badJsonHeaders = { ...authHeaders, "content-type": "application/json" };
  const oldEvBadJson = await callOldHandler(leadEventsRoute, "POST", "http://localhost/api/public/lead-events", "{invalid", badJsonHeaders);
  const newEvBadJson = await callNewExpress(baseUrl, "POST", "/api/public/lead-events", "{invalid", badJsonHeaders);
  results.push({
    endpoint: "POST /api/public/lead-events",
    test: "Malformed JSON body returns 400",
    oldStatus: oldEvBadJson.status,
    newStatus: newEvBadJson.status,
    responseMatch: oldEvBadJson.status === 400 && newEvBadJson.status === 400 && deepEqual(oldEvBadJson.body, newEvBadJson.body),
    dbMatch: true,
    pass: oldEvBadJson.status === 400 && newEvBadJson.status === 400,
    details: "Exact 400 Invalid JSON body",
  });

  // 2b. Missing phone
  const oldEvNoPhone = await callOldHandler(leadEventsRoute, "POST", "http://localhost/api/public/lead-events", { event: "delivered" }, authHeaders);
  const newEvNoPhone = await callNewExpress(baseUrl, "POST", "/api/public/lead-events", { event: "delivered" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/lead-events",
    test: "Missing phone returns 400 Validation failed",
    oldStatus: oldEvNoPhone.status,
    newStatus: newEvNoPhone.status,
    responseMatch: oldEvNoPhone.status === 400 && newEvNoPhone.status === 400 && deepEqual(oldEvNoPhone.body, newEvNoPhone.body),
    dbMatch: true,
    pass: oldEvNoPhone.status === 400 && newEvNoPhone.status === 400,
    details: "400 Validation failed",
  });

  // 2c. New phone -> lead auto-created
  const testPhoneNewLead = "9988110001";
  await cleanupLead(testPhoneNewLead);

  // Call Old
  const oldEvNew = await callOldHandler(
    leadEventsRoute,
    "POST",
    "http://localhost/api/public/lead-events",
    {
      phone: `+91${testPhoneNewLead}`,
      event: "message_sent",
      status: "sent",
      payload: { name: "Auto Created Old Lead", source: "WhatsApp Broadcast" },
    },
    authHeaders
  );
  const { data: oldCreatedLead } = await supabaseAdmin.from("kob_leads").select("*").ilike("phone", `%${testPhoneNewLead}`).single();
  const { data: oldEvents } = await supabaseAdmin.from("lead_events").select("*").eq("lead_id", oldCreatedLead?.id);
  await cleanupLead(testPhoneNewLead, oldCreatedLead?.id);

  // Call New
  const newEvNew = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/lead-events",
    {
      phone: `+91${testPhoneNewLead}`,
      event: "message_sent",
      status: "sent",
      payload: { name: "Auto Created Old Lead", source: "WhatsApp Broadcast" },
    },
    authHeaders
  );
  const { data: newCreatedLead } = await supabaseAdmin.from("kob_leads").select("*").ilike("phone", `%${testPhoneNewLead}`).single();
  const { data: newEvents } = await supabaseAdmin.from("lead_events").select("*").eq("lead_id", newCreatedLead?.id);
  await cleanupLead(testPhoneNewLead, newCreatedLead?.id);

  const newLeadMatch =
    oldEvNew.status === 200 &&
    newEvNew.status === 200 &&
    oldEvNew.body.ok === newEvNew.body.ok &&
    oldEvNew.body.event_logged === newEvNew.body.event_logged &&
    oldEvNew.body.lead_created === true &&
    newEvNew.body.lead_created === true &&
    oldCreatedLead?.stage === newCreatedLead?.stage &&
    oldCreatedLead?.full_name === newCreatedLead?.full_name &&
    oldEvents?.length === newEvents?.length;

  results.push({
    endpoint: "POST /api/public/lead-events",
    test: "New phone -> lead auto-created with exact fields and events",
    oldStatus: oldEvNew.status,
    newStatus: newEvNew.status,
    responseMatch: newLeadMatch,
    dbMatch: newLeadMatch,
    pass: newLeadMatch,
    details: "Lead created and event logged parity match",
  });

  // 2d. Delivery success event on existing LEAD_INBOX lead advances to AUTO_FIRED
  const testPhoneAutoFired = "9988110002";
  await cleanupLead(testPhoneAutoFired);
  const { data: lInbox1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88101",
    full_name: "Test Lead Auto Fired",
    phone: `+91${testPhoneAutoFired}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const oldEvAuto = await callOldHandler(
    leadEventsRoute,
    "POST",
    "http://localhost/api/public/lead-events",
    { phone: `+91${testPhoneAutoFired}`, event: "message_delivered", status: "delivered" },
    authHeaders
  );
  const { data: oldLInboxAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lInbox1?.id).single();
  await cleanupLead(testPhoneAutoFired, lInbox1?.id);

  const { data: lInbox2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88101",
    full_name: "Test Lead Auto Fired",
    phone: `+91${testPhoneAutoFired}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const newEvAuto = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/lead-events",
    { phone: `+91${testPhoneAutoFired}`, event: "message_delivered", status: "delivered" },
    authHeaders
  );
  const { data: newLInboxAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lInbox2?.id).single();
  await cleanupLead(testPhoneAutoFired, lInbox2?.id);

  const autoFiredMatch =
    oldEvAuto.status === 200 &&
    newEvAuto.status === 200 &&
    deepEqual(oldEvAuto.body, newEvAuto.body, ["lead_id"]) &&
    oldLInboxAfter?.stage === "AUTO_FIRED" &&
    newLInboxAfter?.stage === "AUTO_FIRED";

  results.push({
    endpoint: "POST /api/public/lead-events",
    test: "LEAD_INBOX delivery event advances stage to AUTO_FIRED",
    oldStatus: oldEvAuto.status,
    newStatus: newEvAuto.status,
    responseMatch: autoFiredMatch,
    dbMatch: autoFiredMatch,
    pass: autoFiredMatch,
    details: "LEAD_INBOX -> AUTO_FIRED parity",
  });

  // 2e. Sequential multi-stage advancement (LEAD_INBOX -> EOI_1 via template "talk to team drip 6")
  const testPhoneMultiStage = "9988110003";
  await cleanupLead(testPhoneMultiStage);
  const { data: lMulti1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88102",
    full_name: "Test Multi Stage",
    phone: `+91${testPhoneMultiStage}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const oldEvMulti = await callOldHandler(
    leadEventsRoute,
    "POST",
    "http://localhost/api/public/lead-events",
    { phone: `+91${testPhoneMultiStage}`, event: "button_click", template: "talk to team drip 6" },
    authHeaders
  );
  const { data: oldMultiAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lMulti1?.id).single();
  const { data: oldMultiAudits } = await supabaseAdmin.from("audit_logs").select("action, meta").eq("entity_id", lMulti1?.id);
  await cleanupLead(testPhoneMultiStage, lMulti1?.id);

  const { data: lMulti2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88102",
    full_name: "Test Multi Stage",
    phone: `+91${testPhoneMultiStage}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const newEvMulti = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/lead-events",
    { phone: `+91${testPhoneMultiStage}`, event: "button_click", template: "talk to team drip 6" },
    authHeaders
  );
  const { data: newMultiAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lMulti2?.id).single();
  const { data: newMultiAudits } = await supabaseAdmin.from("audit_logs").select("action, meta").eq("entity_id", lMulti2?.id);
  await cleanupLead(testPhoneMultiStage, lMulti2?.id);

  const multiStageMatch =
    oldEvMulti.status === 200 &&
    newEvMulti.status === 200 &&
    deepEqual(oldEvMulti.body, newEvMulti.body, ["lead_id"]) &&
    oldMultiAfter?.stage === "EOI_1" &&
    newMultiAfter?.stage === "EOI_1" &&
    oldMultiAudits?.length === newMultiAudits?.length;

  results.push({
    endpoint: "POST /api/public/lead-events",
    test: "Multi-stage sequential funnel walk: LEAD_INBOX -> AUTO_FIRED -> EOI_1",
    oldStatus: oldEvMulti.status,
    newStatus: newEvMulti.status,
    responseMatch: multiStageMatch,
    dbMatch: multiStageMatch,
    pass: multiStageMatch,
    details: "Stepwise transition and audit logs match",
  });

  // 2f. Older stage event does not rewind (no backward movement)
  const testPhoneRewind = "9988110004";
  await cleanupLead(testPhoneRewind);
  const { data: lRewind1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88103",
    full_name: "Test No Rewind",
    phone: `+91${testPhoneRewind}`,
    stage: "WEBINAR",
  }).select("id").single();

  const oldEvRewind = await callOldHandler(
    leadEventsRoute,
    "POST",
    "http://localhost/api/public/lead-events",
    { phone: `+91${testPhoneRewind}`, event: "message_delivered", status: "delivered" },
    authHeaders
  );
  const { data: oldRewindAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lRewind1?.id).single();
  await cleanupLead(testPhoneRewind, lRewind1?.id);

  const { data: lRewind2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88103",
    full_name: "Test No Rewind",
    phone: `+91${testPhoneRewind}`,
    stage: "WEBINAR",
  }).select("id").single();

  const newEvRewind = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/lead-events",
    { phone: `+91${testPhoneRewind}`, event: "message_delivered", status: "delivered" },
    authHeaders
  );
  const { data: newRewindAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lRewind2?.id).single();
  await cleanupLead(testPhoneRewind, lRewind2?.id);

  const rewindMatch =
    oldEvRewind.status === 200 &&
    newEvRewind.status === 200 &&
    deepEqual(oldEvRewind.body, newEvRewind.body, ["lead_id"]) &&
    oldEvRewind.body.stage_updated === false &&
    newEvRewind.body.stage_updated === false &&
    oldRewindAfter?.stage === "WEBINAR" &&
    newRewindAfter?.stage === "WEBINAR";

  results.push({
    endpoint: "POST /api/public/lead-events",
    test: "Older stage event does not move backward",
    oldStatus: oldEvRewind.status,
    newStatus: newEvRewind.status,
    responseMatch: rewindMatch,
    dbMatch: rewindMatch,
    pass: rewindMatch,
    details: "Stage strictly forward-only",
  });

  // 2g. Failure signal does not move lead
  const testPhoneFail = "9988110005";
  await cleanupLead(testPhoneFail);
  const { data: lFail1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88104",
    full_name: "Test Failure Signal",
    phone: `+91${testPhoneFail}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const oldEvFail = await callOldHandler(
    leadEventsRoute,
    "POST",
    "http://localhost/api/public/lead-events",
    { phone: `+91${testPhoneFail}`, event: "template_failed", status: "failed" },
    authHeaders
  );
  const { data: oldFailAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lFail1?.id).single();
  await cleanupLead(testPhoneFail, lFail1?.id);

  const { data: lFail2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88104",
    full_name: "Test Failure Signal",
    phone: `+91${testPhoneFail}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const newEvFail = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/lead-events",
    { phone: `+91${testPhoneFail}`, event: "template_failed", status: "failed" },
    authHeaders
  );
  const { data: newFailAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lFail2?.id).single();
  await cleanupLead(testPhoneFail, lFail2?.id);

  const failSignalMatch =
    oldEvFail.status === 200 &&
    newEvFail.status === 200 &&
    deepEqual(oldEvFail.body, newEvFail.body, ["lead_id"]) &&
    oldEvFail.body.stage_updated === false &&
    newEvFail.body.stage_updated === false &&
    oldFailAfter?.stage === "LEAD_INBOX" &&
    newFailAfter?.stage === "LEAD_INBOX";

  results.push({
    endpoint: "POST /api/public/lead-events",
    test: "Failure event does not move stage (logged only)",
    oldStatus: oldEvFail.status,
    newStatus: newEvFail.status,
    responseMatch: failSignalMatch,
    dbMatch: failSignalMatch,
    pass: failSignalMatch,
    details: "Failed events ignored for stage progression",
  });

  // --------------------------------------------------------------------------
  // SECTION 3: POST /api/public/template-stage
  // --------------------------------------------------------------------------
  console.log("\n--- Testing 2: template-stage ---");

  // 3a. Malformed JSON body
  const oldTplBadJson = await callOldHandler(templateStageRoute, "POST", "http://localhost/api/public/template-stage", "{invalid", badJsonHeaders);
  const newTplBadJson = await callNewExpress(baseUrl, "POST", "/api/public/template-stage", "{invalid", badJsonHeaders);
  results.push({
    endpoint: "POST /api/public/template-stage",
    test: "Malformed JSON body returns 400",
    oldStatus: oldTplBadJson.status,
    newStatus: newTplBadJson.status,
    responseMatch: oldTplBadJson.status === 400 && newTplBadJson.status === 400 && deepEqual(oldTplBadJson.body, newTplBadJson.body),
    dbMatch: true,
    pass: oldTplBadJson.status === 400 && newTplBadJson.status === 400,
    details: "Exact 400 Invalid JSON body",
  });

  // 3b. Unknown template name
  const oldTplUnknown = await callOldHandler(templateStageRoute, "POST", "http://localhost/api/public/template-stage", { phone: "9988220000", template_name: "nonexistent_tpl" }, authHeaders);
  const newTplUnknown = await callNewExpress(baseUrl, "POST", "/api/public/template-stage", { phone: "9988220000", template_name: "nonexistent_tpl" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/template-stage",
    test: "Unknown template name returns 400",
    oldStatus: oldTplUnknown.status,
    newStatus: newTplUnknown.status,
    responseMatch: oldTplUnknown.status === 400 && newTplUnknown.status === 400 && deepEqual(oldTplUnknown.body, newTplUnknown.body),
    dbMatch: true,
    pass: oldTplUnknown.status === 400 && newTplUnknown.status === 400,
    details: "400 No stage mapping",
  });

  // 3c. Unknown phone
  const oldTplNoPhone = await callOldHandler(templateStageRoute, "POST", "http://localhost/api/public/template-stage", { phone: "9988220000", template_name: "initial_common_drip_clone_clone_clone", status: "delivered" }, authHeaders);
  const newTplNoPhone = await callNewExpress(baseUrl, "POST", "/api/public/template-stage", { phone: "9988220000", template_name: "initial_common_drip_clone_clone_clone", status: "delivered" }, authHeaders);
  results.push({
    endpoint: "POST /api/public/template-stage",
    test: "Unknown phone returns 404 Lead not found",
    oldStatus: oldTplNoPhone.status,
    newStatus: newTplNoPhone.status,
    responseMatch: oldTplNoPhone.status === 404 && newTplNoPhone.status === 404 && deepEqual(oldTplNoPhone.body, newTplNoPhone.body),
    dbMatch: true,
    pass: oldTplNoPhone.status === 404 && newTplNoPhone.status === 404,
    details: "404 Lead not found for phone",
  });

  // 3d. AUTO_FIRED mapping (initial_common_drip... with status sent)
  const testPhoneTplAuto = "9988220001";
  await cleanupLead(testPhoneTplAuto);
  const { data: lTplAuto1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88201",
    full_name: "Test Tpl Auto",
    phone: `+91${testPhoneTplAuto}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const oldTplAuto = await callOldHandler(
    templateStageRoute,
    "POST",
    "http://localhost/api/public/template-stage",
    { phone: `+91${testPhoneTplAuto}`, template_name: "initial_common_drip_clone_clone_clone", status: "delivered" },
    authHeaders
  );
  const { data: oldTplAutoAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lTplAuto1?.id).single();
  await cleanupLead(testPhoneTplAuto, lTplAuto1?.id);

  const { data: lTplAuto2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88201",
    full_name: "Test Tpl Auto",
    phone: `+91${testPhoneTplAuto}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const newTplAuto = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/template-stage",
    { phone: `+91${testPhoneTplAuto}`, template_name: "initial_common_drip_clone_clone_clone", status: "delivered" },
    authHeaders
  );
  const { data: newTplAutoAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lTplAuto2?.id).single();
  await cleanupLead(testPhoneTplAuto, lTplAuto2?.id);

  const tplAutoMatch =
    oldTplAuto.status === 200 &&
    newTplAuto.status === 200 &&
    deepEqual(oldTplAuto.body, newTplAuto.body, ["lead_id"]) &&
    oldTplAutoAfter?.stage === "AUTO_FIRED" &&
    newTplAutoAfter?.stage === "AUTO_FIRED";

  results.push({
    endpoint: "POST /api/public/template-stage",
    test: "AUTO_FIRED template mapping advances LEAD_INBOX to AUTO_FIRED",
    oldStatus: oldTplAuto.status,
    newStatus: newTplAuto.status,
    responseMatch: tplAutoMatch,
    dbMatch: tplAutoMatch,
    pass: tplAutoMatch,
    details: "initial_common_drip -> AUTO_FIRED matched",
  });

  // 3e. EOI_1 mapping
  const testPhoneTplEoi = "9988220002";
  await cleanupLead(testPhoneTplEoi);
  const { data: lTplEoi1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88202",
    full_name: "Test Tpl EOI",
    phone: `+91${testPhoneTplEoi}`,
    stage: "AUTO_FIRED",
  }).select("id").single();

  const oldTplEoi = await callOldHandler(
    templateStageRoute,
    "POST",
    "http://localhost/api/public/template-stage",
    { phone: `+91${testPhoneTplEoi}`, template_name: "tamil_drip1_kob_clone_clone_clone_clone_new_crm", status: "delivered" },
    authHeaders
  );
  const { data: oldTplEoiAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lTplEoi1?.id).single();
  await cleanupLead(testPhoneTplEoi, lTplEoi1?.id);

  const { data: lTplEoi2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88202",
    full_name: "Test Tpl EOI",
    phone: `+91${testPhoneTplEoi}`,
    stage: "AUTO_FIRED",
  }).select("id").single();

  const newTplEoi = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/template-stage",
    { phone: `+91${testPhoneTplEoi}`, template_name: "tamil_drip1_kob_clone_clone_clone_clone_new_crm", status: "delivered" },
    authHeaders
  );
  const { data: newTplEoiAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lTplEoi2?.id).single();
  await cleanupLead(testPhoneTplEoi, lTplEoi2?.id);

  const tplEoiMatch =
    oldTplEoi.status === 200 &&
    newTplEoi.status === 200 &&
    deepEqual(oldTplEoi.body, newTplEoi.body, ["lead_id"]) &&
    oldTplEoiAfter?.stage === "EOI_1" &&
    newTplEoiAfter?.stage === "EOI_1";

  results.push({
    endpoint: "POST /api/public/template-stage",
    test: "EOI_1 template mapping advances AUTO_FIRED to EOI_1",
    oldStatus: oldTplEoi.status,
    newStatus: newTplEoi.status,
    responseMatch: tplEoiMatch,
    dbMatch: tplEoiMatch,
    pass: tplEoiMatch,
    details: "tamil_drip1 -> EOI_1 matched",
  });

  // 3f. WEBINAR mapping valid ONLY from EOI_1
  const testPhoneTplWebinar = "9988220003";
  await cleanupLead(testPhoneTplWebinar);
  const { data: lTplWeb1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88203",
    full_name: "Test Tpl Webinar",
    phone: `+91${testPhoneTplWebinar}`,
    stage: "EOI_1",
  }).select("id").single();

  const oldTplWeb = await callOldHandler(
    templateStageRoute,
    "POST",
    "http://localhost/api/public/template-stage",
    { phone: `+91${testPhoneTplWebinar}`, template_name: "new_crm_webinar_invite_tamil", status: "delivered" },
    authHeaders
  );
  const { data: oldTplWebAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lTplWeb1?.id).single();
  await cleanupLead(testPhoneTplWebinar, lTplWeb1?.id);

  const { data: lTplWeb2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88203",
    full_name: "Test Tpl Webinar",
    phone: `+91${testPhoneTplWebinar}`,
    stage: "EOI_1",
  }).select("id").single();

  const newTplWeb = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/template-stage",
    { phone: `+91${testPhoneTplWebinar}`, template_name: "new_crm_webinar_invite_tamil", status: "delivered" },
    authHeaders
  );
  const { data: newTplWebAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lTplWeb2?.id).single();
  await cleanupLead(testPhoneTplWebinar, lTplWeb2?.id);

  const tplWebMatch =
    oldTplWeb.status === 200 &&
    newTplWeb.status === 200 &&
    deepEqual(oldTplWeb.body, newTplWeb.body, ["lead_id"]) &&
    oldTplWebAfter?.stage === "WEBINAR" &&
    newTplWebAfter?.stage === "WEBINAR";

  results.push({
    endpoint: "POST /api/public/template-stage",
    test: "WEBINAR template advances EOI_1 to WEBINAR",
    oldStatus: oldTplWeb.status,
    newStatus: newTplWeb.status,
    responseMatch: tplWebMatch,
    dbMatch: tplWebMatch,
    pass: tplWebMatch,
    details: "new_crm_webinar_invite -> WEBINAR matched",
  });

  // 3g. WEBINAR mapping ignored when lead is NOT in EOI_1
  const testPhoneTplWebIgnore = "9988220004";
  await cleanupLead(testPhoneTplWebIgnore);
  const { data: lTplWebIgn1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88204",
    full_name: "Test Tpl Webinar Ignore",
    phone: `+91${testPhoneTplWebIgnore}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const oldTplWebIgn = await callOldHandler(
    templateStageRoute,
    "POST",
    "http://localhost/api/public/template-stage",
    { phone: `+91${testPhoneTplWebIgnore}`, template_name: "new_crm_webinar_invite_tamil", status: "delivered" },
    authHeaders
  );
  const { data: oldTplWebIgnAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lTplWebIgn1?.id).single();
  await cleanupLead(testPhoneTplWebIgnore, lTplWebIgn1?.id);

  const { data: lTplWebIgn2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88204",
    full_name: "Test Tpl Webinar Ignore",
    phone: `+91${testPhoneTplWebIgnore}`,
    stage: "LEAD_INBOX",
  }).select("id").single();

  const newTplWebIgn = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/template-stage",
    { phone: `+91${testPhoneTplWebIgnore}`, template_name: "new_crm_webinar_invite_tamil", status: "delivered" },
    authHeaders
  );
  const { data: newTplWebIgnAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lTplWebIgn2?.id).single();
  await cleanupLead(testPhoneTplWebIgnore, lTplWebIgn2?.id);

  const tplWebIgnMatch =
    oldTplWebIgn.status === 200 &&
    newTplWebIgn.status === 200 &&
    deepEqual(oldTplWebIgn.body, newTplWebIgn.body, ["lead_id"]) &&
    oldTplWebIgn.body.stage_updated === false &&
    newTplWebIgn.body.stage_updated === false &&
    oldTplWebIgnAfter?.stage === "LEAD_INBOX" &&
    newTplWebIgnAfter?.stage === "LEAD_INBOX";

  results.push({
    endpoint: "POST /api/public/template-stage",
    test: "WEBINAR template ignored when lead is not in EOI_1 (no funnel walking)",
    oldStatus: oldTplWebIgn.status,
    newStatus: newTplWebIgn.status,
    responseMatch: tplWebIgnMatch,
    dbMatch: tplWebIgnMatch,
    pass: tplWebIgnMatch,
    details: "Webinar template requirement strictly enforced",
  });

  // 3h. LATER retargeting (calls apply_later_retargeting RPC)
  const testPhoneLater = "9988220005";
  await cleanupLead(testPhoneLater);
  const { data: lLater1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88205",
    full_name: "Test Later Retargeting",
    phone: `+91${testPhoneLater}`,
    stage: "EOI_1",
  }).select("id").single();

  const oldLater = await callOldHandler(
    templateStageRoute,
    "POST",
    "http://localhost/api/public/template-stage",
    { phone: `+91${testPhoneLater}`, template_name: "later_retargeting", status: "delivered" },
    authHeaders
  );
  const { data: oldLaterAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lLater1?.id).single();
  await cleanupLead(testPhoneLater, lLater1?.id);

  const { data: lLater2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88205",
    full_name: "Test Later Retargeting",
    phone: `+91${testPhoneLater}`,
    stage: "EOI_1",
  }).select("id").single();

  const newLater = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/template-stage",
    { phone: `+91${testPhoneLater}`, template_name: "later_retargeting", status: "delivered" },
    authHeaders
  );
  const { data: newLaterAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lLater2?.id).single();
  await cleanupLead(testPhoneLater, lLater2?.id);

  const laterMatch =
    oldLater.status === 200 &&
    newLater.status === 200 &&
    deepEqual(oldLater.body, newLater.body, ["lead_id"]) &&
    oldLaterAfter?.stage === "LATER" &&
    newLaterAfter?.stage === "LATER";

  results.push({
    endpoint: "POST /api/public/template-stage",
    test: "later_retargeting triggers RPC apply_later_retargeting -> LATER",
    oldStatus: oldLater.status,
    newStatus: newLater.status,
    responseMatch: laterMatch,
    dbMatch: laterMatch,
    pass: laterMatch,
    details: "RPC apply_later_retargeting execution match",
  });

  // 3i. NO retargeting (calls apply_no_retargeting RPC)
  const testPhoneNo = "9988220006";
  await cleanupLead(testPhoneNo);
  const { data: lNo1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88206",
    full_name: "Test No Retargeting",
    phone: `+91${testPhoneNo}`,
    stage: "EOI_1",
  }).select("id").single();

  const oldNo = await callOldHandler(
    templateStageRoute,
    "POST",
    "http://localhost/api/public/template-stage",
    { phone: `+91${testPhoneNo}`, template_name: "no_retargeting", status: "delivered" },
    authHeaders
  );
  const { data: oldNoAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lNo1?.id).single();
  await cleanupLead(testPhoneNo, lNo1?.id);

  const { data: lNo2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88206",
    full_name: "Test No Retargeting",
    phone: `+91${testPhoneNo}`,
    stage: "EOI_1",
  }).select("id").single();

  const newNo = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/template-stage",
    { phone: `+91${testPhoneNo}`, template_name: "no_retargeting", status: "delivered" },
    authHeaders
  );
  const { data: newNoAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lNo2?.id).single();
  await cleanupLead(testPhoneNo, lNo2?.id);

  const noMatch =
    oldNo.status === 200 &&
    newNo.status === 200 &&
    deepEqual(oldNo.body, newNo.body, ["lead_id"]) &&
    oldNoAfter?.stage === "NO" &&
    newNoAfter?.stage === "NO";

  results.push({
    endpoint: "POST /api/public/template-stage",
    test: "no_retargeting triggers RPC apply_no_retargeting -> NO",
    oldStatus: oldNo.status,
    newStatus: newNo.status,
    responseMatch: noMatch,
    dbMatch: noMatch,
    pass: noMatch,
    details: "RPC apply_no_retargeting execution match",
  });

  // 3j. Unconfirmed retargeting (status failed) leaves stage unchanged
  const testPhoneUnconf = "9988220007";
  await cleanupLead(testPhoneUnconf);
  const { data: lUnconf1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88207",
    full_name: "Test Unconfirmed Retargeting",
    phone: `+91${testPhoneUnconf}`,
    stage: "EOI_1",
  }).select("id").single();

  const oldUnconf = await callOldHandler(
    templateStageRoute,
    "POST",
    "http://localhost/api/public/template-stage",
    { phone: `+91${testPhoneUnconf}`, template_name: "later_retargeting", status: "failed" },
    authHeaders
  );
  const { data: oldUnconfAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lUnconf1?.id).single();
  await cleanupLead(testPhoneUnconf, lUnconf1?.id);

  const { data: lUnconf2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88207",
    full_name: "Test Unconfirmed Retargeting",
    phone: `+91${testPhoneUnconf}`,
    stage: "EOI_1",
  }).select("id").single();

  const newUnconf = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/template-stage",
    { phone: `+91${testPhoneUnconf}`, template_name: "later_retargeting", status: "failed" },
    authHeaders
  );
  const { data: newUnconfAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lUnconf2?.id).single();
  await cleanupLead(testPhoneUnconf, lUnconf2?.id);

  const unconfMatch =
    oldUnconf.status === 200 &&
    newUnconf.status === 200 &&
    deepEqual(oldUnconf.body, newUnconf.body) &&
    oldUnconfAfter?.stage === "EOI_1" &&
    newUnconfAfter?.stage === "EOI_1";

  results.push({
    endpoint: "POST /api/public/template-stage",
    test: "Unconfirmed later_retargeting (failed status) ignored, stage unchanged",
    oldStatus: oldUnconf.status,
    newStatus: newUnconf.status,
    responseMatch: unconfMatch,
    dbMatch: unconfMatch,
    pass: unconfMatch,
    details: "Unconfirmed retargeting protection verified",
  });

  // --------------------------------------------------------------------------
  // SECTION 4: POST /api/public/whatsapp-message
  // --------------------------------------------------------------------------
  console.log("\n--- Testing 3: whatsapp-message ---");

  // 4a. Malformed JSON body
  const oldWaBadJson = await callOldHandler(whatsappMessageRoute, "POST", "http://localhost/api/public/whatsapp-message", "{invalid", badJsonHeaders);
  const newWaBadJson = await callNewExpress(baseUrl, "POST", "/api/public/whatsapp-message", "{invalid", badJsonHeaders);
  results.push({
    endpoint: "POST /api/public/whatsapp-message",
    test: "Malformed JSON body returns 400",
    oldStatus: oldWaBadJson.status,
    newStatus: newWaBadJson.status,
    responseMatch: oldWaBadJson.status === 400 && newWaBadJson.status === 400 && deepEqual(oldWaBadJson.body, newWaBadJson.body),
    dbMatch: true,
    pass: oldWaBadJson.status === 400 && newWaBadJson.status === 400,
    details: "Exact 400 Invalid JSON body",
  });

  // 4b. Wrong channel_id -> ignored
  const oldWaWrongChan = await callOldHandler(
    whatsappMessageRoute,
    "POST",
    "http://localhost/api/public/whatsapp-message",
    { phone: "9988330001", message: "Hello", channel_id: "wrong_channel_999" },
    authHeaders
  );
  const newWaWrongChan = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/whatsapp-message",
    { phone: "9988330001", message: "Hello", channel_id: "wrong_channel_999" },
    authHeaders
  );
  const wrongChanMatch =
    oldWaWrongChan.status === 200 &&
    newWaWrongChan.status === 200 &&
    deepEqual(oldWaWrongChan.body, newWaWrongChan.body);

  results.push({
    endpoint: "POST /api/public/whatsapp-message",
    test: "Wrong channel_id ignored with success:true, ignored:true",
    oldStatus: oldWaWrongChan.status,
    newStatus: newWaWrongChan.status,
    responseMatch: wrongChanMatch,
    dbMatch: true,
    pass: wrongChanMatch,
    details: "channel_id guard parity",
  });

  // 4c. Inbound message on existing lead -> unread incremented, last_message updated
  const testPhoneWaIn = "9988330002";
  await cleanupLead(testPhoneWaIn);
  const { data: lWaIn1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88301",
    full_name: "Test WA Inbound",
    phone: `+91${testPhoneWaIn}`,
    stage: "AUTO_FIRED",
    unread_message_count: 2,
  }).select("id").single();

  const oldWaIn = await callOldHandler(
    whatsappMessageRoute,
    "POST",
    "http://localhost/api/public/whatsapp-message",
    { phone: `+91${testPhoneWaIn}`, message: "Inbound test message", direction: "incoming" },
    authHeaders
  );
  const { data: oldWaInAfter } = await supabaseAdmin.from("kob_leads").select("unread_message_count, has_unread_messages, last_message").eq("id", lWaIn1?.id).single();
  await cleanupLead(testPhoneWaIn, lWaIn1?.id);

  const { data: lWaIn2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88301",
    full_name: "Test WA Inbound",
    phone: `+91${testPhoneWaIn}`,
    stage: "AUTO_FIRED",
    unread_message_count: 2,
  }).select("id").single();

  const newWaIn = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/whatsapp-message",
    { phone: `+91${testPhoneWaIn}`, message: "Inbound test message", direction: "incoming" },
    authHeaders
  );
  const { data: newWaInAfter } = await supabaseAdmin.from("kob_leads").select("unread_message_count, has_unread_messages, last_message").eq("id", lWaIn2?.id).single();
  await cleanupLead(testPhoneWaIn, lWaIn2?.id);

  const waInMatch =
    oldWaIn.status === 200 &&
    newWaIn.status === 200 &&
    deepEqual(oldWaIn.body, newWaIn.body, ["lead_id"]) &&
    oldWaInAfter?.unread_message_count === 3 &&
    newWaInAfter?.unread_message_count === 3 &&
    oldWaInAfter?.has_unread_messages === true &&
    newWaInAfter?.has_unread_messages === true &&
    oldWaInAfter?.last_message === "Inbound test message" &&
    newWaInAfter?.last_message === "Inbound test message";

  results.push({
    endpoint: "POST /api/public/whatsapp-message",
    test: "Inbound message increments unread_count and updates last_message",
    oldStatus: oldWaIn.status,
    newStatus: newWaIn.status,
    responseMatch: waInMatch,
    dbMatch: waInMatch,
    pass: waInMatch,
    details: "Inbound badge and message parity verified",
  });

  // 4d. Outbound message does NOT increment unread_message_count
  const testPhoneWaOut = "9988330003";
  await cleanupLead(testPhoneWaOut);
  const { data: lWaOut1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88302",
    full_name: "Test WA Outbound",
    phone: `+91${testPhoneWaOut}`,
    stage: "AUTO_FIRED",
    unread_message_count: 2,
  }).select("id").single();

  const oldWaOut = await callOldHandler(
    whatsappMessageRoute,
    "POST",
    "http://localhost/api/public/whatsapp-message",
    { phone: `+91${testPhoneWaOut}`, message: "Outbound reply sent by agent", direction: "outgoing" },
    authHeaders
  );
  const { data: oldWaOutAfter } = await supabaseAdmin.from("kob_leads").select("unread_message_count, last_message").eq("id", lWaOut1?.id).single();
  await cleanupLead(testPhoneWaOut, lWaOut1?.id);

  const { data: lWaOut2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88302",
    full_name: "Test WA Outbound",
    phone: `+91${testPhoneWaOut}`,
    stage: "AUTO_FIRED",
    unread_message_count: 2,
  }).select("id").single();

  const newWaOut = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/whatsapp-message",
    { phone: `+91${testPhoneWaOut}`, message: "Outbound reply sent by agent", direction: "outgoing" },
    authHeaders
  );
  const { data: newWaOutAfter } = await supabaseAdmin.from("kob_leads").select("unread_message_count, last_message").eq("id", lWaOut2?.id).single();
  await cleanupLead(testPhoneWaOut, lWaOut2?.id);

  const waOutMatch =
    oldWaOut.status === 200 &&
    newWaOut.status === 200 &&
    deepEqual(oldWaOut.body, newWaOut.body, ["lead_id"]) &&
    oldWaOutAfter?.unread_message_count === 2 &&
    newWaOutAfter?.unread_message_count === 2 &&
    oldWaOutAfter?.last_message === "Outbound reply sent by agent" &&
    newWaOutAfter?.last_message === "Outbound reply sent by agent";

  results.push({
    endpoint: "POST /api/public/whatsapp-message",
    test: "Outbound message does not increment unread_count",
    oldStatus: oldWaOut.status,
    newStatus: newWaOut.status,
    responseMatch: waOutMatch,
    dbMatch: waOutMatch,
    pass: waOutMatch,
    details: "Outbound direction handling verified",
  });

  // 4e. New phone -> auto-creates lead via ensureLeadByPhone
  const testPhoneWaNew = "9988330004";
  await cleanupLead(testPhoneWaNew);

  const oldWaNew = await callOldHandler(
    whatsappMessageRoute,
    "POST",
    "http://localhost/api/public/whatsapp-message",
    { phone: `+91${testPhoneWaNew}`, message: "First message from new user", direction: "incoming" },
    authHeaders
  );
  const { data: oldWaCreatedLead } = await supabaseAdmin.from("kob_leads").select("*").ilike("phone", `%${testPhoneWaNew}`).single();
  await cleanupLead(testPhoneWaNew, oldWaCreatedLead?.id);

  const newWaNew = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/whatsapp-message",
    { phone: `+91${testPhoneWaNew}`, message: "First message from new user", direction: "incoming" },
    authHeaders
  );
  const { data: newWaCreatedLead } = await supabaseAdmin.from("kob_leads").select("*").ilike("phone", `%${testPhoneWaNew}`).single();
  await cleanupLead(testPhoneWaNew, newWaCreatedLead?.id);

  const waNewLeadMatch =
    oldWaNew.status === 200 &&
    newWaNew.status === 200 &&
    oldWaNew.body.success === true &&
    newWaNew.body.success === true &&
    oldWaNew.body.unread_message_count === 1 &&
    newWaNew.body.unread_message_count === 1 &&
    oldWaCreatedLead?.stage === "LEAD_INBOX" &&
    newWaCreatedLead?.stage === "LEAD_INBOX" &&
    oldWaCreatedLead?.unread_message_count === 1 &&
    newWaCreatedLead?.unread_message_count === 1;

  results.push({
    endpoint: "POST /api/public/whatsapp-message",
    test: "Inbound message from new phone auto-creates lead in LEAD_INBOX",
    oldStatus: oldWaNew.status,
    newStatus: newWaNew.status,
    responseMatch: waNewLeadMatch,
    dbMatch: waNewLeadMatch,
    pass: waNewLeadMatch,
    details: "Auto-creation via ensureLeadByPhone in whatsapp webhook",
  });

  // 4f. Language quick reply button updates language and advances to AUTO_FIRED
  const testPhoneWaLang = "9988330005";
  await cleanupLead(testPhoneWaLang);

  // Find or insert WhatsApp Broadcast source
  let { data: broadcastSource } = await supabaseAdmin.from("lead_sources").select("id").ilike("name", "WhatsApp Broadcast").maybeSingle();
  if (!broadcastSource) {
    const { data: insSrc } = await supabaseAdmin.from("lead_sources").insert({ name: "WhatsApp Broadcast" }).select("id").single();
    broadcastSource = insSrc;
  }

  const { data: lWaLang1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88303",
    full_name: "Test Language Reply",
    phone: `+91${testPhoneWaLang}`,
    stage: "LEAD_INBOX",
    source_id: broadcastSource?.id,
  }).select("id").single();

  const oldWaLang = await callOldHandler(
    whatsappMessageRoute,
    "POST",
    "http://localhost/api/public/whatsapp-message",
    {
      phone: `+91${testPhoneWaLang}`,
      message: "தமிழ்",
      direction: "incoming",
      payload: { whatsapp: { type: "button" } },
    },
    authHeaders
  );
  const { data: oldWaLangAfter } = await supabaseAdmin.from("kob_leads").select("stage, language").eq("id", lWaLang1?.id).single();
  await cleanupLead(testPhoneWaLang, lWaLang1?.id);

  const { data: lWaLang2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88303",
    full_name: "Test Language Reply",
    phone: `+91${testPhoneWaLang}`,
    stage: "LEAD_INBOX",
    source_id: broadcastSource?.id,
  }).select("id").single();

  const newWaLang = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/whatsapp-message",
    {
      phone: `+91${testPhoneWaLang}`,
      message: "தமிழ்",
      direction: "incoming",
      payload: { whatsapp: { type: "button" } },
    },
    authHeaders
  );
  const { data: newWaLangAfter } = await supabaseAdmin.from("kob_leads").select("stage, language").eq("id", lWaLang2?.id).single();
  await cleanupLead(testPhoneWaLang, lWaLang2?.id);

  const waLangMatch =
    oldWaLang.status === 200 &&
    newWaLang.status === 200 &&
    deepEqual(oldWaLang.body, newWaLang.body, ["lead_id"]) &&
    oldWaLangAfter?.stage === "AUTO_FIRED" &&
    newWaLangAfter?.stage === "AUTO_FIRED" &&
    oldWaLangAfter?.language === "TAMIL" &&
    newWaLangAfter?.language === "TAMIL";

  results.push({
    endpoint: "POST /api/public/whatsapp-message",
    test: "Language button reply updates language and stage to AUTO_FIRED",
    oldStatus: oldWaLang.status,
    newStatus: newWaLang.status,
    responseMatch: waLangMatch,
    dbMatch: waLangMatch,
    pass: waLangMatch,
    details: "Language button capture and stage progression match",
  });

  // 4g. EOI 1 Received button reply advances stage to EOI_1
  const testPhoneWaEoi = "9988330006";
  await cleanupLead(testPhoneWaEoi);
  const { data: lWaEoi1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88304",
    full_name: "Test EOI Reply",
    phone: `+91${testPhoneWaEoi}`,
    stage: "AUTO_FIRED",
  }).select("id").single();

  const oldWaEoi = await callOldHandler(
    whatsappMessageRoute,
    "POST",
    "http://localhost/api/public/whatsapp-message",
    {
      phone: `+91${testPhoneWaEoi}`,
      message: "விருப்பம் உள்ளது",
      direction: "incoming",
      payload: { whatsapp: { type: "button" } },
    },
    authHeaders
  );
  const { data: oldWaEoiAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lWaEoi1?.id).single();
  await cleanupLead(testPhoneWaEoi, lWaEoi1?.id);

  const { data: lWaEoi2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88304",
    full_name: "Test EOI Reply",
    phone: `+91${testPhoneWaEoi}`,
    stage: "AUTO_FIRED",
  }).select("id").single();

  const newWaEoi = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/whatsapp-message",
    {
      phone: `+91${testPhoneWaEoi}`,
      message: "விருப்பம் உள்ளது",
      direction: "incoming",
      payload: { whatsapp: { type: "button" } },
    },
    authHeaders
  );
  const { data: newWaEoiAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lWaEoi2?.id).single();
  await cleanupLead(testPhoneWaEoi, lWaEoi2?.id);

  const waEoiMatch =
    oldWaEoi.status === 200 &&
    newWaEoi.status === 200 &&
    deepEqual(oldWaEoi.body, newWaEoi.body, ["lead_id"]) &&
    oldWaEoiAfter?.stage === "EOI_1" &&
    newWaEoiAfter?.stage === "EOI_1";

  results.push({
    endpoint: "POST /api/public/whatsapp-message",
    test: "EOI 1 button reply advances AUTO_FIRED to EOI_1",
    oldStatus: oldWaEoi.status,
    newStatus: newWaEoi.status,
    responseMatch: waEoiMatch,
    dbMatch: waEoiMatch,
    pass: waEoiMatch,
    details: "Interest button -> EOI_1 transition match",
  });

  // 4h. Webinar booking button reply advances EOI_1 to WEBINAR
  const testPhoneWaWeb = "9988330007";
  await cleanupLead(testPhoneWaWeb);
  const { data: lWaWeb1 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88305",
    full_name: "Test Webinar Reply",
    phone: `+91${testPhoneWaWeb}`,
    stage: "EOI_1",
  }).select("id").single();

  const oldWaWeb = await callOldHandler(
    whatsappMessageRoute,
    "POST",
    "http://localhost/api/public/whatsapp-message",
    {
      phone: `+91${testPhoneWaWeb}`,
      message: "book free live webinar",
      direction: "incoming",
      payload: { whatsapp: { type: "interactive" } },
    },
    authHeaders
  );
  const { data: oldWaWebAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lWaWeb1?.id).single();
  await cleanupLead(testPhoneWaWeb, lWaWeb1?.id);

  const { data: lWaWeb2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88305",
    full_name: "Test Webinar Reply",
    phone: `+91${testPhoneWaWeb}`,
    stage: "EOI_1",
  }).select("id").single();

  const newWaWeb = await callNewExpress(
    baseUrl,
    "POST",
    "/api/public/whatsapp-message",
    {
      phone: `+91${testPhoneWaWeb}`,
      message: "book free live webinar",
      direction: "incoming",
      payload: { whatsapp: { type: "interactive" } },
    },
    authHeaders
  );
  const { data: newWaWebAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lWaWeb2?.id).single();
  await cleanupLead(testPhoneWaWeb, lWaWeb2?.id);

  const waWebMatch =
    oldWaWeb.status === 200 &&
    newWaWeb.status === 200 &&
    deepEqual(oldWaWeb.body, newWaWeb.body, ["lead_id"]) &&
    oldWaWebAfter?.stage === "WEBINAR" &&
    newWaWebAfter?.stage === "WEBINAR";

  results.push({
    endpoint: "POST /api/public/whatsapp-message",
    test: "Webinar booking button reply advances EOI_1 to WEBINAR",
    oldStatus: oldWaWeb.status,
    newStatus: newWaWeb.status,
    responseMatch: waWebMatch,
    dbMatch: waWebMatch,
    pass: waWebMatch,
    details: "Webinar button -> WEBINAR transition match",
  });

  // Restore env
  process.env.LEAD_INTAKE_API_KEY = origKey;

  await stopServer();

  // Print results summary
  console.log("\n==================================================");
  console.log("FINAL PUBLIC ROUTE BATCH PARITY TEST RESULTS");
  console.log("==================================================");
  let totalPassed = 0;
  for (const r of results) {
    const mark = r.pass ? "[PASS]" : "[FAIL]";
    console.log(`${mark} ${r.endpoint} :: ${r.test} (Old: ${r.oldStatus}, New: ${r.newStatus})`);
    if (!r.pass) {
      console.log(`   Details: ${r.details}`);
    } else {
      totalPassed++;
    }
  }

  console.log(`\nSummary: ${totalPassed}/${results.length} tests passed.`);
  if (totalPassed === results.length) {
    console.log("ALL FINAL BATCH PUBLIC ROUTE PARITY TESTS PASSED SUCCESSFULLY!");
  } else {
    console.error(`FAILED: ${results.length - totalPassed} tests failed.`);
    process.exit(1);
  }
}

runBatch3ParityTests().catch((e) => {
  console.error("FATAL TEST ERROR:", e);
  process.exit(1);
});
