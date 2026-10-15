import { type Request, type Response } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../integrations/supabase/client.js";
import { logAudit } from "../utils/audit.js";
import { computeAutoBuckets } from "./dashboard.controller.js";
import { fetchMetaSpendAndCpl } from "./meta.controller.js";
import { ensureLeadByPhone } from "../services/lead-sync.service.js";
import { config } from "../config/index.js";
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import * as publicIntakeRepo from "../repositories/publicIntake.repository.js";
import * as adminRepo from "../repositories/admin.repository.js";
import * as leadRepo from "../repositories/lead.repository.js";
import { pgClient } from "../db/pgQueryAdapter.js";
import { maybeSendWebsiteFormInitialTemplate } from "../services/websiteFormInitialSend.service.js";

// STAGE 10H: true only when DATA_BACKEND=rds (default remains "supabase").
// Used only by the specific system/public-webhook handlers migrated in this
// file (postLeadStage, postTemplateStage, postFailedFire) — every other
// handler here is untouched and keeps using supabaseAdmin exactly as before.
const useRds = () => config.dataBackend === "rds";

/** Page through PostgREST's 1000-row cap. */
async function pageAll(build: () => any) {
  const all: any[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await build().range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The dashboard sends full ISO instants built from IST day boundaries.
 * External callers usually pass plain dates ("2026-08-11"), which JS parses as
 * UTC midnight — that shifts the window 5h30m and drops the final day entirely.
 * Normalize date-only input to the IST day boundary so the API window matches
 * the dashboard's; full timestamps are honoured as given.
 */
const IST_OFFSET = "+05:30";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseBoundary(value: string | null | undefined, edge: "from" | "to"): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  const iso = DATE_ONLY.test(raw)
    ? `${raw}T${edge === "from" ? "00:00:00.000" : "23:59:59.999"}${IST_OFFSET}`
    : raw;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function buildStages(total: number, entries: Array<[string, number]>) {
  return entries.map(([stage, fired], i) => {
    // Stage counts stand on their own: the dashboard still lists movements even
    // when no lead was manually created in the window, so never zero them out.
    const value = i === 0 ? total : fired;
    return {
      stage,
      fired: value,
      not_fired: Math.max(total - value, 0),
      percentage: total > 0 ? round2((value / total) * 100) : 0,
    };
  });
}

const STAGES = ["EOI_1", "WEBINAR", "EOI_2", "FEE_PAID", "KTN_CS"] as const;

/**
 * GET /api/public/kob/conversion-funnels
 * Computes Auto & Manual conversion funnel cohort metrics for ?from=&to=
 */
export async function getConversionFunnels(req: Request, res: Response): Promise<void> {
  try {
    const fromParam = (req.query.from as string) || null;
    const toParam = (req.query.to as string) || null;
    if ((fromParam && !parseBoundary(fromParam, "from")) || (toParam && !parseBoundary(toParam, "to"))) {
      res.status(400).json({ success: false, error: "Invalid 'from' or 'to' date" });
      return;
    }
    const fromIso = parseBoundary(fromParam, "from") ?? new Date(0).toISOString();
    const toIso = parseBoundary(toParam, "to") ?? new Date().toISOString();

    // ---- AUTO funnel: identical computation to the dashboard ----
    const [auto] = await computeAutoBuckets(useRds() ? pgClient : supabaseAdmin, [{ from: fromIso, to: toIso }]);
    const autoTotal = auto ? auto.leadGenerated : 0;

    // ---- MANUAL funnel: same rules as getManualFunnel ----
    let manualTotal: number;
    let manualHist: { lead_id: string; from_stage: string | null; to_stage: string; created_at: string }[];
    if (useRds()) {
      manualTotal = await publicIntakeRepo.countManualCreateAuditLogs(fromIso, toIso);
      manualHist = await publicIntakeRepo.getManualStageHistoryInRange(fromIso, toIso);
    } else {
      const { count } = await supabaseAdmin
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("action", "lead_manual_create")
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      manualTotal = count ?? 0;

      manualHist = await pageAll(() =>
        supabaseAdmin
          .from("lead_stage_history")
          .select("lead_id, from_stage, to_stage, created_at")
          .not("changed_by", "is", null)
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .order("created_at", { ascending: true }),
      );
    }

    // Same strict sequential rules as the dashboard Manual funnel.
    const STRICT_MANUAL: Record<string, string[]> = {
      EOI_1: ["LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE"],
      WEBINAR: ["EOI_1"],
      EOI_2: ["WEBINAR"],
      FEE_PAID: ["EOI_2"],
      KTN_CS: ["FEE_PAID"],
    };
    const manualCount = (to: string) => {
      const allowed = STRICT_MANUAL[to];
      const seen = new Set<string>();
      for (const h of manualHist as any[])
        if (h.to_stage === to && h.from_stage && allowed.includes(h.from_stage))
          seen.add(h.lead_id);
      return seen.size;
    };

    const mTotal = manualTotal ?? 0;

    res.status(200).json({
      success: true,
      auto_conversion_funnel: {
        total_leads: autoTotal,
        stages: buildStages(autoTotal, [
          ["Lead Generated", autoTotal],
          ["EOI 1 Auto-Fired", auto ? auto.eoi1 : 0],
          ["Webinar Invite Sent", auto ? auto.webinarSent : 0],
          ["Webinar Attendees", auto ? auto.webinarAttended : 0],
          ["EOI 2", auto ? auto.eoi2 : 0],
          ["Fee Paid", auto ? auto.feePaid : 0],
          ["Contract Signed", auto ? auto.contractSigned : 0],
        ]),
      },
      manual_conversion_funnel: {
        total_leads: mTotal,
        stages: buildStages(mTotal, [
          ["Lead Generated", mTotal],
          ["EOI 1", manualCount("EOI_1")],
          ["Webinar", manualCount("WEBINAR")],
          ["EOI 2", manualCount("EOI_2")],
          ["Fee Paid", manualCount("FEE_PAID")],
          ["Contract Signed", manualCount("KTN_CS")],
        ]),
      },
    });
  } catch (e) {
    console.error("[conversion-funnels] failed", e);
    res.status(500).json({ success: false, error: "Failed to fetch conversion funnel data" });
  }
}

/**
 * GET /api/public/kob/lead-stage-counts
 * Stage count aggregations across ?from=&to=
 */
export async function getLeadStageCounts(req: Request, res: Response): Promise<void> {
  try {
    const fromParam = (req.query.from as string) || null;
    const toParam = (req.query.to as string) || null;
    if ((fromParam && !parseBoundary(fromParam, "from")) || (toParam && !parseBoundary(toParam, "to"))) {
      res.status(400).json({ success: false, error: "Invalid 'from' or 'to' date" });
      return;
    }
    const fromIso = parseBoundary(fromParam, "from") ?? new Date(0).toISOString();
    const toIso = parseBoundary(toParam, "to") ?? new Date().toISOString();

    let total: number;
    let data: Record<string, number>;
    if (useRds()) {
      const { total: t, byStage } = await publicIntakeRepo.countLeadsByStageInRange(fromIso, toIso);
      total = t;
      data = { LEADS_GENERATED: total };
      STAGES.forEach((s) => (data[s] = byStage[s] ?? 0));
    } else {
      const countFor = async (stage?: string) => {
        let q = supabaseAdmin
          .from("kob_leads")
          .select("id", { count: "exact", head: true })
          .gte("created_at", fromIso)
          .lte("created_at", toIso);
        if (stage) q = q.eq("stage", stage as never);
        const { count, error } = await q;
        if (error) throw new Error(error.message);
        return count ?? 0;
      };

      const [t, ...stageCounts] = await Promise.all([
        countFor(),
        ...STAGES.map((s) => countFor(s)),
      ]);
      total = t;
      data = { LEADS_GENERATED: total };
      STAGES.forEach((s, i) => (data[s] = stageCounts[i] ?? 0));
    }

    res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[lead-stage-counts] failed", e);
    res.status(500).json({ success: false, error: "Failed to fetch lead stage counts" });
  }
}

/**
 * GET /api/public/metrics
 * Lead and cohort metrics, CPL, spend, and conversion calculations.
 */
export async function getMetrics(req: Request, res: Response): Promise<void> {
  const apiKey = process.env["LEAD_INTAKE_API_KEY"];
  if (!apiKey || apiKey.trim() === "") {
    res.status(500).json({ error: "LEAD_INTAKE_API_KEY not configured" });
    return;
  }
  const reqKey = req.headers["x-api-key"];
  if (!reqKey || reqKey !== apiKey) {
    res.status(401).json({ error: "Invalid or missing x-api-key header" });
    return;
  }

  const fromParam = (req.query.from as string) || null;
  const toParam = (req.query.to as string) || null;
  const from = fromParam ? new Date(fromParam) : null;
  const to = toParam ? new Date(toParam) : null;
  if ((fromParam && isNaN(from!.getTime())) || (toParam && isNaN(to!.getTime()))) {
    res.status(400).json({ error: "Invalid from/to date. Use ISO 8601." });
    return;
  }
  const fromIso = from ? from.toISOString() : null;
  const toIso = to ? to.toISOString() : null;

  const applyRange = (q: any, col: string) => {
    if (fromIso) q = q.gte(col, fromIso);
    if (toIso) q = q.lte(col, toIso);
    return q;
  };

  try {
    // LEADS GENERATED
    const leads = useRds()
      ? await publicIntakeRepo.getLeadsForMetrics(fromIso, toIso)
      : await pageAll(() =>
          applyRange(
            supabaseAdmin.from("kob_leads").select("id, stage, source_id, lead_sources(cost_per_lead)"),
            "created_at",
          ).order("created_at", { ascending: true }),
        );
    const leadIds = new Set(leads.map((l: any) => l.id as string));
    const leadsGenerated = leadIds.size;

    // CONTRACTS SIGNED — leads (from this cohort) that reached KTN_CS at any point
    const signed = new Set<string>();
    for (const l of leads as any[]) {
      if (l.stage === "KTN_CS" || l.stage === "KTN_LIVE") signed.add(l.id);
    }
    const hist = useRds()
      ? await publicIntakeRepo.getAllKtnCsStageHistory()
      : await pageAll(() =>
          supabaseAdmin
            .from("lead_stage_history")
            .select("lead_id, to_stage, created_at")
            .eq("to_stage", "KTN_CS")
            .order("created_at", { ascending: true }),
        );
    for (const h of hist as any[]) if (leadIds.has(h.lead_id)) signed.add(h.lead_id);
    const contractsSigned = signed.size;

    const conversionPercent =
      leadsGenerated > 0 ? Math.round((contractsSigned / leadsGenerated) * 1000) / 10 : 0;

    // COST PER LEAD — live Meta ad spend when configured, else source cost fallback
    let totalSpend = 0;
    const token = process.env["META_ACCESS_TOKEN"];
    if (token) {
      try {
        const meta = await fetchMetaSpendAndCpl(token, fromIso ?? undefined, toIso ?? undefined);
        totalSpend = meta.totalSpend;
      } catch (e) {
        console.error("[metrics] meta spend failed", e);
      }
    }
    if (!totalSpend) {
      totalSpend = (leads as any[]).reduce(
        (s, l: any) => s + Number(l.cost_per_lead ?? l.lead_sources?.cost_per_lead ?? 0),
        0,
      );
    }
    const costPerLead = leadsGenerated > 0 ? Math.round((totalSpend / leadsGenerated) * 100) / 100 : 0;

    res.status(200).json({
      range: { from: fromIso, to: toIso },
      leads_generated: leadsGenerated,
      contracts_signed: contractsSigned,
      conversion_percent: conversionPercent,
      cost_per_lead: costPerLead,
      total_spend: Math.round(totalSpend),
    });
  } catch (e: any) {
    console.error("[metrics] failed", e);
    res.status(500).json({ error: "Failed to compute metrics" });
  }
}

// ============================================================================
// BATCH 2 WRITE ENDPOINTS
// ============================================================================

function phoneTail(phone: string): string {
  return phone.replace(/\D+/g, "").slice(-10);
}

const EVENT_NAME = "GALLABOX_FAILED_FIRE";
const FAILED_FIRE_TEMPLATE_ID = "6a619af9797a751542542897";
const GALLABOX_DEFAULT_ACCOUNT_ID = "61adf636b0cc0c00046772c2";

function templateIdFromMessage(msg: any): string | undefined {
  return pick(msg, [
    ["whatsapp", "template", "templateId"],
    ["whatsapp", "template", "id"],
  ]);
}

async function resolveTemplateIdFromGallabox(
  supabase: any,
  messageId: string,
): Promise<{ templateId?: string; error?: string; url?: string }> {
  const { data: settings, error } = await supabase
    .from("integration_settings")
    .select("key, value")
    .in("key", [
      "gallabox_api_key",
      "gallabox_api_secret",
      "gallabox_api_key_telugu",
      "gallabox_api_secret_telugu",
      "gallabox_api_key_malayalam",
      "gallabox_api_secret_malayalam",
      "gallabox_account_id",
    ]);
  if (error) return { error: error.message };

  const map = new Map<string, string>((settings ?? []).map((s: any) => [s.key, s.value]));
  const accountId =
    map.get("gallabox_account_id") ??
    process.env.GALLABOX_ACCOUNT_ID ??
    GALLABOX_DEFAULT_ACCOUNT_ID;

  const credentials = [
    [map.get("gallabox_api_key"), map.get("gallabox_api_secret")],
    [map.get("gallabox_api_key_telugu"), map.get("gallabox_api_secret_telugu")],
    [map.get("gallabox_api_key_malayalam"), map.get("gallabox_api_secret_malayalam")],
  ].filter(([k, s]) => !!k && !!s) as [string, string][];
  if (credentials.length === 0) return { error: "Gallabox API credentials not configured" };

  const url = `https://server.gallabox.com/devapi/accounts/${accountId}/messages/${messageId}`;
  let lastError = "Gallabox message lookup failed";
  for (const [apiKey, apiSecret] of credentials) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { apiKey, apiSecret, "content-type": "application/json" },
      });
      if (!res.ok) {
        lastError = `Gallabox lookup ${res.status}`;
        continue;
      }
      const msg: any = await res.json();
      const tpl =
        templateIdFromMessage(msg) ??
        templateIdFromMessage(msg?.data ?? {}) ??
        templateIdFromMessage(msg?.message ?? {});
      if (tpl) return { templateId: tpl, url };
      lastError = "Template id not present in Gallabox message response";
    } catch (e: any) {
      lastError = e?.message ?? "Gallabox lookup error";
    }
  }
  return { error: lastError, url };
}

