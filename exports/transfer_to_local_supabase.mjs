import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

// Connection configurations
const SOURCE_CONFIG = {
  connectionString: 'postgresql://postgres:Kob%40321!@127.0.0.1:5432/kob_local',
};

const DEST_CONFIG = {
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
};

// Topological dependency order of all 54 public tables (excluding auth.users)
const PUBLIC_TABLES = [
  'brands',
  'india_states',
  'india_pincodes',
  'lead_sources',
  'gallabox_templates',
  'evaluation_questions',
  'kob_configuration',
  'integration_settings',
  'kpi_targets',
  'india_districts',
  'india_cities',
  'brand_state_availability',
  'state_native_brand',
  'profiles',
  'user_roles',
  'audit_logs',
  'retargeting_rules',
  'kob_leads',
  'lead_stage_history',
  'lead_activities',
  'lead_events',
  'retargeting_schedule',
  'retargeting_attempts',
  'gallabox_fire_queue',
  'email_fire_queue',
  'webinar_batches',
  'webinar_attendance',
  'evaluation_responses',
  'lead_inbox_retarget_sends',
  'lead_eoi1_retarget_sends',
  'lead_eoi1_retarget_telugu_sends',
  'lead_eoi1_retarget_malayalam_sends',
  'lead_webinar_retarget_tamil_sends',
  'lead_webinar_retarget_telugu_sends',
  'lead_webinar_retarget_malayalam_sends',
  'website_form_default_sends',
  'website_form_tamil_sends',
  'website_form_telugu_sends',
  'website_form_malayalam_sends',
  'support_lead_sends',
  'meta_ads_initial_sends',
  'whatsapp_broadcast_initial_sends',
  'scv_mode_config',
  'scv_mode_config_changes',
  'scv_mode_inputs',
  'scv_monthly_inputs',
  'scv_rules',
  'scv_component_weights',
  'scv_role_weights',
  'scv_weight_changes',
  'scv_manual_ratings',
  'incentive_rules',
  'incentives',
  'marketing_kpi_targets'
];

