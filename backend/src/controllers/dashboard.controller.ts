import { type Request, type Response, type NextFunction } from "express";
import { supabaseAdmin } from "../integrations/supabase/client.js";
import { config } from "../config/index.js";
import { resolveLeadScopeOrDeny } from "../db/authz.js";
import * as dashboardRepo from "../repositories/dashboard.repository.js";
import * as referenceRepo from "../repositories/reference.repository.js";
import * as funnelRepo from "../repositories/funnel.repository.js";
import * as analyticsRepo from "../repositories/analytics.repository.js";
import { pgClient } from "../db/pgQueryAdapter.js";

/**
 * STAGE 10I-B: all handlers in this file that use req.supabase directly
 * (no role resolution in the handler itself — authorization today is
 * whatever RLS already permits for req.supabase on these tables) are
 * ALREADY org-wide/unscoped in their query code. Their RDS path therefore
 * adds no new scoping beyond requireAuth — this preserves current
 * behavior exactly, it does not broaden it: kob_app_user already bypasses
 * RLS the same way supabaseAdmin does today for the role-aware handlers.
 */

// STAGE 10E2: true only when DATA_BACKEND=rds (default remains "supabase").
// Used only by the specific handler(s) migrated in this file.
const useRds = () => config.dataBackend === "rds";

export type AutoBucket = {
  leadGenerated: number;
  eoi1: number;
  webinarSent: number;
  webinarAttended: number;
  eoi2: number;
  feePaid: number;
  contractSigned: number;
};

export type Span = { from: string; to: string };

const inSpan = (ts: string, s: Span) => ts >= s.from && ts <= s.to;

const bounds = (spans: Span[]) => ({
  min: spans.reduce((a, s) => (s.from < a ? s.from : a), spans[0].from),
  max: spans.reduce((a, s) => (s.to > a ? s.to : a), spans[0].to),
});

/** PostgREST caps a single response at 1000 rows — page through it. */
const pageAll = async (build: () => any) => {
  const all: any[] = [];
  for (let page = 0; page < 60; page++) {
    const { data } = await build().range(page * 1000, page * 1000 + 999);
    const rows = (data ?? []) as any[];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
};

const AUTO_PROGRESSIONS: Array<{ key: string; to: string; from: string[] }> = [
  { key: "eoi1", to: "EOI_1", from: ["LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE"] },
  { key: "webinarSent", to: "WEBINAR", from: ["EOI_1"] },
  { key: "eoi2", to: "EOI_2", from: ["WEBINAR", "WEBINAR_ATTENDED", "EOI2_PENDING"] },
  { key: "feePaid", to: "FEE_PAID", from: ["EOI_2"] },
  { key: "contractSigned", to: "KTN_CS", from: ["FEE_PAID"] },
];

function autoProgressionKey(from: string | null, to: string | null): string | null {
  if (!from) return null;
  const p = AUTO_PROGRESSIONS.find((x) => x.to === to);
  if (!p || !p.from.includes(from)) return null;
  return p.key;
}

function makeCounter<T extends object>(spans: Span[], out: T[]) {
  const seen: Array<Record<string, Set<string>>> = spans.map(() => ({}));
  return (i: number, key: keyof T, leadId: string) => {
    const bag = (seen[i][key as string] ??= new Set<string>());
    if (bag.has(leadId)) return;
    bag.add(leadId);
    (out[i] as any)[key] += 1;
  };
}

export async function computeAutoBuckets(
  supabase: any,
  spans: Span[],
): Promise<AutoBucket[]> {
  const out: AutoBucket[] = spans.map(() => ({
    leadGenerated: 0,
    eoi1: 0,
    webinarSent: 0,
    webinarAttended: 0,
    eoi2: 0,
    feePaid: 0,
    contractSigned: 0,
  }));
  if (spans.length === 0) return out;

  // Cohort: AUTO leads generated inside each span. Every downstream stage is
  // restricted to these exact lead IDs (old leads progressing now never count).
  const { min: hMin, max: hMax } = bounds(spans);
  const cohortLeads = await pageAll(() =>
    supabase
      .from("kob_leads")
      .select("id, created_at")
      .eq("mode", "AUTO")
      .gte("created_at", hMin)
      .lte("created_at", hMax)
      .order("created_at", { ascending: true }),
  );
  const cohorts: Set<string>[] = spans.map(
    (s) => new Set(cohortLeads.filter((l: any) => inSpan(l.created_at, s)).map((l: any) => l.id)),
  );
  cohorts.forEach((c, i) => (out[i].leadGenerated = c.size));

  // Automatic moves only (changed_by IS NULL) with whitelisted origins, for
  // cohort leads — regardless of when the move happened.
  const bump = makeCounter(spans, out);
  const ids = cohortLeads.map((l: any) => l.id as string);
  for (let c = 0; c < ids.length; c += 200) {
    const chunk = ids.slice(c, c + 200);
    const hist = await pageAll(() =>
      supabase
        .from("lead_stage_history")
        .select("id, lead_id, from_stage, to_stage")
        .is("changed_by", null)
        .in("lead_id", chunk)
        .order("id", { ascending: true }),
    );
    for (const h of hist) {
      const key = autoProgressionKey(h.from_stage, h.to_stage) as keyof AutoBucket | null;
      if (!key) continue;
      cohorts.forEach((set, i) => {
        if (set.has(h.lead_id)) bump(i, key, h.lead_id);
      });
    }
  }

  // Webinar Attendees: sourced from Webinar History (status = ATTENDED).
  const { min, max } = bounds(spans);
  const historyDb = process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : supabase;
  const batches = await pageAll(() =>
    historyDb
      .from("webinar_batches")
      .select("id, scheduled_at")
      .gte("scheduled_at", min)
      .lte("scheduled_at", max)
      .order("scheduled_at", { ascending: true }),
  );
  const batchTime = new Map<string, string>(
    (batches as any[]).map((b) => [b.id, String(b.scheduled_at ?? "")]),
  );
  if (batchTime.size) {
    const batchIds = [...batchTime.keys()];
    for (let i = 0; i < batchIds.length; i += 200) {
      const chunk = batchIds.slice(i, i + 200);
      const att = await pageAll(() =>
        historyDb
          .from("webinar_attendance")
          .select("id, lead_id, batch_id")
          .eq("attended", true)
          .in("batch_id", chunk)
          .order("id", { ascending: true }),
      );
      for (const a of att as any[]) {
        const when = batchTime.get(a.batch_id) ?? "";
        spans.forEach((s, si) => {
          if (inSpan(when, s)) bump(si, "webinarAttended", a.id);
        });
      }
    }
  }

  return out;
}

const COMBINED_PROGRESSIONS = [
  { key: "eoi1", to: "EOI_1", from: ["LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE"] },
  { key: "webinar", to: "WEBINAR", from: ["EOI_1"] },
  { key: "eoi2", to: "EOI_2", from: ["WEBINAR", "WEBINAR_ATTENDED", "EOI2_PENDING"] },
  { key: "feePaid", to: "FEE_PAID", from: ["EOI_2"] },
  { key: "contractSigned", to: "KTN_CS", from: ["FEE_PAID"] },
];

function combinedProgressionKey(from: string | null, to: string | null): string | null {
  if (!from) return null;
  const p = COMBINED_PROGRESSIONS.find((x) => x.to === to);
  if (!p) return null;
  if (!p.from.includes(from)) return null;
  return p.key;
}

export async function combinedFirstEntries(
  supabase: any,
): Promise<Record<string, Map<string, string>>> {
  const out: Record<string, Map<string, string>> = {};
  for (const p of COMBINED_PROGRESSIONS) out[p.to] = new Map();
  const hist = await pageAll(() =>
    supabase
      .from("lead_stage_history")
      .select("id, lead_id, from_stage, to_stage, created_at")
      .in("to_stage", COMBINED_PROGRESSIONS.map((p) => p.to))
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  );
  for (const h of hist) {
    if (!combinedProgressionKey(h.from_stage, h.to_stage)) continue;
    const m = out[h.to_stage];
    if (!m.has(h.lead_id)) m.set(h.lead_id, h.created_at);
  }
  return out;
}

/**
 * Controller for getAbandonedFunnel.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 1223).
 */
export async function getAbandonedFunnel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    const TO = ["NO", "LATER", "NO_RESPONSE"] as const;
    const rows = useRds()
      ? await dashboardRepo.getAbandonedStageHistory([...TO], { from, to })
      : await pageAll(() => {
          let q = req.supabase!
            .from("lead_stage_history")
            .select("lead_id, from_stage, to_stage, created_at")
            .in("to_stage", TO)
            .not("from_stage", "is", null)
            .order("created_at", { ascending: true });
          if (from) q = q.gte("created_at", from);
          if (to) q = q.lte("created_at", to);
          return q;
        });

    const sets: Record<string, Set<string>> = {
      NO: new Set(),
      LATER: new Set(),
      NO_RESPONSE: new Set(),
    };
    for (const row of rows) {
      if (!row.lead_id) continue;
      const s = sets[row.to_stage as string];
      if (s) s.add(row.lead_id as string);
    }

    const IST_MS = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(Date.now() + IST_MS);
    const istDay = (iso: string) =>
      new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
    const todayIst = nowIst.toISOString().slice(0, 10);
    const days: string[] = [];
    for (let i = 1; i <= 5; i++) {
      days.push(new Date(nowIst.getTime() - i * 86400000).toISOString().slice(0, 10));
    }
    const monthStart = todayIst.slice(0, 8) + "01";
    const earliest = days[days.length - 1] < monthStart ? days[days.length - 1] : monthStart;
    const windowFrom = new Date(new Date(`${earliest}T00:00:00.000Z`).getTime() - IST_MS).toISOString();

    const tableRows = useRds()
      ? await dashboardRepo.getAbandonedStageHistory([...TO], { from: windowFrom })
      : await pageAll(() =>
          req.supabase!
            .from("lead_stage_history")
            .select("lead_id, from_stage, to_stage, created_at")
            .in("to_stage", TO as any)
            .not("from_stage", "is", null)
            .gte("created_at", windowFrom)
            .order("created_at", { ascending: true }),
        );

    const perDay: Record<string, Record<string, Set<string>>> = {};
    const perMtd: Record<string, Set<string>> = {};
    for (const t of TO) {
      perDay[t] = {};
      for (const d of days) perDay[t][d] = new Set();
      perMtd[t] = new Set();
    }
    for (const row of tableRows as any[]) {
      if (!row.lead_id) continue;
      const t = row.to_stage as string;
      if (!perDay[t]) continue;
      const day = istDay(row.created_at);
      if (perDay[t][day]) perDay[t][day].add(row.lead_id);
      if (day >= monthStart && day <= todayIst) perMtd[t].add(row.lead_id);
    }

    const table = Object.fromEntries(
      TO.map((t) => [
        t,
        { daily: days.map((d) => perDay[t][d].size), mtd: perMtd[t].size },
      ]),
    ) as Record<(typeof TO)[number], { daily: number[]; mtd: number }>;

    res.status(200).json({
      no: sets.NO.size,
      later: sets.LATER.size,
      noResponse: sets.NO_RESPONSE.size,
      days,
      table,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getAbandonedSplit.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 1372).
 */
export async function getAbandonedSplit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const asOfParam = typeof req.query.asOf === "string" ? req.query.asOf : "";
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfParam) ? asOfParam : null;

    const TO = ["NO", "LATER", "NO_RESPONSE"];
    const FROM = new Set(["LEAD_INBOX", "AUTO_FIRED", "EOI_1", "WEBINAR", "WEBINAR_ATTENDED", "EOI2_PENDING", "EOI_2"]);
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const day = asOf ?? new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
    const cutoff = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_MS + 86400000 - 1).toISOString();

    const entries = useRds()
      ? await dashboardRepo.getStageHistoryToStagesUntil(TO, cutoff)
      : await pageAll(() =>
          req.supabase!.from("lead_stage_history").select("lead_id")
            .in("to_stage", TO as any).lte("created_at", cutoff).order("created_at", { ascending: true }),
        );
    const leadIds = Array.from(new Set((entries as any[]).map((x) => x.lead_id).filter(Boolean)));
    const last = new Map<string, any>();
    for (let i = 0; i < leadIds.length; i += 200) {
      const chunk = leadIds.slice(i, i + 200);
      const rows = useRds()
        ? await dashboardRepo.getStageHistoryByLeadIdsUntil(chunk, cutoff)
        : await pageAll(() =>
            req.supabase!.from("lead_stage_history").select("lead_id, from_stage, to_stage, created_at")
              .in("lead_id", chunk).lte("created_at", cutoff).order("created_at", { ascending: true }),
          );
      for (const row of rows as any[]) last.set(row.lead_id, row);
    }
    const sets: Record<string, Set<string>> = { NO: new Set(), LATER: new Set(), NO_RESPONSE: new Set() };
    for (const [id, row] of last) {
      if (!TO.includes(row.to_stage) || !FROM.has(row.from_stage)) continue;
      sets[row.to_stage].add(id);
    }

    res.status(200).json({ asOf: day, noResponse: sets.NO_RESPONSE.size, no: sets.NO.size, later: sets.LATER.size });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getAutoFunnel.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 81).
 */