const failedFireBodySchema = z.record(z.any());

function pick(obj: any, paths: string[][]): string | undefined {
  for (const path of paths) {
    let cur: any = obj;
    for (const key of path) {
      if (cur == null || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = cur[key];
    }
    if (typeof cur === "string" && cur.trim()) return cur.trim();
    if (typeof cur === "number") return String(cur);
  }
  return undefined;
}

const FAILURE_TOKENS = [
  "failed_fire",
  "failed",
  "failure",
  "undelivered",
  "rejected",
  "error",
  "message_failed",
  "template_failed",
];

function isFailure(...values: (string | undefined)[]): boolean {
  return values.some((v) => {
    if (!v) return false;
    const s = v.trim().toLowerCase();
    return FAILURE_TOKENS.some((t) => s === t || s.includes(t));
  });
}

/**
 * POST /api/public/failed-fire
 * Webhook that transitions leads to FAILED_FIRE when Gallabox template delivery fails.
 */
export async function postFailedFire(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.LEAD_INTAKE_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    res.status(500).json({ success: false, error: "LEAD_INTAKE_API_KEY not configured" });
    return;
  }
  if (req.headers["x-api-key"] !== apiKey) {
    res.status(401).json({ success: false, error: "Invalid or missing x-api-key header" });
    return;
  }

  const raw = req.body;
  if (raw === undefined || raw === null || typeof raw !== "object") {
    res.status(400).json({ success: false, error: "Invalid JSON body" });
    return;
  }
  const parsed = failedFireBodySchema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid failed fire event" });
    return;
  }
  const body: any = parsed.data;

  const eventName = ((req.headers["x-event-name"] as string)?.trim()) ?? "";
  const isGallaboxFailedEvent = eventName.toLowerCase() === "message.wa.status.failed";

  const phone = pick(body, [
    ["recipient_id"],
    ["message", "recipient_id"],
    ["phone"],
    ["mobile"],
    ["to"],
    ["whatsapp"],
    ["contact", "phone"],
    ["contact", "mobile"],
    ["message", "to"],
    ["payload", "phone"],
    ["data", "phone"],
  ]);
  const status = pick(body, [
    ["status"],
    ["event"],
    ["messageStatus"],
    ["message", "status"],
    ["data", "status"],
    ["payload", "status"],
  ]);
  const event = pick(body, [["event"], ["type"], ["eventType"]]) ?? (eventName || undefined);
  const localMessageId = pick(body, [["localMessageId"], ["local_message_id"]]);
  const messageId =
    pick(body, [
      ["message_id"],
      ["messageId"],
      ["id"],
      ["message", "id"],
      ["message", "messageId"],
      ["data", "messageId"],
      ["payload", "message_id"],
    ]) ?? localMessageId;

  const firstError = Array.isArray(body.errors) ? body.errors[0] : undefined;
  const errorCode =
    firstError && (typeof firstError.code === "number" || typeof firstError.code === "string")
      ? firstError.code
      : null;
  const errorTitle = typeof firstError?.title === "string" ? firstError.title : null;
  const errorMessage = typeof firstError?.message === "string" ? firstError.message : null;

  const reason =
    pick(body, [
      ["reason"],
      ["error"],
      ["errorMessage"],
      ["failureReason"],
      ["message", "error"],
      ["data", "reason"],
    ]) ??
    errorMessage ??
    errorTitle ??
    undefined;
  const timestamp = pick(body, [["timestamp"], ["time"], ["eventAt"], ["createdAt"]]);

  if (!phone || phoneTail(phone).length < 6) {
    res.status(400).json({ success: false, error: "Invalid failed fire event" });
    return;
  }
  if (!messageId) {
    res.status(400).json({ success: false, error: "Invalid failed fire event" });
    return;
  }
  if (!isGallaboxFailedEvent && !isFailure(status, event, reason)) {
    res.status(400).json({ success: false, error: "Invalid failed fire event" });
    return;
  }

  let resolvedTemplateId: string | undefined;
  let lookupError: string | undefined;
  let lookupUrl: string | undefined;
  const gallaboxMessageId = pick(body, [["id"], ["message_id"], ["messageId"]]);
  if (gallaboxMessageId) {
    // resolveTemplateIdFromGallabox only uses .from().select().in() — pgClient
    // (the RDS shim) covers that vocabulary, so the same helper works unmodified.
    const r = await resolveTemplateIdFromGallabox(useRds() ? pgClient : supabaseAdmin, gallaboxMessageId);
    resolvedTemplateId = r.templateId;
    lookupError = r.error;
    lookupUrl = r.url;
  }
  if (resolvedTemplateId !== FAILED_FIRE_TEMPLATE_ID) {
    res.status(200).json({
      success: true,
      ignored: true,
      resolved_template_id: resolvedTemplateId ?? null,
      lookup_message_id: gallaboxMessageId ?? null,
      lookup_url: lookupUrl ?? null,
      lookup_error: lookupError ?? null,
      reason: "Failed message is not the configured Failed Fire template",
    });
    return;
  }

  if (useRds()) {
    // Idempotency
    const existing = await publicIntakeRepo.findLeadEventByPayloadMessageId(EVENT_NAME, messageId);
    if (existing) {
      res.status(200).json({
        success: true,
        already_processed: true,
        message: "Failed fire event already processed",
      });
      return;
    }

    // Resolve lead by phone tail
    const tail = phoneTail(phone);
    const candidates = await publicIntakeRepo.findLeadsByPhoneSuffix(getPool(), tail, 5);
    const match = candidates.find((l) => phoneTail(l.phone ?? "") === tail);
    if (!match) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }

    const previousStage = match.stage as string | null;

    let eventAt: string | null = null;
    if (timestamp) {
      const d = /^\d{10,13}$/.test(timestamp)
        ? new Date(timestamp.length <= 10 ? Number(timestamp) * 1000 : Number(timestamp))
        : new Date(timestamp);
      if (!isNaN(d.getTime())) eventAt = d.toISOString();
    }
    if (!eventAt && typeof firstError?.time === "string") {
      const d = new Date(firstError.time);
      if (!isNaN(d.getTime())) eventAt = d.toISOString();
    }

    try {
      await withTransaction(null, async (client) => {
        await leadRepo.insertLeadEvent(client, {
          lead_id: match.id,
          phone,
          event: EVENT_NAME,
          template: pick(body, [["template"], ["templateName"], ["message", "template"]]) ?? null,
          status: status ?? "FAILED_FIRE",
          event_at: eventAt,
          payload: {
            message_id: messageId,
            local_message_id: localMessageId ?? null,
            recipient_id: phone,
            event_name: eventName || null,
            error_code: errorCode,
            error_title: errorTitle,
            error_message: errorMessage,
            reason: reason ?? null,
            status: status ?? null,
            source: "gallabox-failed-fire-webhook",
            raw: body,
          },
        });
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message ?? "Insert failed" });
      return;
    }

    let stageUpdated = false;
    if (previousStage !== "FAILED_FIRE") {
      try {
        await withTransaction(null, async (client) => {
          await publicIntakeRepo.updateLeadStageSystem(client, match.id, "FAILED_FIRE");
        });
      } catch (e: any) {
        res.status(200).json({
          success: false,
          lead_id: match.id,
          error: `Stage update failed: ${e?.message ?? "unknown error"}`,
          event_logged: true,
        });
        return;
      }
      stageUpdated = true;
    }

    await withTransaction(null, (client) => adminRepo.insertAuditLog(client, null, "GALLABOX_FAILED_FIRE", "kob_leads", match.id, {
      source: "failed-fire-webhook",
      phone,
      message_id: messageId,
      local_message_id: localMessageId ?? null,
      event_name: eventName || null,
      error_code: errorCode,
      error_title: errorTitle,
      reason: reason ?? null,
      gallabox_status: status ?? null,
      timestamp: eventAt,
      from: previousStage,
      to: "FAILED_FIRE",
      stage_updated: stageUpdated,
    }));

    res.status(200).json({
      success: true,
      lead_id: match.id,
      stage: "FAILED_FIRE",
      previous_stage: previousStage,
      stage_updated: stageUpdated,
      message: "Failed fire recorded successfully",
    });
    return;
  }

  // Idempotency
  const { data: existing, error: existErr } = await supabaseAdmin
    .from("lead_events")
    .select("id")
    .eq("event", EVENT_NAME)
    .eq("payload->>message_id", messageId)
    .limit(1);
  if (existErr) {
    res.status(500).json({ success: false, error: existErr.message });
    return;
  }
  if (existing && existing.length > 0) {
    res.status(200).json({
      success: true,
      already_processed: true,
      message: "Failed fire event already processed",
    });
    return;
  }

  // Resolve lead by phone tail
  const tail = phoneTail(phone);
  const { data: leads, error: leadErr } = await supabaseAdmin
    .from("kob_leads")
    .select("id, phone, stage")
    .ilike("phone", `%${tail}`)
    .limit(5);
  if (leadErr) {
    res.status(500).json({ success: false, error: leadErr.message });
    return;
  }
  const match = (leads ?? []).find((l: any) => phoneTail(l.phone ?? "") === tail);
  if (!match) {
    res.status(404).json({ success: false, error: "Lead not found" });
    return;
  }

  const previousStage = match.stage as string | null;

  let eventAt: string | null = null;
  if (timestamp) {
    const d = /^\d{10,13}$/.test(timestamp)
      ? new Date(timestamp.length <= 10 ? Number(timestamp) * 1000 : Number(timestamp))
      : new Date(timestamp);
    if (!isNaN(d.getTime())) eventAt = d.toISOString();
  }
  if (!eventAt && typeof firstError?.time === "string") {
    const d = new Date(firstError.time);
    if (!isNaN(d.getTime())) eventAt = d.toISOString();
  }

  const { error: evErr } = await supabaseAdmin.from("lead_events").insert({
    lead_id: match.id,
    phone,
    event: EVENT_NAME,
    template: pick(body, [["template"], ["templateName"], ["message", "template"]]) ?? null,
    status: status ?? "FAILED_FIRE",
    event_at: eventAt,
    payload: {
      message_id: messageId,
      local_message_id: localMessageId ?? null,
      recipient_id: phone,
      event_name: eventName || null,
      error_code: errorCode,
      error_title: errorTitle,
      error_message: errorMessage,
      reason: reason ?? null,
      status: status ?? null,
      source: "gallabox-failed-fire-webhook",
      raw: body,
    },
  });
  if (evErr) {
    res.status(500).json({ success: false, error: evErr.message });
    return;
  }

  let stageUpdated = false;
  if (previousStage !== "FAILED_FIRE") {
    const { error: upErr } = await supabaseAdmin
      .from("kob_leads")
      .update({ stage: "FAILED_FIRE" as any })
      .eq("id", match.id);
    if (upErr) {
      res.status(200).json({
        success: false,
        lead_id: match.id,
        error: `Stage update failed: ${upErr.message}`,
        event_logged: true,
      });
      return;
    }
    stageUpdated = true;
  }

  await logAudit(supabaseAdmin, null, "GALLABOX_FAILED_FIRE", "kob_leads", match.id, {
    source: "failed-fire-webhook",
    phone,
    message_id: messageId,
    local_message_id: localMessageId ?? null,
    event_name: eventName || null,
    error_code: errorCode,
    error_title: errorTitle,
    reason: reason ?? null,
    gallabox_status: status ?? null,
    timestamp: eventAt,
    from: previousStage,
    to: "FAILED_FIRE",
    stage_updated: stageUpdated,
  });

  res.status(200).json({
    success: true,
    lead_id: match.id,
    stage: "FAILED_FIRE",
    previous_stage: previousStage,
    stage_updated: stageUpdated,
    message: "Failed fire recorded successfully",
  });
}