async function runTransfer() {
  console.log('='.repeat(80));
  console.log('KOB LOCAL DATA -> LOCAL SUPABASE POSTGRESQL TRANSFER');
  console.log('='.repeat(80));

  // Safety checks
  if (SOURCE_CONFIG.connectionString.includes('supabase.co') || DEST_CONFIG.connectionString.includes('supabase.co')) {
    throw new Error('SAFETY VIOLATION: Remote database URL detected! Aborting.');
  }

  const srcClient = new Client(SOURCE_CONFIG);
  const destClient = new Client(DEST_CONFIG);

  await srcClient.connect();
  console.log('[CONNECTED] Source DB: localhost:5432 / kob_local');

  await destClient.connect();
  console.log('[CONNECTED] Destination DB: localhost:54322 / postgres (Local Supabase)');

  try {
    // --------------------------------------------------------------------------
    // 1. MIGRATE AUTH USERS INTO GOTRUE AUTH (auth.users and auth.identities)
    // --------------------------------------------------------------------------
    console.log('\n--- 1. Migrating 17 Auth Users into GoTrue ---');
    const usersJsonPath = path.resolve('exports/01_auth_users.json');
    const usersData = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));
    console.log(`Loaded ${usersData.length} users from exports/01_auth_users.json`);

    for (const u of usersData) {
      // 1. Insert into auth.users preserving exact UUID
      const userRes = await destClient.query(
        `INSERT INTO auth.users (
          id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at,
          recovery_token, recovery_sent_at, email_change_token_new, email_change,
          email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
          is_super_admin, created_at, updated_at, phone, phone_confirmed_at,
          email_change_token_current, email_change_confirm_status,
          banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user,
          deleted_at, is_anonymous
        ) VALUES (
          $1, '00000000-0000-0000-0000-000000000000', $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16, $17,
          $18, $19, $20, $21, $22,
          $23, $24,
          $25, $26, $27, $28,
          $29, $30
        )
        ON CONFLICT (id) DO UPDATE SET
          encrypted_password = EXCLUDED.encrypted_password,
          email = EXCLUDED.email,
          raw_app_meta_data = EXCLUDED.raw_app_meta_data,
          raw_user_meta_data = EXCLUDED.raw_user_meta_data,
          updated_at = EXCLUDED.updated_at
        RETURNING id, email`,
        [
          u.id, u.aud || 'authenticated', u.role || 'authenticated', u.email, u.encrypted_password,
          u.email_confirmed_at, u.invited_at, u.confirmation_token || '', u.confirmation_sent_at,
          u.recovery_token || '', u.recovery_sent_at, u.email_change_token_new || '', u.email_change || '',
          u.email_change_sent_at, u.last_sign_in_at, JSON.stringify(u.raw_app_meta_data || { provider: 'email', providers: ['email'] }), JSON.stringify(u.raw_user_meta_data || {}),
          u.is_super_admin || false, u.created_at, u.updated_at, u.phone, u.phone_confirmed_at,
          u.email_change_token_current || '', u.email_change_confirm_status || 0,
          u.banned_until, u.reauthentication_token || '', u.reauthentication_sent_at, u.is_sso_user || false,
          u.deleted_at, u.is_anonymous || false
        ]
      );

      // 2. Insert into auth.identities
      const identityData = {
        sub: u.id,
        email: u.email,
        email_verified: true
      };

      await destClient.query(
        `INSERT INTO auth.identities (
          id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
        ) VALUES (
          $1::uuid, $1::uuid, $2, 'email', $1::text, $3, $4, $5
        )
        ON CONFLICT (provider, provider_id) DO UPDATE SET
          identity_data = EXCLUDED.identity_data,
          last_sign_in_at = EXCLUDED.last_sign_in_at,
          updated_at = EXCLUDED.updated_at`,
        [
          u.id,
          JSON.stringify(identityData),
          u.last_sign_in_at || u.confirmed_at || u.created_at,
          u.created_at,
          u.updated_at
        ]
      );
    }

    const authCount = await destClient.query('SELECT count(*) FROM auth.users');
    const identCount = await destClient.query('SELECT count(*) FROM auth.identities');
    console.log(`[AUTH READY] auth.users: ${authCount.rows[0].count}, auth.identities: ${identCount.rows[0].count}`);

    // --------------------------------------------------------------------------
    // 2. TRANSFER 54 PUBLIC TABLES
    // --------------------------------------------------------------------------
    console.log('\n--- 2. Transferring 54 Public Tables ---');

    // Disable triggers and constraint checks in destination session
    await destClient.query("SET session_replication_role = 'replica';");

    // Clean destination public tables
    for (const tbl of [...PUBLIC_TABLES].reverse()) {
      await destClient.query(`TRUNCATE TABLE public."${tbl}" CASCADE;`);
    }
    console.log('Truncated destination public tables for clean import.');

    let totalImportedRows = 0;

    for (let idx = 0; idx < PUBLIC_TABLES.length; idx++) {
      const tbl = PUBLIC_TABLES[idx];
      const countRes = await srcClient.query(`SELECT count(*) FROM public."${tbl}";`);
      const srcRowsCount = parseInt(countRes.rows[0].count, 10);

      if (srcRowsCount === 0) {
        console.log(`[#${String(idx + 1).padStart(2, '0')}] ${tbl.padEnd(35)}: 0 rows (empty)`);
        continue;
      }

      // Fetch all columns with data types
      const colsRes = await srcClient.query(`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [tbl]);
      const columns = colsRes.rows.map(r => r.column_name);
      const colMap = Object.fromEntries(colsRes.rows.map(r => [r.column_name, r]));
      const colList = columns.map(c => `"${c}"`).join(', ');

      // Find primary key for deterministic ordering
      const pkRes = await srcClient.query(`
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary;
      `, [`public."${tbl}"`]);
      const pkCol = pkRes.rows[0]?.attname;
      const orderClause = pkCol ? `ORDER BY "${pkCol}"` : '';

      // Dynamically calculate batch size to stay safely under PostgreSQL's 32,767 parameter limit
      const BATCH = Math.max(50, Math.min(2000, Math.floor(30000 / columns.length)));
      let inserted = 0;

      for (let offset = 0; offset < srcRowsCount; offset += BATCH) {
        const rowsRes = await srcClient.query(
          `SELECT ${colList} FROM public."${tbl}" ${orderClause} LIMIT ${BATCH} OFFSET ${offset};`
        );
        const rows = rowsRes.rows;
        if (rows.length === 0) break;

        // Build multi-row parameterized INSERT
        const valPlaceholders = [];
        const flatValues = [];
        let pIndex = 1;

        for (const row of rows) {
          const rowPlaceholders = [];
          for (const col of columns) {
            rowPlaceholders.push(`$${pIndex++}`);
            let val = row[col];
            const meta = colMap[col];
            if (meta && (meta.udt_name === 'json' || meta.udt_name === 'jsonb')) {
              if (typeof val === 'object' && val !== null) {
                val = JSON.stringify(val);
              }
            }
            flatValues.push(val);
          }
          valPlaceholders.push(`(${rowPlaceholders.join(', ')})`);
        }

        const conflictClause = pkCol ? `ON CONFLICT ("${pkCol}") DO NOTHING` : '';
        const insertQuery = `INSERT INTO public."${tbl}" (${colList}) VALUES ${valPlaceholders.join(', ')} ${conflictClause};`;
        await destClient.query(insertQuery, flatValues);
        inserted += rows.length;
      }

      totalImportedRows += inserted;
      console.log(`[#${String(idx + 1).padStart(2, '0')}] ${tbl.padEnd(35)}: ${String(inserted).padStart(6)} rows transferred`);
    }

    // Re-enable triggers and foreign key checks
    await destClient.query("SET session_replication_role = 'origin';");
    console.log('\nRestored session_replication_role to origin.');

    // --------------------------------------------------------------------------
    // 3. VERIFICATION & INTEGRITY CHECKS
    // --------------------------------------------------------------------------
    console.log('\n--- 3. Target Verification ---');
    console.log(`Total public rows imported: ${totalImportedRows}`);

    const checkCounts = [
      'kob_leads',
      'lead_stage_history',
      'lead_activities',
      'lead_events',
      'audit_logs',
      'profiles',
      'user_roles'
    ];

    for (const cTable of checkCounts) {
      const res = await destClient.query(`SELECT count(*) FROM public."${cTable}";`);
      console.log(`  ${cTable.padEnd(25)}: ${res.rows[0].count}`);
    }

    console.log('\n[SUCCESS] Transfer completed successfully!');
  } finally {
    await srcClient.end();
    await destClient.end();
  }
}

runTransfer().catch(err => {
  console.error('\n[FATAL ERROR IN TRANSFER]:', err);
  process.exit(1);
});
