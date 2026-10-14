import pg from 'pg';

const client = new pg.Client('postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres');
await client.connect();

// 1. Unschedule all cron jobs so no background jobs fire
const jobs = await client.query('SELECT jobid FROM cron.job');
for (const j of jobs.rows) {
  await client.query('SELECT cron.unschedule($1::bigint)', [j.jobid]);
}
console.log('Unscheduled jobs count:', jobs.rows.length);

// 2. Remove the 4 cron-generated audit logs
const res = await client.query("DELETE FROM public.audit_logs WHERE action = 'WEBINAR_24H_RETARGET_TELUGU_SENT' AND created_at >= '2026-10-12'");
console.log('Deleted cron audit logs:', res.rowCount);

// 3. Remove corresponding send queue records
const resSends = await client.query("DELETE FROM public.lead_webinar_retarget_telugu_sends WHERE updated_at >= '2026-10-12'");
console.log('Deleted send queue records:', resSends.rowCount);

// 4. Verify audit_logs count
const countRes = await client.query('SELECT count(*)::int FROM public.audit_logs');
console.log('Current audit_logs count:', countRes.rows[0].count);

await client.end();
