import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { spawn } from 'child_process';

dotenv.config();

const liveUrl = process.env.LIVE_SUPABASE_URL || 'https://guqjvhptyhfrzkjcykvf.supabase.co';
const pubKey = process.env.LIVE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_u0skS-QrMquyqfIAuL1lWw_UzQY24L9';

console.log('Authenticating against Live Supabase to obtain temporary read-only token...');
const client = createClient(liveUrl, pubKey);
const authRes = await client.auth.signInWithPassword({
  email: 'ceo@shero.test',
  password: 'Test@12345'
});

if (!authRes.data?.session?.access_token) {
  console.error('Failed to obtain token from live:', authRes.error);
  process.exit(1);
}

const token = authRes.data.session.access_token;
console.log('Successfully acquired live read token. Executing live-connected dry run...\n');

const env = {
  ...process.env,
  LIVE_SUPABASE_URL: liveUrl,
  LIVE_SUPABASE_READ_KEY: token
};

const child = spawn('node', ['scripts/sync_live_to_local.mjs', '--dry-run'], {
  env,
  stdio: 'inherit'
});

child.on('close', (code) => {
  process.exit(code);
});