// ----------------------------------------------------------------------------
// POST /api/public/lead-stage
// ----------------------------------------------------------------------------

const ALL_STAGES = [
  "LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE", "EOI_1", "WEBINAR", "EOI_2",
  "FORM_FILLED", "FEE_PAID", "KTN_CS", "KTN_LIVE",
  "NO", "LATER", "NO_RESPONSE", "RETARGETING", "DEAD_LEAD",
] as const;

const SEQ = [
  "LEAD_INBOX", "AUTO_FIRED", "EOI_1", "WEBINAR", "EOI_2",
  "FORM_FILLED", "FEE_PAID", "KTN_CS", "KTN_LIVE",
];

const leadStageBodySchema = z
  .object({
    lead_id: z.string().uuid().optional(),
    phone: z.string().trim().min(4).max(40).optional(),
    stage: z.string().trim().min(1).max(40),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => !!(v.lead_id || v.phone), {
    message: "Provide either lead_id or phone",
  });

export async function postLeadStage(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.LEAD_INTAKE_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    res.status(500).json({ success: false, message: "LEAD_INTAKE_API_KEY not configured" });
    return;
  }
  if (req.headers["x-api-key"] !== apiKey) {
    res.status(401).json({ success: false, message: "Invalid or missing x-api-key header" });
    return;
  }

  const raw = req.body;
  if (raw === undefined || raw === null || typeof raw !== "object") {
    res.status(400).json({ success: false, message: "Invalid JSON body" });
    return;
  }
  const parsed = leadStageBodySchema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      details: parsed.error.flatten(),
    });
    return;
  }
  const { lead_id, phone, note } = parsed.data;
  const targetStage = parsed.data.stage.trim().toUpperCase();
  if (!(ALL_STAGES as readonly string[]).includes(targetStage)) {
    res.status(400).json({
      success: false,
      message: `Unknown stage "${parsed.data.stage}"`,
      allowed_stages: ALL_STAGES,
    });
    return;
  }

  if (useRds()) {
    let leadId: string | null = null;
    let previousStage: string | null = null;

    if (lead_id) {
      const row = await publicIntakeRepo.findLeadById(getPool(), lead_id);
      if (row) { leadId = row.id; previousStage = row.stage; }
    } else if (phone) {
      const tail = phoneTail(phone);
      if (tail.length < 6) {
        res.status(400).json({ success: false, message: "Phone number too short to match" });
        return;
      }
      const candidates = await publicIntakeRepo.findLeadsByPhoneSuffix(getPool(), tail, 5);
      const match = candidates.find((l) => phoneTail(l.phone ?? "") === tail);
      if (match) { leadId = match.id; previousStage = match.stage; }
    }

    if (!leadId) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }

    if (previousStage === targetStage) {
      res.status(200).json({
        success: true,
        lead_id: leadId,
        previous_stage: previousStage,
        current_stage: previousStage,
        stage_updated: false,
        message: "Lead already in target stage",
      });
      return;
    }

    const fromIdx = previousStage ? SEQ.indexOf(previousStage) : -1;
    const toIdx = SEQ.indexOf(targetStage);
    const path: string[] = [];
    if (fromIdx >= 0 && toIdx >= 0 && toIdx > fromIdx) {
      for (let i = fromIdx + 1; i <= toIdx; i++) path.push(SEQ[i]);
    } else {
      path.push(targetStage);
    }

    let walkFrom = previousStage;
    let lastError: string | null = null;
    for (const next of path) {
      try {
        // STAGE 10H: actor is NULL (withTransaction(null, ...)) — this is a
        // system/webhook write, matching supabaseAdmin's service-role calls
        // on the Supabase path, which never carry a caller JWT. Each hop is
        // its OWN transaction (business write + its audit row only), never
        // the whole walk — this intentionally preserves the existing
        // Supabase path's non-atomic, partial-walk-on-failure behavior.
        await withTransaction(null, async (client) => {
          await publicIntakeRepo.updateLeadStageSystem(client, leadId!, next);
          await adminRepo.insertAuditLog(client, null, "API_STAGE_TRANSITION", "kob_leads", leadId, {
            source: "lead-stage-api", from: walkFrom, to: next, final_target: targetStage, note: note ?? null,
          });
        });
      } catch (e: any) {
        lastError = e?.message ?? "Stage update failed";
        break;
      }
      walkFrom = next;
    }

    if (lastError) {
      res.status(200).json({
        success: false,
        lead_id: leadId,
        previous_stage: previousStage,
        current_stage: walkFrom,
        stage_updated: walkFrom !== previousStage,
        message: `Stage update failed: ${lastError}`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      lead_id: leadId,
      previous_stage: previousStage,
      current_stage: walkFrom,
      stage_updated: true,
      message: "Stage updated successfully",
    });
    return;
  }

  // Resolve lead
  let leadId: string | null = null;
  let previousStage: string | null = null;

  if (lead_id) {
    const { data, error } = await supabaseAdmin
      .from("kob_leads")
      .select("id, stage")
      .eq("id", lead_id)
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, message: error.message });
      return;
    }
    if (data) {
      leadId = data.id;
      previousStage = data.stage;
    }
  } else if (phone) {
    const tail = phoneTail(phone);
    if (tail.length < 6) {
      res.status(400).json({ success: false, message: "Phone number too short to match" });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from("kob_leads")
      .select("id, phone, stage")
      .ilike("phone", `%${tail}`)
      .limit(5);
    if (error) {
      res.status(500).json({ success: false, message: error.message });
      return;
    }
    const match = (data ?? []).find((l: any) => phoneTail(l.phone ?? "") === tail);
    if (match) {
      leadId = match.id;
      previousStage = match.stage;
    }
  }

  if (!leadId) {
    res.status(404).json({ success: false, message: "Lead not found" });
    return;
  }

  if (previousStage === targetStage) {
    res.status(200).json({
      success: true,
      lead_id: leadId,
      previous_stage: previousStage,
      current_stage: previousStage,
      stage_updated: false,
      message: "Lead already in target stage",
    });
    return;
  }

  const fromIdx = previousStage ? SEQ.indexOf(previousStage) : -1;
  const toIdx = SEQ.indexOf(targetStage);
  const path: string[] = [];
  if (fromIdx >= 0 && toIdx >= 0 && toIdx > fromIdx) {
    for (let i = fromIdx + 1; i <= toIdx; i++) path.push(SEQ[i]);
  } else {
    path.push(targetStage);
  }

  let walkFrom = previousStage;
  let lastError: string | null = null;
  for (const next of path) {
    const { error: upErr } = await supabaseAdmin
      .from("kob_leads")
      .update({ stage: next as any })
      .eq("id", leadId);
    if (upErr) {
      lastError = upErr.message;
      break;
    }
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: null,
      action: "API_STAGE_TRANSITION",
      entity: "kob_leads",
      entity_id: leadId,
      meta: {
        source: "lead-stage-api",
        from: walkFrom,
        to: next,
        final_target: targetStage,
        note: note ?? null,
      },
    });
    walkFrom = next;
  }

  if (lastError) {
    res.status(200).json({
      success: false,
      lead_id: leadId,
      previous_stage: previousStage,
      current_stage: walkFrom,
      stage_updated: walkFrom !== previousStage,
      message: `Stage update failed: ${lastError}`,
    });
    return;
  }

  res.status(200).json({
    success: true,
    lead_id: leadId,
    previous_stage: previousStage,
    current_stage: walkFrom,
    stage_updated: true,
    message: "Stage updated successfully",
  });
}

