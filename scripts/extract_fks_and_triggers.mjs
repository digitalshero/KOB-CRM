import pg from 'pg';
import fs from 'fs';

const client = new pg.Client('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
await client.connect();

const fks = await client.query(`
  SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  JOIN information_schema.referential_constraints AS rc
    ON rc.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  ORDER BY tc.table_name;
`);

const triggers = await client.query(`
  SELECT event_object_table, trigger_name, action_timing, event_manipulation, action_statement
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
  ORDER BY event_object_table;
`);

const trgMap = {};
for (const tr of triggers.rows) {
  if (!trgMap[tr.event_object_table]) trgMap[tr.event_object_table] = [];
  trgMap[tr.event_object_table].push(tr.trigger_name + ' (' + tr.event_manipulation + ')');
}

fs.writeFileSync('scripts/fks_and_triggers.json', JSON.stringify({
  fks: fks.rows,
  triggers: trgMap
}, null, 2));

console.log('Done extracting FKs (' + fks.rows.length + ') and triggers (' + triggers.rows.length + ').');
await client.end();
