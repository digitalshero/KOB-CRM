import fs from "fs";
import path from "path";

const BASE_DIR = "d:/Shero Home Food/kob-unity-spark (2)";
const raw = JSON.parse(
  fs.readFileSync(path.join(BASE_DIR, "backend/scratch/ast_full_audit_raw.json"), "utf8")
);

const inventory = JSON.parse(
  fs.readFileSync(
    "C:/Users/acer/.gemini/antigravity-ide/brain/906bf449-3a77-4ccc-bbf4-97cc38a846f1/scratch/ast_inventory.json",
    "utf8"
  )
);
const functionMap = new Map();
inventory.forEach((fn) => functionMap.set(fn.name, fn));

// Filter to frontend files (non-server files)
const frontendAudits = raw.filter((f) => !f.isServerFile);

// 1. All imports/usages of @tanstack/react-start, useServerFn, createServerFn, *.functions, *.server
const section1Findings = [];

for (const fa of frontendAudits) {
  // If file has imports or usages of server stuff
  if (
    fa.importsReactStart ||
    fa.importsCreateServerFn ||
    fa.importsUseServerFn ||
    fa.serverFunctionImports.length > 0 ||
    fa.useServerFnCalls.length > 0
  ) {
    // For each imported function from .functions or .server
    for (const imp of fa.serverFunctionImports) {
      const isKnownMigrated = functionMap.has(imp.importedName);
      
      // Check if it is passed to useServerFn
      const useCalls = fa.useServerFnCalls.filter((c) => c.fnArg === imp.localName);
      
      let isActuallyUsed = false;
      let isActiveRuntimeCode = false;
      let classification = "";

      if (useCalls.length > 0) {
        // It was passed to useServerFn
        isActuallyUsed = true;
        // Check if boundVar is invoked or inline queryFn
        for (const uc of useCalls) {
          if (uc.isInlineQueryFn || (uc.boundVar && uc.boundVar.startsWith("inline_prop_"))) {
            isActiveRuntimeCode = true;
          } else if (uc.boundVar) {
            const callCount = fa.invocations[uc.boundVar] || 0;
            if (callCount > 0) {
              isActiveRuntimeCode = true;
            }
          }
        }
        if (isActiveRuntimeCode) {
          classification = "ACTIVE FRONTEND RUNTIME (calls old TanStack server function via useServerFn)";
        } else {
          classification = "SAFE ROLLBACK / DEAD CODE (bound via useServerFn but never invoked)";
        }
      } else {
        // Not passed to useServerFn - is it called directly or referenced?
        const directCalls = fa.invocations[imp.localName] || 0;
        const totalUsages = (fa.allIdentifiers && fa.allIdentifiers[imp.localName]) || 0;
        if (directCalls > 0) {
          isActuallyUsed = true;
          isActiveRuntimeCode = true;
          classification = "ACTIVE FRONTEND RUNTIME (direct call to server function)";
        } else if (totalUsages > 0) {
          isActuallyUsed = true;
          isActiveRuntimeCode = false; // referenced as type or value
          classification = "SAFE ROLLBACK / DEAD CODE (imported and referenced, but not invoked)";
        } else {
          isActuallyUsed = false;
          isActiveRuntimeCode = false;
          classification = "SAFE ROLLBACK / DEAD CODE (imported but unused)";
        }
      }

      section1Findings.push({
        file: fa.file,
        line: imp.line,
        importedFunction: imp.importedName,
        localName: imp.localName,
        from: imp.from,
        isKnownMigrated,
        isActuallyUsed,
        isActiveRuntimeCode,
        classification,
      });
    }
  }
}

// Write section 1 analysis
fs.writeFileSync(
  path.join(BASE_DIR, "backend/scratch/section1_findings.json"),
  JSON.stringify(section1Findings, null, 2)
);

console.log("Section 1 findings total:", section1Findings.length);
const activeCount = section1Findings.filter((x) => x.isActiveRuntimeCode).length;
const rollbackCount = section1Findings.filter((x) => !x.isActiveRuntimeCode).length;
console.log("Active runtime usages:", activeCount);
console.log("Safe rollback / dead code:", rollbackCount);

// Group active by function
const activeByFn = {};
section1Findings
  .filter((x) => x.isActiveRuntimeCode)
  .forEach((x) => {
    activeByFn[x.importedFunction] = (activeByFn[x.importedFunction] || []).concat(x);
  });

console.log("\nActive functions still being called by frontend:");
for (const [fn, items] of Object.entries(activeByFn)) {
  console.log(`- ${fn} (${items.length} callers):`);
  items.forEach((it) => console.log(`    ${it.file}:${it.line} (${it.classification})`));
}