// ----------------------------------------------------------------------------
// POST /api/public/leads
// ----------------------------------------------------------------------------

const leadsBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(6).max(20),
  source: z.string().trim().min(1).max(100),
  pincode: z.string().trim().regex(/^\d{4,10}$/).optional(),
  language: z.string().trim().min(1).max(50).optional(),
});

const LANGUAGE_MAP: Record<string, string> = {
  tamil: "TAMIL",
  telugu: "TELUGU",
  malayalam: "MALAYALAM",
  hindi: "HINDI",
  bengali: "BENGALI",
  english: "ENGLISH",
  kannada: "KANNADA",
  marathi: "MARATHI",
  gujarati: "GUJARATI",
  others: "OTHERS",
  other: "OTHERS",
};

const SOURCE_ALIASES: Record<string, string> = {
  "zoho form": "Website Form",
  "zoho forms": "Website Form",
  zoho: "Website Form",
  website: "Website Form",
  "website form": "Website Form",
  web: "Website Form",
};

export async function postLeads(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.LEAD_INTAKE_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    res.status(500).json({ error: "LEAD_INTAKE_API_KEY not configured" });
    return;
  }
  if (req.headers["x-api-key"] !== apiKey) {
    res.status(401).json({ error: "Invalid or missing x-api-key header" });
    return;
  }

  const payload = req.body;
  if (payload === undefined || payload === null || typeof payload !== "object") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  const parsed = leadsBodySchema.safeParse(payload);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const { name, phone, source, pincode, language } = parsed.data;

  const mappedLanguage = language ? LANGUAGE_MAP[language.toLowerCase()] ?? null : null;

  const normalized = source.trim().replace(/\s+/g, " ");
  const alias = SOURCE_ALIASES[normalized.toLowerCase()] ?? normalized;

  let source_id: string | null = null;
  let sourceWarning: string | null = null;
  let sourceRowName: string | null = null;

  if (useRds()) {
    const { rows } = await getPool().query(`SELECT id, name FROM public.lead_sources WHERE name ILIKE $1 LIMIT 1`, [alias]);
    source_id = rows[0]?.id ?? null;
    sourceRowName = rows[0]?.name ?? null;
  } else {
    const { data: srcRow, error: srcErr } = await supabaseAdmin
      .from("lead_sources")
      .select("id, name")
      .ilike("name", alias)
      .maybeSingle();
    source_id = srcRow?.id ?? null;
    sourceRowName = srcRow?.name ?? null;
    if (!source_id && srcErr) {
      sourceWarning = `Source lookup failed for "${source}": ${srcErr.message}`;
    }
  }
  if (!source_id && !sourceWarning) {
    sourceWarning = `No active record in lead_sources matches "${source}" (normalized: "${alias}"). Lead saved with an empty Source.`;
  }

  const noteParts: string[] = [];
  if (!source_id) noteParts.push(`Source (unmatched): ${source}`);
  if (pincode) noteParts.push(`Pincode: ${pincode}`);
  if (language && !mappedLanguage) noteParts.push(`Language (unmatched): ${language}`);
  const notes = noteParts.length ? noteParts.join(" | ") : null;

  if (useRds()) {
    // Idempotency: repeated webhook deliveries of the same lead (e.g.
    // Gallabox retrying a Meta Lead Ads forward) must not create a second
    // row. mark_duplicate_lead() (BEFORE INSERT trigger) only TAGS a repeat
    // phone as DUPLICATE_LEAD after the row is already created — it doesn't
    // stop the duplicate row itself. Checking first, using the same
    // phone-tail match already used by createManualLead's clash check,
    // returns the existing lead instead of inserting a throwaway duplicate.
    const dupTail = phoneTail(phone);
    if (dupTail.length === 10) {
      const clash = await leadRepo.findPhoneClash(dupTail);
      if (clash) {
        res.status(200).json({
          id: clash.id,
          code: clash.code,
          duplicate: true,
          source: sourceRowName,
          source_id,
          message: "Lead already exists for this phone number; skipped duplicate insert",
          ...(sourceWarning ? { warning: sourceWarning } : {}),
        });
        return;
      }
    }

    let inserted: { id: string; code: string; language: string | null };
    try {
      inserted = await withTransaction(null, async (client) => {
        const last = await leadRepo.getLastManualLeadCode();
        let nextNum = 1;
        const m = /^IND-(\d+)$/.exec(last ?? "");
        if (m) nextNum = parseInt(m[1], 10) + 1;
        const code = `IND-${String(nextNum).padStart(5, "0")}`;
        const { rows } = await client.query<{ id: string; code: string; language: string | null }>(
          `INSERT INTO public.kob_leads (code, full_name, phone, source_id, notes, stage, language)
           VALUES ($1, $2, $3, $4, $5, 'LEAD_INBOX', $6)
           RETURNING id, code, language::text AS language`,
          [code, name, phone, source_id, notes, mappedLanguage ?? null],
        );
        return rows[0];
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Insert failed" });
      return;
    }

    // Website Form initial template: see websiteFormInitialSend.service.ts —
    // Node-side replacement for the Supabase trg_send_website_form_* triggers,
    // which never ran on RDS (no pg_net there). Scoped to source = Website
    // Form only; no-ops for any other source or unsupported language, and
    // never throws, so a Gallabox failure can't affect this response.
    if ((sourceRowName ?? "").trim().toLowerCase() === "website form") {
      void maybeSendWebsiteFormInitialTemplate({
        id: inserted.id,
        full_name: name,
        phone,
        language: inserted.language,
      });
    }

    res.status(201).json({
      id: inserted.id,
      code: inserted.code,
      language: inserted.language ?? null,
      source: sourceRowName,
      source_id,
      ...(sourceWarning ? { warning: sourceWarning } : {}),
    });
    return;
  }

  // Generate next IND-##### code.
  const { data: last } = await supabaseAdmin
    .from("kob_leads")
    .select("code")
    .like("code", "IND-%")
    .order("code", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextNum = 1;
  if (last?.code) {
    const m = /^IND-(\d+)$/.exec(last.code);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  const code = `IND-${String(nextNum).padStart(5, "0")}`;

  const { data: inserted, error } = await supabaseAdmin
    .from("kob_leads")
    .insert({
      code,
      full_name: name,
      phone,
      source_id,
      notes,
      stage: "LEAD_INBOX",
      ...(mappedLanguage ? { language: mappedLanguage as any } : {}),
    })
    .select("id, code, language")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json({
    id: inserted.id,
    code: inserted.code,
    language: inserted.language ?? null,
    source: sourceRowName,
    source_id,
    ...(sourceWarning ? { warning: sourceWarning } : {}),
  });
}

// ============================================================================
// POST /api/public/lead-events
// ============================================================================

const leadEventsBodySchema = z.object({
  phone: z.string().trim().min(4).max(40),
  event: z.string().trim().min(1).max(200),
  template: z.string().trim().max(300).optional(),
  status: z.string().trim().max(100).optional(),
  timestamp: z.string().trim().max(64).optional(),
  payload: z.record(z.any()).optional(),
});

function resolveTargetStage(input: {
  event: string;
  template?: string;
  status?: string;
  currentStage?: string | null;
}): string | null {
  const t = (input.template ?? "").trim().toLowerCase();
  const e = (input.event ?? "").trim().toLowerCase();
  const s = (input.status ?? "").trim().toLowerCase();

  // Failure signals no longer move leads. FAILED_FIRE has exactly one
  // automated source: /api/public/failed-fire (Gallabox template
  // 6a619af9797a751542542897). Failures here are logged only.
  if (
    e === "template_failed" ||
    s === "failed" ||
    s === "template_failed" ||
    e === "failed"
  ) {
    return null;
  }

  // Template-specific mappings (checked before generic success signal so
  // downstream drip templates route to their proper funnel stage).
  if (t.includes("talk to team") && t.includes("drip 6")) return "EOI_1";
  if (t.includes("lead qualification") && t.includes("drip 7")) return "EOI_2";
  if (
    t.includes("after video registration conversion") &&
    t.includes("drip 12")
  ) {
    return "FEE_PAID";
  }

  // Generic "first template sent/delivered" signal — promotes a brand-new
  // lead out of LEAD_INBOX into AUTO_FIRED. Only fires when the lead is
  // still in LEAD_INBOX so later delivery receipts don't rewind stages.
  const successful =
    s === "sent" ||
    s === "delivered" ||
    s === "delivered_successfully" ||
    s === "read" ||
    e === "message_sent" ||
    e === "message_delivered" ||
    e === "delivered" ||
    e === "sent";
  if (successful && input.currentStage === "LEAD_INBOX") {
    return "AUTO_FIRED";
  }

  return null;
}

export async function postLeadEvents(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.LEAD_INTAKE_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    res.status(500).json({ error: "LEAD_INTAKE_API_KEY not configured" });
    return;
  }
  if (req.headers["x-api-key"] !== apiKey) {
    res.status(401).json({ error: "Invalid or missing x-api-key header" });
    return;
  }

  const raw = req.body;
  if (raw === undefined || raw === null || typeof raw !== "object") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  const parsed = leadEventsBodySchema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten(),
    });
    return;
  }
  const { phone, event, template, status, timestamp, payload } = parsed.data;

  // Find lead by phone (tail-10 match)
  const tail = phoneTail(phone);
  let leadId: string | null = null;
  let currentStage: string | null = null;
  if (tail.length >= 6) {
    if (useRds()) {
      const m = await leadRepo.findLeadByPhoneIlike(tail);
      if (m) { leadId = m.id; currentStage = m.stage; }
    } else {
      const { data: leads } = await supabaseAdmin
        .from("kob_leads")
        .select("id, phone, stage")
        .ilike("phone", `%${tail}`)
        .limit(2);
      const m2 = (leads ?? []).find((l: any) => phoneTail(l.phone ?? "") === tail);
      if (m2) { leadId = m2.id; currentStage = m2.stage; }
    }
  }

  // A successful Gallabox template trigger is NOT proof the CRM lead
  // exists. Create/sync it here so the lead always lands in Lead Inbox.
  let leadCreated = false;
  if (!leadId) {
    const p: any = payload ?? {};
    const ensureInput = {
      phone,
      name:
        p.name ?? p.full_name ?? p.contact_name ?? p.contactName ??
        p.contact?.name ?? null,
      language: p.language ?? p.contact?.language ?? null,
      sourceName: p.source ?? p.lead_source ?? "WhatsApp Broadcast",
      origin: "gallabox-lead-events-webhook",
    };
    const ensured = useRds()
      ? await leadRepo.ensureLeadByPhoneRds(ensureInput)
      : await ensureLeadByPhone(supabaseAdmin, ensureInput);
    if (ensured.leadId) {
      leadId = ensured.leadId;
      currentStage = ensured.stage;
      leadCreated = ensured.created;
    }
  }

  // Always log the event (even if lead unknown) for audit
  let eventAt: string | null = null;
  if (timestamp) {
    const d = new Date(timestamp);
    if (!isNaN(d.getTime())) eventAt = d.toISOString();
  }

  if (useRds()) {
    try {
      await withTransaction(null, async (client) => {
        await leadRepo.insertLeadEvent(client, {
          lead_id: leadId, phone, event, template: template ?? null, status: status ?? null, event_at: eventAt, payload: payload ?? null,
        });
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Insert failed" });
      return;
    }
  } else {
    const { error: logErr } = await supabaseAdmin
      .from("lead_events")
      .insert({
        lead_id: leadId,
        phone,
        event,
        template: template ?? null,
        status: status ?? null,
        event_at: eventAt,
        payload: payload ?? null,
      });
    if (logErr) {
      res.status(500).json({ error: logErr.message });
      return;
    }
  }

  if (!leadId) {
    res.status(422).json({
      error: "Could not resolve or create a lead for this phone",
      logged: true,
    });
    return;
  }

  // Decide stage transition (walk through intermediate stages if needed)
  const target = resolveTargetStage({ event, template, status, currentStage });
  let stageUpdated: { from: string | null; to: string } | null = null;
  let stageUpdateError: string | null = null;

  if (target && target !== currentStage) {
    const fromIdx = currentStage ? SEQ.indexOf(currentStage) : -1;
    const toIdx = SEQ.indexOf(target);

    const path: string[] = [];
    if (fromIdx >= 0 && toIdx >= 0 && toIdx > fromIdx) {
      for (let i = fromIdx + 1; i <= toIdx; i++) path.push(SEQ[i]);
    } else {
      path.push(target);
    }

    let walkFrom = currentStage;
    for (const next of path) {
      const meta = {
        source: "lead-events-webhook",
        event,
        template: template ?? null,
        status: status ?? null,
        from: walkFrom,
        to: next,
        final_target: target,
      };
      if (useRds()) {
        try {
          await withTransaction(null, async (client) => {
            await leadRepo.updateLeadStageUnscoped(client, leadId!, next);
            await adminRepo.insertAuditLog(client, null, "LEAD_EVENT_STAGE_TRANSITION", "kob_leads", leadId!, meta);
          });
        } catch (e: any) {
          stageUpdateError = e?.message ?? "Stage update failed";
          break;
        }
      } else {
        const { error: upErr } = await supabaseAdmin
          .from("kob_leads")
          .update({ stage: next as any })
          .eq("id", leadId);
        if (upErr) {
          stageUpdateError = upErr.message;
          break;
        }
        await supabaseAdmin.from("audit_logs").insert({ actor_id: null, action: "LEAD_EVENT_STAGE_TRANSITION", entity: "kob_leads", entity_id: leadId, meta });
      }
      walkFrom = next;
    }

    if (!stageUpdateError) {
      stageUpdated = { from: currentStage, to: target };
    } else {
      res.status(200).json({
        ok: true,
        lead_id: leadId,
        event_logged: true,
        stage_updated: walkFrom !== currentStage,
        partial_to: walkFrom,
        stage_update_error: stageUpdateError,
      });
      return;
    }
  }

  res.status(200).json({
    ok: true,
    lead_id: leadId,
    event_logged: true,
    lead_created: leadCreated,
    stage_updated: stageUpdated !== null,
    transition: stageUpdated,
  });
}

// ============================================================================
// POST /api/public/template-stage
// ============================================================================

const templateStageBodySchema = z.object({
  phone: z.string().trim().min(4).max(40),
  template_name: z.string().trim().min(1).max(300),
  status: z.string().trim().max(100).optional(),
  timestamp: z.string().trim().max(64).optional(),
  payload: z.record(z.any()).optional(),
});

const TEMPLATE_STAGE_MAP: Record<string, string> = {
  // Initial common drip (all languages) — LEAD_INBOX, promoted on delivery
  initial_common_drip_clone_clone_clone: "LEAD_INBOX",

  // EOI_1 — customer responded to language drip 1
  tamil_drip1_kob_clone_clone_clone_clone_new_crm: "EOI_1",
  telugu_drip1_kob_clone: "EOI_1",
  malayalam_kob_drip_1_clone: "EOI_1",

  // WEBINAR — customer responded to webinar invite
  new_crm_webinar_invite_tamil: "WEBINAR",
  new_crm_webinar_invite_telugu_clone: "WEBINAR",
  new_crm_webinar_invite_malayalam_clone: "WEBINAR",

  // NO — customer received the "no_retargeting" template from Lead Inbox
  no_retargeting: "NO",

  // LATER — customer received the "later_retargeting" template from Lead Inbox
  later_retargeting: "LATER",
};

const INITIAL_TEMPLATES = new Set(["initial_common_drip_clone_clone_clone"]);

const WEBINAR_TEMPLATES = new Set([
  "new_crm_webinar_invite_tamil",
  "new_crm_webinar_invite_telugu_clone",
  "new_crm_webinar_invite_malayalam_clone",
]);

const LEAD_INBOX_ONLY_TEMPLATES = new Set<string>([]);

export async function postTemplateStage(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.LEAD_INTAKE_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    res.status(500).json({
      success: false,
      message: "LEAD_INTAKE_API_KEY not configured",
    });
    return;
  }
  if (req.headers["x-api-key"] !== apiKey) {
    res.status(401).json({
      success: false,
      message: "Invalid or missing x-api-key header",
    });
    return;
  }

  const raw = req.body;
  if (raw === undefined || raw === null || typeof raw !== "object") {
    res.status(400).json({ success: false, message: "Invalid JSON body" });
    return;
  }
  const parsed = templateStageBodySchema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      details: parsed.error.flatten(),
    });
    return;
  }
  const { phone, template_name, status, timestamp, payload } = parsed.data;

  const tplKey = template_name.trim().toLowerCase();
  let targetStage: string | null = TEMPLATE_STAGE_MAP[tplKey] ?? null;

  const statusKey = status?.trim().toLowerCase() ?? "";
  const successStatuses = new Set([
    "sent", "delivered", "delivered_successfully", "read", "success",
  ]);
  const failureStatuses = new Set([
    "failed", "failure", "undelivered", "rejected", "error",
    "template_failed",
  ]);

  if (INITIAL_TEMPLATES.has(tplKey)) {
    if (failureStatuses.has(statusKey)) targetStage = null;
    else if (successStatuses.has(statusKey)) targetStage = "AUTO_FIRED";
  }

  const laterUnconfirmed =
    tplKey === "later_retargeting" && !successStatuses.has(statusKey);
  if (laterUnconfirmed) targetStage = null;

  const noRetargetingUnconfirmed =
    tplKey === "no_retargeting" && !successStatuses.has(statusKey);
  if (noRetargetingUnconfirmed) targetStage = null;

  if (useRds()) {
    // STAGE 10H: system/webhook write — actor is always NULL, matching
    // supabaseAdmin's service-role calls. Each independent audit/update step
    // below is its own withTransaction(null, ...), mirroring the Supabase
    // path's own per-REST-call granularity (today's code already performs
    // the lead update and each audit_logs insert as separate, independent
    // calls, so this reproduces existing behavior exactly, not a new design).
    const webhookReason = targetStage
      ? "template matched stage mapping"
      : laterUnconfirmed
        ? "later_retargeting not confirmed as sent/received — no stage change applied"
        : noRetargetingUnconfirmed
          ? "no_retargeting not confirmed as sent/delivered/received — no stage change applied"
          : `no stage mapping for normalized template "${tplKey}"`;
    await withTransaction(null, (client) => adminRepo.insertAuditLog(client, null, "TEMPLATE_STAGE_WEBHOOK", "kob_leads", null, {
      source: "template-stage-webhook", phone, template_name, normalized_template_name: tplKey,
      status: status ?? null, timestamp: timestamp ?? null, payload: payload ?? null,
      resolved_target: targetStage, matched_stage: targetStage, reason: webhookReason,
    }));

    if (!targetStage) {
      if (laterUnconfirmed) {
        res.status(200).json({ success: true, template_name, stage_updated: false, message: "later_retargeting ignored — template not confirmed sent/received" });
        return;
      }
      if (noRetargetingUnconfirmed) {
        res.status(200).json({ success: true, template_name, stage_updated: false, message: "no_retargeting ignored — template not confirmed sent/delivered/received" });
        return;
      }
      res.status(400).json({ success: false, template_name, message: `No stage mapping for template "${template_name}"` });
      return;
    }

    const tail = phoneTail(phone);
    if (tail.length < 6) {
      res.status(400).json({ success: false, template_name, message: "Phone number too short to match" });
      return;
    }

    const leads = await publicIntakeRepo.findLeadsByPhoneSuffix(getPool(), tail, 20, true);
    const candidates = leads.filter((l) => phoneTail(l.phone ?? "") === tail);
    const match = candidates[0];
    if (candidates.length > 1) {
      await withTransaction(null, (client) => adminRepo.insertAuditLog(client, null, "TEMPLATE_STAGE_DUPLICATE_PHONE", "kob_leads", match?.id ?? null, {
        source: "template-stage-webhook", phone, template_name, matched_stage: targetStage,
        chosen_lead_id: match?.id ?? null,
        duplicates: candidates.map((l) => ({ id: l.id, stage: l.stage, language: l.language, created_at: l.created_at })),
        reason: "multiple leads share this phone; newest selected",
      }));
    }
    if (!match) {
      res.status(404).json({ success: false, template_name, message: "Lead not found for phone" });
      return;
    }

    const leadId: string = match.id;
    const previousStage: string = match.stage;

    const prevIdx = SEQ.indexOf(previousStage);
    const tgtIdx = SEQ.indexOf(targetStage);
    if (previousStage === targetStage || (prevIdx >= 0 && tgtIdx >= 0 && tgtIdx < prevIdx)) {
      const reason = previousStage === targetStage
        ? "already in target stage — no duplicate history written"
        : "lead already past target stage — duplicate/out-of-order event ignored";
      await withTransaction(null, (client) => adminRepo.insertAuditLog(client, null, "TEMPLATE_STAGE_RESULT", "kob_leads", leadId, {
        source: "template-stage-webhook", phone, template_name, normalized_template_name: tplKey, mapping_found: true,
        matched_stage: targetStage, previous_stage: previousStage, current_stage: previousStage, stage_updated: false, reason,
      }));
      res.status(200).json({
        success: true, lead_id: leadId, template_name, previous_stage: previousStage, current_stage: previousStage,
        stage_updated: false,
        message: previousStage === targetStage ? "Lead already in target stage" : "Lead already past target stage — ignored duplicate event",
      });
      return;
    }

    if (WEBINAR_TEMPLATES.has(tplKey) && previousStage !== "EOI_1") {
      await withTransaction(null, (client) => adminRepo.insertAuditLog(client, null, "TEMPLATE_STAGE_RESULT", "kob_leads", leadId, {
        source: "template-stage-webhook", phone, template_name, normalized_template_name: tplKey, mapping_found: true,
        matched_stage: targetStage, target_stage: targetStage, previous_stage: previousStage, current_stage: previousStage,
        stage_updated: false, reason: "webinar template requires lead to be in EOI_1; no stage change applied",
      }));
      res.status(200).json({
        success: true, lead_id: leadId, template_name, previous_stage: previousStage, target_stage: targetStage,
        current_stage: previousStage, stage_updated: false, message: "Webinar template ignored — lead is not in EOI_1 yet",
      });
      return;
    }

    if (LEAD_INBOX_ONLY_TEMPLATES.has(tplKey) && previousStage !== "LEAD_INBOX") {
      await withTransaction(null, (client) => adminRepo.insertAuditLog(client, null, "TEMPLATE_STAGE_RESULT", "kob_leads", leadId, {
        source: "template-stage-webhook", phone, template_name, normalized_template_name: tplKey, mapping_found: true,
        matched_stage: targetStage, target_stage: targetStage, previous_stage: previousStage, current_stage: previousStage,
        stage_updated: false, reason: "template requires lead to be in LEAD_INBOX; no stage change applied",
      }));
      res.status(200).json({
        success: true, lead_id: leadId, template_name, previous_stage: previousStage, target_stage: targetStage,
        current_stage: previousStage, stage_updated: false, message: "Template ignored — lead is not in Lead Inbox",
      });
      return;
    }

    if (tplKey === "later_retargeting" || tplKey === "no_retargeting") {
      let applied: publicIntakeRepo.RetargetingApplyResult | null = null;
      let rpcErr: string | null = null;
      try {
        // Calls the unmodified RPC inside this transaction so its
        // set_config('app.later_retargeting'/'app.no_retargeting', 'on', true)
        // is visible to validate_stage_transition for the UPDATE it performs
        // internally — exactly matching the Supabase path's single RPC call.
        applied = await withTransaction(null, (client) =>
          tplKey === "later_retargeting"
            ? publicIntakeRepo.applyLaterRetargeting(client, leadId)
            : publicIntakeRepo.applyNoRetargeting(client, leadId),
        );
      } catch (e: any) {
        rpcErr = e?.message ?? "RPC failed";
      }
      const stageUpdated = !rpcErr && !!applied?.updated;
      const currentStage = applied?.new_stage ?? previousStage;
      await withTransaction(null, (client) => adminRepo.insertAuditLog(client, null, "TEMPLATE_STAGE_RESULT", "kob_leads", leadId, {
        source: "template-stage-webhook", phone, template_name, normalized_template_name: tplKey, mapping_found: true,
        matched_stage: targetStage, target_stage: targetStage, previous_stage: previousStage, current_stage: currentStage,
        stage_updated: stageUpdated, error: rpcErr,
      }));
      if (rpcErr) {
        res.status(200).json({
          success: false, lead_id: leadId, template_name, previous_stage: previousStage, target_stage: targetStage,
          current_stage: previousStage, stage_updated: false, message: `Stage update failed: ${rpcErr}`,
        });
        return;
      }
      res.status(200).json({
        success: true, lead_id: leadId, template_name, previous_stage: previousStage, target_stage: targetStage,
        current_stage: currentStage, stage_updated: stageUpdated,
        message: stageUpdated ? "Stage updated successfully" : "Lead already in target stage",
      });
      return;
    }

    const fromIdx = SEQ.indexOf(previousStage);
    const toIdx = SEQ.indexOf(targetStage);
    const path: string[] = [];
    if (fromIdx >= 0 && toIdx >= 0 && toIdx > fromIdx) {
      for (let i = fromIdx + 1; i <= toIdx; i++) path.push(SEQ[i]);
    } else {
      path.push(targetStage);
    }

    let walkFrom = previousStage;
    let lastError: string | null = null;
    for (const next of path) {
      try {
        await withTransaction(null, async (client) => {
          await publicIntakeRepo.updateLeadStageSystem(client, leadId, next);
          await adminRepo.insertAuditLog(client, null, "TEMPLATE_STAGE_TRANSITION", "kob_leads", leadId, {
            source: "template-stage-webhook", template_name, status: status ?? null, from: walkFrom, to: next, final_target: targetStage,
          });
        });
      } catch (e: any) {
        lastError = e?.message ?? "Stage update failed";
        break;
      }
      walkFrom = next;
    }

    const stageUpdated = walkFrom !== previousStage;
    await withTransaction(null, (client) => adminRepo.insertAuditLog(client, null, "TEMPLATE_STAGE_RESULT", "kob_leads", leadId, {
      source: "template-stage-webhook", phone, template_name, normalized_template_name: tplKey, mapping_found: true,
      matched_stage: targetStage, target_stage: targetStage, previous_stage: previousStage, current_stage: walkFrom,
      stage_updated: stageUpdated, error: lastError,
    }));

    if (lastError) {
      res.status(200).json({
        success: false, lead_id: leadId, template_name, previous_stage: previousStage, target_stage: targetStage,
        current_stage: walkFrom, stage_updated: stageUpdated, message: `Stage update failed: ${lastError}`,
      });
      return;
    }

    res.status(200).json({
      success: true, lead_id: leadId, template_name, previous_stage: previousStage, target_stage: targetStage,
      current_stage: walkFrom, stage_updated: stageUpdated, message: "Stage updated successfully",
    });
    return;
  }

  await supabaseAdmin.from("audit_logs").insert({
    actor_id: null,
    action: "TEMPLATE_STAGE_WEBHOOK",
    entity: "kob_leads",
    entity_id: null,
    meta: {
      source: "template-stage-webhook",
      phone,
      template_name,
      normalized_template_name: tplKey,
      status: status ?? null,
      timestamp: timestamp ?? null,
      payload: payload ?? null,
      resolved_target: targetStage,
      matched_stage: targetStage,
      reason: targetStage
        ? "template matched stage mapping"
        : laterUnconfirmed
          ? "later_retargeting not confirmed as sent/received — no stage change applied"
          : noRetargetingUnconfirmed
            ? "no_retargeting not confirmed as sent/delivered/received — no stage change applied"
            : `no stage mapping for normalized template "${tplKey}"`,
    },
  });

  if (!targetStage) {
    if (laterUnconfirmed) {
      res.status(200).json({
        success: true,
        template_name,
        stage_updated: false,
        message:
          "later_retargeting ignored — template not confirmed sent/received",
      });
      return;
    }
    if (noRetargetingUnconfirmed) {
      res.status(200).json({
        success: true,
        template_name,
        stage_updated: false,
        message:
          "no_retargeting ignored — template not confirmed sent/delivered/received",
      });
      return;
    }
    res.status(400).json({
      success: false,
      template_name,
      message: `No stage mapping for template "${template_name}"`,
    });
    return;
  }

  const tail = phoneTail(phone);
  if (tail.length < 6) {
    res.status(400).json({
      success: false,
      template_name,
      message: "Phone number too short to match",
    });
    return;
  }

  const { data: leads, error: findErr } = await supabaseAdmin
    .from("kob_leads")
    .select("id, phone, stage, language, created_at")
    .ilike("phone", `%${tail}`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (findErr) {
    res.status(500).json({
      success: false,
      template_name,
      message: findErr.message,
    });
    return;
  }

  const candidates = (leads ?? []).filter(
    (l: any) => phoneTail(l.phone ?? "") === tail,
  );
  const match = candidates[0];
  if (candidates.length > 1) {
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: null,
      action: "TEMPLATE_STAGE_DUPLICATE_PHONE",
      entity: "kob_leads",
      entity_id: match?.id ?? null,
      meta: {
        source: "template-stage-webhook",
        phone,
        template_name,
        matched_stage: targetStage,
        chosen_lead_id: match?.id ?? null,
        duplicates: candidates.map((l: any) => ({
          id: l.id,
          stage: l.stage,
          language: l.language,
          created_at: l.created_at,
        })),
        reason: "multiple leads share this phone; newest selected",
      },
    });
  }
  if (!match) {
    res.status(404).json({
      success: false,
      template_name,
      message: "Lead not found for phone",
    });
    return;
  }

  const leadId: string = match.id;
  const previousStage: string = match.stage;

  const prevIdx = SEQ.indexOf(previousStage);
  const tgtIdx = SEQ.indexOf(targetStage);
  if (
    previousStage === targetStage ||
    (prevIdx >= 0 && tgtIdx >= 0 && tgtIdx < prevIdx)
  ) {
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: null,
      action: "TEMPLATE_STAGE_RESULT",
      entity: "kob_leads",
      entity_id: leadId,
      meta: {
        source: "template-stage-webhook",
        phone,
        template_name,
        normalized_template_name: tplKey,
        mapping_found: true,
        matched_stage: targetStage,
        previous_stage: previousStage,
        current_stage: previousStage,
        stage_updated: false,
        reason:
          previousStage === targetStage
            ? "already in target stage — no duplicate history written"
            : "lead already past target stage — duplicate/out-of-order event ignored",
      },
    });
    res.status(200).json({
      success: true,
      lead_id: leadId,
      template_name,
      previous_stage: previousStage,
      current_stage: previousStage,
      stage_updated: false,
      message:
        previousStage === targetStage
          ? "Lead already in target stage"
          : "Lead already past target stage — ignored duplicate event",
    });
    return;
  }

  if (WEBINAR_TEMPLATES.has(tplKey) && previousStage !== "EOI_1") {
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: null,
      action: "TEMPLATE_STAGE_RESULT",
      entity: "kob_leads",
      entity_id: leadId,
      meta: {
        source: "template-stage-webhook",
        phone,
        template_name,
        normalized_template_name: tplKey,
        mapping_found: true,
        matched_stage: targetStage,
        target_stage: targetStage,
        previous_stage: previousStage,
        current_stage: previousStage,
        stage_updated: false,
        reason:
          "webinar template requires lead to be in EOI_1; no stage change applied",
      },
    });
    res.status(200).json({
      success: true,
      lead_id: leadId,
      template_name,
      previous_stage: previousStage,
      target_stage: targetStage,
      current_stage: previousStage,
      stage_updated: false,
      message: "Webinar template ignored — lead is not in EOI_1 yet",
    });
    return;
  }

  if (
    LEAD_INBOX_ONLY_TEMPLATES.has(tplKey) &&
    previousStage !== "LEAD_INBOX"
  ) {
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: null,
      action: "TEMPLATE_STAGE_RESULT",
      entity: "kob_leads",
      entity_id: leadId,
      meta: {
        source: "template-stage-webhook",
        phone,
        template_name,
        normalized_template_name: tplKey,
        mapping_found: true,
        matched_stage: targetStage,
        target_stage: targetStage,
        previous_stage: previousStage,
        current_stage: previousStage,
        stage_updated: false,
        reason:
          "template requires lead to be in LEAD_INBOX; no stage change applied",
      },
    });
    res.status(200).json({
      success: true,
      lead_id: leadId,
      template_name,
      previous_stage: previousStage,
      target_stage: targetStage,
      current_stage: previousStage,
      stage_updated: false,
      message: "Template ignored — lead is not in Lead Inbox",
    });
    return;
  }

  if (tplKey === "later_retargeting") {
    const { data: applied, error: rpcErr } = await supabaseAdmin.rpc(
      "apply_later_retargeting",
      { _lead_id: leadId },
    );
    const row = Array.isArray(applied) ? applied[0] : applied;
    const stageUpdated = !rpcErr && !!row?.updated;
    const currentStage = (row?.new_stage as string | undefined) ?? previousStage;
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: null,
      action: "TEMPLATE_STAGE_RESULT",
      entity: "kob_leads",
      entity_id: leadId,
      meta: {
        source: "template-stage-webhook",
        phone,
        template_name,
        normalized_template_name: tplKey,
        mapping_found: true,
        matched_stage: targetStage,
        target_stage: targetStage,
        previous_stage: previousStage,
        current_stage: currentStage,
        stage_updated: stageUpdated,
        error: rpcErr?.message ?? null,
      },
    });
    if (rpcErr) {
      res.status(200).json({
        success: false,
        lead_id: leadId,
        template_name,
        previous_stage: previousStage,
        target_stage: targetStage,
        current_stage: previousStage,
        stage_updated: false,
        message: `Stage update failed: ${rpcErr.message}`,
      });
      return;
    }
    res.status(200).json({
      success: true,
      lead_id: leadId,
      template_name,
      previous_stage: previousStage,
      target_stage: targetStage,
      current_stage: currentStage,
      stage_updated: stageUpdated,
      message: stageUpdated
        ? "Stage updated successfully"
        : "Lead already in target stage",
    });
    return;
  }

  if (tplKey === "no_retargeting") {
    const { data: applied, error: rpcErr } = await supabaseAdmin.rpc(
      "apply_no_retargeting",
      { _lead_id: leadId },
    );
    const row = Array.isArray(applied) ? applied[0] : applied;
    const stageUpdated = !rpcErr && !!row?.updated;
    const currentStage = (row?.new_stage as string | undefined) ?? previousStage;
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: null,
      action: "TEMPLATE_STAGE_RESULT",
      entity: "kob_leads",
      entity_id: leadId,
      meta: {
        source: "template-stage-webhook",
        phone,
        template_name,
        normalized_template_name: tplKey,
        mapping_found: true,
        matched_stage: targetStage,
        target_stage: targetStage,
        previous_stage: previousStage,
        current_stage: currentStage,
        stage_updated: stageUpdated,
        error: rpcErr?.message ?? null,
      },
    });
    if (rpcErr) {
      res.status(200).json({
        success: false,
        lead_id: leadId,
        template_name,
        previous_stage: previousStage,
        target_stage: targetStage,
        current_stage: previousStage,
        stage_updated: false,
        message: `Stage update failed: ${rpcErr.message}`,
      });
      return;
    }
    res.status(200).json({
      success: true,
      lead_id: leadId,
      template_name,
      previous_stage: previousStage,
      target_stage: targetStage,
      current_stage: currentStage,
      stage_updated: stageUpdated,
      message: stageUpdated
        ? "Stage updated successfully"
        : "Lead already in target stage",
    });
    return;
  }

  const fromIdx = SEQ.indexOf(previousStage);
  const toIdx = SEQ.indexOf(targetStage);
  const path: string[] = [];
  if (fromIdx >= 0 && toIdx >= 0 && toIdx > fromIdx) {
    for (let i = fromIdx + 1; i <= toIdx; i++) path.push(SEQ[i]);
  } else {
    path.push(targetStage);
  }

  let walkFrom = previousStage;
  let lastError: string | null = null;
  for (const next of path) {
    const { error: upErr } = await supabaseAdmin
      .from("kob_leads")
      .update({ stage: next as any })
      .eq("id", leadId);
    if (upErr) {
      lastError = upErr.message;
      break;
    }
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: null,
      action: "TEMPLATE_STAGE_TRANSITION",
      entity: "kob_leads",
      entity_id: leadId,
      meta: {
        source: "template-stage-webhook",
        template_name,
        status: status ?? null,
        from: walkFrom,
        to: next,
        final_target: targetStage,
      },
    });
    walkFrom = next;
  }

  const stageUpdated = walkFrom !== previousStage;

  await supabaseAdmin.from("audit_logs").insert({
    actor_id: null,
    action: "TEMPLATE_STAGE_RESULT",
    entity: "kob_leads",
    entity_id: leadId,
    meta: {
      source: "template-stage-webhook",
      phone,
      template_name,
      normalized_template_name: tplKey,
      mapping_found: true,
      matched_stage: targetStage,
      target_stage: targetStage,
      previous_stage: previousStage,
      current_stage: walkFrom,
      stage_updated: stageUpdated,
      error: lastError,
    },
  });

  if (lastError) {
    res.status(200).json({
      success: false,
      lead_id: leadId,
      template_name,
      previous_stage: previousStage,
      target_stage: targetStage,
      current_stage: walkFrom,
      stage_updated: stageUpdated,
      message: `Stage update failed: ${lastError}`,
    });
    return;
  }

  res.status(200).json({
    success: true,
    lead_id: leadId,
    template_name,
    previous_stage: previousStage,
    target_stage: targetStage,
    current_stage: walkFrom,
    stage_updated: stageUpdated,
    message: "Stage updated successfully",
  });
}

