import fs from "fs";
import path from "path";

const files = [
  "src/lib/evaluation.functions.ts",
  "src/lib/import-leads.functions.ts",
  "src/lib/kob-dashboard.functions.ts",
  "src/lib/kob.functions.ts",
  "src/lib/meta-ads.functions.ts",
  "src/lib/qa.functions.ts",
  "src/lib/seed-users.functions.ts",
  "src/lib/webinar.functions.ts",
];

let total = 0;
const inventory = [];
for (const f of files) {
  const content = fs.readFileSync(f, "utf8");
  const regex = /export\s+const\s+(\w+)\s*=\s*createServerFn\(\s*\{\s*method:\s*["'](GET|POST|PUT|DELETE)["']/g;
  let m;
  let countInFile = 0;
  while ((m = regex.exec(content)) !== null) {
    total++;
    countInFile++;
    inventory.push({ name: m[1], method: m[2], file: f });
  }
  console.log(`${f}: ${countInFile}`);
}

console.log(`\nTOTAL createServerFn in src/lib: ${total}`);

// Now read backend routes to see what has been migrated
const routeFiles = [
  "backend/src/routes/kob.routes.ts",
  "backend/src/routes/dashboard.routes.ts",
  "backend/src/routes/webinar.routes.ts",
  "backend/src/routes/qa.routes.ts",
  "backend/src/routes/evaluation.routes.ts",
];

const migratedRoutes = [];
for (const rf of routeFiles) {
  if (fs.existsSync(rf)) {
    const c = fs.readFileSync(rf, "utf8");
    // Look for router.get(...) or router.post(...)
    const reg = /(?:kobRouter|dashboardRouter|webinarRouter|qaRouter|evaluationRouter)\.(get|post|put|delete)\(\s*["']([^"']+)["']/g;
    let rm;
    while ((rm = reg.exec(c)) !== null) {
      migratedRoutes.push({ method: rm[1].toUpperCase(), path: rm[2], file: rf });
    }
  }
}

console.log(`TOTAL Migrated Express Routes: ${migratedRoutes.length}`);

// Load previous classification verified if available
let previousClassification = {};
const classPath = "C:/Users/acer/.gemini/antigravity-ide/brain/906bf449-3a77-4ccc-bbf4-97cc38a846f1/scratch/classification_verified.json";
if (fs.existsSync(classPath)) {
  previousClassification = JSON.parse(fs.readFileSync(classPath, "utf8"));
}

console.log(`Loaded previous classification entries: ${Object.keys(previousClassification).length}`);

// Audit batch 1 to 12 migrated functions
// Read all controllers in backend/src/controllers to list exported functions
const controllerFiles = [
  "backend/src/controllers/kob.controller.ts",
  "backend/src/controllers/dashboard.controller.ts",
  "backend/src/controllers/webinar.controller.ts",
  "backend/src/controllers/qa.controller.ts",
  "backend/src/controllers/evaluation.controller.ts",
];

const controllerFunctions = new Set();
for (const cf of controllerFiles) {
  if (fs.existsSync(cf)) {
    const c = fs.readFileSync(cf, "utf8");
    const reg = /export\s+async\s+function\s+(\w+)/g;
    let cm;
    while ((cm = reg.exec(c)) !== null) {
      controllerFunctions.add(cm[1]);
    }
  }
}

console.log(`Controller exported handler count: ${controllerFunctions.size}`);

// Compare inventory against controllerFunctions
const migratedFns = [];
const unmigratedFns = [];

for (const fn of inventory) {
  if (controllerFunctions.has(fn.name)) {
    migratedFns.push(fn);
  } else {
    unmigratedFns.push(fn);
  }
}

console.log(`\n==================================================`);
console.log(`INVENTORY AUDIT RESULTS`);
console.log(`==================================================`);
console.log(`TOTAL SERVER FUNCTIONS: ${total}`);
console.log(`MIGRATED (in Express controllers): ${migratedFns.length}`);
console.log(`REMAINING (unmigrated): ${unmigratedFns.length}`);

// Classify remaining
const remainingReadOnly = [];
const remainingMutation = [];

for (const fn of unmigratedFns) {
  // Check method or previous classification
  const prev = previousClassification[fn.name];
  const isReadOnly = fn.method === "GET" && (!prev || prev.classification === "READ_ONLY");
  if (isReadOnly) {
    remainingReadOnly.push(fn);
  } else {
    remainingMutation.push(fn);
  }
}

console.log(`REMAINING READ-ONLY: ${remainingReadOnly.length}`);
console.log(`REMAINING WRITE/MUTATION: ${remainingMutation.length}`);

if (remainingReadOnly.length > 0) {
  console.log(`\nWARNING: Found ${remainingReadOnly.length} unmigrated READ-ONLY functions:`);
  console.table(remainingReadOnly);
}

fs.writeFileSync(
  "backend/scratch/audit_results.json",
  JSON.stringify(
    {
      totalServerFunctions: total,
      migratedCount: migratedFns.length,
      remainingCount: unmigratedFns.length,
      remainingReadOnly: remainingReadOnly,
      remainingMutation: remainingMutation,
      unmigratedFns,
    },
    null,
    2,
  ),
);
