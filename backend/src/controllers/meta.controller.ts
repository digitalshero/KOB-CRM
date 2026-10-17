import { type Request, type Response, type NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import { logAudit } from "../utils/audit.js";
import { config } from "../config/index.js";
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { insertAuditLog } from "../repositories/admin.repository.js";
import { resolveActorRole } from "../db/authz.js";

// STAGE 10I-C: RDS read path for getCampaignSelections() only (used by
// getMetaCampaignsList and getMetaCplForKpiCard). toggleMetaCampaignSelection
// (the write + its get_user_role authorization check) stays on Supabase.
const useRds = () => config.dataBackend === "rds";

const GRAPH_VERSION = "v21.0";
const AD_ACCOUNT_ID = "act_278974773282719";
const FALLBACK_STORE_FILE = fs.existsSync(path.resolve(process.cwd(), "..", ".meta_campaign_selections.json"))
  ? path.resolve(process.cwd(), "..", ".meta_campaign_selections.json")
  : path.resolve(process.cwd(), ".meta_campaign_selections.json");

type LocalSelectionRecord = {
  campaign_id: string;
  campaign_name?: string | null;
  is_enabled: boolean;
  updated_at: string;
  updated_by?: string | null;
};

export type MetaSpendResult = { totalSpend: number; cpl: number };

export type MetaCampaignRecord = {
  id: string;
  name: string;
  status: string;
  effective_status?: string;
  objective?: string;
  created_time?: string;
  updated_time?: string;
  spend: number;
  leads: number;
  cpl: number;
  is_enabled: boolean;
};

export type MetaCampaignsListResult = {
  campaigns: MetaCampaignRecord[];
  totalCount: number;
  account: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
  };
  summary: {
    totalCampaigns: number;
    enabledCount: number;
    combinedSpend: number;
    combinedLeads: number;
    combinedCpl: number;
  };
};

export type MetaCplResult = {
  hasEnabledCampaigns: boolean;
  enabledCount: number;
  totalSpend: number;
  totalLeads: number;
  cpl: number;
  currency: string;
  error?: string | null;
};

function readFallbackStore(): Map<string, LocalSelectionRecord> {
  const map = new Map<string, LocalSelectionRecord>();
  try {
    if (fs.existsSync(FALLBACK_STORE_FILE)) {
      const raw = fs.readFileSync(FALLBACK_STORE_FILE, "utf-8");
      const list = JSON.parse(raw) as LocalSelectionRecord[];
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.campaign_id) map.set(item.campaign_id, item);
        }
      }
    }
  } catch (err) {
    console.error("[meta-campaign-storage] failed to read fallback file", err);
  }
  return map;
}

