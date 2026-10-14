import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.sync.local' });
const rawConn = process.env.LIVE_DATABASE_READ_URL || '';
const poolerPassword = rawConn.includes('<') ? rawConn.match(/:<([^>]+)>/)?.[1] : rawConn.match(/:([^@:]+)@/)?.[1];

const livePg = new pg.Client({
  host: 'aws-0-ap-southeast-2.pooler.supabase.com',
  port: 5432,
  user: 'live_sync_reader.guqjvhptyhfrzkjcykvf',
  password: poolerPassword,
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});
const localPg = new pg.Client('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
await livePg.connect();
await localPg.connect();

const liveId1 = '40b8043e-a1f7-46fe-975e-429cbdcb4bdf';
const liveId2 = '6efdaecb-89ad-45d1-9e61-04dee12bba2a';

for (const id of [liveId1, liveId2]) {
  const sh = (await livePg.query('SELECT count(*)::int as cnt FROM public.lead_stage_history WHERE lead_id = $1', [id])).rows[0].cnt;
  const act = (await livePg.query('SELECT count(*)::int as cnt FROM public.lead_activities WHERE lead_id = $1', [id])).rows[0].cnt;
  const ev = (await livePg.query('SELECT count(*)::int as cnt FROM public.lead_events WHERE lead_id = $1', [id])).rows[0].cnt;
  console.log(`Live lead ${id} has: ${sh} stage_history, ${act} activities, ${ev} events`);
}

await livePg.end();
await localPg.end();
