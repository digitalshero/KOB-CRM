import fs from "fs";
import path from "path";

const BASE_DIR = "d:/Shero Home Food/kob-unity-spark (2)";

const oldFiles = [
  "src/integrations/supabase/client.server.ts",
  "src/lib/evaluation.functions.ts",
  "src/lib/import-leads.functions.ts",
  "src/lib/kob-dashboard.functions.ts",
  "src/lib/kob-dashboard.server.ts",
  "src/lib/kob.functions.ts",
  "src/lib/lead-sync.server.ts",
  "src/lib/meta-ads.functions.ts",
  "src/lib/meta-ads.server.ts",
  "src/lib/meta-campaign-storage.server.ts",
  "src/lib/qa.functions.ts",
  "src/lib/seed-users.functions.ts",
  "src/lib/webinar.functions.ts",
];

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

const allTsFiles = getAllFiles(path.join(BASE_DIR, "src")).concat(
  getAllFiles(path.join(BASE_DIR, "backend/src"))
);

const analysis = {};

for (const target of oldFiles) {
  const baseName = path.basename(target, ".ts");
  // Patterns e.g. "@/lib/kob.functions", "./kob.functions", "client.server"
  const importers = [];
  
  for (const file of allTsFiles) {
    const rel = path.relative(BASE_DIR, file).replace(/\\/g, "/");
    if (rel === target) continue;
    const content = fs.readFileSync(file, "utf8");
    if (content.includes(baseName)) {
      importers.push(rel);
    }
  }

  const backendImporters = importers.filter((f) => f.startsWith("backend/"));
  const frontendImporters = importers.filter((f) => !f.startsWith("backend/"));
  const publicApiImporters = importers.filter((f) => f.startsWith("src/routes/api/public/"));
  const uiImporters = importers.filter((f) => !f.startsWith("backend/") && !f.startsWith("src/routes/api/public/"));

  analysis[target] = {
    totalImporters: importers.length,
    backendImporters,
    publicApiImporters,
    uiImporters,
  };
}

console.log(JSON.stringify(analysis, null, 2));
