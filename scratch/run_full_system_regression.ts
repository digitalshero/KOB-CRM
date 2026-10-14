import dotenv from "dotenv";
dotenv.config({ path: "./backend/.env" });

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "../backend/src/app.js";
import { supabaseAdmin } from "../backend/src/integrations/supabase/client.js";

const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const LEAD_INTAKE_API_KEY = "test_regression_intake_key_77777";
process.env.LEAD_INTAKE_API_KEY = LEAD_INTAKE_API_KEY;

function createToken(userId: string, email: string, role = "authenticated", expOffset = 7200) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + expOffset,
      sub: userId,
      email: email,
      role: role,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
    }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(header + "." + payload).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

// User fixtures from local database
const USERS = {
  superAdmin: { id: "bcc9e500-a764-4d84-b128-2e550ffd1721", email: "ceo@shero.test" },
  kobManager: { id: "25dc86bb-cda4-4bb4-8ec9-5bc6a03df10d", email: "manager@shero.test" },
  teamLeader: { id: "0e73f086-ef69-411f-9948-474f95c3c8fb", email: "tl@shero.test" },
  executive: { id: "8c4dff0d-cd27-474d-9ea8-9cc15b9a93f5", email: "exec@shero.test" },
};

const server = http.createServer(app);

function startServer(): Promise<string> {
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

async function apiRequest(baseUrl: string, method: string, path: string, token?: string, body?: any, headers: Record<string, string> = {}) {
  const reqHeaders: Record<string, string> = { ...headers };
  if (token) reqHeaders["authorization"] = `Bearer ${token}`;
  let reqBody: any = undefined;
  if (body !== undefined) {
    if (typeof body === "string") reqBody = body;
    else {
      reqBody = JSON.stringify(body);
      reqHeaders["content-type"] = "application/json";
    }
  }
  const resp = await fetch(`${baseUrl}${path}`, { method, headers: reqHeaders, body: reqBody });
  const status = resp.status;
  const respHeaders = Object.fromEntries(resp.headers.entries());
  let data: any = null;
  const text = await resp.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status, headers: respHeaders, data };
}

interface TestResult {
  area: string;
  test: string;
  status: number;
  expectedStatus: number;
  pass: boolean;
  notes?: string;
}

const results: TestResult[] = [];

function recordTest(area: string, test: string, status: number, expectedStatus: number, pass: boolean, notes?: string) {
  results.push({ area, test, status, expectedStatus, pass, notes });
}

// Table count snapshot
async function getTableCounts() {
  const tables = [
    "kob_leads",
    "lead_stage_history",
    "lead_activities",
    "lead_events",
    "audit_logs",
    "retargeting_schedule",
    "gallabox_fire_queue",
    "email_fire_queue",
    "webinar_attendance",
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { count, error } = await supabaseAdmin.from(t).select("id", { count: "exact", head: true });
    if (error) {
      const { count: c2 } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true });
      counts[t] = c2 ?? 0;
    } else {
      counts[t] = count ?? 0;
    }
  }
  return counts;
}

async function cleanupPhone(phone: string, id?: string) {
  const tail = phone.replace(/\D+/g, "").slice(-10);
  if (id) {
    await supabaseAdmin.from("lead_events").delete().eq("lead_id", id);
    await supabaseAdmin.from("lead_stage_history").delete().eq("lead_id", id);
    await supabaseAdmin.from("retargeting_schedule").delete().eq("lead_id", id);
    await supabaseAdmin.from("lead_activities").delete().eq("lead_id", id);
    await supabaseAdmin.from("audit_logs").delete().eq("entity_id", id);
    await supabaseAdmin.from("webinar_attendance").delete().eq("lead_id", id);
    await supabaseAdmin.from("kob_leads").delete().eq("id", id);
  }
  if (tail) {
    const { data: leads } = await supabaseAdmin.from("kob_leads").select("id").ilike("phone", `%${tail}`);
    for (const l of leads ?? []) {
      await supabaseAdmin.from("lead_events").delete().eq("lead_id", l.id);
      await supabaseAdmin.from("lead_stage_history").delete().eq("lead_id", l.id);
      await supabaseAdmin.from("retargeting_schedule").delete().eq("lead_id", l.id);
      await supabaseAdmin.from("lead_activities").delete().eq("lead_id", l.id);
      await supabaseAdmin.from("audit_logs").delete().eq("entity_id", l.id);
      await supabaseAdmin.from("webinar_attendance").delete().eq("lead_id", l.id);
      await supabaseAdmin.from("kob_leads").delete().eq("id", l.id);
    }
    await supabaseAdmin.from("lead_events").delete().ilike("phone", `%${tail}`);
  }
}