// ============================================================================
// POST /api/public/whatsapp-message
// ============================================================================

const KOB_SALES_CHANNEL_ID =
  process.env.GALLABOX_KOB_SALES_CHANNEL_ID || "660bdabd3a96237ad64ff6d6";

const whatsappBodySchema = z.object({
  phone: z.string().trim().min(4).max(40),
  message: z.string().trim().max(4000).optional().default(""),
  message_id: z.string().trim().max(200).optional(),
  timestamp: z.string().trim().max(64).optional(),
  direction: z.string().trim().max(32).optional().default("incoming"),
  channel_id: z.string().trim().max(120).optional(),
  payload: z.record(z.any()).optional(),
});

const REPLY_STAGE_MAP: Record<string, string> = {
  "தமிழ்": "AUTO_FIRED",
  "తెలుగు": "AUTO_FIRED",
  "മലയാളം": "AUTO_FIRED",
  "விருப்பம் உள்ளது": "EOI_1",
  "నాకు ఇష్టం ఉంది": "EOI_1",
  "താൽപര്യമുണ്ട്": "EOI_1",
  "book free live webinar": "WEBINAR",
  "book free webinar": "WEBINAR",
  "book free telugu webinar": "WEBINAR",
  "free malayalam webinar": "WEBINAR",
};

