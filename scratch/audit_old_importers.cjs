const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        results = results.concat(walk(full));
      }
    } else {
      results.push(full);
    }
  }
  return results;
}

const allSrc = walk('./src');

const targets = [
  'kob.functions',
  'kob-dashboard.functions',
  'kob-dashboard.server',
  'webinar.functions',
  'evaluation.functions',
  'qa.functions',
  'import-leads.functions',
  'seed-users.functions',
  'meta-ads.functions',
  'meta-ads.server',
  'meta-campaign-storage.server',
  'lead-sync.server',
  'client.server',
  'auth-middleware',
  'auth-attacher'
];

const results = [];

for (const f of allSrc) {
  if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
  const content = fs.readFileSync(f, 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const t of targets) {
      if (line.includes(t)) {
        // Check if the imported symbols are actually called in this file
        results.push({
          file: f.replace(/\\/g, '/'),
          lineNo: i + 1,
          target: t,
          line: line.trim()
        });
      }
    }
  }
}

console.log(`Total import statements referencing old server files: ${results.length}`);
fs.writeFileSync('./scratch/server_import_audit.json', JSON.stringify(results, null, 2));
