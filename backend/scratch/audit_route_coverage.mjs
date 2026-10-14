import fs from "fs";
import path from "path";

const BASE_DIR = "d:/Shero Home Food/kob-unity-spark (2)";
const apiClientCalls = JSON.parse(
  fs.readFileSync(path.join(BASE_DIR, "backend/scratch/api_client_calls.json"), "utf8")
);

const routeFiles = [
  { prefix: "/api/kob", file: "backend/src/routes/kob.routes.ts" },
  { prefix: "/api/dashboard", file: "backend/src/routes/dashboard.routes.ts" },
  { prefix: "/api/evaluation", file: "backend/src/routes/evaluation.routes.ts" },
  { prefix: "/api/qa", file: "backend/src/routes/qa.routes.ts" },
  { prefix: "/api/webinar", file: "backend/src/routes/webinar.routes.ts" },
  { prefix: "/api/admin", file: "backend/src/routes/admin.routes.ts" },
  { prefix: "/api/meta", file: "backend/src/routes/meta.routes.ts" },
];

const registeredRoutes = [];

for (const rf of routeFiles) {
  const content = fs.readFileSync(path.join(BASE_DIR, rf.file), "utf8");
  const lines = content.split("\n");

  lines.forEach((l, idx) => {
    const m = l.match(/(?:[a-zA-Z0-9_]*Router|router)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']\s*,\s*(.+)\);?/);
    if (m) {
      const httpMethod = m[1].toUpperCase();
      const subPath = m[2];
      const rest = m[3];
      const hasAuth = rest.includes("requireAuth") || rest.includes("authenticate");
      const fullPath = (rf.prefix + (subPath === "/" ? "" : subPath)).replace(/\/+/g, "/");

      const parts = rest.split(",").map((s) => s.trim());
      const controllerHandler = parts[parts.length - 1].replace(/\);?$/, "");

      registeredRoutes.push({
        method: httpMethod,
        prefix: rf.prefix,
        subPath,
        fullPath,
        controllerHandler,
        hasAuth,
        line: idx + 1,
        file: rf.file,
      });
    }
  });
}

function cleanFrontendPath(raw) {
  let s = raw.trim();
  // Strip outer quotes/backticks
  s = s.replace(/^[`'"]|[`'"]$/g, "");
  // Replace template query params like ${q ? ...}
  s = s.replace(/\$\{[^}]*\?[^}]*\}/g, "");
  s = s.replace(/\$\{[^}]*q[^}]*\}/gi, "");
  s = s.replace(/\$\{period[^}]*\}/gi, "");
  s = s.replace(/\$\{spans[^}]*\}/gi, "");
  s = s.replace(/\$\{params[^}]*\}/gi, "");
  s = s.replace(/\$\{from[^}]*\}/gi, "");
  s = s.replace(/\$\{to[^}]*\}/gi, "");
  s = s.replace(/\$\{rangeArg[^}]*\}/gi, "");
  s = s.replace(/[`'"]\s*:\s*[`'"][^`'"]*[`'"]\s*\}?/g, "");
  s = s.split("?")[0];
  s = s.replace(/\$\{[^}]+\}/g, ":param");
  s = s.replace(/[`'"]+/g, "");
  s = s.replace(/\/+/g, "/").replace(/\/$/, "");
  return s;
}

function matchRoute(frontendMethod, frontendPath) {
  const normFrontend = cleanFrontendPath(frontendPath);
  const partsFrontend = normFrontend.split("/").filter(Boolean);

  for (const reg of registeredRoutes) {
    if (reg.method !== frontendMethod) continue;
    const partsReg = reg.fullPath.split("/").filter(Boolean);
    if (partsFrontend.length !== partsReg.length) continue;

    let match = true;
    for (let i = 0; i < partsFrontend.length; i++) {
      if (partsReg[i].startsWith(":") || partsFrontend[i].startsWith(":")) {
        continue;
      }
      if (partsFrontend[i] !== partsReg[i]) {
        match = false;
        break;
      }
    }
    if (match) return reg;
  }
  return null;
}

const uniqueFrontendCalls = new Map();
for (const call of apiClientCalls) {
  const norm = cleanFrontendPath(call.endpoint);
  const key = `${call.method} ${norm}`;
  if (!uniqueFrontendCalls.has(key)) {
    uniqueFrontendCalls.set(key, {
      method: call.method,
      rawEndpoint: call.endpoint,
      normEndpoint: norm,
      occurrences: [],
    });
  }
  uniqueFrontendCalls.get(key).occurrences.push({ file: call.file, line: call.line });
}

const auditResults = [];
let missingCount = 0;
let methodMismatchCount = 0;
let authMismatchCount = 0;

for (const [key, call] of uniqueFrontendCalls.entries()) {
  const matched = matchRoute(call.method, call.normEndpoint);
  if (!matched) {
    const anyMethodMatched = registeredRoutes.find((r) => {
      const partsFrontend = call.normEndpoint.split("/").filter(Boolean);
      const partsReg = r.fullPath.split("/").filter(Boolean);
      if (partsFrontend.length !== partsReg.length) return false;
      for (let i = 0; i < partsFrontend.length; i++) {
        if (partsReg[i].startsWith(":") || partsFrontend[i].startsWith(":")) continue;
        if (partsFrontend[i] !== partsReg[i]) return false;
      }
      return true;
    });

    if (anyMethodMatched) {
      methodMismatchCount++;
      auditResults.push({
        status: "METHOD_MISMATCH",
        frontend: key,
        matchedRoute: anyMethodMatched,
        call,
      });
    } else {
      missingCount++;
      auditResults.push({
        status: "MISSING_ROUTE",
        frontend: key,
        call,
      });
    }
  } else {
    if (!matched.hasAuth) {
      authMismatchCount++;
      auditResults.push({
        status: "AUTH_MISMATCH",
        frontend: key,
        matchedRoute: matched,
        call,
      });
    } else {
      auditResults.push({
        status: "MATCHED_OK",
        frontend: key,
        matchedRoute: matched,
        call,
      });
    }
  }
}

fs.writeFileSync(
  path.join(BASE_DIR, "backend/scratch/route_coverage_audit.json"),
  JSON.stringify(
    {
      totalUniqueCalls: uniqueFrontendCalls.size,
      totalRegisteredRoutes: registeredRoutes.length,
      missingCount,
      methodMismatchCount,
      authMismatchCount,
      auditResults,
    },
    null,
    2
  )
);

console.log("\n--- FINAL ROUTE COVERAGE RESULTS ---");
console.log("Matched OK:", auditResults.filter((x) => x.status === "MATCHED_OK").length);
console.log("Missing routes:", missingCount);
console.log("Method mismatches:", methodMismatchCount);
console.log("Auth middleware mismatches:", authMismatchCount);

if (missingCount > 0 || methodMismatchCount > 0) {
  console.log("\nUnmatched items:");
  auditResults
    .filter((x) => x.status !== "MATCHED_OK")
    .forEach((x) => console.log(x.status, x.frontend));
}