export async function getAutoFunnel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    const span: Span = {
      from: from ?? new Date(0).toISOString(),
      to: to ?? new Date().toISOString(),
    };

    if (useRds()) {
      const [b] = await computeAutoBuckets(pgClient, [span]);
      res.status(200).json({
        leadGenerated: b.leadGenerated,
        eoi1: b.eoi1,
        webinarSent: b.webinarSent,
        webinarAccepted: b.webinarAttended,
        eoi2: b.eoi2,
        feePaid: b.feePaid,
        contractSigned: b.contractSigned,
      });
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const [b] = await computeAutoBuckets(req.supabase, [span]);
    res.status(200).json({
      leadGenerated: b.leadGenerated,
      eoi1: b.eoi1,
      webinarSent: b.webinarSent,
      webinarAccepted: b.webinarAttended,
      eoi2: b.eoi2,
      feePaid: b.feePaid,
      contractSigned: b.contractSigned,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getAutoFunnelBuckets.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 26).
 */
export async function getAutoFunnelBuckets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let rawSpans: any = [];
    if (typeof req.query.spans === "string") {
      try {
        rawSpans = JSON.parse(req.query.spans);
      } catch {
        rawSpans = [];
      }
    } else if (Array.isArray(req.query.spans)) {
      rawSpans = req.query.spans;
    } else if (Array.isArray(req.body?.spans)) {
      rawSpans = req.body.spans;
    }

    const spans: Span[] = (Array.isArray(rawSpans) ? rawSpans : [])
      .slice(0, 20)
      .map((s: any) => ({
        from: String(s?.from ?? ""),
        to: String(s?.to ?? ""),
      }))
      .filter((s) => Boolean(s.from && s.to));

    if (useRds()) {
      const out = await computeAutoBuckets(pgClient, spans);
      res.status(200).json(out);
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const out = await computeAutoBuckets(req.supabase, spans);
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getBrandPerformance.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 1313).
 */
export async function getBrandPerformance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    let brands: { id: string; name: string; code: string }[];
    if (useRds()) {
      brands = await dashboardRepo.getActiveBrands();
    } else {
      const { data, error: bErr } = await req.supabase!
        .from("brands")
        .select("id, name, code")
        .eq("active", true)
        .order("code");
      if (bErr) {
        res.status(500).json({ error: bErr.message });
        return;
      }
      brands = (data ?? []) as any[];
    }

    const leads = useRds()
      ? await dashboardRepo.getLeadsBrandStage({ from, to })
      : await pageAll(() => {
          let q = req.supabase!.from("kob_leads").select("brand_id, stage");
          if (from) q = q.gte("created_at", from);
          if (to) q = q.lte("created_at", to);
          return q;
        });

    const map = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const b of (brands ?? []) as any[]) {
      const row = { brand: b.name, code: b.code, leads: 0, contracts: 0 };
      map.set(b.id, row);
      byName.set(String(b.name).trim().toLowerCase(), row);
    }
    for (const l of leads) {
      const row = l.brand_id ? map.get(l.brand_id) : undefined;
      if (!row) continue;
      row.leads++;
    }

    const ktnHist = await pageAll(() => {
      let q = req.supabase!.from("lead_stage_history").select("lead_id").eq("to_stage", "KTN_CS");
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to);
      return q;
    });
    const enteredIds = new Set<string>((ktnHist as any[]).map((h) => h.lead_id));
    const ktn = (
      await pageAll(() =>
        req.supabase!.from("kob_leads").select("id, cuisine").eq("stage", "KTN_CS").not("cuisine", "is", null),
      )
    ).filter((l: any) => enteredIds.has(l.id));

    const seen = new Set<string>();
    for (const l of ktn as any[]) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      const row = byName.get(String(l.cuisine).trim().toLowerCase());
      if (row) row.contracts++;
    }

    const result = Array.from(map.values()).map((row) => ({
      ...row,
      conv: row.leads > 0 ? Math.round((row.contracts / row.leads) * 1000) / 10 : 0,
      pending: row.leads - row.contracts,
    }));

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getCombinedFunnel.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 394).
 */
