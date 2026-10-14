import pg from 'pg';
import fs from 'fs';

const client = new pg.Client('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
await client.connect();

const query = `
  SELECT 
    t.table_name,
    COALESCE(
      (SELECT string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position)
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu 
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' 
         AND tc.table_schema = 'public' 
         AND tc.table_name = t.table_name), 'NONE'
    ) as primary_key,
    EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t.table_name AND c.column_name = 'created_at') as has_created_at,
    EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t.table_name AND c.column_name = 'updated_at') as has_updated_at,
    (SELECT string_agg(column_name, ', ') FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t.table_name AND c.column_name LIKE '%_at') as all_timestamp_cols,
    (SELECT count(*)::int FROM information_schema.triggers tr WHERE tr.event_object_schema = 'public' AND tr.event_object_table = t.table_name) as trigger_count
  FROM information_schema.tables t
  WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  ORDER BY t.table_name;
`;

const res = await client.query(query);

// Also get row counts from each table
const enriched = [];
for (const row of res.rows) {
  const countRes = await client.query(`SELECT count(*)::int as count FROM public."${row.table_name}"`);
  enriched.push({
    ...row,
    row_count: countRes.rows[0].count
  });
}

console.log(JSON.stringify(enriched, null, 2));
fs.writeFileSync('scripts/table_audit_summary.json', JSON.stringify(enriched, null, 2));

await client.end();
