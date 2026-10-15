import { getPool } from "../db/pool.js";

/**
 * Node-side equivalent of Supabase's send_website_form_{tamil,telugu,malayalam}_template()
 * trigger functions — same three ledger tables, same ON CONFLICT (lead_id)
 * DO NOTHING idempotency semantics. Table name is always one of these three
 * hardcoded literals chosen by application code from a lead's language, never
 * built from request input.
 */
export type WebsiteFormSendTable =
  | "website_form_tamil_sends"
  | "website_form_telugu_sends"
  | "website_form_malayalam_sends";

const ALLOWED_TABLES: ReadonlySet<WebsiteFormSendTable> = new Set([
  "website_form_tamil_sends",
  "website_form_telugu_sends",
  "website_form_malayalam_sends",
]);

function assertTable(table: WebsiteFormSendTable): void {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Invalid website form send table: ${table}`);
  }
}

/** Mirrors `INSERT ... ON CONFLICT (lead_id) DO NOTHING RETURNING id` — null means a send already exists for this lead. */
export async function insertPendingSend(table: WebsiteFormSendTable, leadId: string): Promise<string | null> {
  assertTable(table);
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO public.${table} (lead_id, status) VALUES ($1, 'PENDING')
     ON CONFLICT (lead_id) DO NOTHING RETURNING id`,
    [leadId],
  );
  return rows[0]?.id ?? null;
}

export async function markSendFailed(table: WebsiteFormSendTable, sendId: string, error: string): Promise<void> {
  assertTable(table);
  await getPool().query(
    `UPDATE public.${table} SET status = 'FAILED', error = $2, updated_at = now() WHERE id = $1`,
    [sendId, error.slice(0, 2000)],
  );
}

export async function markSendSent(table: WebsiteFormSendTable, sendId: string, messageId: string | null): Promise<void> {
  assertTable(table);
  await getPool().query(
    `UPDATE public.${table} SET status = 'SENT', message_id = $2, sent_at = now(), updated_at = now(), error = NULL WHERE id = $1`,
    [sendId, messageId],
  );
}

export interface GallaboxCredentials { apiKey: string; apiSecret: string; channelId: string }

/** Reads from the same integration_settings table postFailedFire's Gallabox lookup already uses. */
export async function getGallaboxCredentials(): Promise<GallaboxCredentials | null> {
  const { rows } = await getPool().query<{ key: string; value: string }>(
    `SELECT key, value FROM public.integration_settings WHERE key IN ('gallabox_api_key','gallabox_api_secret','gallabox_channel_id')`,
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const apiKey = map.get("gallabox_api_key");
  const apiSecret = map.get("gallabox_api_secret");
  const channelId = map.get("gallabox_channel_id");
  if (!apiKey || !apiSecret || !channelId) return null;
  return { apiKey, apiSecret, channelId };
}