function isButtonReply(payload: any): boolean {
  const t = String(
    payload?.whatsapp?.type ?? payload?.message?.whatsapp?.type ?? "",
  ).toLowerCase();
  return t === "button" || t === "interactive";
}

function resolveReplyStage(message: string): string | null {
  const key = (message ?? "").trim();
  return REPLY_STAGE_MAP[key] ?? REPLY_STAGE_MAP[key.toLowerCase()] ?? null;
}

const LANGUAGE_BUTTON_MAP: Record<string, string> = {
  "தமிழ்": "TAMIL",
  "తెలుగు": "TELUGU",
  "മലയാളം": "MALAYALAM",
  tamil: "TAMIL",
  telugu: "TELUGU",
  malayalam: "MALAYALAM",
  english: "ENGLISH",
};

function resolveButtonLanguage(message: string): string | null {
  const key = (message ?? "").trim();
  return LANGUAGE_BUTTON_MAP[key] ?? LANGUAGE_BUTTON_MAP[key.toLowerCase()] ?? null;
}

function extractChannelId(raw: any): string | undefined {
  const cid =
    raw?.channel_id ?? raw?.channelId ?? raw?.channel?.id ?? raw?.message?.channelId ?? undefined;
  return cid ? String(cid).trim() : undefined;
}