export async function getCombinedFunnel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    const pop = new Map<string, string>(); // lead id -> current stage
    let first: Record<string, Map<string, string>>;

    if (useRds()) {
      const leadRows = await dashboardRepo.getLeadsIdStage({ from, to });
      for (const l of leadRows) pop.set(l.id, l.stage);
      first = await combinedFirstEntries(pgClient);
    } else {
      if (!req.supabase) {
        res.status(500).json({ error: "Supabase client not initialized on request" });
        return;
      }
      const leadRows = await pageAll(() => {
        let q = req.supabase!.from("kob_leads").select("id, stage");
        if (from) q = q.gte("created_at", from);
        if (to) q = q.lte("created_at", to);
        return q.order("created_at", { ascending: true });
      });
      for (const l of leadRows) pop.set(l.id, l.stage);
      first = await combinedFirstEntries(req.supabase);
    }

    const inR = (ts: string) => (!from || ts >= from) && (!to || ts <= to);
    const pick = (stage: string) => {
      const s = new Set<string>();
      for (const [id, ts] of first[stage]) if (inR(ts)) s.add(id);
      return s;
    };
    const reached = {
      EOI_1: pick("EOI_1"),
      WEBINAR: pick("WEBINAR"),
      EOI_2: pick("EOI_2"),
      FEE_PAID: pick("FEE_PAID"),
      KTN_CS: pick("KTN_CS"),
    };

    const current = new Map<string, string>(pop);
    const missing = new Set<string>();
    for (const s of Object.values(reached)) for (const id of s) if (!current.has(id)) missing.add(id);
    const miss = [...missing];
    for (let i = 0; i < miss.length; i += 200) {
      const chunk = miss.slice(i, i + 200);
      const rows = useRds()
        ? await dashboardRepo.getLeadsIdStageByIds(chunk)
        : (await req.supabase!.from("kob_leads").select("id, stage").in("id", chunk)).data ?? [];
      for (const l of rows) current.set(l.id, l.stage);
    }

    const stuck = (set: Set<string>, stage: string) => {
      let n = 0;
      for (const id of set) if (current.get(id) === stage) n++;
      return n;
    };

    let leadsNotMoved = 0;
    for (const stage of pop.values()) if (stage === "LEAD_INBOX") leadsNotMoved++;

    res.status(200).json({
      leads: pop.size,
      leadsNotMoved,
      eoi1: reached.EOI_1.size,
      eoi1NotMoved: stuck(reached.EOI_1, "EOI_1"),
      webinar: reached.WEBINAR.size,
      webinarNotMoved: stuck(reached.WEBINAR, "WEBINAR"),
      eoi2: reached.EOI_2.size,
      eoi2NotMoved: stuck(reached.EOI_2, "EOI_2"),
      feePaid: reached.FEE_PAID.size,
      feePaidNotMoved: stuck(reached.FEE_PAID, "FEE_PAID"),
      contractSigned: reached.KTN_CS.size,
      contractSignedNotMoved: stuck(reached.KTN_CS, "KTN_CS"),
    });
  } catch (err) {
    next(err);
  }
}

export type CombinedBucket = {
  leadGenerated: number;
  eoi1: number;
  webinar: number;
  eoi2: number;
  feePaid: number;
  contractSigned: number;
};

const COMBINED_STAGE_KEYS: Record<string, keyof CombinedBucket> = {
  EOI_1: "eoi1",
  WEBINAR: "webinar",
  EOI_2: "eoi2",
  FEE_PAID: "feePaid",
  KTN_CS: "contractSigned",
};

export async function computeCombinedBuckets(
  supabase: any,
  spans: Span[],
): Promise<CombinedBucket[]> {
  const out: CombinedBucket[] = spans.map(() => ({
    leadGenerated: 0,
    eoi1: 0,
    webinar: 0,
    eoi2: 0,
    feePaid: 0,
    contractSigned: 0,
  }));
  if (spans.length === 0) return out;

  const { min, max } = bounds(spans);

  const leads = await pageAll(() =>
    supabase
      .from("kob_leads")
      .select("id, created_at")
      .gte("created_at", min)
      .lte("created_at", max)
      .order("created_at", { ascending: true }),
  );
  spans.forEach((s, i) => {
    out[i].leadGenerated = leads.filter((l: any) => inSpan(l.created_at, s)).length;
  });

  const first = await combinedFirstEntries(supabase);
  const bump = makeCounter(spans, out);
  for (const [stage, m] of Object.entries(first)) {
    const key = COMBINED_STAGE_KEYS[stage];
    for (const [leadId, ts] of m) {
      spans.forEach((s, i) => {
        if (inSpan(ts, s)) bump(i, key, leadId);
      });
    }
  }

  return out;
}

/**
 * Controller for getCombinedFunnelBuckets.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 44).
 */
