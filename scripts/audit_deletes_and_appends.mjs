import fs from 'fs';
import path from 'path';

function searchFiles(dir, pattern, ext) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git' && e.name !== '.output') {
      results.push(...searchFiles(full, pattern, ext));
    } else if (e.isFile() && ext.some(x => e.name.endsWith(x))) {
      const content = fs.readFileSync(full, 'utf8');
      const matches = [...content.matchAll(pattern)];
      if (matches.length > 0) {
        results.push({ file: full, matches: matches.map(m => m[0]) });
      }
    }
  }
  return results;
}

// 1. Audit DELETE operations in SQL migrations
const sqlDeletes = searchFiles('supabase/migrations', /DELETE\s+FROM\s+(?:public\.)?([a-zA-Z0-9_]+)/gi, ['.sql']);
const sqlDeleteTables = new Map();
for (const r of sqlDeletes) {
  for (const m of r.matches) {
    const t = m.replace(/DELETE\s+FROM\s+(?:public\.)?/i, '').trim().toLowerCase();
    if (!sqlDeleteTables.has(t)) sqlDeleteTables.set(t, []);
    sqlDeleteTables.get(t).push(path.basename(r.file));
  }
}

// 2. Audit DELETE operations in application code (src/)
const jsDeletes = searchFiles('src', /\.from\(['"]([a-zA-Z0-9_]+)['"]\)\s*\.delete\(\)/g, ['.ts', '.tsx', '.js']);
const jsDeleteTables = new Map();
for (const r of jsDeletes) {
  for (const m of r.matches) {
    const match = m.match(/\.from\(['"]([a-zA-Z0-9_]+)['"]\)/);
    if (match) {
      const t = match[1].toLowerCase();
      if (!jsDeleteTables.has(t)) jsDeleteTables.set(t, []);
      jsDeleteTables.get(t).push(path.relative(process.cwd(), r.file));
    }
  }
}

// 3. Audit UPDATE operations in application code (src/) for Append-Only candidates
const appendCandidates = [
  'audit_logs',
  'lead_stage_history',
  'lead_activities',
  'lead_events',
  'evaluation_responses',
  'scv_mode_config_changes',
  'scv_weight_changes',
  'incentives'
];

const jsUpdates = {};
for (const table of appendCandidates) {
  const pattern = new RegExp(`\\.from\\(['"]${table}['"]\\)\\s*\\.update\\(`, 'g');
  const results = searchFiles('src', pattern, ['.ts', '.tsx', '.js']);
  jsUpdates[table] = results.map(r => ({
    file: path.relative(process.cwd(), r.file),
    count: r.matches.length
  }));
}

// Also check migrations for UPDATE on these tables
const sqlUpdates = {};
for (const table of appendCandidates) {
  const pattern = new RegExp(`UPDATE\\s+(?:public\\.)?${table}\\s+SET`, 'gi');
  const results = searchFiles('supabase/migrations', pattern, ['.sql']);
  sqlUpdates[table] = results.map(r => ({
    file: path.basename(r.file),
    count: r.matches.length
  }));
}

console.log('--- 1. TABLES WITH DELETE OPERATIONS IN APPLICATION CODE (src/) ---');
for (const [t, files] of jsDeleteTables.entries()) {
  console.log(`- ${t}: in ${files.join(', ')}`);
}

console.log('\n--- 2. TABLES WITH DELETE OPERATIONS IN MIGRATIONS/TRIGGERS ---');
for (const [t, files] of sqlDeleteTables.entries()) {
  console.log(`- ${t}: in ${files.length} migrations (e.g. ${files.slice(0, 3).join(', ')})`);
}

console.log('\n--- 3. APPEND-ONLY CANDIDATES: UPDATE AUDIT ---');
for (const table of appendCandidates) {
  const appUpdates = jsUpdates[table];
  const migUpdates = sqlUpdates[table];
  console.log(`Table: ${table}`);
  console.log(`  App updates (.update()): ${appUpdates.length ? JSON.stringify(appUpdates) : 'NONE (0)'}`);
  console.log(`  Migration updates:       ${migUpdates.length ? JSON.stringify(migUpdates) : 'NONE (0)'}`);
}