function normalizePayload(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;
  if (raw.phone) return { ...raw, channel_id: extractChannelId(raw) };

  const wa = raw.whatsapp ?? raw.message?.whatsapp;
  if (!wa || typeof wa !== "object") return raw;

  const from = String(wa.from ?? wa.waId ?? wa.phone ?? "").trim();
  const phone = from ? (from.startsWith("+") ? from : `+${from.replace(/\D+/g, "")}`) : "";

  const text =
    wa.text?.body ??
    wa.body ??
    wa.button?.text ??
    wa.interactive?.button_reply?.title ??
    wa.interactive?.list_reply?.title ??
    raw.text?.body ??
    raw.message?.text ??
    "";

  const senderType = String(raw.senderType ?? raw.sender?.type ?? "Customer").toLowerCase();
  const direction = senderType === "customer" || senderType === "contact" ? "incoming" : "outgoing";

  return {
    phone,
    message: typeof text === "string" ? text : "",
    message_id: wa.id ?? raw.id ?? undefined,
    timestamp: wa.time ?? wa.timestamp ?? raw.time ?? undefined,
    direction,
    channel_id: extractChannelId(raw),
    payload: raw,
  };
}

export async function postWhatsappMessage(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.LEAD_INTAKE_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    res.status(500).json({ error: "LEAD_INTAKE_API_KEY not configured" });
    return;
  }
  if (req.headers["x-api-key"] !== apiKey) {
    res.status(401).json({ error: "Invalid or missing x-api-key header" });
    return;
  }

  const raw = req.body;
  if (raw === undefined || raw === null || typeof raw !== "object") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const parsed = whatsappBodySchema.safeParse(normalizePayload(raw));
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const { phone, message, message_id, timestamp, direction, channel_id, payload } = parsed.data;

  // Only the KOB Sales channel drives lead message state.
  if (channel_id && channel_id !== KOB_SALES_CHANNEL_ID) {
    res.status(200).json({ success: true, ignored: true, reason: "non_kob_sales_channel" });
    return;
  }

  let eventAt: string | null = null;
  if (timestamp) {
    const epoch = /^\d{10}$/.test(timestamp)
      ? Number(timestamp) * 1000
      : /^\d{13}$/.test(timestamp)
        ? Number(timestamp)
        : null;
    const d = epoch !== null ? new Date(epoch) : new Date(timestamp);
    if (!isNaN(d.getTime())) eventAt = d.toISOString();
  }

  // Find lead by tail-10 phone match (newest lead wins on duplicates)
  const tail = phoneTail(phone);
  let lead: any = null;
  if (tail.length >= 6) {
    if (useRds()) {
      lead = await leadRepo.findLeadByPhoneIlikeRich(tail);
    } else {
      const { data: leads, error: lookupErr } = await supabaseAdmin
        .from("kob_leads")
        .select("id, phone, stage, unread_message_count, created_at, source_id, language")
        .ilike("phone", `%${tail}`)
        .order("created_at", { ascending: false })
        .limit(5);
      if (lookupErr) console.error("[wa-webhook] lead lookup error:", lookupErr.message);
      lead = (leads ?? []).find((l: any) => phoneTail(l.phone ?? "") === tail) ?? null;
    }
  }

  // Log the message event regardless of match
  if (useRds()) {
    try {
      await withTransaction(null, async (client) => {
        await leadRepo.insertLeadEvent(client, {
          lead_id: lead?.id ?? null, phone, event: "whatsapp_message", template: null, status: direction,
          event_at: eventAt, payload: { message, message_id: message_id ?? null, direction, ...(payload ?? {}) },
        });
      });
    } catch (e: any) {
      console.error("[wa-webhook] lead_events insert failed:", e?.message);
    }
  } else {
    const { error: evErr } = await supabaseAdmin.from("lead_events").insert({
      lead_id: lead?.id ?? null,
      phone,
      event: "whatsapp_message",
      template: null,
      status: direction,
      event_at: eventAt,
      payload: { message, message_id: message_id ?? null, direction, ...(payload ?? {}) },
    });
    if (evErr) console.error("[wa-webhook] lead_events insert failed:", evErr.message);
  }

  if (!lead) {
    // KOB Sales conversation without a CRM lead: create it so the
    // contact always shows up in Lead Inbox (idempotent by phone).
    const p: any = payload ?? {};
    const ensureInput = {
      phone,
      name: p.name ?? p.contact_name ?? p.contactName ?? p.contact?.name ?? null,
      language: p.language ?? null,
      sourceName: p.source ?? "WhatsApp Broadcast",
      origin: "gallabox-whatsapp-message-webhook",
    };
    const ensured = useRds()
      ? await leadRepo.ensureLeadByPhoneRds(ensureInput)
      : await ensureLeadByPhone(supabaseAdmin, ensureInput);
    if (ensured.leadId) {
      lead = { id: ensured.leadId, unread_message_count: 0 };
      if (useRds()) {
        await withTransaction(null, async (client) => {
          await leadRepo.backfillLeadEventsLeadId(client, ensured.leadId!, phone);
        });
      } else {
        await supabaseAdmin
          .from("lead_events")
          .update({ lead_id: ensured.leadId })
          .is("lead_id", null)
          .eq("phone", phone);
      }
    } else {
      if (useRds()) {
        await withTransaction(null, async (client) => {
          await adminRepo.insertAuditLog(client, null, "WHATSAPP_MESSAGE_WEBHOOK_UNMATCHED", "kob_leads", null, { phone, message_id: message_id ?? null, direction, error: ensured.error ?? null });
        });
      } else {
        await supabaseAdmin.from("audit_logs").insert({
          actor_id: null,
          action: "WHATSAPP_MESSAGE_WEBHOOK_UNMATCHED",
          entity: "kob_leads",
          entity_id: null,
          meta: { phone, message_id: message_id ?? null, direction, error: ensured.error ?? null },
        });
      }
      res.status(422).json({ success: false, error: "Lead could not be created for phone", logged: true });
      return;
    }
  }

  const isIncoming = (direction ?? "incoming").toLowerCase() === "incoming";
  const nextCount = isIncoming ? (Number(lead.unread_message_count) || 0) + 1 : (Number(lead.unread_message_count) || 0);

  const lastMessageAt = eventAt ?? new Date().toISOString();
  const lastActivityAt = new Date().toISOString();
  const auditMeta = {
    source: "whatsapp-message-webhook",
    phone,
    message_id: message_id ?? null,
    direction,
    unread_message_count: isIncoming ? nextCount : lead.unread_message_count,
  };

  if (useRds()) {
    try {
      await withTransaction(null, async (client) => {
        await leadRepo.updateLeadMessageFields(client, lead.id, {
          last_message: message || null,
          last_message_at: lastMessageAt,
          last_activity_at: lastActivityAt,
          ...(isIncoming ? { unread_message_count: nextCount, has_unread_messages: true } : {}),
        });
        await adminRepo.insertAuditLog(client, null, "WHATSAPP_MESSAGE_RECEIVED", "kob_leads", lead.id, auditMeta);
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message ?? "Update failed" });
      return;
    }
  } else {
    const update: Record<string, unknown> = {
      last_message: message || null,
      last_message_at: lastMessageAt,
      last_activity_at: lastActivityAt,
    };
    if (isIncoming) {
      update.unread_message_count = nextCount;
      update.has_unread_messages = true;
    }

    const { error: upErr } = await supabaseAdmin
      .from("kob_leads")
      .update(update as any)
      .eq("id", lead.id);
    if (upErr) {
      res.status(500).json({ success: false, error: upErr.message });
      return;
    }

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: null,
      action: "WHATSAPP_MESSAGE_RECEIVED",
      entity: "kob_leads",
      entity_id: lead.id,
      meta: auditMeta,
    });
  }

  // ---- Language capture from the WhatsApp Broadcast language buttons ----
  const pickedLanguage =
    isIncoming && isButtonReply(payload) ? resolveButtonLanguage(message) : null;
  if (pickedLanguage && lead.source_id) {
    const sourceName = useRds()
      ? await leadRepo.getLeadSourceNameById(lead.source_id)
      : (await supabaseAdmin.from("lead_sources").select("name").eq("id", lead.source_id).maybeSingle()).data?.name;
    const isBroadcast = String(sourceName ?? "").trim().toLowerCase() === "whatsapp broadcast";
    if (isBroadcast && lead.language !== pickedLanguage) {
      const langMeta = {
        source: "whatsapp-message-webhook",
        phone,
        button: message,
        from: lead.language ?? null,
        to: pickedLanguage,
      };
      if (useRds()) {
        try {
          await withTransaction(null, async (client) => {
            await leadRepo.updateLeadLanguage(client, lead.id, pickedLanguage);
            await adminRepo.insertAuditLog(client, null, "WHATSAPP_BROADCAST_LANGUAGE_SELECTED", "kob_leads", lead.id, langMeta);
          });
        } catch { /* language capture is best-effort */ }
      } else {
        const { error: langErr } = await supabaseAdmin
          .from("kob_leads")
          .update({ language: pickedLanguage as any })
          .eq("id", lead.id);
        if (!langErr) {
          await supabaseAdmin.from("audit_logs").insert({
            actor_id: null,
            action: "WHATSAPP_BROADCAST_LANGUAGE_SELECTED",
            entity: "kob_leads",
            entity_id: lead.id,
            meta: langMeta,
          });
        }
      }
    }
  }

  // ---- Stage progression on a valid customer button reply ----
  let stageUpdated: { from: string | null; to: string } | null = null;
  let stageError: string | null = null;
  const replyTarget =
    isIncoming && isButtonReply(payload) ? resolveReplyStage(message) : null;

  if (replyTarget) {
    const freshStage = useRds()
      ? await leadRepo.getLeadStageById(lead.id)
      : (await supabaseAdmin.from("kob_leads").select("stage").eq("id", lead.id).maybeSingle()).data?.stage ?? null;
    const current = (freshStage as string | null) ?? (lead.stage as string | null) ?? null;
    const fromIdx = current ? SEQ.indexOf(current) : -1;
    const toIdx = SEQ.indexOf(replyTarget);

    if (fromIdx >= 0 && toIdx > fromIdx) {
      let walkFrom = current;
      for (let i = fromIdx + 1; i <= toIdx; i++) {
        const next = SEQ[i];
        if (useRds()) {
          try {
            await withTransaction(null, async (client) => {
              await leadRepo.updateLeadStageUnscoped(client, lead.id, next);
              await adminRepo.insertAuditLog(client, null, "WHATSAPP_REPLY_STAGE_TRANSITION", "kob_leads", lead.id, {
                source: "whatsapp-message-webhook", phone, message, from: walkFrom, to: next, final_target: replyTarget,
              });
            });
          } catch (e: any) {
            stageError = e?.message ?? "Stage update failed";
            await withTransaction(null, async (client) => {
              await adminRepo.insertAuditLog(client, null, "WHATSAPP_REPLY_STAGE_TRANSITION_FAILED", "kob_leads", lead.id, {
                source: "whatsapp-message-webhook", phone, message, from: walkFrom, attempted: next, final_target: replyTarget, error: stageError,
              });
            }).catch(() => {});
            break;
          }
        } else {
          const { error: stErr } = await supabaseAdmin
            .from("kob_leads")
            .update({ stage: next as any })
            .eq("id", lead.id);
          if (stErr) {
            stageError = stErr.message;
            await supabaseAdmin.from("audit_logs").insert({
              actor_id: null,
              action: "WHATSAPP_REPLY_STAGE_TRANSITION_FAILED",
              entity: "kob_leads",
              entity_id: lead.id,
              meta: {
                source: "whatsapp-message-webhook",
                phone,
                message,
                from: walkFrom,
                attempted: next,
                final_target: replyTarget,
                error: stErr.message,
              },
            });
            break;
          }
          await supabaseAdmin.from("audit_logs").insert({
            actor_id: null,
            action: "WHATSAPP_REPLY_STAGE_TRANSITION",
            entity: "kob_leads",
            entity_id: lead.id,
            meta: {
              source: "whatsapp-message-webhook",
              phone,
              message,
              from: walkFrom,
              to: next,
              final_target: replyTarget,
            },
          });
        }
        walkFrom = next;
      }
      if (!stageError) stageUpdated = { from: current, to: replyTarget };
    }
  }

  res.status(200).json({
    success: true,
    lead_id: lead.id,
    unread_message_count: isIncoming ? nextCount : Number(lead.unread_message_count) || 0,
    has_unread_messages: isIncoming ? true : Boolean(lead.unread_message_count),
    stage_updated: stageUpdated !== null,
    transition: stageUpdated,
    stage_update_error: stageError,
  });
}


