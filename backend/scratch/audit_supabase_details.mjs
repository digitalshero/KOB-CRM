import fs from "fs";
import path from "path";

const BASE_DIR = "d:/Shero Home Food/kob-unity-spark (2)";
const SRC_DIR = path.join(BASE_DIR, "src");

function getAllFiles(dir, exts = [".ts", ".tsx"]) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, exts));
    } else if (exts.includes(path.extname(file))) {
      results.push(fullPath);
    }
  }
  return results;
}

const allFiles = getAllFiles(SRC_DIR);
const patterns = [
  "supabase.from(",
  "supabase.rpc(",
  "supabase.auth",
  "supabase.functions",
  "supabaseAdmin",
];

const occurrences = [];

for (const f of allFiles) {
  const rel = path.relative(BASE_DIR, f).replace(/\\/g, "/");
  const lines = fs.readFileSync(f, "utf8").split("\n");

  lines.forEach((l, idx) => {
    const lineNum = idx + 1;
    const trimmed = l.trim();
    for (const p of patterns) {
      if (trimmed.includes(p)) {
        // Classify
        let category = "unknown";
        if (rel.endsWith(".functions.ts") || rel.endsWith(".server.ts")) {
          category = "dead/rollback code (old TanStack server functions)";
        } else if (rel.startsWith("src/routes/api/public/")) {
          category = "public API route (TanStack Start API route, Phase 4 scope)";
        } else if (rel === "src/lib/api-client.ts") {
          category = "auth/session-only and intentionally retained (gets auth token for Express requests)";
        } else if (rel.startsWith("src/integrations/supabase/auth-")) {
          category = "auth/session-only and intentionally retained";
        } else if (rel === "src/routes/auth.tsx") {
          category = "auth/session-only and intentionally retained (Supabase Auth login/logout UI)";
        } else if (rel === "src/routes/index.tsx") {
          category = "auth/session-only and intentionally retained (Session redirect guard)";
        } else if (rel === "src/routes/_authenticated/route.tsx") {
          category = "auth/session-only and intentionally retained (Authenticated layout session check)";
        } else if (rel === "src/lib/audit.ts") {
          category = "dead/rollback code (helper for old TanStack server functions)";
        } else {
          category = "data access that should now use Express";
        }

        occurrences.push({
          file: rel,
          line: lineNum,
          pattern: p,
          text: trimmed,
          category,
        });
      }
    }
  });
}

fs.writeFileSync(
  path.join(BASE_DIR, "backend/scratch/supabase_frontend_audit_classified.json"),
  JSON.stringify(occurrences, null, 2)
);

console.log("Total direct Supabase occurrences in src:", occurrences.length);

const byCat = {};
occurrences.forEach((o) => {
  byCat[o.category] = (byCat[o.category] || 0) + 1;
});
console.log("\nSummary by Category:");
for (const [c, count] of Object.entries(byCat)) {
  console.log(`- ${c}: ${count}`);
}

console.log("\nBreakdown of active frontend non-server files:");
const frontendOnly = occurrences.filter(
  (x) =>
    !x.file.endsWith(".functions.ts") &&
    !x.file.endsWith(".server.ts") &&
    !x.file.startsWith("src/routes/api/public/") &&
    x.file !== "src/lib/audit.ts"
);
console.log("Count in active frontend:", frontendOnly.length);
frontendOnly.forEach((x) => {
  console.log(`  ${x.file}:${x.line} [${x.pattern}] -> ${x.category}`);
});
