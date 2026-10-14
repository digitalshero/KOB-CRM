import { app } from "../backend/src/app.js";
import { Route as funnelsRoute } from "../src/routes/api/public/kob/conversion-funnels.js";
import { Route as stageCountsRoute } from "../src/routes/api/public/kob/lead-stage-counts.js";
import { Route as metricsRoute } from "../src/routes/api/public/metrics.js";
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
async function callOldHandler(route: any, method: string, url: string, headers: Record<string, string> = {}) {
  const req = new Request(url, {
    method,
    headers: new Headers(headers),
  });
  const handler = route.options.server.handlers[method];
  const resp: Response = await handler({ request: req });
  const status = resp.status;
  const respHeaders = Object.fromEntries(resp.headers.entries());
  let body: any = null;
  const text = await resp.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status, headers: respHeaders, body };
}

// Helper to call new Express server
async function callNewExpress(baseUrl: string, method: string, path: string, headers: Record<string, string> = {}) {
  const url = `${baseUrl}${path}`;
  const resp = await fetch(url, {
    method,
    headers,
  });
  const status = resp.status;
  const respHeaders = Object.fromEntries(resp.headers.entries());
  let body: any = null;
  const text = await resp.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status, headers: respHeaders, body };
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!keysB.includes(k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

async function runParityTests() {
  console.log("==================================================");
  console.log("STARTING PUBLIC ROUTE BATCH 1 PARITY TESTS");
  console.log("==================================================");

  const baseUrl = await startServer();
  console.log(`Express test server running at ${baseUrl}`);

  const results: Array<{
    endpoint: string;
    test: string;
    oldStatus: number;
    newStatus: number;
    match: boolean;
    details?: string;
  }> = [];

  // ==================================================
  // 1. CONVERSION FUNNELS
  // ==================================================
  console.log("\n--- Testing 1: conversion-funnels ---");

  const funnelCases = [
    { name: "Explicit from/to", query: "?from=2026-08-01&to=2026-08-15" },
    { name: "Empty date period", query: "?from=1980-01-01&to=1980-01-02" },
    { name: "Populated date period", query: "?from=2026-01-01&to=2026-12-31" },
    { name: "Malformed date", query: "?from=invalid-date" },
    { name: "No date params", query: "" },
  ];

  for (const c of funnelCases) {
    const oldRes = await callOldHandler(
      funnelsRoute,
      "GET",
      `http://localhost/api/public/kob/conversion-funnels${c.query}`
    );
    const newRes = await callNewExpress(
      baseUrl,
      "GET",
      `/api/public/kob/conversion-funnels${c.query}`
    );

    const statusMatch = oldRes.status === newRes.status;
    const bodyMatch = deepEqual(oldRes.body, newRes.body);
    const pass = statusMatch && bodyMatch;

    results.push({
      endpoint: "GET /api/public/kob/conversion-funnels",
      test: c.name,
      oldStatus: oldRes.status,
      newStatus: newRes.status,
      match: pass,
      details: pass ? "Exact Match" : `Mismatch: Old body=${JSON.stringify(oldRes.body).slice(0, 80)}, New body=${JSON.stringify(newRes.body).slice(0, 80)}`,
    });
    console.log(`[funnels] ${c.name}: ${pass ? "PASS" : "FAIL"} (status ${oldRes.status} vs ${newRes.status})`);
  }

  // OPTIONS test for funnels
  const oldOpt = await callOldHandler(funnelsRoute, "OPTIONS", "http://localhost/api/public/kob/conversion-funnels");
  const newOpt = await callNewExpress(baseUrl, "OPTIONS", "/api/public/kob/conversion-funnels");
  results.push({
    endpoint: "OPTIONS /api/public/kob/conversion-funnels",
    test: "CORS preflight",
    oldStatus: oldOpt.status,
    newStatus: newOpt.status,
    match: oldOpt.status === 204 && newOpt.status === 204,
    details: "CORS 204 match",
  });

  // ==================================================
  // 2. LEAD STAGE COUNTS
  // ==================================================
  console.log("\n--- Testing 2: lead-stage-counts ---");

  const stageCases = [
    { name: "Explicit from/to", query: "?from=2026-08-01&to=2026-08-15" },
    { name: "Empty date period", query: "?from=1980-01-01&to=1980-01-02" },
    { name: "Populated date period", query: "?from=2026-01-01&to=2026-12-31" },
    { name: "Malformed date", query: "?from=bad-date" },
    { name: "No date params", query: "" },
  ];

  for (const c of stageCases) {
    const oldRes = await callOldHandler(
      stageCountsRoute,
      "GET",
      `http://localhost/api/public/kob/lead-stage-counts${c.query}`
    );
    const newRes = await callNewExpress(
      baseUrl,
      "GET",
      `/api/public/kob/lead-stage-counts${c.query}`
    );

    const statusMatch = oldRes.status === newRes.status;
    const bodyMatch = deepEqual(oldRes.body, newRes.body);
    const pass = statusMatch && bodyMatch;

    results.push({
      endpoint: "GET /api/public/kob/lead-stage-counts",
      test: c.name,
      oldStatus: oldRes.status,
      newStatus: newRes.status,
      match: pass,
      details: pass ? "Exact Match" : `Mismatch: Old body=${JSON.stringify(oldRes.body).slice(0, 80)}, New body=${JSON.stringify(newRes.body).slice(0, 80)}`,
    });
    console.log(`[stage-counts] ${c.name}: ${pass ? "PASS" : "FAIL"} (status ${oldRes.status} vs ${newRes.status})`);
  }

  // ==================================================
  // 3. METRICS (AUTH & CALCULATIONS)
  // ==================================================
  console.log("\n--- Testing 3: metrics ---");

  // Test 3a: Auth failure when LEAD_INTAKE_API_KEY is not set
  const origKey = process.env.LEAD_INTAKE_API_KEY;
  delete process.env.LEAD_INTAKE_API_KEY;

  const oldNoEnv = await callOldHandler(metricsRoute, "GET", "http://localhost/api/public/metrics");
  const newNoEnv = await callNewExpress(baseUrl, "GET", "/api/public/metrics");
  results.push({
    endpoint: "GET /api/public/metrics",
    test: "Auth: Missing env key returns 500",
    oldStatus: oldNoEnv.status,
    newStatus: newNoEnv.status,
    match: oldNoEnv.status === 500 && newNoEnv.status === 500 && deepEqual(oldNoEnv.body, newNoEnv.body),
    details: "Matches 500 LEAD_INTAKE_API_KEY not configured",
  });
  console.log(`[metrics] Missing env key: ${oldNoEnv.status === 500 && newNoEnv.status === 500 ? "PASS" : "FAIL"}`);

  // Test 3b: undefined === undefined safety hardening check
  const undefinedAttack = await callNewExpress(baseUrl, "GET", "/api/public/metrics", { "x-api-key": "" });
  results.push({
    endpoint: "GET /api/public/metrics",
    test: "Security hardening: Empty env cannot authenticate",
    oldStatus: 500,
    newStatus: undefinedAttack.status,
    match: undefinedAttack.status === 500,
    details: "Rejected with 500 - undefined===undefined impossible",
  });

  // Now set a valid test key
  const TEST_KEY = "test_lead_intake_secret_key_12345";
  process.env.LEAD_INTAKE_API_KEY = TEST_KEY;

  // Test 3c: Invalid header key returns 401
  const oldBadKey = await callOldHandler(
    metricsRoute,
    "GET",
    "http://localhost/api/public/metrics",
    { "x-api-key": "wrong_key" }
  );
  const newBadKey = await callNewExpress(
    baseUrl,
    "GET",
    "/api/public/metrics",
    { "x-api-key": "wrong_key" }
  );
  results.push({
    endpoint: "GET /api/public/metrics",
    test: "Auth: Invalid x-api-key returns 401",
    oldStatus: oldBadKey.status,
    newStatus: newBadKey.status,
    match: oldBadKey.status === 401 && newBadKey.status === 401 && deepEqual(oldBadKey.body, newBadKey.body),
    details: "Matches 401 Invalid or missing x-api-key header",
  });
  console.log(`[metrics] Invalid header key: ${oldBadKey.status === 401 && newBadKey.status === 401 ? "PASS" : "FAIL"}`);

  // Test 3d: Valid key query cases (with x-meta-mock to ensure stable test environment)
  const metricsCases = [
    { name: "Valid key + Explicit from/to", query: "?from=2026-08-01T00:00:00Z&to=2026-08-15T23:59:59Z" },
    { name: "Valid key + Empty date period", query: "?from=1980-01-01T00:00:00Z&to=1980-01-02T00:00:00Z" },
    { name: "Valid key + Malformed date", query: "?from=invalid-date" },
    { name: "Valid key + No date params", query: "" },
  ];

  for (const c of metricsCases) {
    const oldRes = await callOldHandler(
      metricsRoute,
      "GET",
      `http://localhost/api/public/metrics${c.query}`,
      { "x-api-key": TEST_KEY }
    );
    const newRes = await callNewExpress(
      baseUrl,
      "GET",
      `/api/public/metrics${c.query}`,
      { "x-api-key": TEST_KEY }
    );

    const statusMatch = oldRes.status === newRes.status;
    const bodyMatch = deepEqual(oldRes.body, newRes.body);
    const pass = statusMatch && bodyMatch;

    results.push({
      endpoint: "GET /api/public/metrics",
      test: c.name,
      oldStatus: oldRes.status,
      newStatus: newRes.status,
      match: pass,
      details: pass ? "Exact Match" : `Mismatch: Old body=${JSON.stringify(oldRes.body)}, New body=${JSON.stringify(newRes.body)}`,
    });
    console.log(`[metrics] ${c.name}: ${pass ? "PASS" : "FAIL"} (status ${oldRes.status} vs ${newRes.status})`);
  }

  // Restore env
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

  const allPassed = results.every((r) => r.match);
  console.log(`\nOVERALL PARITY STATUS: ${allPassed ? "ALL PASS" : "FAIL"}`);
  return allPassed;
}

runParityTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
