import pg from 'pg';
const { Client } = pg;

async function fix() {
  const c = new Client('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  await c.connect();

  const res = await c.query(`
    UPDATE auth.users SET
      confirmation_token = COALESCE(confirmation_token, ''),
      recovery_token = COALESCE(recovery_token, ''),
      email_change_token_new = COALESCE(email_change_token_new, ''),
      email_change_token_current = COALESCE(email_change_token_current, ''),
      email_change = COALESCE(email_change, ''),
      phone_change = COALESCE(phone_change, ''),
      phone_change_token = COALESCE(phone_change_token, ''),
      reauthentication_token = COALESCE(reauthentication_token, '')
    RETURNING id, email, confirmation_token;
  `);

  console.log(`Updated ${res.rowCount} users in local auth.users!`);
  await c.end();
}

fix().catch(console.error);
