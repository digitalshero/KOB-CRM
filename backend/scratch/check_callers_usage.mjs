import fs from "fs";
import path from "path";

const details = JSON.parse(fs.readFileSync("d:/Shero Home Food/kob-unity-spark (2)/backend/scratch/useServerFn_details.json", "utf8"));

const activeCalls = [];
const unusedBindings = [];

for (const item of details) {
  const fullPath = path.join("d:/Shero Home Food/kob-unity-spark (2)", item.file);
  const content = fs.readFileSync(fullPath, "utf8");
  const lines = content.split("\n");

  for (const fnInfo of item.fns) {
    const lineText = lines[fnInfo.line - 1];
    // Find variable name e.g. "const fnTog = useServerFn(toggleEntity);" or "queryFn: useServerFn(listStates)"
    const varMatch = lineText.match(/(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*useServerFn/);
    const inlineMatch = lineText.match(/queryFn:\s*useServerFn\s*\(\s*([A-Za-z0-9_]+)\s*\)/);
    
    if (inlineMatch) {
      activeCalls.push({
        file: item.file,
        line: fnInfo.line,
        fn: fnInfo.fn,
        type: "inline_queryFn",
        varName: null,
      });
      continue;
    }

    if (varMatch) {
      const varName = varMatch[1];
      // Count occurrences of varName in content (outside declaration)
      // Simple regex for word boundary varName followed by (
      const callRegex = new RegExp(`\\b${varName}\\s*\\(`, "g");
      const matches = content.match(callRegex) || [];
      if (matches.length > 0) {
        activeCalls.push({
          file: item.file,
          line: fnInfo.line,
          fn: fnInfo.fn,
          type: "called_variable",
          varName: varName,
          callCount: matches.length,
        });
      } else {
        unusedBindings.push({
          file: item.file,
          line: fnInfo.line,
          fn: fnInfo.fn,
          varName: varName,
        });
      }
    } else {
      // maybe direct or other pattern
      activeCalls.push({
        file: item.file,
        line: fnInfo.line,
        fn: fnInfo.fn,
        type: "other",
        raw: lineText.trim(),
      });
    }
  }
}

console.log("Total useServerFn declarations found:", details.reduce((s, x) => s + x.fns.length, 0));
console.log("Active calls / inline usages:", activeCalls.length);
console.log("Unused bindings (dead/rollback only):", unusedBindings.length);

fs.writeFileSync("d:/Shero Home Food/kob-unity-spark (2)/backend/scratch/active_useServerFn_calls.json", JSON.stringify(activeCalls, null, 2));
fs.writeFileSync("d:/Shero Home Food/kob-unity-spark (2)/backend/scratch/unused_useServerFn_bindings.json", JSON.stringify(unusedBindings, null, 2));

console.log("\n--- ACTIVE CALLS DETAIL ---");
for (const c of activeCalls) {
  console.log(`[ACTIVE] ${c.file}:${c.line} -> ${c.fn} (${c.type})`);
}

console.log("\n--- UNUSED BINDINGS (DEAD/ROLLBACK ONLY) ---");
for (const u of unusedBindings) {
  console.log(`[UNUSED] ${u.file}:${u.line} -> ${u.fn} (var: ${u.varName})`);
}