export async function getCombinedFunnelBuckets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let rawSpans: any = [];
    if (typeof req.query.spans === "string") {
      try {
        rawSpans = JSON.parse(req.query.spans);
      } catch {
        rawSpans = [];
      }
    } else if (Array.isArray(req.query.spans)) {
      rawSpans = req.query.spans;
    } else if (Array.isArray(req.body?.spans)) {
      rawSpans = req.body.spans;
    }

    const spans: Span[] = (Array.isArray(rawSpans) ? rawSpans : [])
      .slice(0, 20)
      .map((s: any) => ({
        from: String(s?.from ?? ""),
        to: String(s?.to ?? ""),
      }))
      .filter((s) => Boolean(s.from && s.to));

    if (useRds()) {
      const out = await computeCombinedBuckets(pgClient, spans);
      res.status(200).json(out);
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const out = await computeCombinedBuckets(req.supabase, spans);
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

export type ManualBucket = {
  leadGenerated: number;
  eoi1: number;
  webinar: number;
  eoi2: number;
  feePaid: number;
  contractSigned: number;
};

const MANUAL_PROGRESSIONS: Array<{ key: string; to: string; from: string[] }> = [
  { key: "eoi1", to: "EOI_1", from: ["LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE"] },
  { key: "webinar", to: "WEBINAR", from: ["EOI_1"] },
  { key: "eoi2", to: "EOI_2", from: ["WEBINAR", "WEBINAR_ATTENDED", "EOI2_PENDING"] },
  { key: "feePaid", to: "FEE_PAID", from: ["EOI_2"] },
  { key: "contractSigned", to: "KTN_CS", from: ["FEE_PAID"] },
];

function manualProgressionKey(from: string | null, to: string | null): string | null {
  if (!from) return null;
  const p = MANUAL_PROGRESSIONS.find((x) => x.to === to);
  if (!p || !p.from.includes(from)) return null;
  return p.key;
}

export async function computeManualBuckets(
  supabase: any,
  spans: Span[],
): Promise<ManualBucket[]> {
  const out: ManualBucket[] = spans.map(() => ({
    leadGenerated: 0,
    eoi1: 0,
    webinar: 0,
    eoi2: 0,
    feePaid: 0,
    contractSigned: 0,
  }));
  if (spans.length === 0) return out;

  const { min, max } = bounds(spans);
  const cohortLeads = await pageAll(() =>
    supabase
      .from("kob_leads")
      .select("id, created_at, mode")
      .gte("created_at", min)
      .lte("created_at", max)
      .order("created_at", { ascending: true }),
  );
  const cohorts: Set<string>[] = spans.map(
    (s) => new Set(cohortLeads.filter((l: any) => inSpan(l.created_at, s)).map((l: any) => l.id)),
  );
  spans.forEach(
    (s, i) =>
      (out[i].leadGenerated = cohortLeads.filter(
        (l: any) => l.mode === "MANUAL" && inSpan(l.created_at, s),
      ).length),
  );

  const bump = makeCounter(spans, out);
  const ids = cohortLeads.map((l: any) => l.id as string);
  for (let c = 0; c < ids.length; c += 200) {
    const chunk = ids.slice(c, c + 200);
    const hist = await pageAll(() =>
      supabase
        .from("lead_stage_history")
        .select("id, lead_id, from_stage, to_stage")
        .not("changed_by", "is", null)
        .in("lead_id", chunk)
        .order("id", { ascending: true }),
    );
    for (const h of hist) {
      const key = manualProgressionKey(h.from_stage, h.to_stage) as keyof ManualBucket | null;
      if (!key) continue;
      cohorts.forEach((set, i) => {
        if (set.has(h.lead_id)) bump(i, key, h.lead_id);
      });
    }
  }

  return out;
}

/**
 * Controller for getManualFunnel.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 57).
 */
export async function getManualFunnel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    const span: Span = {
      from: from ?? new Date(0).toISOString(),
      to: to ?? new Date().toISOString(),
    };

    if (useRds()) {
      const [b] = await computeManualBuckets(pgClient, [span]);
      res.status(200).json(b);
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const [b] = await computeManualBuckets(req.supabase, [span]);
    res.status(200).json(b);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getManualFunnelBuckets.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 35).
 */
export async function getManualFunnelBuckets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let rawSpans: any = [];
    if (typeof req.query.spans === "string") {
      try {
        rawSpans = JSON.parse(req.query.spans);
      } catch {
        rawSpans = [];
      }
    } else if (Array.isArray(req.query.spans)) {
      rawSpans = req.query.spans;
    } else if (Array.isArray(req.body?.spans)) {
      rawSpans = req.body.spans;
    }

    const spans: Span[] = (Array.isArray(rawSpans) ? rawSpans : [])
      .slice(0, 20)
      .map((s: any) => ({
        from: String(s?.from ?? ""),
        to: String(s?.to ?? ""),
      }))
      .filter((s) => Boolean(s.from && s.to));

    if (useRds()) {
      const out = await computeManualBuckets(pgClient, spans);
      res.status(200).json(out);
      return;
    }

    if (!req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const out = await computeManualBuckets(req.supabase, spans);
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

const COMBINED_SPLIT_SOURCES: Record<string, string[]> = {
  EOI_1: ["EOI_1"],
  WEBINAR: ["WEBINAR", "WEBINAR_ATTENDED"],
  EOI_2: ["EOI_2"],
};
const COMBINED_SPLIT_SUCCESS: Record<string, string[]> = {
  EOI_1: ["WEBINAR"],
  WEBINAR: ["WEBINAR_ATTENDED", "EOI2_PENDING", "EOI_2"],
  EOI_2: ["FORM_FILLED", "FEE_PAID", "KTN_CS"],
};
const SPLIT_NEG = ["NO", "NO_RESPONSE", "LATER"];
const SPLIT_KEYS = ["INTERESTED", "NO", "NO_RESPONSE", "LATER", "PENDING"] as const;

async function combinedSplitClassify(supabase: any, stageKey: string) {
  const firstMap = (await combinedFirstEntries(supabase))[stageKey] ?? new Map<string, string>();
  const success = COMBINED_SPLIT_SUCCESS[stageKey] ?? [];
  const rows = await pageAll(() =>
    supabase
      .from("lead_stage_history")
      .select("id, lead_id, from_stage, to_stage, created_at")
      .in("from_stage", COMBINED_SPLIT_SOURCES[stageKey] as any)
      .in("to_stage", [...success, ...SPLIT_NEG] as any)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  );
  const cls = new Map<string, string>();
  for (const r of rows) {
    const entry = firstMap.get(r.lead_id);
    if (!entry || cls.has(r.lead_id) || r.created_at < entry) continue;
    if (r.from_stage === r.to_stage) continue;
    cls.set(r.lead_id, success.includes(r.to_stage) ? "INTERESTED" : r.to_stage);
  }
  return { first: firstMap, cls };
}

/**
 * Controller for getCombinedStageResponseSplit.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 922).
 */
export async function getCombinedStageResponseSplit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stageKey = req.query.stageKey as string;
    if (!["EOI_1", "WEBINAR", "EOI_2"].includes(stageKey)) {
      res.status(400).json({ error: "Invalid stageKey: must be EOI_1, WEBINAR, or EOI_2" });
      return;
    }
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(Date.now() + IST_MS);
    const monthStart = new Date(
      Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS,
    ).toISOString();
    const now = new Date().toISOString();
    const from = (typeof req.query.from === "string" ? req.query.from : undefined) ?? monthStart;
    const to = (typeof req.query.to === "string" ? req.query.to : undefined) ?? now;

    const { first, cls } = await combinedSplitClassify(useRds() ? pgClient : req.supabase, stageKey);
    const out: Record<string, { mtd: number; lifetime: number }> = {};
    for (const k of SPLIT_KEYS) out[k] = { mtd: 0, lifetime: 0 };
    let eligible = 0;
    for (const [id, ts] of first) {
      const k = cls.get(id) ?? "PENDING";
      if (ts >= from && ts <= to) { out[k].lifetime++; eligible++; }
      if (ts >= monthStart && ts <= now) out[k].mtd++;
    }
    res.status(200).json({ ...out, eligible });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getCombinedStageResponseSplitTable.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 954).
 */
export async function getCombinedStageResponseSplitTable(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stageKey = req.query.stageKey as string;
    if (!["EOI_1", "WEBINAR", "EOI_2"].includes(stageKey)) {
      res.status(400).json({ error: "Invalid stageKey: must be EOI_1, WEBINAR, or EOI_2" });
      return;
    }
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    const IST_MS = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(Date.now() + IST_MS);
    const istDay = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
    const todayIst = nowIst.toISOString().slice(0, 10);
    const days: string[] = [];
    for (let i = 0; i < 5; i++) days.push(new Date(nowIst.getTime() - i * 86400000).toISOString().slice(0, 10));
    const monthStart = todayIst.slice(0, 8) + "01";
    const inRange = (ts: string) => (!from || ts >= from) && (!to || ts <= to);

    const { first, cls } = await combinedSplitClassify(useRds() ? pgClient : req.supabase, stageKey);
    const b: Record<string, Record<string, number>> = {};
    for (const k of SPLIT_KEYS) {
      b[k] = { lifetime: 0, mtd: 0 };
      for (const d of days) b[k][d] = 0;
    }
    for (const [id, ts] of first) {
      const k = cls.get(id) ?? "PENDING";
      const day = istDay(ts);
      if (inRange(ts)) b[k].lifetime++;
      if (day >= monthStart && day <= todayIst) b[k].mtd++;
      if (b[k][day] !== undefined) b[k][day]++;
    }
    const rowsOut = SPLIT_KEYS.map((k) => ({
      key: k as string,
      daily: days.map((d) => b[k][d]),
      mtd: b[k].mtd,
      lifetime: b[k].lifetime,
    }));
    res.status(200).json({ days, rows: rowsOut });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getLeadsTrend.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 474).
 */
export async function getLeadsTrend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const from = (typeof req.query.from === "string" ? req.query.from : undefined) ?? new Date(Date.now() - 29 * 864e5).toISOString();
    const to = (typeof req.query.to === "string" ? req.query.to : undefined) ?? new Date().toISOString();

    const IST = 5.5 * 3600 * 1000;
    const dayKey = (ts: string) => new Date(new Date(ts).getTime() + IST).toISOString().slice(0, 10);
    const label = (key: string) => {
      const d = new Date(`${key}T00:00:00Z`);
      return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${String(d.getUTCDate()).padStart(2, "0")}`;
    };

    const leadRows = useRds()
      ? await dashboardRepo.getLeadsIdCreatedAt({ from, to })
      : await pageAll(() =>
          req.supabase!.from("kob_leads").select("id, created_at").gte("created_at", from).lte("created_at", to),
        );
    const contractRows = useRds()
      ? await dashboardRepo.getStageHistoryKtnCsEntries({ from, to })
      : await pageAll(() =>
          req.supabase!
            .from("lead_stage_history")
            .select("lead_id, to_stage, created_at")
            .eq("to_stage", "KTN_CS")
            .gte("created_at", from)
            .lte("created_at", to),
        );

    const keys: string[] = [];
    const start = new Date(`${dayKey(from)}T00:00:00Z`).getTime();
    const end = new Date(`${dayKey(to)}T00:00:00Z`).getTime();
    for (let t = start; t <= end && keys.length < 400; t += 864e5) {
      keys.push(new Date(t).toISOString().slice(0, 10));
    }

    const leadsBy = new Map<string, number>();
    for (const l of leadRows) leadsBy.set(dayKey(l.created_at), (leadsBy.get(dayKey(l.created_at)) ?? 0) + 1);
    const contractsBy = new Map<string, Set<string>>();
    for (const h of contractRows) {
      const k = dayKey(h.created_at);
      if (!contractsBy.has(k)) contractsBy.set(k, new Set());
      contractsBy.get(k)!.add(h.lead_id);
    }

    const out = keys.map((k) => {
      const leads = leadsBy.get(k) ?? 0;
      const contracts = contractsBy.get(k)?.size ?? 0;
      return {
        date: label(k),
        leads,
        contracts,
        conv: leads > 0 ? Number(((contracts / leads) * 100).toFixed(2)) : 0,
      };
    });

    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

async function autoCohortResponses(
  supabase: any,
  windows: Array<{ from: string; to: string }>,
  sources: string[],
  targets: string[],
  manual = false,
) {
  const leads = new Map<string, string>();
  for (const w of windows) {
    const rows = await pageAll(() =>
      supabase
        .from("kob_leads")
        .select("id, created_at")
        .gte("created_at", w.from)
        .lte("created_at", w.to)
        .order("created_at", { ascending: true }),
    );
    for (const l of rows) leads.set(l.id, l.created_at);
  }
  const ids = [...leads.keys()];
  const hist: any[] = [];
  for (let c = 0; c < ids.length; c += 200) {
    const chunk = ids.slice(c, c + 200);
    hist.push(
      ...(await pageAll(() =>
        supabase
          .from("lead_stage_history")
          .select("id, lead_id, to_stage")
          .filter("changed_by", manual ? "not.is" : "is", null)
          .in("lead_id", chunk)
          .in("from_stage", sources)
          .in("to_stage", targets)
          .order("id", { ascending: true }),
      )),
    );
  }
  return { leads, hist };
}

const MANUAL_SPLIT_SUCCESS: Record<string, string[]> = {
  EOI_1: ["WEBINAR"],
  WEBINAR: ["EOI_2"],
  EOI_2: ["FORM_FILLED", "FEE_PAID", "KTN_CS"],
};

/**
 * Controller for getManualStageResponseSplit.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 804).
 */
export async function getManualStageResponseSplit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stageKey = req.query.stageKey as string;
    if (!["EOI_1", "WEBINAR", "EOI_2"].includes(stageKey)) {
      res.status(400).json({ error: "Invalid stageKey: must be EOI_1, WEBINAR, or EOI_2" });
      return;
    }
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(Date.now() + IST_MS);
    const y = nowIst.getUTCFullYear();
    const m = nowIst.getUTCMonth();
    const rangeStart = new Date(Date.UTC(y, m, 1) - IST_MS).toISOString();
    const rangeEnd = new Date().toISOString();

    const successTargets = MANUAL_SPLIT_SUCCESS[stageKey] ?? [];
    const negatives = ["NO", "NO_RESPONSE", "LATER"] as const;

    const from = (typeof req.query.from === "string" ? req.query.from : undefined) ?? rangeStart;
    const to = (typeof req.query.to === "string" ? req.query.to : undefined) ?? rangeEnd;

    const { leads, hist } = await autoCohortResponses(
      useRds() ? pgClient : req.supabase,
      [{ from, to }, { from: rangeStart, to: rangeEnd }],
      [stageKey],
      [...successTargets, ...negatives],
      true,
    );

    const keys = ["INTERESTED", "NO", "NO_RESPONSE", "LATER"] as const;
    const life: Record<string, Set<string>> = {};
    const mtd: Record<string, Set<string>> = {};
    for (const k of keys) {
      life[k] = new Set();
      mtd[k] = new Set();
    }

    for (const r of hist) {
      const created = leads.get(r.lead_id);
      if (!created) continue;
      const k = successTargets.includes(r.to_stage as string)
        ? "INTERESTED"
        : (r.to_stage as string);
      if (!life[k]) continue;
      if (created >= from && created <= to) life[k].add(r.lead_id);
      if (created >= rangeStart && created <= rangeEnd) mtd[k].add(r.lead_id);
    }

    const out: Record<string, { mtd: number; lifetime: number }> = {};
    for (const k of keys) out[k] = { mtd: mtd[k].size, lifetime: life[k].size };

    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getStageResponseSplit.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 732).
 */
export async function getStageResponseSplit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stageKey = req.query.stageKey as string;
    if (!["AUTO_FIRED", "WEBINAR", "EOI_2"].includes(stageKey)) {
      res.status(400).json({ error: "Invalid stageKey: must be AUTO_FIRED, WEBINAR, or EOI_2" });
      return;
    }
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const IST_MS_A = 5.5 * 60 * 60 * 1000;
    const nowIstA = new Date(Date.now() + IST_MS_A);
    const monthStart = new Date(
      Date.UTC(nowIstA.getUTCFullYear(), nowIstA.getUTCMonth(), 1) - IST_MS_A,
    ).toISOString();
    const monthEnd = new Date().toISOString();
    const from = (typeof req.query.from === "string" ? req.query.from : undefined) ?? monthStart;
    const to = (typeof req.query.to === "string" ? req.query.to : undefined) ?? monthEnd;

    const SOURCES: Record<string, string[]> = {
      AUTO_FIRED: ["AUTO_FIRED", "EOI_1"],
      WEBINAR: ["WEBINAR"],
      EOI_2: ["EOI_2"],
    };
    const SUCCESS: Record<string, string[]> = {
      AUTO_FIRED: ["WEBINAR"],
      WEBINAR: ["EOI_2"],
      EOI_2: ["FORM_FILLED", "FEE_PAID"],
    };
    const negatives = ["NO", "NO_RESPONSE", "LATER"] as const;
    const targets = [...(SUCCESS[stageKey] ?? []), ...negatives];

    const { leads, hist } = await autoCohortResponses(
      useRds() ? pgClient : req.supabase,
      [{ from, to }, { from: monthStart, to: monthEnd }],
      [...(SOURCES[stageKey] ?? [])],
      targets,
      false,
    );

    const keys = ["INTERESTED", ...negatives] as const;
    const mk = () =>
      Object.fromEntries(keys.map((k) => [k, new Set<string>()])) as Record<string, Set<string>>;
    const life = mk();
    const mtd = mk();
    const successSet = new Set<string>(SUCCESS[stageKey] ?? []);
    for (const r of hist) {
      const created = leads.get(r.lead_id);
      if (!created) continue;
      const k = successSet.has(r.to_stage as string) ? "INTERESTED" : (r.to_stage as string);
      if (!life[k]) continue;
      if (created >= from && created <= to) life[k].add(r.lead_id);
      if (created >= monthStart && created <= monthEnd) mtd[k].add(r.lead_id);
    }

    const out = keys.reduce(
      (acc, k) => {
        acc[k] = { mtd: mtd[k].size, lifetime: life[k].size };
        return acc;
      },
      {} as Record<string, { mtd: number; lifetime: number }>,
    );

    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getRetargetingFunnel.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 1131).
 */
export async function getRetargetingFunnel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const r = {
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
    };
    const FROM = ["NO", "LATER", "NO_RESPONSE"] as const;
    const TO = ["LEAD_INBOX", "EOI_1", "WEBINAR"] as const;
    const rows = useRds()
      ? await dashboardRepo.getStageHistoryByFromTo([...FROM], [...TO], r)
      : await pageAll(() => {
          let q = req.supabase!
            .from("lead_stage_history")
            .select("lead_id, from_stage, to_stage, created_at")
            .in("from_stage", FROM as any)
            .in("to_stage", TO as any)
            .order("created_at", { ascending: true });
          if (r.from) q = q.gte("created_at", r.from);
          if (r.to) q = q.lte("created_at", r.to);
          return q;
        });
    const sets: Record<string, Set<string>> = {
      LEAD_INBOX: new Set(),
      EOI_1: new Set(),
      WEBINAR: new Set(),
    };
    for (const row of rows) {
      if (!row.lead_id) continue;
      const s = sets[row.to_stage as string];
      if (s) s.add(row.lead_id as string);
    }

    // TABLE view: last 5 COMPLETED IST days + month-to-date, each computed
    // from the actual transition timestamp (same qualifying definition).
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(Date.now() + IST_MS);
    const istDay = (iso: string) =>
      new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
    const todayIst = nowIst.toISOString().slice(0, 10);
    const days: string[] = [];
    for (let i = 1; i <= 5; i++) {
      days.push(new Date(nowIst.getTime() - i * 86400000).toISOString().slice(0, 10));
    }
    const monthStart = todayIst.slice(0, 8) + "01";
    const earliest = days[days.length - 1] < monthStart ? days[days.length - 1] : monthStart;
    const windowFrom = new Date(new Date(`${earliest}T00:00:00.000Z`).getTime() - IST_MS).toISOString();

    const tableRows = useRds()
      ? await dashboardRepo.getStageHistoryByFromTo([...FROM], [...TO], { from: windowFrom })
      : await pageAll(() =>
          req.supabase!
            .from("lead_stage_history")
            .select("lead_id, from_stage, to_stage, created_at")
            .in("from_stage", FROM as any)
            .in("to_stage", TO as any)
            .gte("created_at", windowFrom)
            .order("created_at", { ascending: true }),
        );

    const perDay: Record<string, Record<string, Set<string>>> = {};
    const perMtd: Record<string, Set<string>> = {};
    for (const t of TO) {
      perDay[t] = {};
      for (const d of days) perDay[t][d] = new Set();
      perMtd[t] = new Set();
    }
    for (const row of tableRows as any[]) {
      if (!row.lead_id) continue;
      const t = row.to_stage as string;
      if (!perDay[t]) continue;
      const day = istDay(row.created_at);
      if (perDay[t][day]) perDay[t][day].add(row.lead_id);
      if (day >= monthStart && day <= todayIst) perMtd[t].add(row.lead_id);
    }

    const table = Object.fromEntries(
      TO.map((t) => [
        t,
        { daily: days.map((d) => perDay[t][d].size), mtd: perMtd[t].size },
      ]),
    ) as Record<(typeof TO)[number], { daily: number[]; mtd: number }>;

    res.status(200).json({
      leadInbox: sets.LEAD_INBOX.size,
      eoi1: sets.EOI_1.size,
      webinar: sets.WEBINAR.size,
      days,
      table,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getRetargetingSplit.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 1406).
 */
export async function getRetargetingSplit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const asOfQuery = typeof req.query.asOf === "string" ? req.query.asOf : "";
    const day = /^\d{4}-\d{2}-\d{2}$/.test(asOfQuery)
      ? asOfQuery
      : new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
    const cutoff = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_MS + 86400000 - 1).toISOString();
    const rows = useRds()
      ? await dashboardRepo.getStageHistoryFromToUntil(["NO", "LATER", "NO_RESPONSE"], ["LEAD_INBOX", "EOI_1", "WEBINAR"], cutoff)
      : await pageAll(() =>
          req.supabase!
            .from("lead_stage_history")
            .select("lead_id, to_stage")
            .in("from_stage", ["NO", "LATER", "NO_RESPONSE"] as any)
            .in("to_stage", ["LEAD_INBOX", "EOI_1", "WEBINAR"] as any)
            .lte("created_at", cutoff)
            .order("created_at", { ascending: true }),
        );
    const sets: Record<string, Set<string>> = { LEAD_INBOX: new Set(), EOI_1: new Set(), WEBINAR: new Set() };
    for (const r of rows as any[]) {
      if (r.lead_id) sets[r.to_stage]?.add(r.lead_id);
    }
    res.status(200).json({
      asOf: day,
      leadInbox: sets.LEAD_INBOX.size,
      eoi1: sets.EOI_1.size,
      webinar: sets.WEBINAR.size,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getStateSpread.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 316).
 */
export async function getStateSpread(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    const supabase = req.supabase;

    let nameById: Map<string, string>;
    let rows: any[];
    if (useRds()) {
      const states = await dashboardRepo.getAllStatesIdName();
      nameById = new Map(states.map((s) => [s.id, s.name]));
      rows = await dashboardRepo.getAllLeadsStateStageNotes();
    } else {
      const { data: states } = await supabase!.from("india_states").select("id, name");
      nameById = new Map(((states ?? []) as any[]).map((s) => [s.id, s.name]));
      rows = [];
      for (let i = 0; ; i += 1000) {
        const { data: page } = await supabase!
          .from("kob_leads")
          .select("state_id, stage, notes")
          .range(i, i + 999);
        const p = (page ?? []) as any[];
        rows.push(...p);
        if (p.length < 1000) break;
      }
    }

    const pinOf = (notes: string | null) => notes?.match(/(\d{6})/)?.[1] ?? null;
    const pins = Array.from(
      new Set(rows.filter((l) => !l.state_id).map((l) => pinOf(l.notes)).filter(Boolean) as string[]),
    );
    const stateByPin = new Map<string, string>();
    for (let i = 0; i < pins.length; i += 500) {
      const chunk = pins.slice(i, i + 500);
      const pr = useRds()
        ? await dashboardRepo.getPincodeStates(chunk)
        : (await supabase!.from("india_pincodes").select("pincode, state").in("pincode", chunk)).data ?? [];
      for (const p of pr as any[]) if (!stateByPin.has(p.pincode)) stateByPin.set(p.pincode, p.state);
    }
    const titleCase = (s: string) =>
      s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

    const total = rows.length || 1;
    const agg = new Map<string, { leads: number; contracts: number }>();
    for (const l of rows) {
      let key: string | null = null;
      if (l.state_id) key = nameById.get(l.state_id) ?? null;
      else {
        const pin = pinOf(l.notes);
        const st = pin ? stateByPin.get(pin) : null;
        key = st ? titleCase(st) : null;
      }
      if (!key) continue;
      const cur = agg.get(key) ?? { leads: 0, contracts: 0 };
      cur.leads++;
      if (l.stage === "KTN_CS") cur.contracts++;
      agg.set(key, cur);
    }

    const out = Array.from(agg.entries())
      .filter(([, v]) => v.leads > 0)
      .map(([name, v]) => ({
        state: name,
        leads: v.leads,
        conv: `${((v.contracts / v.leads) * 100).toFixed(2)}%`,
        coverage: `${((v.leads / total) * 100).toFixed(2)}%`,
      }))
      .sort((a, b) => b.leads - a.leads);

    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getVariantStageResponseSplitTable.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 1004).
 */
export async function getVariantStageResponseSplitTable(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stageKey = req.query.stageKey as string;
    const variant = req.query.variant as string;
    if (!["AUTO_FIRED", "EOI_1", "WEBINAR", "EOI_2"].includes(stageKey)) {
      res.status(400).json({ error: "Invalid stageKey: must be AUTO_FIRED, EOI_1, WEBINAR, or EOI_2" });
      return;
    }
    if (!useRds() && !req.supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    if (!["auto", "manual"].includes(variant)) {
      res.status(400).json({ error: "Invalid variant: must be auto or manual" });
      return;
    }
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    const IST_MS = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(Date.now() + IST_MS);
    const istDay = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
    const todayIst = nowIst.toISOString().slice(0, 10);
    // Last 5 completed calendar days, ending with yesterday.
    const days: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const d = new Date(nowIst.getTime() - i * 86400000);
      days.push(d.toISOString().slice(0, 10));
    }
    const monthStart = todayIst.slice(0, 8) + "01";

    let rows: any[] = [];
    let successTargets: readonly string[];

    const keys = ["INTERESTED", "NO", "NO_RESPONSE", "LATER"] as const;
    const buckets: Record<string, Record<string, Set<string>>> = {};
    for (const k of keys) {
      buckets[k] = { lifetime: new Set(), mtd: new Set() };
      for (const d of days) buckets[k][d] = new Set();
    }

    if (variant === "auto") {
      const SOURCES = {
        AUTO_FIRED: ["AUTO_FIRED", "EOI_1"],
        WEBINAR: ["WEBINAR"],
        EOI_2: ["EOI_2"],
        EOI_1: ["EOI_1", "AUTO_FIRED"],
      } as const;
      const SUCCESS = {
        AUTO_FIRED: ["WEBINAR"],
        WEBINAR: ["EOI_2"],
        EOI_2: ["FORM_FILLED", "FEE_PAID"],
        EOI_1: ["WEBINAR"],
      } as const;
      const sources = SOURCES[stageKey as keyof typeof SOURCES];
      successTargets = SUCCESS[stageKey as keyof typeof SUCCESS];
      const monthStartIso = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS).toISOString();
      const fiveAgo = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() - 5) - IST_MS).toISOString();
      const { leads, hist } = await autoCohortResponses(useRds() ? pgClient : req.supabase, [
        { from: from ?? monthStartIso, to: to ?? new Date().toISOString() },
        { from: monthStartIso < fiveAgo ? monthStartIso : fiveAgo, to: new Date().toISOString() },
      ], sources as any, [...successTargets, "NO", "NO_RESPONSE", "LATER"]);
      const inRange = (ts: string) =>
        (!from || ts >= from) && (!to || ts <= to);
      for (const r of hist) {
        const created = leads.get(r.lead_id);
        if (!created) continue;
        const k = successTargets.includes(r.to_stage as string) ? "INTERESTED" : (r.to_stage as string);
        if (!buckets[k]) continue;
        const day = istDay(created);
        if (inRange(created)) buckets[k].lifetime.add(r.lead_id);
        if (day >= monthStart && day <= todayIst) buckets[k].mtd.add(r.lead_id);
        if (buckets[k][day]) buckets[k][day].add(r.lead_id);
      }
      rows = [];
    } else {
      const SUCCESS = {
        EOI_1: ["WEBINAR"],
        WEBINAR: ["EOI_2"],
        EOI_2: ["FORM_FILLED", "FEE_PAID", "KTN_CS"],
        AUTO_FIRED: ["WEBINAR"],
      } as const;
      successTargets = SUCCESS[stageKey as keyof typeof SUCCESS];
      const monthStartIso = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS).toISOString();
      const fiveAgo = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() - 5) - IST_MS).toISOString();
      const { leads, hist } = await autoCohortResponses(useRds() ? pgClient : req.supabase, [
        { from: from ?? monthStartIso, to: to ?? new Date().toISOString() },
        { from: monthStartIso < fiveAgo ? monthStartIso : fiveAgo, to: new Date().toISOString() },
      ], [stageKey], [...successTargets, "NO", "NO_RESPONSE", "LATER"], true);
      const inRange = (ts: string) =>
        (!from || ts >= from) && (!to || ts <= to);
      for (const r of hist) {
        const created = leads.get(r.lead_id);
        if (!created) continue;
        const k = successTargets.includes(r.to_stage as string) ? "INTERESTED" : (r.to_stage as string);
        if (!buckets[k]) continue;
        const day = istDay(created);
        if (inRange(created)) buckets[k].lifetime.add(r.lead_id);
        if (day >= monthStart && day <= todayIst) buckets[k].mtd.add(r.lead_id);
        if (buckets[k][day]) buckets[k][day].add(r.lead_id);
      }
      rows = [];
    }

    for (const r of rows) {
      if (!r.lead_id) continue;
      const k = successTargets.includes(r.to_stage as string) ? "INTERESTED" : (r.to_stage as string);
      if (!buckets[k]) continue;
      const day = istDay(r.created_at);
      if (day > todayIst) continue;
      buckets[k].lifetime.add(r.lead_id);
      if (day >= monthStart && day <= todayIst) buckets[k].mtd.add(r.lead_id);
      if (buckets[k][day]) buckets[k][day].add(r.lead_id);
    }

    const rowsOut = keys.map((k) => ({
      key: k as string,
      daily: days.map((d) => buckets[k][d].size),
      mtd: buckets[k].mtd.size,
      lifetime: buckets[k].lifetime.size,
    }));
    res.status(200).json({ days, rows: rowsOut });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getExecPerformanceSummary.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 188).
 * Scoped by role: executive role uses req.supabase; non-executives use supabaseAdmin.
 */
export async function getExecPerformanceSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!useRds() && (!req.supabase || !req.userId)) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }
    if (useRds() && !req.userId) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : undefined;

    let execIds: string[];
    let profs: { id: string; full_name: string }[];
    let rows: { assigned_to: string | null }[];
    let history: { lead_id: string; changed_by: string | null }[];
    let mode: "AUTO" | "MANUAL";
    let targetByUser: Map<string, number | null>;
    let execTarget: number;

    if (useRds()) {
      // Same scope precedent as getExecutiveStageSummary/getTLOverview (see
      // db/authz.ts's columnScopeSql doc comment): the Supabase path's
      // "executive -> req.supabase; else -> supabaseAdmin" IS this project's
      // already-documented self-scope-via-RLS pattern, reproduced explicitly.
      const scope = await resolveLeadScopeOrDeny(req.userId!);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }

      execIds = await analyticsRepo.getExecutiveRoleUserIdsScoped(scope);
      if (execIds.length === 0) {
        res.status(200).json([]);
        return;
      }
      profs = await analyticsRepo.getProfilesForExecSummary(execIds);
      rows = await analyticsRepo.getLeadsAssignedToInRangeScoped(scope, from, to);
      history = (await analyticsRepo.getKtnCsHistoryScoped(scope, from, to)).filter((h) => h.changed_by);

      const refDate = from ? new Date(from) : new Date();
      const period = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, "0")}-01`;
      mode = await analyticsRepo.getDefaultMode();
      const inputs = await analyticsRepo.getScvModeInputTargets(period, mode, execIds);
      targetByUser = new Map(inputs.map((i) => [i.user_id, i.ktn_cs_target != null ? Number(i.ktn_cs_target) : null]));
      execTarget = await analyticsRepo.getOrgMonthlyKtnCsTarget(period);
    } else {
      const db = req.supabase!;
      const { data: role } = await db.rpc("get_user_role", { _user_id: req.userId });
      const client =
        ((role as string | null) ?? "executive") === "executive" || !process.env.SUPABASE_SERVICE_ROLE_KEY
          ? db
          : supabaseAdmin;

      const { data: roleRows } = await client
        .from("user_roles")
        .select("user_id")
        .eq("role", "executive");
      execIds = ((roleRows ?? []) as any[]).map((r: any) => r.user_id);
      if (execIds.length === 0) {
        res.status(200).json([]);
        return;
      }

      const { data: profsData } = await client
        .from("profiles")
        .select("id, full_name")
        .in("id", execIds);
      profs = (profsData ?? []) as any[];

      // Leads = leads assigned, created inside the selected date range.
      rows = await pageAll(() => {
        let q = client.from("kob_leads").select("assigned_to");
        if (from) q = q.gte("created_at", from);
        if (to) q = q.lte("created_at", to);
        return q;
      });

      // Contracts = unique leads that entered KTN_CS in the range (stage history
      // timestamp), credited to the lead's assigned executive — not the mover.
      const ktnHist = await pageAll(() => {
        let q = client
          .from("lead_stage_history")
          .select("lead_id, kob_leads!inner(assigned_to, stage)")
          .eq("to_stage", "KTN_CS")
          .eq("kob_leads.stage", "KTN_CS");
        if (from) q = q.gte("created_at", from);
        if (to) q = q.lte("created_at", to);
        return q;
      });
      history = (ktnHist as any[])
        .map((h: any) => ({ lead_id: h.lead_id, changed_by: h.kob_leads?.assigned_to ?? null }))
        .filter((h: any) => h.changed_by);

      // Target = per-executive KTN CS target from SCV & Incentives (active mode,
      // month of the filter start), falling back to the org monthly KTN_CS target.
      const refDate = from ? new Date(from) : new Date();
      const period = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, "0")}-01`;
      const { data: cfgRow } = await client.from("kob_configuration").select("default_mode").limit(1).maybeSingle();
      mode = (cfgRow as any)?.default_mode === "MANUAL" ? "MANUAL" : "AUTO";
      const { data: inputs } = await client
        .from("scv_mode_inputs")
        .select("user_id, ktn_cs_target")
        .eq("period", period)
        .eq("mode", mode)
        .in("user_id", execIds);
      targetByUser = new Map<string, number | null>(
        ((inputs ?? []) as any[]).map((i: any) => [i.user_id, i.ktn_cs_target != null ? Number(i.ktn_cs_target) : null]),
      );
      const { data: orgTargetRow } = await client
        .from("kpi_targets")
        .select("target_value")
        .eq("metric", "KTN_CS")
        .eq("period", "monthly")
        .lte("effective_from", period)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle();
      execTarget = Number((orgTargetRow as any)?.target_value ?? 0);
    }

    const UNASSIGNED = "__unassigned__";
    const byExec = new Map<string, { leads: number; contracts: number }>();
    for (const l of rows as any[]) {
      const key = l.assigned_to ?? UNASSIGNED;
      const e = byExec.get(key) ?? { leads: 0, contracts: 0 };
      e.leads += 1;
      byExec.set(key, e);
    }
    const credited = new Set<string>(); // `${changed_by}:${lead_id}` dedupe
    for (const h of history as any[]) {
      const key = h.changed_by as string;
      const dedupeKey = `${key}:${h.lead_id}`;
      if (credited.has(dedupeKey)) continue;
      credited.add(dedupeKey);
      const e = byExec.get(key) ?? { leads: 0, contracts: 0 };
      e.contracts += 1;
      byExec.set(key, e);
    }

    const nameById = new Map<string, string>(
      ((profs ?? []) as any[]).map((p: any) => [p.id, p.full_name]),
    );
    const shape = (id: string, name: string, target: number) => {
      const { leads, contracts } = byExec.get(id) ?? { leads: 0, contracts: 0 };
      return {
        id,
        name,
        leads,
        contracts,
        target,
        conversion: leads > 0 ? Math.round((contracts / leads) * 10000) / 100 : 0,
        pending: Math.max(0, leads - contracts),
      };
    };

    const execRows = ((profs ?? []) as any[]).map((p: any) => shape(p.id, p.full_name, targetByUser.get(p.id) ?? execTarget));

    // Leads held by non-executive users (TL/manager) plus unassigned leads.
    const otherRows = [...byExec.keys()]
      .filter((k) => k !== UNASSIGNED && !nameById.has(k))
      .map((k) => shape(k, "Other user", 0));

    const unassigned = shape(UNASSIGNED, "Unassigned", 0);
    const result = [...execRows, ...otherRows, ...(unassigned.leads > 0 ? [unassigned] : [])];
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getFunnelStageLeads.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 541).
 */
export async function getFunnelStageLeads(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const supabase = req.supabase;
    if (!useRds() && !supabase) {
      res.status(500).json({ error: "Supabase client not initialized on request" });
      return;
    }

    const stageKey = typeof req.query.stageKey === "string" ? req.query.stageKey : (typeof req.query.stage_key === "string" ? req.query.stage_key : undefined);
    if (!stageKey) {
      res.status(400).json({ error: "stageKey is required" });
      return;
    }
    const mode = (typeof req.query.mode === "string" && ["auto", "manual", "all"].includes(req.query.mode.toLowerCase())
      ? req.query.mode.toLowerCase()
      : "all") as "auto" | "manual" | "all";
    const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : undefined;

    let leadIds: string[] = [];

    if (stageKey === "LEAD_GENERATED") {
      const rows = useRds()
        ? await dashboardRepo.getLeadIdsCreatedInRange({ from, to })
        : await pageAll(() => {
            let q = supabase!.from("kob_leads").select("id").order("created_at", { ascending: true });
            if (from) q = q.gte("created_at", from);
            if (to) q = q.lte("created_at", to);
            return q;
          });
      leadIds = rows.map((l: any) => l.id);

      if (mode !== "all") {
        const mrows = useRds()
          ? await dashboardRepo.getManualCreateAuditEntityIds({ from, to })
          : await pageAll(() => {
              let m = supabase!
                .from("audit_logs")
                .select("entity_id")
                .eq("action", "lead_manual_create")
                .order("created_at", { ascending: true });
              if (from) m = m.gte("created_at", from);
              if (to) m = m.lte("created_at", to);
              return m;
            });
        const manual = new Set(mrows.map((x: any) => x.entity_id).filter(Boolean));
        leadIds = leadIds.filter((id) => (mode === "manual" ? manual.has(id) : !manual.has(id)));
      }
    } else if (stageKey === "WEBINAR_ATTENDED") {
      const historyDb = (process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin : supabase) as any;
      const batches = useRds()
        ? await dashboardRepo.getWebinarBatchesInRange({ from, to })
        : await pageAll(() => {
            let q = historyDb
              .from("webinar_batches")
              .select("id, name, scheduled_at, language")
              .order("scheduled_at", { ascending: false });
            if (from) q = q.gte("scheduled_at", from);
            if (to) q = q.lte("scheduled_at", to);
            return q;
          });
      const batchMap = new Map<string, any>(batches.map((b: any) => [b.id, b]));
      const batchIds = [...batchMap.keys()];
      const historyRows: any[] = [];
      for (let i = 0; i < batchIds.length; i += 150) {
        const chunk = batchIds.slice(i, i + 150);
        historyRows.push(
          ...(useRds()
            ? await dashboardRepo.getAttendedWebinarAttendanceByBatchIds(chunk)
            : await pageAll(() =>
                historyDb
                  .from("webinar_attendance")
                  .select("id, lead_id, batch_id, marked_at")
                  .eq("attended", true)
                  .in("batch_id", chunk)
                  .order("id", { ascending: false }),
              )),
        );
      }
      if (historyRows.length === 0) {
        res.status(200).json({ total: 0, leads: [], webinarRows: [] });
        return;
      }

      const uniqueLeadIds = [...new Set(historyRows.map((a: any) => a.lead_id).filter(Boolean))];
      const leadMap = new Map<string, any>();
      for (let i = 0; i < uniqueLeadIds.length; i += 150) {
        const chunk = uniqueLeadIds.slice(i, i + 150);
        if (useRds()) {
          for (const lead of await dashboardRepo.getLeadDetailsForWebinarAttendees(chunk)) leadMap.set(lead.id, lead);
        } else {
          const { data: leads, error } = await historyDb
            .from("kob_leads")
            .select("id, code, full_name, phone, stage, language, created_at, assigned_to")
            .in("id", chunk);
          if (error) throw error;
          for (const lead of leads ?? []) leadMap.set(lead.id, lead);
        }
      }
      const assignedIds = [...new Set([...leadMap.values()].map((l: any) => l.assigned_to).filter(Boolean))];
      const executiveMap = new Map<string, string>();
      if (assignedIds.length) {
        for (let i = 0; i < assignedIds.length; i += 150) {
          const chunk = assignedIds.slice(i, i + 150);
          if (useRds()) {
            for (const profile of await dashboardRepo.getProfileNamesByIds(chunk)) executiveMap.set(profile.id, profile.full_name);
          } else {
            const { data: profiles, error } = await historyDb
              .from("profiles")
              .select("id, full_name")
              .in("id", chunk);
            if (error) throw error;
            for (const profile of profiles ?? []) executiveMap.set(profile.id, profile.full_name);
          }
        }
      }

      const webinarRows = historyRows.map((attendance: any) => {
        const batch = batchMap.get(attendance.batch_id) ?? {};
        const lead = leadMap.get(attendance.lead_id) ?? {};
        return {
          id: attendance.id,
          lead_id: attendance.lead_id,
          batch_name: batch.name ?? "—",
          scheduled_at: batch.scheduled_at ?? null,
          batch_language: batch.language ?? null,
          full_name: lead.full_name ?? "—",
          code: lead.code ?? "",
          phone: lead.phone ?? "",
          language: lead.language ?? "",
          executive: lead.assigned_to ? executiveMap.get(lead.assigned_to) ?? "—" : "—",
          stage: lead.stage ?? "",
          status: "Attended",
          marked_at: attendance.marked_at ?? null,
        };
      });
      res.status(200).json({ total: webinarRows.length, leads: [], webinarRows });
      return;
    } else {
      const rows = useRds()
        ? await dashboardRepo.getStageHistoryForFunnelLeads(stageKey, mode, { from, to })
        : await pageAll(() => {
            let q = supabase!
              .from("lead_stage_history")
              .select("lead_id, to_stage, created_at, changed_by")
              .eq("to_stage", stageKey as any)
              .order("created_at", { ascending: true });
            if (mode === "auto") q = q.is("changed_by", null);
            if (mode === "manual") q = q.not("changed_by", "is", null);
            if (from) q = q.gte("created_at", from);
            if (to) q = q.lte("created_at", to);
            return q;
          });
      leadIds = [...new Set(rows.map((h: any) => h.lead_id).filter(Boolean))];
    }

    if (leadIds.length === 0) {
      res.status(200).json({ total: 0, leads: [] as any[] });
      return;
    }
    const total = leadIds.length;

    const leads = useRds()
      ? await dashboardRepo.getLeadDetailsForFunnelLeads(leadIds.slice(0, 300))
      : (
          await supabase!
            .from("kob_leads")
            .select("id, code, full_name, phone, stage, language, assigned_to, created_at")
            .in("id", leadIds.slice(0, 300))
            .order("created_at", { ascending: false })
        ).data ?? [];

    res.status(200).json({ total, leads: leads as any[] });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for getChannelConversion.
 * Migrated 1:1 from src/lib/kob-dashboard.functions.ts (line 110).
 */
/** Shared aggregation used by getChannelConversion() for both backends. */
function aggregateChannelConversion(
  sources: { id: string; name: string; cost_per_lead: number | null }[],
  rows: { id: string; stage: string; source_id: string | null }[],
) {
  const byId = new Map<string, any>(sources.map((s) => [s.id, s]));
  const costOf = (name: string) =>
    Math.round(Number(sources.find((s) => String(s.name).toLowerCase() === name.toLowerCase())?.cost_per_lead ?? 0));

  const buckets: Record<string, { leads: number; converted: number }> = {
    marketing: { leads: 0, converted: 0 },
    website: { leads: 0, converted: 0 },
    whatsapp: { leads: 0, converted: 0 },
    organic: { leads: 0, converted: 0 },
    other: { leads: 0, converted: 0 },
  };
  for (const l of rows) {
    const name = String(byId.get(l.source_id as string)?.name ?? "").toLowerCase();
    const key =
      name === "meta ads" ? "marketing"
      : name === "website form" ? "website"
      : name === "whatsapp broadcast" ? "whatsapp"
      : name === "manual" || name === "support" ? "organic"
      : "other";
    buckets[key].leads += 1;
    if (l.stage === "KTN_LIVE") buckets[key].converted += 1;
  }

  const shape = (k: string, cpl: number) => ({
    leads: buckets[k].leads,
    conv: buckets[k].leads > 0 ? (buckets[k].converted / buckets[k].leads) * 100 : 0,
    cpl,
  });

  return {
    marketing: shape("marketing", costOf("Meta Ads")),
    website: shape("website", costOf("Website Form")),
    whatsapp: shape("whatsapp", costOf("WhatsApp Broadcast")),
    organic: shape("organic", 0),
    other: shape("other", 0),
    total: rows.length,
  };
}

export async function getChannelConversion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    if (useRds()) {
      if (!req.userId) { res.status(500).json({ error: "Supabase client not initialized" }); return; }
      const scope = await resolveLeadScopeOrDeny(req.userId);
      if (scope === null) { res.status(403).json({ error: "Forbidden: no role assigned" }); return; }
      const sources = await referenceRepo.listSources();
      const rows = await dashboardRepo.getLeadsIdStageSource(scope, { from, to });
      res.status(200).json(aggregateChannelConversion(sources, rows));
      return;
    }

    const supabase = req.supabase;
    if (!supabase) {
      res.status(500).json({ error: "Supabase client not initialized" });
      return;
    }

    const { data: role } = await supabase.rpc("get_user_role", { _user_id: req.userId });
    const db =
      ((role as string | null) ?? "executive") === "executive" || !process.env.SUPABASE_SERVICE_ROLE_KEY
        ? supabase
        : supabaseAdmin;

    const { data: sources } = await db.from("lead_sources").select("id, name, cost_per_lead");

    // Every lead in range, bucketed by channel — nothing is dropped.
    const rows = await pageAll(() => {
      let q = db.from("kob_leads").select("id, stage, source_id");
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to);
      return q;
    });

    res.status(200).json(aggregateChannelConversion((sources ?? []) as any[], rows as any[]));
  } catch (err) {
    next(err);
  }
}



