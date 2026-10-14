import fs from "fs";
import path from "path";

const BASE_DIR = "d:/Shero Home Food/kob-unity-spark (2)";
const SRC_DIR = path.join(BASE_DIR, "src");

function getAllFiles(dir, exts = [".ts", ".tsx", ".js", ".jsx"]) {
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

const targetDirs = [
  path.join(SRC_DIR, "routes"),
  path.join(SRC_DIR, "components"),
  path.join(SRC_DIR, "hooks"),
  path.join(SRC_DIR, "lib"),
];

let allFiles = [];
for (const d of targetDirs) {
  if (fs.existsSync(d)) {
    allFiles = allFiles.concat(getAllFiles(d));
  }
}

// Patterns to search
const patterns = [
  { name: "fetch", regex: /\bfetch\s*\(/ },
  { name: "axios", regex: /\baxios\b/ },
  { name: "Meta Graph URL", regex: /graph\.facebook\.com/i },
  { name: "Gallabox URL", regex: /api\.gallabox\.com|gallabox/i },
  { name: "WhatsApp URL", regex: /api\.whatsapp\.com|wa\.me/i },
  { name: "localhost backend URL", regex: /http:\/\/(?:localhost|127\.0\.0\.1):300[0-9]/i },
];

const bypassMatches = [];

for (const filePath of allFiles) {
  const relPath = path.relative(BASE_DIR, filePath).replace(/\\/g, "/");
  
  // Exclude api-client.ts and server functions/files from frontend caller audit
  const isServerFile = relPath.endsWith(".functions.ts") || relPath.endsWith(".server.ts");
  const isPublicRoute = relPath.startsWith("src/routes/api/public/");
  const isApiClient = relPath === "src/lib/api-client.ts";

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    for (const pat of patterns) {
      if (pat.regex.test(line)) {
        bypassMatches.push({
          file: relPath,
          line: lineNum,
          type: pat.name,
          text: line.trim(),
          isServerFile,
          isPublicRoute,
          isApiClient,
        });
      }
    }
  });
}

fs.writeFileSync(
  path.join(BASE_DIR, "backend/scratch/bypass_audit_results.json"),
  JSON.stringify(bypassMatches, null, 2)
);

console.log("Total matches:", bypassMatches.length);

const frontendMatches = bypassMatches.filter(
  (m) => !m.isServerFile && !m.isPublicRoute && !m.isApiClient
);
console.log("Frontend active matches (excluding server files, public routes, api-client):", frontendMatches.length);

for (const m of frontendMatches) {
  console.log(`[${m.type}] ${m.file}:${m.line} -> ${m.text}`);
}