function writeFallbackStore(map: Map<string, LocalSelectionRecord>) {
  try {
    const list = Array.from(map.values());
    fs.writeFileSync(FALLBACK_STORE_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.error("[meta-campaign-storage] failed to write fallback file", err);
  }
}

async function getCampaignSelections(supabase: any): Promise<Map<string, { is_enabled: boolean; campaign_name?: string | null }>> {
  const map = new Map<string, { is_enabled: boolean; campaign_name?: string | null }>();

  // Seed from fallback store first
  const fallback = readFallbackStore();
  for (const [id, rec] of fallback.entries()) {
    map.set(id, { is_enabled: rec.is_enabled, campaign_name: rec.campaign_name });
  }

  try {
    if (useRds()) {
      const { rows } = await getPool().query(`SELECT campaign_id, campaign_name, is_enabled FROM public.meta_campaign_selections`);
      for (const row of rows) {
        map.set(row.campaign_id, {
          is_enabled: Boolean(row.is_enabled),
          campaign_name: row.campaign_name ?? null,
        });
      }
    } else {
      const { data, error } = await supabase
        .from("meta_campaign_selections")
        .select("campaign_id, campaign_name, is_enabled");

      if (!error && Array.isArray(data)) {
        for (const row of data) {
          map.set(row.campaign_id, {
            is_enabled: Boolean(row.is_enabled),
            campaign_name: row.campaign_name ?? null,
          });
        }
      }
    }
  } catch {
    // RDS/Supabase table query failed — fallback map returned
  }

  return map;
}

async function getEnabledCampaignIds(supabase: any): Promise<string[]> {
  const selections = await getCampaignSelections(supabase);
  const enabled: string[] = [];
  for (const [id, s] of selections.entries()) {
    if (s.is_enabled) enabled.push(id);
  }
  return enabled;
}

async function saveCampaignSelection(
  supabase: any,
  campaignId: string,
  isEnabled: boolean,
  campaignName?: string | null,
  userId?: string | null,
): Promise<{ ok: boolean }> {
  // Update local fallback store
  const fallback = readFallbackStore();
  fallback.set(campaignId, {
    campaign_id: campaignId,
    campaign_name: campaignName ?? fallback.get(campaignId)?.campaign_name ?? null,
    is_enabled: isEnabled,
    updated_at: new Date().toISOString(),
    updated_by: userId ?? null,
  });
  writeFallbackStore(fallback);

  // Upsert to database
  try {
    if (useRds()) {
      await getPool().query(
        `INSERT INTO public.meta_campaign_selections (campaign_id, campaign_name, is_enabled, updated_at, updated_by)
         VALUES ($1, $2, $3, now(), $4)
         ON CONFLICT (campaign_id) DO UPDATE SET campaign_name = EXCLUDED.campaign_name, is_enabled = EXCLUDED.is_enabled,
           updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
        [campaignId, campaignName ?? null, isEnabled, userId ?? null],
      );
    } else {
      await supabase.from("meta_campaign_selections").upsert({
        campaign_id: campaignId,
        campaign_name: campaignName ?? null,
        is_enabled: isEnabled,
        updated_at: new Date().toISOString(),
        updated_by: userId ?? null,
      });
    }
  } catch (e) {
    console.warn("[meta-campaign-storage] database upsert failed, stored in fallback", e);
  }

  return { ok: true };
}

// Cached account info
let cachedAccountInfo: { name: string; currency: string; timezone: string; at: number } | null = null;

async function getAccountInfo(accessToken: string): Promise<{ name: string; currency: string; timezone: string }> {
  if (cachedAccountInfo && Date.now() - cachedAccountInfo.at < 60 * 60 * 1000) return cachedAccountInfo;
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${AD_ACCOUNT_ID}?fields=name,currency,timezone_name&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (res.ok) {
      const json = (await res.json()) as { name?: string; currency?: string; timezone_name?: string };
      cachedAccountInfo = {
        name: json.name ?? "Barottas hospitality pvt ltd",
        currency: json.currency ?? "INR",
        timezone: json.timezone_name ?? "Asia/Kolkata",
        at: Date.now(),
      };
      return cachedAccountInfo;
    }
  } catch (e) {
    console.error("[meta-ads] failed to read account info", e);
  }
  return { name: "Barottas hospitality pvt ltd", currency: "INR", timezone: "Asia/Kolkata" };
}

async function getAccountTimezone(accessToken: string): Promise<string> {
  const info = await getAccountInfo(accessToken);
  return info.timezone;
}

function dateInTimezone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function buildDateRangeParams(tz: string, since?: string, until?: string): URLSearchParams {
  const today = dateInTimezone(new Date(), tz);
  const sinceDate = since ? dateInTimezone(new Date(since), tz) : undefined;
  const untilDate = until ? dateInTimezone(new Date(until), tz) : undefined;

  const params = new URLSearchParams();
  if (sinceDate && untilDate) {
    if (sinceDate === today && untilDate === today) {
      params.set("date_preset", "today");
    } else {
      params.set("time_range", JSON.stringify({ since: sinceDate, until: untilDate }));
    }
  } else {
    params.set("date_preset", "today");
  }
  return params;
}

// Frozen Mock Data for safe local testing
const FROZEN_MOCK_ACCOUNT = {
  name: "Barottas hospitality pvt ltd",
  currency: "INR",
  timezone: "Asia/Kolkata",
};

const FROZEN_MOCK_RAW_CAMPAIGNS = [
  {
    id: "2385111111111",
    name: "Shero_Brand_Campaign_1",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    objective: "OUTCOME_LEADS",
    created_time: "2026-01-01T00:00:00Z",
    updated_time: "2026-01-02T00:00:00Z",
  },
  {
    id: "2385222222222",
    name: "Shero_App_Install_2",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    objective: "OUTCOME_LEADS",
    created_time: "2026-01-03T00:00:00Z",
    updated_time: "2026-01-04T00:00:00Z",
  },
  {
    id: "2385333333333",
    name: "Shero_Paused_3",
    status: "PAUSED",
    effective_status: "PAUSED",
    objective: "OUTCOME_LEADS",
    created_time: "2026-01-05T00:00:00Z",
    updated_time: "2026-01-06T00:00:00Z",
  },
];

const FROZEN_MOCK_INSIGHTS = new Map([
  ["2385111111111", { spend: 5000, leads: 25 }],
  ["2385222222222", { spend: 3000, leads: 10 }],
  ["2385333333333", { spend: 0, leads: 0 }],
]);

/**
 * GET /api/meta/campaigns
 * Fetches Meta Ads campaigns list with spend, leads, and selection state.
 */
export async function getMetaCampaignsList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Auth only requires req.userId (set by requireAuth for both a Supabase
    // session and an RDS/JWT session). req.supabase itself is never
    // dereferenced below when DATA_BACKEND=rds (getCampaignSelections'
    // useRds() branch ignores its supabase param), so it must not be a
    // hard requirement here — doing so 401'd every RDS-authenticated
    // request after the AUTH_BACKEND=rds cutover, since an RDS session has
    // no req.supabase by design (see auth.middleware.ts).
    if (!req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const token = process.env["META_ACCESS_TOKEN"];
    const isMock = req.headers["x-meta-mock"] === "true";

    if (!token && !isMock) {
      res.status(500).json({ error: "META_ACCESS_TOKEN is not configured in backend environment" });
      return;
    }

    const from = (req.query?.from ?? req.body?.from ?? req.body?.data?.from) as string | undefined;
    const to = (req.query?.to ?? req.body?.to ?? req.body?.data?.to) as string | undefined;
    const since = from ? from.slice(0, 10) : undefined;
    const until = to ? to.slice(0, 10) : undefined;

    if (isMock) {
      const selections = await getCampaignSelections(req.supabase);
      let combinedSpend = 0;
      let combinedLeads = 0;
      let enabledCount = 0;

      const campaigns: MetaCampaignRecord[] = FROZEN_MOCK_RAW_CAMPAIGNS.map((c) => {
        const ins = FROZEN_MOCK_INSIGHTS.get(c.id) ?? { spend: 0, leads: 0 };
        const spend = Math.round(ins.spend * 100) / 100;
        const leads = ins.leads;
        const cpl = leads > 0 ? Math.round((spend / leads) * 100) / 100 : 0;
        const isEnabled = selections.get(c.id)?.is_enabled ?? false;

        if (isEnabled) {
          enabledCount++;
          combinedSpend += spend;
          combinedLeads += leads;
        }

        return {
          id: c.id,
          name: c.name,
          status: c.status,
          effective_status: c.effective_status,
          objective: c.objective,
          created_time: c.created_time,
          updated_time: c.updated_time,
          spend,
          leads,
          cpl,
          is_enabled: isEnabled,
        };
      });

      const combinedCpl = combinedLeads > 0 ? Math.round((combinedSpend / combinedLeads) * 100) / 100 : 0;

      res.status(200).json({
        campaigns,
        totalCount: campaigns.length,
        account: {
          id: AD_ACCOUNT_ID,
          name: FROZEN_MOCK_ACCOUNT.name,
          currency: FROZEN_MOCK_ACCOUNT.currency,
          timezone: FROZEN_MOCK_ACCOUNT.timezone,
        },
        summary: {
          totalCampaigns: campaigns.length,
          enabledCount,
          combinedSpend: Math.round(combinedSpend * 100) / 100,
          combinedLeads,
          combinedCpl,
        },
      });
      return;
    }

    // Live Meta execution
    const account = await getAccountInfo(token!);
    const tz = account.timezone;

    const rawCampaigns: Array<{
      id: string;
      name: string;
      status: string;
      effective_status?: string;
      objective?: string;
      created_time?: string;
      updated_time?: string;
    }> = [];

    let nextUrl: string | null = `https://graph.facebook.com/${GRAPH_VERSION}/${AD_ACCOUNT_ID}/campaigns?fields=id,name,status,effective_status,objective,created_time,updated_time&limit=100&access_token=${encodeURIComponent(token!)}`;

    let iterations = 0;
    while (nextUrl && iterations < 10) {
      iterations++;
      const r = await fetch(nextUrl);
      if (!r.ok) {
        const errText = await r.text();
        console.error("[meta-ads] campaigns request failed", r.status, errText);
        res.status(502).json({ error: `Meta Marketing API campaigns request failed: ${r.status}` });
        return;
      }
      const json = (await r.json()) as {
        data?: typeof rawCampaigns;
        paging?: { next?: string };
      };
      if (json.data && json.data.length > 0) {
        rawCampaigns.push(...json.data);
      }
      nextUrl = json.paging?.next ?? null;
    }

    const insightsMap = new Map<string, { spend: number; leads: number }>();
    try {
      const dateParams = buildDateRangeParams(tz, since, until);
      const insightsParams = new URLSearchParams({
        level: "campaign",
        fields: "campaign_id,campaign_name,spend,actions",
        limit: "500",
        use_unified_attribution_setting: "true",
        access_token: token!,
      });
      for (const [k, v] of dateParams.entries()) {
        insightsParams.set(k, v);
      }

      let insightsUrl: string | null = `https://graph.facebook.com/${GRAPH_VERSION}/${AD_ACCOUNT_ID}/insights?${insightsParams.toString()}`;
      let insightsIters = 0;
      while (insightsUrl && insightsIters < 10) {
        insightsIters++;
        const r = await fetch(insightsUrl);
        if (!r.ok) break;
        const json = (await r.json()) as {
          data?: Array<{
            campaign_id?: string;
            spend?: string;
            actions?: Array<{ action_type: string; value: string }>;
          }>;
          paging?: { next?: string };
        };
        for (const row of json.data ?? []) {
          if (!row.campaign_id) continue;
          const rowSpend = Number(row.spend ?? 0) || 0;
          const leadHit = (row.actions ?? []).find((a) => a.action_type === "lead");
          const rowLeads = Number(leadHit?.value ?? 0) || 0;
          insightsMap.set(row.campaign_id, { spend: rowSpend, leads: rowLeads });
        }
        insightsUrl = json.paging?.next ?? null;
      }
    } catch (err) {
      console.warn("[meta-ads] failed to fetch campaign insights, continuing with 0s", err);
    }

    const selections = await getCampaignSelections(req.supabase);

    let combinedSpend = 0;
    let combinedLeads = 0;
    let enabledCount = 0;

    const campaigns: MetaCampaignRecord[] = rawCampaigns.map((c) => {
      const ins = insightsMap.get(c.id) ?? { spend: 0, leads: 0 };
      const spend = Math.round(ins.spend * 100) / 100;
      const leads = ins.leads;
      const cpl = leads > 0 ? Math.round((spend / leads) * 100) / 100 : 0;
      const isEnabled = selections.get(c.id)?.is_enabled ?? false;

      if (isEnabled) {
        enabledCount++;
        combinedSpend += spend;
        combinedLeads += leads;
      }

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        effective_status: c.effective_status,
        objective: c.objective,
        created_time: c.created_time,
        updated_time: c.updated_time,
        spend,
        leads,
        cpl,
        is_enabled: isEnabled,
      };
    });

    const combinedCpl = combinedLeads > 0 ? Math.round((combinedSpend / combinedLeads) * 100) / 100 : 0;

    res.status(200).json({
      campaigns,
      totalCount: campaigns.length,
      account: {
        id: AD_ACCOUNT_ID,
        name: account.name,
        currency: account.currency,
        timezone: account.timezone,
      },
      summary: {
        totalCampaigns: campaigns.length,
        enabledCount,
        combinedSpend: Math.round(combinedSpend * 100) / 100,
        combinedLeads,
        combinedCpl,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Retrieves total account spend and average CPL across all campaigns.
 */
export async function fetchMetaSpendAndCpl(
  accessToken: string,
  since?: string,
  until?: string,
): Promise<MetaSpendResult> {
  const tz = await getAccountTimezone(accessToken);
  const dateParams = buildDateRangeParams(tz, since, until);

  const params = new URLSearchParams({
    level: "campaign",
    fields: "spend,actions",
    limit: "500",
    use_unified_attribution_setting: "true",
    access_token: accessToken,
  });

  for (const [k, v] of dateParams.entries()) {
    params.set(k, v);
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${AD_ACCOUNT_ID}/insights?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    console.error("[meta-ads] insights request failed", res.status, body);
    throw new Error("Meta Marketing API request failed");
  }

  const json = (await res.json()) as { data?: Array<{ spend?: string; actions?: Array<{ action_type: string; value: string }> }> };
  let totalSpend = 0;
  let totalLeads = 0;
  for (const row of json.data ?? []) {
    totalSpend += Number(row.spend ?? 0) || 0;
    const hit = (row.actions ?? []).find((a) => a.action_type === "lead");
    if (hit) totalLeads += Number(hit.value ?? 0) || 0;
  }

  const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  return {
    totalSpend: Math.round(totalSpend),
    cpl: Math.round(cpl * 100) / 100,
  };
}

/**
 * GET /api/meta/spend-kpis
 * Calculates total account spend and average CPL across all campaigns.
 */
export async function getMetaSpendKpis(req: Request, res: Response, _next: NextFunction): Promise<void> {
  try {
    // See getMetaCampaignsList above — req.supabase is never used in this
    // function, so only req.userId (set for both Supabase and RDS sessions)
    // is required.
    if (!req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const token = process.env["META_ACCESS_TOKEN"];
    const isMock = req.headers["x-meta-mock"] === "true";

    if (!token && !isMock) {
      res.status(200).json({ totalSpend: 0, cpl: 0 });
      return;
    }

    const from = (req.query?.from ?? req.body?.from ?? req.body?.data?.from) as string | undefined;
    const to = (req.query?.to ?? req.body?.to ?? req.body?.data?.to) as string | undefined;
    const since = from ? from.slice(0, 10) : undefined;
    const until = to ? to.slice(0, 10) : undefined;

    if (isMock) {
      let totalSpend = 0;
      let totalLeads = 0;
      for (const ins of FROZEN_MOCK_INSIGHTS.values()) {
        totalSpend += ins.spend;
        totalLeads += ins.leads;
      }
      const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
      res.status(200).json({
        totalSpend: Math.round(totalSpend),
        cpl: Math.round(cpl * 100) / 100,
      });
      return;
    }

    try {
      const tz = await getAccountTimezone(token!);
      const dateParams = buildDateRangeParams(tz, since, until);

      const params = new URLSearchParams({
        level: "campaign",
        fields: "spend,actions",
        limit: "500",
        use_unified_attribution_setting: "true",
        access_token: token!,
      });

      for (const [k, v] of dateParams.entries()) {
        params.set(k, v);
      }

      const url = `https://graph.facebook.com/${GRAPH_VERSION}/${AD_ACCOUNT_ID}/insights?${params.toString()}`;
      const r = await fetch(url);
      if (!r.ok) {
        res.status(200).json({ totalSpend: 0, cpl: 0 });
        return;
      }

      const json = (await r.json()) as { data?: Array<{ spend?: string; actions?: Array<{ action_type: string; value: string }> }> };
      let totalSpend = 0;
      let totalLeads = 0;
      for (const row of json.data ?? []) {
        totalSpend += Number(row.spend ?? 0) || 0;
        const hit = (row.actions ?? []).find((a) => a.action_type === "lead");
        if (hit) totalLeads += Number(hit.value ?? 0) || 0;
      }

      const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
      res.status(200).json({
        totalSpend: Math.round(totalSpend),
        cpl: Math.round(cpl * 100) / 100,
      });
    } catch {
      res.status(200).json({ totalSpend: 0, cpl: 0 });
    }
  } catch {
    res.status(200).json({ totalSpend: 0, cpl: 0 });
  }
}

/**
 * GET /api/meta/cpl
 * Calculates CPL for enabled campaigns strictly for KOB Dashboard CPL card.
 */
export async function getMetaCplForKpiCard(req: Request, res: Response, _next: NextFunction): Promise<void> {
  try {
    // See getMetaCampaignsList above — getEnabledCampaignIds(req.supabase)
    // only dereferences its param when DATA_BACKEND is not "rds", so
    // req.supabase is not a hard requirement; only req.userId is.
    if (!req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const token = process.env["META_ACCESS_TOKEN"];
    const isMock = req.headers["x-meta-mock"] === "true";

    if (!token && !isMock) {
      res.status(200).json({
        hasEnabledCampaigns: false,
        enabledCount: 0,
        totalSpend: 0,
        totalLeads: 0,
        cpl: 0,
        currency: "INR",
        error: "META_ACCESS_TOKEN not configured",
      });
      return;
    }

    const from = (req.query?.from ?? req.body?.from ?? req.body?.data?.from) as string | undefined;
    const to = (req.query?.to ?? req.body?.to ?? req.body?.data?.to) as string | undefined;
    const since = from ? from.slice(0, 10) : undefined;
    const until = to ? to.slice(0, 10) : undefined;

    const enabledIds = await getEnabledCampaignIds(req.supabase);

    if (enabledIds.length === 0) {
      res.status(200).json({
        hasEnabledCampaigns: false,
        enabledCount: 0,
        totalSpend: 0,
        totalLeads: 0,
        cpl: 0,
        currency: "INR",
        error: null,
      });
      return;
    }

    if (isMock) {
      let totalSpend = 0;
      let totalLeads = 0;
      for (const id of enabledIds) {
        const ins = FROZEN_MOCK_INSIGHTS.get(id);
        if (ins) {
          totalSpend += ins.spend;
          totalLeads += ins.leads;
        }
      }
      const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
      res.status(200).json({
        hasEnabledCampaigns: true,
        enabledCount: enabledIds.length,
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalLeads,
        cpl: Math.round(cpl * 100) / 100,
        currency: "INR",
        error: null,
      });
      return;
    }

    try {
      const account = await getAccountInfo(token!);
      const tz = account.timezone;
      const dateParams = buildDateRangeParams(tz, since, until);

      const filter = JSON.stringify([{ field: "campaign.id", operator: "IN", value: enabledIds }]);

      const params = new URLSearchParams({
        level: "campaign",
        fields: "campaign_id,spend,actions",
        limit: "500",
        use_unified_attribution_setting: "true",
        filtering: filter,
        access_token: token!,
      });

      for (const [k, v] of dateParams.entries()) {
        params.set(k, v);
      }

      const url = `https://graph.facebook.com/${GRAPH_VERSION}/${AD_ACCOUNT_ID}/insights?${params.toString()}`;
      const r = await fetch(url);
      if (!r.ok) {
        const body = await r.text();
        console.error("[meta-ads] insights for enabled campaigns failed", r.status, body);
        res.status(200).json({
          hasEnabledCampaigns: true,
          enabledCount: 0,
          totalSpend: 0,
          totalLeads: 0,
          cpl: 0,
          currency: account.currency,
          error: `Meta Marketing API request failed: ${r.status}`,
        });
        return;
      }

      const json = (await r.json()) as {
        data?: Array<{ spend?: string; actions?: Array<{ action_type: string; value: string }> }>;
      };

      let totalSpend = 0;
      let totalLeads = 0;

      for (const row of json.data ?? []) {
        totalSpend += Number(row.spend ?? 0) || 0;
        const hit = (row.actions ?? []).find((a) => a.action_type === "lead");
        if (hit) totalLeads += Number(hit.value ?? 0) || 0;
      }

      const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

      res.status(200).json({
        hasEnabledCampaigns: true,
        enabledCount: enabledIds.length,
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalLeads,
        cpl: Math.round(cpl * 100) / 100,
        currency: account.currency,
        error: null,
      });
    } catch (e: any) {
      console.error("[meta-ads] failed to compute CPL for enabled campaigns", e);
      res.status(200).json({
        hasEnabledCampaigns: true,
        enabledCount: 0,
        totalSpend: 0,
        totalLeads: 0,
        cpl: 0,
        currency: "INR",
        error: e?.message || "Meta API request failed",
      });
    }
  } catch (err: any) {
    res.status(200).json({
      hasEnabledCampaigns: true,
      enabledCount: 0,
      totalSpend: 0,
      totalLeads: 0,
      cpl: 0,
      currency: "INR",
      error: err?.message || "Internal error",
    });
  }
}

/**
 * PATCH /api/meta/campaigns/:id/selection
 * Toggles a campaign's inclusion in KOB Dashboard CPL calculations.
 * Requires super_admin or kob_manager role.
 */
export async function toggleMetaCampaignSelection(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId || (!useRds() && !req.supabase)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const role = useRds()
      ? await resolveActorRole(getPool(), req.userId)
      : (await req.supabase!.rpc("get_user_role", { _user_id: req.userId })).data;
    const isAuthorized = role === "super_admin" || role === "kob_manager";

    if (!isAuthorized) {
      res.status(403).json({ error: "Forbidden: Only CEO Office or KOB Manager can change campaign selections" });
      return;
    }

    const campaignId = (req.params.id ?? req.body?.campaignId ?? req.body?.data?.campaignId) as string | undefined;
    const isEnabled = (req.body?.isEnabled ?? req.body?.data?.isEnabled) as boolean | undefined;
    const campaignName = (req.body?.campaignName ?? req.body?.data?.campaignName) as string | undefined;

    if (!campaignId || typeof campaignId !== "string") {
      res.status(400).json({ error: "campaignId is required" });
      return;
    }

    if (typeof isEnabled !== "boolean") {
      res.status(400).json({ error: "isEnabled must be a boolean" });
      return;
    }

    await saveCampaignSelection(
      req.supabase,
      campaignId,
      isEnabled,
      campaignName ?? null,
      req.userId,
    );

    if (useRds()) {
      await withTransaction(req.userId, async (client) => {
        await insertAuditLog(client, req.userId!, "toggle_campaign_kob_cpl", "meta_campaign_selections", campaignId, { is_enabled: isEnabled, campaign_name: campaignName });
      });
    } else {
      await logAudit(
        req.supabase!,
        req.userId,
        "toggle_campaign_kob_cpl",
        "meta_campaign_selections",
        campaignId,
        { is_enabled: isEnabled, campaign_name: campaignName },
      );
    }

    res.status(200).json({ ok: true, campaignId, isEnabled });
  } catch (err) {
    next(err);
  }
}
