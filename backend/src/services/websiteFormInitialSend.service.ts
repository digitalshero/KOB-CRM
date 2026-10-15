import { withTransaction } from "../db/transaction.js";
import * as adminRepo from "../repositories/admin.repository.js";
import * as websiteFormSendsRepo from "../repositories/websiteFormSends.repository.js";
import type { WebsiteFormSendTable } from "../repositories/websiteFormSends.repository.js";

/**
 * Node/Express replacement for Supabase's trg_send_website_form_{tamil,telugu,malayalam}_template
 * triggers (pg_net calls made from inside Postgres). Those triggers never ran
 * on RDS — pg_net isn't installed there — so Website Form leads in these three
 * languages received no initial template on AWS. This reproduces the exact
 * same template names, button payload, and header media from the live
 * Supabase migrations (supabase/migrations/20260810170400_*.sql [Tamil],
 * 20260810175501_*.sql [Telugu], 20260903052728_*.sql [Malayalam — supersedes
 * the original 20260810180444_*.sql]), called synchronously from Node instead
 * of asynchronously from pg_net, using the Gallabox credentials already
 * stored in integration_settings (not hardcoded).
 *
 * Deliberately scoped to only these three languages, matching this task's
 * scope — the old system also had a "default" (any other language) Website
 * Form template (send_website_form_default_template, template
 * initial_common_drip_clone_clone_clone), which this does NOT reproduce.
 */

type SupportedLanguage = "TAMIL" | "TELUGU" | "MALAYALAM";

interface TemplateConfig {
  table: WebsiteFormSendTable;
  templateName: string;
  auditAction: string;
  buttonPayload: string;
  headerMediaUrl: string;
  headerMediaName: string;
}

const GALLABOX_SEND_URL = "https://server.gallabox.com/devapi/messages/whatsapp";

const TEMPLATE_CONFIG: Record<SupportedLanguage, TemplateConfig> = {
  TAMIL: {
    table: "website_form_tamil_sends",
    templateName: "tamil_drip1_kob_clone_clone_clone_clone_new_crm",
    auditAction: "WEBSITE_FORM_TAMIL_TEMPLATE_SENT",
    buttonPayload: "விருப்பம் உள்ளது",
    headerMediaUrl:
      "https://files.gallabox.com/61adf636b0cc0c00046772c2/9bb05210-6268-40df-bad8-1735223ebe73-ChatGPTImageJun12026020737PM.png",
    headerMediaName: "ChatGPT Image Jun 1, 2026, 02_07_37 PM.png",
  },
  TELUGU: {
    table: "website_form_telugu_sends",
    templateName: "telugu_drip1_kob_clone",
    auditAction: "WEBSITE_FORM_TELUGU_TEMPLATE_SENT",
    buttonPayload: "నాకు ఇష్టం ఉంది",
    headerMediaUrl:
      "https://files.gallabox.com/61adf636b0cc0c00046772c2/c65f1c95-701a-40e3-920e-24902cba4980-9bb05210626840dfbad81735223ebe73ChatGPTImageJun12026020737PM.png",
    headerMediaName: "9bb05210-6268-40df-bad8-1735223ebe73-ChatGPTImageJun12026020737PM.png",
  },
  MALAYALAM: {
    table: "website_form_malayalam_sends",
    templateName: "malayalam_kob_drip_1_clone",
    auditAction: "WEBSITE_FORM_MALAYALAM_TEMPLATE_SENT",
    buttonPayload: "താൽപര്യമുണ്ട്",
    headerMediaUrl:
      "https://files.gallabox.com/61adf636b0cc0c00046772c2/039974d7-db95-4b5f-9eaa-7fb67ac3b452-9bb05210626840dfbad81735223ebe73ChatGPTImageJun12026020737PM.png",
    headerMediaName: "9bb05210-6268-40df-bad8-1735223ebe73-ChatGPTImageJun12026020737PM.png",
  },
};

/** Mirrors the SQL triggers' v_digits/v_phone normalization exactly. */
function normalizeGallaboxPhone(phone: string): string | null {
  const digits = (phone ?? "").replace(/\D+/g, "");
  if (digits.length === 10) return "91" + digits;
  if (digits.length >= 11) return digits;
  return null;
}

function extractGallaboxMessageId(json: any): string | null {
  const candidates = [json?.id, json?.data?.id, json?.message?.id, json?.messageId, json?.data?.messageId];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

export interface WebsiteFormLeadInput {
  id: string;
  full_name: string | null;
  phone: string;
  language: string | null;
}

/**
 * No-op for any language other than Tamil/Telugu/Malayalam, or if a send
 * already exists for this lead_id (ON CONFLICT DO NOTHING in
 * insertPendingSend — the same per-lead idempotency the old trigger had).
 * Never throws — a failed/skipped send must not affect lead creation, same
 * as the SQL triggers' own `EXCEPTION WHEN OTHERS { RETURN NEW }` guarantee.
 */
export async function maybeSendWebsiteFormInitialTemplate(lead: WebsiteFormLeadInput): Promise<void> {
  const lang = (lead.language ?? "").toUpperCase() as SupportedLanguage;
  const cfg = TEMPLATE_CONFIG[lang];
  if (!cfg) return;

  try {
    const sendId = await websiteFormSendsRepo.insertPendingSend(cfg.table, lead.id);
    if (!sendId) return; // already sent/attempted for this lead

    const phone = normalizeGallaboxPhone(lead.phone);
    if (!phone) {
      await websiteFormSendsRepo.markSendFailed(cfg.table, sendId, "invalid phone");
      return;
    }

    const creds = await websiteFormSendsRepo.getGallaboxCredentials();
    if (!creds) {
      await websiteFormSendsRepo.markSendFailed(cfg.table, sendId, "Gallabox API credentials not configured");
      return;
    }

    let res: Response;
    try {
      res = await fetch(GALLABOX_SEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apiKey: creds.apiKey,
          apiSecret: creds.apiSecret,
        },
        body: JSON.stringify({
          channelId: creds.channelId,
          channelType: "whatsapp",
          recipient: { name: (lead.full_name ?? "").trim() || "Customer", phone },
          whatsapp: {
            type: "template",
            template: {
              templateName: cfg.templateName,
              buttonValues: [
                { index: 1, sub_type: "quick_reply", parameters: { type: "payload", payload: cfg.buttonPayload } },
              ],
              headerValues: { mediaUrl: cfg.headerMediaUrl, mediaName: cfg.headerMediaName },
            },
          },
        }),
      });
    } catch (e: any) {
      await websiteFormSendsRepo.markSendFailed(cfg.table, sendId, e?.message ?? "Gallabox request error");
      return;
    }

    const json: any = await res.json().catch(() => null);
    if (!res.ok) {
      await websiteFormSendsRepo.markSendFailed(
        cfg.table,
        sendId,
        `Gallabox send failed: ${res.status} ${JSON.stringify(json)}`,
      );
      return;
    }

    const messageId = extractGallaboxMessageId(json);
    await websiteFormSendsRepo.markSendSent(cfg.table, sendId, messageId);

    await withTransaction(null, (client) =>
      adminRepo.insertAuditLog(client, null, cfg.auditAction, "kob_leads", lead.id, {
        template: cfg.templateName,
        message_id: messageId,
      }),
    );
  } catch {
    // Never let a send-pipeline bug affect the caller of postLeads.
  }
}
