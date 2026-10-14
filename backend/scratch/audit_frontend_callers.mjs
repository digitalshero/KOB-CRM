import fs from "fs";
import path from "path";

const SRC_DIR = "d:/Shero Home Food/kob-unity-spark (2)/src";

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

console.log("Total TS/TSX files in src:", allFiles.length);

const findings = {
  useServerFn: [],
  reactStart: [],
  functionsImports: [],
  serverImports: [],
  createServerFn: [],
};

for (const file of allFiles) {
  const content = fs.readFileSync(file, "utf8");
  const rel = path.relative("d:/Shero Home Food/kob-unity-spark (2)", file).replace(/\\/g, "/");
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    if (line.includes("useServerFn")) {
      findings.useServerFn.push({ file: rel, line: lineNum, text: line.trim() });
    }
    if (line.includes("@tanstack/react-start")) {
      findings.reactStart.push({ file: rel, line: lineNum, text: line.trim() });
    }
    if (line.includes(".functions") && !file.includes(".functions.ts")) {
      findings.functionsImports.push({ file: rel, line: lineNum, text: line.trim() });
    }
    if (line.includes(".server") && !file.includes(".server.ts")) {
      findings.serverImports.push({ file: rel, line: lineNum, text: line.trim() });
    }
    if (line.includes("createServerFn")) {
      findings.createServerFn.push({ file: rel, line: lineNum, text: line.trim() });
    }
  });
}

console.log("\n--- FINDINGS SUMMARY ---");
console.log("useServerFn occurrences:", findings.useServerFn.length);
console.log("@tanstack/react-start occurrences:", findings.reactStart.length);
console.log(".functions imports in non-functions files:", findings.functionsImports.length);
console.log(".server imports in non-server files:", findings.serverImports.length);
console.log("createServerFn occurrences:", findings.createServerFn.length);

fs.writeFileSync("d:/Shero Home Food/kob-unity-spark (2)/backend/scratch/raw_findings.json", JSON.stringify(findings, null, 2));
