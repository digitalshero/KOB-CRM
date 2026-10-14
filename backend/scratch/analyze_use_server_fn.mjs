import fs from "fs";
import path from "path";

const findings = JSON.parse(fs.readFileSync("d:/Shero Home Food/kob-unity-spark (2)/backend/scratch/raw_findings.json", "utf8"));

// Let's inspect all useServerFn occurrences
const byFile = {};
for (const item of findings.useServerFn) {
  if (item.file.endsWith(".functions.ts")) continue;
  if (!byFile[item.file]) byFile[item.file] = [];
  byFile[item.file].push(item);
}

console.log("Files containing useServerFn:", Object.keys(byFile).length);

// Let's inspect what each file does
const fileDetails = [];
for (const [file, items] of Object.entries(byFile)) {
  const content = fs.readFileSync(path.join("d:/Shero Home Food/kob-unity-spark (2)", file), "utf8");
  
  // extract which server functions are passed to useServerFn
  const usedFns = [];
  for (const it of items) {
    const match = it.text.match(/useServerFn\s*\(\s*([A-Za-z0-9_]+)\s*\)/);
    if (match) {
      usedFns.push({ fn: match[1], line: it.line, text: it.text });
    }
  }
  fileDetails.push({ file, count: items.length, fns: usedFns });
}

fs.writeFileSync("d:/Shero Home Food/kob-unity-spark (2)/backend/scratch/useServerFn_details.json", JSON.stringify(fileDetails, null, 2));

console.log("\nSummary of files with useServerFn:");
for (const f of fileDetails) {
  console.log(`- ${f.file}: ${f.fns.map(x => x.fn).join(", ")}`);
}