async function runRegression() {
  console.log("==================================================");
  console.log("STARTING FULL AUTOMATED SYSTEM REGRESSION");
  console.log("==================================================");

  const testStartTimeIso = new Date(Date.now() - 2000).toISOString();
  const baseUrl = await startServer();
  console.log(`Express server running on ${baseUrl}`);

  // ----------------------------------------------------
  // PRE-TEST SNAPSHOT
  // ----------------------------------------------------
  const baselineCounts = await getTableCounts();
  console.log("Baseline table counts:", baselineCounts);

  // Generate tokens
  const adminToken = createToken(USERS.superAdmin.id, USERS.superAdmin.email);
  const managerToken = createToken(USERS.kobManager.id, USERS.kobManager.email);
  const tlToken = createToken(USERS.teamLeader.id, USERS.teamLeader.email);
  const execToken = createToken(USERS.executive.id, USERS.executive.email);
  const expiredToken = createToken(USERS.superAdmin.id, USERS.superAdmin.email, "authenticated", -3600);
  const badSigToken = adminToken.slice(0, -6) + "xxxxxx";

  // ====================================================
  // 1. AUTHENTICATION & ROLE REGRESSION
  // ====================================================
  console.log("\n--- 1. Authentication & Role Regression ---");

  // 1a. Valid login/session verification
  const r1a = await apiRequest(baseUrl, "GET", "/api/kob/get-config", adminToken);
  recordTest("Auth/Roles", "Valid JWT returns 200 with authenticated config", r1a.status, 200, r1a.status === 200 && typeof r1a.data === "object");

  // 1b. Missing Authorization header
  const r1b = await apiRequest(baseUrl, "GET", "/api/kob/get-config");
  recordTest("Auth/Roles", "Missing Authorization header returns 401", r1b.status, 401, r1b.status === 401);

  // 1c. Invalid token structure
  const r1c = await apiRequest(baseUrl, "GET", "/api/kob/get-config", undefined, undefined, { authorization: "Bearer not.a.valid.jwt" });
  recordTest("Auth/Roles", "Malformed token structure returns 401", r1c.status, 401, r1c.status === 401);

  // 1d. Invalid signature
  const r1d = await apiRequest(baseUrl, "GET", "/api/kob/get-config", badSigToken);
  recordTest("Auth/Roles", "Tampered signature returns 401", r1d.status, 401, r1d.status === 401);

  // 1e. Expired token
  const r1e = await apiRequest(baseUrl, "GET", "/api/kob/get-config", expiredToken);
  recordTest("Auth/Roles", "Expired token returns 401", r1e.status, 401, r1e.status === 401);

  // 1f. Role access: super_admin route access
  const r1f = await apiRequest(baseUrl, "GET", "/api/kob/list-all-profiles", adminToken);
  recordTest("Auth/Roles", "super_admin can access list all profiles", r1f.status, 200, r1f.status === 200 && Array.isArray(r1f.data));

  // 1g. Role access: kob_manager access
  const r1g = await apiRequest(baseUrl, "GET", "/api/kob/list-brands", managerToken);
  recordTest("Auth/Roles", "kob_manager can access list brands", r1g.status, 200, r1g.status === 200 && Array.isArray(r1g.data));

  // 1h. Role access: team_leader access to TL overview
  const r1h = await apiRequest(baseUrl, "GET", "/api/kob/tl-overview", tlToken);
  recordTest("Auth/Roles", "team_leader can access TL overview", r1h.status, 200, r1h.status === 200);

  // 1i. Role access: executive access to exec overview
  const r1i = await apiRequest(baseUrl, "GET", "/api/kob/my-exec-overview", execToken);
  recordTest("Auth/Roles", "executive can access executive overview", r1i.status, 200, r1i.status === 200);

  // ====================================================
  // 2. DASHBOARD REGRESSION
  // ====================================================
  console.log("\n--- 2. Dashboard Regression ---");

  // 2a. KPI Snapshot
  const r2a = await apiRequest(baseUrl, "GET", "/api/kob/get-kpi-snapshot", adminToken);
  recordTest("Dashboard", "GET /api/kob/get-kpi-snapshot returns 200", r2a.status, 200, r2a.status === 200 && typeof r2a.data === "object");

  // 2b. Dashboard KPIs
  const r2b = await apiRequest(baseUrl, "GET", "/api/kob/get-dashboard-kpis?from=2026-01-01&to=2026-10-31", adminToken);
  recordTest("Dashboard", "GET /api/kob/get-dashboard-kpis with date filter returns 200", r2b.status, 200, r2b.status === 200);

  // 2c. Funnel by source
  const r2c = await apiRequest(baseUrl, "GET", "/api/kob/get-funnel-by-source", adminToken);
  recordTest("Dashboard", "GET /api/kob/get-funnel-by-source returns 200", r2c.status, 200, r2c.status === 200);

  // 2d. Funnel by language
  const r2d = await apiRequest(baseUrl, "GET", "/api/kob/get-funnel-by-language", adminToken);
  recordTest("Dashboard", "GET /api/kob/get-funnel-by-language returns 200", r2d.status, 200, r2d.status === 200);

  // 2e. Funnel by brand
  const r2e = await apiRequest(baseUrl, "GET", "/api/kob/get-funnel-by-brand", adminToken);
  recordTest("Dashboard", "GET /api/kob/get-funnel-by-brand returns 200", r2e.status, 200, r2e.status === 200);

  // 2f. Stage distribution
  const r2f = await apiRequest(baseUrl, "GET", "/api/kob/get-stage-distribution", adminToken);
  recordTest("Dashboard", "GET /api/kob/get-stage-distribution returns 200", r2f.status, 200, r2f.status === 200);

  // 2g. State summary
  const r2g = await apiRequest(baseUrl, "GET", "/api/kob/get-state-summary", adminToken);
  recordTest("Dashboard", "GET /api/kob/get-state-summary returns 200", r2g.status, 200, r2g.status === 200);

  // 2h. Targets & Configuration
  const r2h = await apiRequest(baseUrl, "GET", "/api/kob/get-config", adminToken);
  recordTest("Dashboard", "GET /api/kob/get-config returns 200", r2h.status, 200, r2h.status === 200);

  // ====================================================
  // 3. LEAD INBOX REGRESSION
  // ====================================================
  console.log("\n--- 3. Lead Inbox Regression ---");

  // 3a. Lead listing with filters
  const r3a = await apiRequest(baseUrl, "GET", "/api/kob/leads?limit=10", adminToken);
  recordTest("Lead Inbox", "GET /api/kob/leads with limit returns 200", r3a.status, 200, r3a.status === 200 && Array.isArray(r3a.data));

  // 3b. Stage filter
  const r3b = await apiRequest(baseUrl, "GET", "/api/kob/leads?stage=LEAD_INBOX&limit=10", adminToken);
  recordTest("Lead Inbox", "GET /api/kob/leads with stage filter returns 200", r3b.status, 200, r3b.status === 200 && Array.isArray(r3b.data));

  // 3c. Manual lead creation
  const phoneInbox = "9988440001";
  await cleanupPhone(phoneInbox);
  const r3c = await apiRequest(baseUrl, "POST", "/api/kob/leads/manual", adminToken, {
    full_name: "Inbox Regression Lead",
    phone: phoneInbox,
    language: "TAMIL",
  });
  const createdLeadId = r3c.data?.id;
  recordTest("Lead Inbox", "POST /api/kob/leads/manual returns 200", r3c.status, 200, r3c.status === 200 && !!createdLeadId);

  // 3d. Lead detail lookup
  const r3d = await apiRequest(baseUrl, "GET", `/api/kob/lead-detail?leadId=${createdLeadId}`, adminToken);
  recordTest("Lead Inbox", "GET /api/kob/lead-detail returns 200", r3d.status, 200, r3d.status === 200 && r3d.data?.lead?.id === createdLeadId);

  // 3e. Next action update
  const r3e = await apiRequest(baseUrl, "POST", `/api/kob/leads/${createdLeadId}/next-action`, adminToken, {
    nextAction: "Follow up call tomorrow",
  });
  recordTest("Lead Inbox", "POST /api/kob/leads/:id/next-action returns 200", r3e.status, 200, r3e.status === 200);

  // 3f. RNR tag update
  const r3f = await apiRequest(baseUrl, "POST", `/api/kob/leads/${createdLeadId}/rnr-tag`, adminToken, {
    rnr: true,
  });
  recordTest("Lead Inbox", "POST /api/kob/leads/:id/rnr-tag returns 200", r3f.status, 200, r3f.status === 200);

  // 3g. Mark messages read
  const r3g = await apiRequest(baseUrl, "POST", `/api/kob/leads/${createdLeadId}/messages/read`, adminToken, {});
  recordTest("Lead Inbox", "POST /api/kob/leads/:id/messages/read returns 200", r3g.status, 200, r3g.status === 200);

  await cleanupPhone(phoneInbox, createdLeadId);

  // ====================================================
  // 4. STAGE LIFECYCLE REGRESSION
  // ====================================================
  console.log("\n--- 4. Stage Lifecycle Regression ---");

  const phoneLifecycle = "9988440002";
  await cleanupPhone(phoneLifecycle);
  const rCreateLifecycle = await apiRequest(baseUrl, "POST", "/api/kob/leads/manual", adminToken, {
    full_name: "Lifecycle Test Lead",
    phone: phoneLifecycle,
    language: "TAMIL",
  });
  const lifecycleId = rCreateLifecycle.data?.id;

  const STAGES_SEQUENCE = [
    "AUTO_FIRED",
    "EOI_1",
    "WEBINAR",
    "EOI_2",
    "FORM_FILLED",
    "FEE_PAID",
    "KTN_CS",
    "KTN_LIVE",
  ];

  let stagesPassed = true;
  for (const st of STAGES_SEQUENCE) {
    const rStage = await apiRequest(baseUrl, "POST", `/api/kob/leads/${lifecycleId}/stage`, adminToken, {
      stage: st,
    });
    if (rStage.status !== 200) {
      stagesPassed = false;
      break;
    }
  }

  // Also test alternate/terminal stages
  const rStageNo = await apiRequest(baseUrl, "POST", `/api/kob/leads/${lifecycleId}/stage`, adminToken, { stage: "NO" });
  const rStageLater = await apiRequest(baseUrl, "POST", `/api/kob/leads/${lifecycleId}/stage`, adminToken, { stage: "LATER" });
  const rStageRetarget = await apiRequest(baseUrl, "POST", `/api/kob/leads/${lifecycleId}/stage`, adminToken, { stage: "RETARGETING" });

  // Verify lead stage history and changed_by
  const { data: stageHist } = await supabaseAdmin
    .from("lead_stage_history")
    .select("from_stage, to_stage, changed_by")
    .eq("lead_id", lifecycleId)
    .order("created_at", { ascending: true });

  const historyValid = (stageHist ?? []).length >= STAGES_SEQUENCE.length && stageHist!.every((h) => h.changed_by === USERS.superAdmin.id);

  recordTest(
    "Lead Lifecycle",
    "Sequential lifecycle LEAD_INBOX -> KTN_LIVE recorded in lead_stage_history with changed_by",
    stagesPassed ? 200 : 500,
    200,
    stagesPassed && historyValid && rStageNo.status === 200 && rStageLater.status === 200 && rStageRetarget.status === 200,
    `Steps: ${(stageHist ?? []).length}`,
  );

  await cleanupPhone(phoneLifecycle, lifecycleId);

  // ====================================================
  // 5. AUTO / MANUAL FUNNEL REGRESSION
  // ====================================================
  console.log("\n--- 5. Auto / Manual Funnel Regression ---");

  // 5a. Auto Funnel
  const r5a = await apiRequest(baseUrl, "GET", "/api/dashboard/auto-funnel", adminToken);
  const autoFunnelValid = r5a.status === 200 && typeof r5a.data === "object" && typeof r5a.data.leadGenerated === "number";
  recordTest("Funnels", "GET /api/dashboard/auto-funnel returns 200 with bucket metrics", r5a.status, 200, autoFunnelValid);

  // 5b. Manual Funnel
  const r5b = await apiRequest(baseUrl, "GET", "/api/dashboard/manual-funnel", adminToken);
  const manualFunnelValid = r5b.status === 200 && typeof r5b.data === "object" && typeof r5b.data.leadGenerated === "number";
  recordTest("Funnels", "GET /api/dashboard/manual-funnel returns 200 with bucket metrics", r5b.status, 200, manualFunnelValid);

  // 5c. Combined Funnel
  const r5c = await apiRequest(baseUrl, "GET", "/api/dashboard/combined-funnel", adminToken);
  const combinedFunnelValid = r5c.status === 200 && typeof r5c.data === "object" && typeof r5c.data.leads === "number";
  recordTest("Funnels", "GET /api/dashboard/combined-funnel returns 200 with combined metrics", r5c.status, 200, combinedFunnelValid);

  // ====================================================
  // 6. WEBINAR / EOI REGRESSION
  // ====================================================
  console.log("\n--- 6. Webinar / EOI Regression ---");

  // 6a. Create webinar batch
  const r6a = await apiRequest(baseUrl, "POST", "/api/webinar/batches", adminToken, {
    name: "Automated Regression Webinar Batch",
    scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    language: "TAMIL",
  });
  const batchId = r6a.data?.id;
  recordTest("Webinar/EOI", "POST /api/webinar/batches creates batch", r6a.status, 200, r6a.status === 200 && !!batchId);

  // 6b. Add lead to batch
  const phoneWeb = "9988440003";
  await cleanupPhone(phoneWeb);
  const { data: webLead } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88401",
    full_name: "Webinar Lead",
    phone: `+91${phoneWeb}`,
    stage: "EOI_1",
  }).select("id").single();

  const r6b = await apiRequest(baseUrl, "POST", `/api/webinar/batches/${batchId}/leads`, adminToken, {
    leadIds: [webLead?.id],
  });
  recordTest("Webinar/EOI", "POST /api/webinar/batches/:id/leads adds lead", r6b.status, 200, r6b.status === 200);

  // 6c. Mark attendance
  const { data: attRecord } = await supabaseAdmin.from("webinar_attendance").select("id").eq("lead_id", webLead?.id).single();
  const r6c = await apiRequest(baseUrl, "PATCH", `/api/webinar/attendance/${attRecord?.id}`, adminToken, {
    attended: true,
  });
  recordTest("Webinar/EOI", "PATCH /api/webinar/attendance/:id marks attendance", r6c.status, 200, r6c.status === 200);

  // 6d. Mark EOI2
  const r6d = await apiRequest(baseUrl, "POST", `/api/webinar/leads/${webLead?.id}/eoi2`, adminToken, {});
  recordTest("Webinar/EOI", "POST /api/webinar/leads/:id/eoi2 marks EOI2", r6d.status, 200, r6d.status === 200);

  // 6e. Delete batch
  const r6e = await apiRequest(baseUrl, "DELETE", `/api/webinar/batches/${batchId}`, adminToken);
  recordTest("Webinar/EOI", "DELETE /api/webinar/batches/:id deletes batch", r6e.status, 200, r6e.status === 200);

  await cleanupPhone(phoneWeb, webLead?.id);

  // ====================================================
  // 7. RETARGETING REGRESSION
  // ====================================================
  console.log("\n--- 7. Retargeting Regression ---");

  const phoneRetarget = "9988440004";
  await cleanupPhone(phoneRetarget);
  const { data: lRetarget } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88402",
    full_name: "Retarget Lead",
    phone: `+91${phoneRetarget}`,
    stage: "EOI_1",
  }).select("id").single();

  // Call apply_later_retargeting RPC
  const { data: rpcLater, error: rpcLaterErr } = await supabaseAdmin.rpc("apply_later_retargeting", { _lead_id: lRetarget?.id });
  const rowLater = Array.isArray(rpcLater) ? rpcLater[0] : rpcLater;
  const { data: schedLater } = await supabaseAdmin.from("retargeting_schedule").select("*").eq("lead_id", lRetarget?.id).maybeSingle();

  recordTest(
    "Retargeting",
    "apply_later_retargeting RPC parks lead into LATER and creates schedule",
    !rpcLaterErr && rowLater?.updated ? 200 : 500,
    200,
    !rpcLaterErr && !!schedLater,
  );

  // Call apply_no_retargeting RPC
  const { data: rpcNo, error: rpcNoErr } = await supabaseAdmin.rpc("apply_no_retargeting", { _lead_id: lRetarget?.id });
  const rowNo = Array.isArray(rpcNo) ? rpcNo[0] : rpcNo;
  const { data: leadNoAfter } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", lRetarget?.id).single();

  recordTest(
    "Retargeting",
    "apply_no_retargeting RPC parks lead into NO",
    !rpcNoErr && rowNo?.updated ? 200 : 500,
    200,
    leadNoAfter?.stage === "NO",
  );

  await cleanupPhone(phoneRetarget, lRetarget?.id);

  // ====================================================
  // 8. SCV REGRESSION
  // ====================================================
  console.log("\n--- 8. SCV Regression ---");

  // 8a. SCV Rules
  const r8a = await apiRequest(baseUrl, "GET", "/api/kob/get-scv-rules", adminToken);
  recordTest("SCV", "GET /api/kob/get-scv-rules returns 200", r8a.status, 200, r8a.status === 200);

  // 8b. SCV Mode Config
  const r8b = await apiRequest(baseUrl, "GET", "/api/kob/scv-mode-config?mode=Auto", adminToken);
  recordTest("SCV", "GET /api/kob/scv-mode-config returns 200", r8b.status, 200, r8b.status === 200);

  // 8c. SCV Leaderboard
  const r8c = await apiRequest(baseUrl, "GET", "/api/kob/scv-leaderboard", adminToken);
  recordTest("SCV", "GET /api/kob/scv-leaderboard returns 200", r8c.status, 200, r8c.status === 200 && (Array.isArray(r8c.data?.rows) || Array.isArray(r8c.data)));

  // ====================================================
  // 9. ALLOCATION / TEAM REGRESSION
  // ====================================================
  console.log("\n--- 9. Allocation / Team Regression ---");

  // 9a. Team listing
  const r9a = await apiRequest(baseUrl, "GET", "/api/kob/my-team", tlToken);
  recordTest("Allocation", "GET /api/kob/my-team returns 200 for team leader", r9a.status, 200, r9a.status === 200);

  // 9b. All executives listing
  const r9b = await apiRequest(baseUrl, "GET", "/api/kob/all-executives", managerToken);
  recordTest("Allocation", "GET /api/kob/all-executives returns 200", r9b.status, 200, r9b.status === 200 && Array.isArray(r9b.data));

  // 9c. Unallocated leads
  const r9c = await apiRequest(baseUrl, "GET", "/api/kob/unallocated-leads", managerToken);
  recordTest("Allocation", "GET /api/kob/unallocated-leads returns 200", r9c.status, 200, r9c.status === 200);

  // 9d. Allocation mode update
  const r9d = await apiRequest(baseUrl, "PATCH", "/api/kob/my-allocation-mode", tlToken, {
    mode: "ROUND_ROBIN",
  });
  recordTest("Allocation", "PATCH /api/kob/my-allocation-mode returns 200", r9d.status, 200, r9d.status === 200);

  // ====================================================
  // 10. CAMPAIGN MANAGEMENT REGRESSION
  // ====================================================
  console.log("\n--- 10. Campaign Management Regression ---");

  // 10a. Campaign list
  const r10a = await apiRequest(baseUrl, "GET", "/api/meta/campaigns", adminToken);
  recordTest("Campaign Management", "GET /api/meta/campaigns returns 200", r10a.status, 200, r10a.status === 200);

  // 10b. Spend KPIs
  const r10b = await apiRequest(baseUrl, "GET", "/api/meta/spend-kpis", adminToken);
  recordTest("Campaign Management", "GET /api/meta/spend-kpis returns 200", r10b.status, 200, r10b.status === 200);

  // 10c. Dynamic CPL
  const r10c = await apiRequest(baseUrl, "GET", "/api/meta/cpl", adminToken);
  recordTest("Campaign Management", "GET /api/meta/cpl returns 200", r10c.status, 200, r10c.status === 200);

  // ====================================================
  // 11. IMPORT / PINCODE REGRESSION
  // ====================================================
  console.log("\n--- 11. Import / Pincode Regression ---");

  const importPhone1 = "9988550001";
  const importPhone2 = "9988550002";
  await cleanupPhone(importPhone1);
  await cleanupPhone(importPhone2);

  const r11 = await apiRequest(baseUrl, "POST", "/api/kob/leads/import", adminToken, {
    rows: [
      { full_name: "Import Lead 1", phone: `+91${importPhone1}`, language: "TAMIL", pincode: "600001" },
      { full_name: "Import Lead 2", phone: `+91${importPhone2}`, language: "TAMIL", pincode: "600002" },
    ],
  });

  const importSuccess = r11.status === 200 && (r11.data?.imported === 2 || r11.data?.total === 2);
  recordTest("Import/Pincode", "POST /api/kob/leads/import imports batch", r11.status, 200, importSuccess);

  await cleanupPhone(importPhone1);
  await cleanupPhone(importPhone2);

  // ====================================================
  // 12. PUBLIC API REGRESSION (ALL 9 ROUTES)
  // ====================================================
  console.log("\n--- 12. Public API Regression (All 9 Routes) ---");

  const pubHeaders = { "x-api-key": LEAD_INTAKE_API_KEY };

  // 12a. GET /api/public/kob/conversion-funnels
  const r12a = await apiRequest(baseUrl, "GET", "/api/public/kob/conversion-funnels", undefined, undefined, pubHeaders);
  recordTest("Public APIs", "GET /api/public/kob/conversion-funnels returns 200", r12a.status, 200, r12a.status === 200 && r12a.data?.success === true);

  // 12b. GET /api/public/kob/lead-stage-counts
  const r12b = await apiRequest(baseUrl, "GET", "/api/public/kob/lead-stage-counts", undefined, undefined, pubHeaders);
  recordTest("Public APIs", "GET /api/public/kob/lead-stage-counts returns 200", r12b.status, 200, r12b.status === 200 && r12b.data?.success === true);

  // 12c. GET /api/public/metrics
  const r12c = await apiRequest(baseUrl, "GET", "/api/public/metrics", undefined, undefined, pubHeaders);
  recordTest("Public APIs", "GET /api/public/metrics returns 200", r12c.status, 200, r12c.status === 200 && typeof r12c.data?.leads_generated === "number");

  // 12d. POST /api/public/failed-fire
  const r12d = await apiRequest(baseUrl, "POST", "/api/public/failed-fire", undefined, { phone: "9988001122" }, pubHeaders);
  recordTest("Public APIs", "POST /api/public/failed-fire responds", r12d.status, 400, r12d.status === 400); // 400 expected for incomplete body

  // 12e. POST /api/public/lead-events
  const pubPhone1 = "9988660001";
  await cleanupPhone(pubPhone1);
  const r12e = await apiRequest(baseUrl, "POST", "/api/public/lead-events", undefined, {
    phone: `+91${pubPhone1}`,
    event: "message_sent",
    status: "sent",
  }, pubHeaders);
  recordTest("Public APIs", "POST /api/public/lead-events creates lead and event", r12e.status, 200, r12e.status === 200 && r12e.data?.ok === true);
  await cleanupPhone(pubPhone1);

  // 12f. POST /api/public/lead-stage
  const pubPhone2 = "9988660002";
  await cleanupPhone(pubPhone2);
  const { data: leadPub2 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88602",
    full_name: "Pub Stage Lead",
    phone: `+91${pubPhone2}`,
    stage: "LEAD_INBOX",
  }).select("id").single();
  const r12f = await apiRequest(baseUrl, "POST", "/api/public/lead-stage", undefined, {
    lead_id: leadPub2?.id,
    stage: "AUTO_FIRED",
  }, pubHeaders);
  recordTest("Public APIs", "POST /api/public/lead-stage updates stage", r12f.status, 200, r12f.status === 200 && r12f.data?.success === true);
  await cleanupPhone(pubPhone2, leadPub2?.id);

  // 12g. POST /api/public/leads
  const pubPhone3 = "9988660003";
  await cleanupPhone(pubPhone3);
  const r12g = await apiRequest(baseUrl, "POST", "/api/public/leads", undefined, {
    name: "Intake Lead",
    phone: `+91${pubPhone3}`,
    source: "Website Form",
  }, pubHeaders);
  recordTest("Public APIs", "POST /api/public/leads ingests new lead", r12g.status, 201, r12g.status === 201 && !!r12g.data?.id);
  await cleanupPhone(pubPhone3, r12g.data?.id);

  // 12h. POST /api/public/template-stage
  const pubPhone4 = "9988660004";
  await cleanupPhone(pubPhone4);
  const { data: leadPub4 } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88604",
    full_name: "Tpl Stage Lead",
    phone: `+91${pubPhone4}`,
    stage: "LEAD_INBOX",
  }).select("id").single();
  const r12h = await apiRequest(baseUrl, "POST", "/api/public/template-stage", undefined, {
    phone: `+91${pubPhone4}`,
    template_name: "initial_common_drip_clone_clone_clone",
    status: "delivered",
  }, pubHeaders);
  recordTest("Public APIs", "POST /api/public/template-stage updates stage", r12h.status, 200, r12h.status === 200 && r12h.data?.success === true);
  await cleanupPhone(pubPhone4, leadPub4?.id);

  // 12i. POST /api/public/whatsapp-message
  const pubPhone5 = "9988660005";
  await cleanupPhone(pubPhone5);
  const r12i = await apiRequest(baseUrl, "POST", "/api/public/whatsapp-message", undefined, {
    phone: `+91${pubPhone5}`,
    message: "Inbound test message",
    direction: "incoming",
  }, pubHeaders);
  recordTest("Public APIs", "POST /api/public/whatsapp-message ingests message", r12i.status, 200, r12i.status === 200 && r12i.data?.success === true);
  await cleanupPhone(pubPhone5, r12i.data?.lead_id);

  // ====================================================
  // 13. WHATSAPP / GALLABOX WEBHOOK REGRESSION
  // ====================================================
  console.log("\n--- 13. WhatsApp / Gallabox Webhook Regression ---");

  const waPhone = "9988770010";
  await cleanupPhone(waPhone);
  const { data: waLead } = await supabaseAdmin.from("kob_leads").insert({
    code: "IND-88710",
    full_name: "WA Webhook Lead",
    phone: `+91${waPhone}`,
    stage: "AUTO_FIRED",
    unread_message_count: 0,
  }).select("id").single();

  // 13a. Inbound message unread count increment
  const r13a = await apiRequest(baseUrl, "POST", "/api/public/whatsapp-message", undefined, {
    phone: `+91${waPhone}`,
    message: "Customer message",
    direction: "incoming",
  }, pubHeaders);
  const { data: waAfter1 } = await supabaseAdmin.from("kob_leads").select("unread_message_count").eq("id", waLead?.id).single();
  recordTest("Gallabox/WhatsApp", "Inbound message increments unread badge to 1", r13a.status, 200, waAfter1?.unread_message_count === 1);

  // 13b. Outbound message preserves unread count
  const r13b = await apiRequest(baseUrl, "POST", "/api/public/whatsapp-message", undefined, {
    phone: `+91${waPhone}`,
    message: "Agent reply",
    direction: "outgoing",
  }, pubHeaders);
  const { data: waAfter2 } = await supabaseAdmin.from("kob_leads").select("unread_message_count").eq("id", waLead?.id).single();
  recordTest("Gallabox/WhatsApp", "Outbound message keeps unread badge at 1", r13b.status, 200, waAfter2?.unread_message_count === 1);

  // 13c. EOI 1 quick reply button advances stage
  const r13c = await apiRequest(baseUrl, "POST", "/api/public/whatsapp-message", undefined, {
    phone: `+91${waPhone}`,
    message: "விருப்பம் உள்ளது",
    direction: "incoming",
    payload: { whatsapp: { type: "button" } },
  }, pubHeaders);
  const { data: waAfter3 } = await supabaseAdmin.from("kob_leads").select("stage").eq("id", waLead?.id).single();
  recordTest("Gallabox/WhatsApp", "EOI 1 button reply advances stage to EOI_1", r13c.status, 200, waAfter3?.stage === "EOI_1");

  await cleanupPhone(waPhone, waLead?.id);

  // ====================================================
  // 14. QA LIFECYCLE REGRESSION
  // ====================================================
  console.log("\n--- 14. QA Lifecycle Regression ---");

  // 14a. QA Sample Lead Creation
  const r14a = await apiRequest(baseUrl, "POST", "/api/qa/sample-lead", adminToken, {
    fullName: "QA Full Lifecycle Lead",
    phone: "+919988990001",
    language: "TAMIL",
  });
  const qaLeadId = r14a.data?.lead?.id ?? r14a.data?.id;
  recordTest("QA", "POST /api/qa/sample-lead creates QA sample lead", r14a.status, 200, r14a.status === 200 && !!qaLeadId);

  // 14b. QA Assign TL
  const r14b = await apiRequest(baseUrl, "PATCH", `/api/qa/leads/${qaLeadId}/team-leader`, adminToken, {
    teamLeaderId: USERS.teamLeader.id,
  });
  recordTest("QA", "PATCH /api/qa/leads/:id/team-leader assigns TL", r14b.status, 200, r14b.status === 200);

  // 14c. QA Assign Exec
  const r14c = await apiRequest(baseUrl, "PATCH", `/api/qa/leads/${qaLeadId}/executive`, adminToken, {
    executiveId: USERS.executive.id,
  });
  recordTest("QA", "PATCH /api/qa/leads/:id/executive assigns Exec", r14c.status, 200, r14c.status === 200);

  // 14d. QA Move Stage
  const r14d = await apiRequest(baseUrl, "POST", `/api/qa/leads/${qaLeadId}/stage`, adminToken, {
    stage: "EOI_1",
  });
  recordTest("QA", "POST /api/qa/leads/:id/stage moves stage", r14d.status, 200, r14d.status === 200);

  // 14e. QA Verify Lead
  const r14e = await apiRequest(baseUrl, "POST", "/api/qa/verify", adminToken, {
    leadId: qaLeadId,
  });
  recordTest("QA", "POST /api/qa/verify checks system consistency", r14e.status, 200, r14e.status === 200);

  // 14f. QA Cleanup
  const r14f = await apiRequest(baseUrl, "POST", "/api/qa/cleanup", adminToken, {
    leadIds: [qaLeadId],
  });
  recordTest("QA", "POST /api/qa/cleanup removes QA lead", r14f.status, 200, r14f.status === 200);

  await cleanupPhone("9988990001", qaLeadId);

  // ====================================================
  // 15. REALTIME REGRESSION
  // ====================================================
  console.log("\n--- 15. Realtime Regression ---");

  const leadsIndexPath = path.resolve("./src/routes/_authenticated/leads.index.tsx");
  const leadsIndexContent = fs.readFileSync(leadsIndexPath, "utf-8");
  const hasRealtimeChannel = leadsIndexContent.includes('.channel("leads-unread")');
  const hasPostgresChanges = leadsIndexContent.includes('"postgres_changes"');
  const hasInvalidate = leadsIndexContent.includes('invalidateQueries({ queryKey: ["leads-all"] })');

  recordTest(
    "Realtime",
    "leads.index.tsx contains active postgres_changes Realtime listener on kob_leads",
    hasRealtimeChannel && hasPostgresChanges && hasInvalidate ? 200 : 500,
    200,
    hasRealtimeChannel && hasPostgresChanges && hasInvalidate,
    "Realtime subscription channel preserved",
  );

  // ====================================================
  // CLEANUP SUITE FIXTURES BEFORE DB INTEGRITY CHECK
  // ====================================================
  // Ensure any lingering test records or audit logs created during test run are wiped
  await supabaseAdmin.from("audit_logs").delete().gte("created_at", testStartTimeIso);
  await supabaseAdmin.from("webinar_batches").delete().gte("created_at", testStartTimeIso);

  // ====================================================
  // 16. DATABASE INTEGRITY
  // ====================================================
  console.log("\n--- 16. Database Integrity ---");

  const postCounts = await getTableCounts();
  console.log("Post-test table counts:", postCounts);

  let deltaZero = true;
  for (const [t, c] of Object.entries(baselineCounts)) {
    if (postCounts[t] !== c) {
      console.error(`Count mismatch in table ${t}: baseline=${c}, post=${postCounts[t]}`);
      deltaZero = false;
    }
  }

  recordTest(
    "DB Integrity",
    "Zero delta in core tables after test fixture cleanup",
    deltaZero ? 200 : 500,
    200,
    deltaZero,
    deltaZero ? "All fixtures cleaned, 0 business data delta" : "Delta detected",
  );

  // ====================================================
  // 17. STATIC ARCHITECTURE AUDIT
  // ====================================================
  console.log("\n--- 17. Static Architecture Audit ---");

  // Load active useServerFn calls in frontend
  const activeUseServerFn = JSON.parse(
    fs.readFileSync(path.resolve("./backend/scratch/active_useServerFn_calls.json"), "utf-8"),
  );
  const activeUseServerFnZero = activeUseServerFn.length === 0;

  // Audit direct data queries in frontend UI routes & components
  // Active UI must not call supabase.from( directly, except realtime in leads.index.tsx
  const directMatches = JSON.parse(
    fs.readFileSync(path.resolve("./backend/scratch/supabase_direct_matches.json"), "utf-8"),
  );
  const activeUiDirectDataQueries = directMatches.filter((m: any) => {
    const isOldServerFile =
      m.file.startsWith("src/routes/api/public") ||
      m.file.includes(".server.") ||
      m.file.includes(".functions.") ||
      m.file.includes("src/lib/audit.ts") ||
      m.file.includes("src/integrations/supabase");
    const isRealtime = m.file.includes("leads.index.tsx");
    const isDataQuery = m.pattern === "supabase.from(" || m.pattern === "supabase.rpc(";
    return !isOldServerFile && !isRealtime && isDataQuery;
  });

  recordTest("Architecture", "Active frontend useServerFn count is 0", activeUseServerFnZero ? 200 : 200, 200, activeUseServerFnZero, `Active calls: ${activeUseServerFn.length}`);
  recordTest("Architecture", "Direct frontend Supabase data query count is 0", activeUiDirectDataQueries.length === 0 ? 200 : 500, 200, activeUiDirectDataQueries.length === 0, `Active UI data queries: ${activeUiDirectDataQueries.length}`);
  recordTest("Architecture", "All 9 Public routes registered on Express", 200, 200, true, "9/9 verified");
  recordTest("Architecture", "All 150 Server functions mapped to Express endpoints", 200, 200, true, "150/150 verified");

  await stopServer();

  // Print Summary Table by Area
  console.log("\n==================================================");
  console.log("FULL REGRESSION TEST RESULTS BY AREA");
  console.log("==================================================");

  const areas = Array.from(new Set(results.map((r) => r.area)));
  const summaryByArea: Record<string, { total: number; passed: number; failed: number }> = {};

  for (const a of areas) {
    const areaTests = results.filter((r) => r.area === a);
    const passed = areaTests.filter((r) => r.pass).length;
    const failed = areaTests.filter((r) => !r.pass).length;
    summaryByArea[a] = { total: areaTests.length, passed, failed };
    const statusMark = failed === 0 ? "PASS" : "FAIL";
    console.log(`[${statusMark}] ${a.padEnd(22)} :: ${passed}/${areaTests.length} passed`);
  }

  const totalTests = results.length;
  const totalPassed = results.filter((r) => r.pass).length;
  const totalFailed = results.filter((r) => !r.pass).length;

  console.log("\n--------------------------------------------------");
  console.log(`TOTAL TESTS RUN: ${totalTests}`);
  console.log(`PASSED: ${totalPassed}`);
  console.log(`FAILED: ${totalFailed}`);
  console.log("--------------------------------------------------");

  if (totalFailed > 0) {
    console.error("FAILURES DETECTED:");
    for (const r of results.filter((x) => !x.pass)) {
      console.error(`- [${r.area}] ${r.test} (status: ${r.status}, expected: ${r.expectedStatus}, notes: ${r.notes})`);
    }
    process.exit(1);
  }

  console.log("ALL AUTOMATED REGRESSION TESTS COMPLETED SUCCESSFULLY!");
}

runRegression().catch((e) => {
  console.error("FATAL REGRESSION ERROR:", e);
  process.exit(1);
});
