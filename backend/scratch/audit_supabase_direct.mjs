import fs from "fs";
import path from "path";

function searchDir(dir, patterns) {
  let matches = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      matches = matches.concat(searchDir(full, patterns));
    } else if (ent.name.endsWith(".ts") || ent.name.endsWith(".tsx")) {
      const rel = path.relative("d:/Shero Home Food/kob-unity-spark (2)", full).replace(/\\/g, "/");
      const lines = fs.readFileSync(full, "utf8").split("\n");
      lines.forEach((l, idx) => {
        for (const p of patterns) {
          if (l.includes(p)) {
            matches.push({ file: rel, line: idx + 1, pattern: p, text: l.trim() });
          }
        }
      });
    }
  }
  return matches;
}

const patterns = ["supabase.from(", "supabase.rpc(", "supabase.auth", "supabase.functions", "supabaseAdmin"];
const results = searchDir("d:/Shero Home Food/kob-unity-spark (2)/src", patterns);
console.log("Total matches in src:", results.length);
fs.writeFileSync("d:/Shero Home Food/kob-unity-spark (2)/backend/scratch/supabase_direct_matches.json", JSON.stringify(results, null, 2));

const byFile = {};
for (const m of results) {
  if (!byFile[m.file]) byFile[m.file] = [];
  byFile[m.file].push(m);
}
console.log("Unique files:", Object.keys(byFile).length);
for (const [f, list] of Object.entries(byFile)) {
  console.log(`- ${f} (${list.length} matches): ${Array.from(new Set(list.map(x => x.pattern))).join(", ")}`);
}
