import fs from "fs";
import path from "path";

const BASE_DIR = "d:/Shero Home Food/kob-unity-spark (2)";
const SRC_DIR = path.join(BASE_DIR, "src");

// Load the 150 inventory
const inventory = JSON.parse(
  fs.readFileSync(
    "C:/Users/acer/.gemini/antigravity-ide/brain/906bf449-3a77-4ccc-bbf4-97cc38a846f1/scratch/ast_inventory.json",
    "utf8"
  )
);
const functionNames = new Set(inventory.map((f) => f.name));

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

const targetDirs = [
  path.join(SRC_DIR, "routes"),
  path.join(SRC_DIR, "components"),
  path.join(SRC_DIR, "hooks"),
  path.join(SRC_DIR, "lib"),
];

let allTargetFiles = [];
for (const d of targetDirs) {
  if (fs.existsSync(d)) {
    allTargetFiles = allTargetFiles.concat(getAllFiles(d));
  }
}

console.log("Total files to scan in target dirs:", allTargetFiles.length);

// Analyze imports and usages
const importRecords = [];
const useServerFnRecords = [];
const createServerFnRecords = [];
const reactStartRecords = [];

for (const filePath of allTargetFiles) {
  const relPath = path.relative(BASE_DIR, filePath).replace(/\\/g, "/");
  const isServerFile = relPath.endsWith(".functions.ts") || relPath.endsWith(".server.ts");
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    // Check react-start
    if (trimmed.includes("@tanstack/react-start")) {
      reactStartRecords.push({
        file: relPath,
        line: lineNum,
        text: trimmed,
        isServerFile,
      });
    }

    // Check createServerFn
    if (trimmed.includes("createServerFn")) {
      createServerFnRecords.push({
        file: relPath,
        line: lineNum,
        text: trimmed,
        isServerFile,
      });
    }

    // Check useServerFn
    if (trimmed.includes("useServerFn")) {
      useServerFnRecords.push({
        file: relPath,
        line: lineNum,
        text: trimmed,
        isServerFile,
      });
    }

    // Check imports from .functions or .server
    if (
      (trimmed.startsWith("import ") || trimmed.includes("from \"") || trimmed.includes("from '")) &&
      (trimmed.includes(".functions") || trimmed.includes(".server"))
    ) {
      // Parse imported symbols
      const match = trimmed.match(/import\s+(?:\{([^}]+)\}|([A-Za-z0-9_]+))\s+from\s+['"]([^'"]+)['"]/);
      if (match) {
        const named = match[1]
          ? match[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)
          : [];
        const defaultImp = match[2] ? match[2].trim() : null;
        const fromPath = match[3];

        const importedSymbols = named.length > 0 ? named : (defaultImp ? [defaultImp] : []);
        for (const sym of importedSymbols) {
          importRecords.push({
            file: relPath,
            line: lineNum,
            symbol: sym,
            from: fromPath,
            isServerFile,
            raw: trimmed,
          });
        }
      } else {
        importRecords.push({
          file: relPath,
          line: lineNum,
          symbol: "UNKNOWN",
          from: trimmed,
          isServerFile,
          raw: trimmed,
        });
      }
    }
  });
}

// Check how imported symbols are used in non-server files
for (const imp of importRecords) {
  if (imp.isServerFile) {
    imp.status = "server_internal";
    continue;
  }
  const content = fs.readFileSync(path.join(BASE_DIR, imp.file), "utf8");
  // Check if symbol appears outside the import line
  // Regex for word boundary
  const symRegex = new RegExp(`\\b${imp.symbol}\\b`, "g");
  const matches = content.match(symRegex) || [];
  // The import line itself contains at least 1 match
  const countOutsideImport = matches.length - 1;
  imp.usageCount = countOutsideImport;
  imp.isUsedInFile = countOutsideImport > 0;

  // If used, let's see how: is it in useServerFn(sym) or direct call?
  if (imp.isUsedInFile) {
    const useServerFnMatch = content.match(new RegExp(`useServerFn\\s*\\(\\s*${imp.symbol}\\s*\\)`));
    if (useServerFnMatch) {
      imp.usedVia = "useServerFn";
      // Find what variable it was assigned to:
      const varMatch = content.match(new RegExp(`(?:const|let|var)\\s+([A-Za-z0-9_]+)\\s*=\\s*useServerFn\\s*\\(\\s*${imp.symbol}\\s*\\)`));
      if (varMatch) {
        const boundVar = varMatch[1];
        // Check if boundVar is called
        const callMatches = content.match(new RegExp(`\\b${boundVar}\\s*\\(`, "g")) || [];
        imp.boundVar = boundVar;
        imp.boundVarCallCount = callMatches.length;
        imp.isActiveCaller = callMatches.length > 0;
      } else {
        // Maybe queryFn: useServerFn(sym)
        if (content.match(new RegExp(`queryFn:\\s*useServerFn\\s*\\(\\s*${imp.symbol}\\s*\\)`))) {
          imp.isActiveCaller = true;
          imp.boundVar = "inline_queryFn";
        } else {
          imp.isActiveCaller = true;
          imp.boundVar = "other";
        }
      }
    } else {
      // Used directly or as type?
      const callMatch = content.match(new RegExp(`\\b${imp.symbol}\\s*\\(`, "g")) || [];
      imp.usedVia = "direct_call_or_ref";
      imp.isActiveCaller = callMatch.length > 0;
    }
  } else {
    imp.isActiveCaller = false;
  }
}

fs.writeFileSync(
  path.join(BASE_DIR, "backend/scratch/audit_detailed_imports.json"),
  JSON.stringify(
    {
      totalImports: importRecords.length,
      frontendImports: importRecords.filter((x) => !x.isServerFile),
      useServerFnRecords,
      createServerFnRecords,
      reactStartRecords,
    },
    null,
    2
  )
);

console.log("Audit detailed imports complete.");
console.log("Total frontend imports of .functions/.server:", importRecords.filter((x) => !x.isServerFile).length);
console.log("Frontend active callers:", importRecords.filter((x) => !x.isServerFile && x.isActiveCaller).length);
console.log("Frontend unused/dead imports:", importRecords.filter((x) => !x.isServerFile && !x.isActiveCaller).length);
