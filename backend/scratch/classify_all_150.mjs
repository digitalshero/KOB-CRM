import fs from "fs";
import path from "path";

const BASE_DIR = "d:/Shero Home Food/kob-unity-spark (2)";

// Load 150 functions
const inventory = JSON.parse(
  fs.readFileSync(
    "C:/Users/acer/.gemini/antigravity-ide/brain/906bf449-3a77-4ccc-bbf4-97cc38a846f1/scratch/ast_inventory.json",
    "utf8"
  )
);

// Load findings from section 1
const section1 = JSON.parse(
  fs.readFileSync(path.join(BASE_DIR, "backend/scratch/section1_findings.json"), "utf8")
);
const activeOldCallers = section1.filter((x) => x.isActiveRuntimeCode);

// Map of active old callers by function name
const oldCallersByFn = new Map();
for (const c of activeOldCallers) {
  if (!oldCallersByFn.has(c.importedFunction)) oldCallersByFn.set(c.importedFunction, []);
  oldCallersByFn.get(c.importedFunction).push(c);
}

// Load route coverage / apiClient calls
const routeCoverage = JSON.parse(
  fs.readFileSync(path.join(BASE_DIR, "backend/scratch/route_coverage_audit.json"), "utf8")
);

// Map of Express controllers to their functions
const expressRouteByFn = new Map();
for (const r of routeCoverage.auditResults) {
  if (r.matchedRoute && r.matchedRoute.controllerHandler) {
    const fnName = r.matchedRoute.controllerHandler;
    if (!expressRouteByFn.has(fnName)) expressRouteByFn.set(fnName, []);
    expressRouteByFn.get(fnName).push(r);
  }
}

const classified150 = [];

for (const fn of inventory) {
  const name = fn.name;
  let category = "";
  let reason = "";

  // 1. Check Category E first: Does active frontend still call old function?
  if (oldCallersByFn.has(name)) {
    const callers = oldCallersByFn.get(name);
    category = "E";
    reason = `Active frontend/runtime callers still call old TanStack function (${callers.map(c => `${c.file}:${c.line}`).join(", ")})`;
  } else if (expressRouteByFn.has(name)) {
    // Has active frontend callers using apiClient to Express!
    category = "A";
    const calls = expressRouteByFn.get(name);
    reason = `Migrated to Express; active frontend caller uses apiClient (${calls[0].frontend})`;
  } else if (fn.callers && fn.callers.length > 0) {
    category = "D";
    reason = "Old TanStack function retained only for rollback (all frontend callers cut over or inactive)";
  } else {
    category = "C";
    reason = "No active caller in frontend or routes";
  }

  classified150.push({
    name: fn.name,
    file: fn.file,
    category,
    reason,
  });
}

fs.writeFileSync(
  path.join(BASE_DIR, "backend/scratch/classified_150_functions.json"),
  JSON.stringify(classified150, null, 2)
);

const counts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
classified150.forEach((c) => counts[c.category]++);

console.log("--- 150 FUNCTIONS CLASSIFICATION SUMMARY ---");
console.log("Total functions:", classified150.length);
console.log("A - Active caller now uses apiClient:", counts.A);
console.log("B - Backend-only / internal:", counts.B);
console.log("C - No active caller:", counts.C);
console.log("D - Retained for rollback only:", counts.D);
console.log("E - PROBLEM: active frontend still calls old function:", counts.E);

console.log("\nCATEGORY E FUNCTIONS (active old callers):");
classified150.filter((c) => c.category === "E").forEach((c) => {
  console.log(`- ${c.name} (${c.file}): ${c.reason}`);
});
