import { createRequire } from "module";
import { pathToFileURL } from "url";

const require = createRequire("d:/Shero Home Food/kob-unity-spark (2)/backend/package.json");
const { createClient } = require("@supabase/supabase-js");
const { loadTestEnv } = await import(pathToFileURL("d:/Shero Home Food/kob-unity-spark (2)/backend/test-env.mjs").href);

const env = loadTestEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const BACKEND_BASE = "http://localhost:3001";

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const pageAll = async (build) => {
  const all = [];
  for (let page = 0; page < 60; page++) {
    const { data } = await build().range(page * 1000, page * 1000 + 999);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
};

// ----------------------------------------------------
// SCV & INCENTIVES HELPERS (from kob.functions.ts)
// ----------------------------------------------------
async function scvPageAll(build) {
  const all = [];
  for (let page = 0; page < 200; page++) {
    const { data, error } = await build().range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

async function scvPageAllChunked(ids, build) {
  const all = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    all.push(...(await scvPageAll(() => build(chunk))));
  }
  return all;
}

const SCV_WEIGHTS_FALLBACK = { conversion: 35, tat: 25, eoi2Payment: 15, crm: 25 };
async function loadScvComponentWeights(supabase) {
  const { data } = await supabase.from("scv_component_weights").select("*").eq("id", 1).maybeSingle();
  if (!data) return { ...SCV_WEIGHTS_FALLBACK };
  return {
    conversion: Number(data.weight_conversion),
    tat: Number(data.weight_tat),
    eoi2Payment: Number(data.weight_eoi2_payment),
    crm: Number(data.weight_crm_discipline),
  };
}

async function loadIncentiveRules(supabase) {
  const { data } = await supabase.from("incentive_rules").select("*").order("sort_order");
  return data ?? [];
}

function lookupIncentive(rules, score) {
  for (const r of rules) if (score >= r.min_score && score <= r.max_score) return { label: r.label, pct: r.incentive_pct, amount: Number(r.incentive_amount ?? 0) };
  return { label: "Unrated", pct: 0, amount: 0 };
}

function currentScvMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function scvMonthRange(month) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) month = currentScvMonthKey();
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

async function scvAvailableMonths(supabase) {
  const { data } = await supabase.from("kob_leads").select("created_at").order("created_at", { ascending: true }).limit(1);
  const first = data?.[0]?.created_at ? new Date(data[0].created_at) : new Date();
  const now = new Date();
  const months = [];
  let y = now.getUTCFullYear(), m = now.getUTCMonth();
  const fy = first.getUTCFullYear(), fm = first.getUTCMonth();
  while (y > fy || (y === fy && m >= fm)) {
    months.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m--; if (m < 0) { m = 11; y--; }
  }
  return months;
}

const TAT_CLOSE_STAGES = new Set(["NO", "LATER", "NO_RESPONSE", "RETARGETING", "DEAD_LEAD", "NON_SERVICEABLE", "NO_VACANCY", "DUPLICATE_LEAD"]);
const TAT_SLA_MS = 96 * 3600000;

async function computeScvForExecs(supabase, execIds, range) {
  const r = range ?? scvMonthRange(currentScvMonthKey());
  const weights = await loadScvComponentWeights(supabase);
  const incentiveRules = await loadIncentiveRules(supabase);
  const byExec = new Map();
  if (!execIds.length) return { weights, incentiveRules, byExec };

  const leads = await scvPageAll(() =>
    supabase.from("kob_leads")
      .select("id, assigned_to, stage, created_at, stage_entered_at")
      .in("assigned_to", execIds)
      .lt("created_at", r.end)
      .order("id", { ascending: true }),
  );
  const leadIds = leads.map((l) => l.id);
  const hist = await scvPageAllChunked(leadIds, (chunk) =>
    supabase.from("lead_stage_history")
      .select("lead_id, from_stage, to_stage, created_at")
      .in("lead_id", chunk)
      .gte("created_at", r.start)
      .order("created_at", { ascending: true }),
  );
  const feePaidMoves = await scvPageAll(() =>
    supabase.from("lead_stage_history")
      .select("lead_id, changed_by, created_at")
      .eq("from_stage", "EOI_2")
      .eq("to_stage", "FEE_PAID")
      .in("changed_by", execIds)
      .gte("created_at", r.start).lt("created_at", r.end)
      .order("lead_id", { ascending: true }),
  );
  const { data: inputs } = await supabase
    .from("scv_monthly_inputs")
    .select("user_id, ktn_cs_target, crm_discipline")
    .eq("period", r.start.slice(0, 10))
    .in("user_id", execIds);
  const inputByUser = new Map((inputs ?? []).map((i) => [i.user_id, i]));

  const { data: orgTargetRow } = await supabase
    .from("kpi_targets")
    .select("target_value, effective_from")
    .eq("metric", "KTN_CS")
    .eq("period", "monthly")
    .lte("effective_from", r.start.slice(0, 10))
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const orgKtnCsTarget = orgTargetRow?.target_value != null ? Number(orgTargetRow.target_value) : null;

  const leadsByExec = {};
  for (const l of leads) (leadsByExec[l.assigned_to] ??= []).push(l);
  const histByLead = {};
  for (const h of hist) (histByLead[h.lead_id] ??= []).push(h);
  for (const arr of Object.values(histByLead)) arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const startMs = new Date(r.start).getTime();
  const endMs = new Date(r.end).getTime();
  const nowMs = Date.now();
  const inMonth = (iso) => { const t = new Date(iso).getTime(); return t >= startMs && t < endMs; };
  const clampPct = (n) => Math.max(0, Math.min(100, n));

  for (const eid of execIds) {
    const el = leadsByExec[eid] ?? [];
    const input = inputByUser.get(eid);
    const target = input?.ktn_cs_target != null ? Number(input.ktn_cs_target) : orgKtnCsTarget;

    const ktnCs = el.filter((l) => l.stage === "KTN_CS" && l.stage_entered_at && inMonth(l.stage_entered_at)).length;
    const conversionPct = target && target > 0 ? clampPct((ktnCs / target) * 100) : 0;

    let tatTotal = 0, tatPass = 0;
    const ktnLiveLeads = new Set();
    const eoi2Eligible = new Set();
    const eoi2Paid = new Set();
    for (const l of el) {
      const rows = histByLead[l.id] ?? [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (inMonth(row.created_at)) {
          if (row.to_stage === "KTN_LIVE") ktnLiveLeads.add(l.id);
          if (row.to_stage === "EOI_2") eoi2Eligible.add(l.id);
          if (row.from_stage === "EOI_2" && row.to_stage === "FEE_PAID") eoi2Eligible.add(l.id);
        }
        if (row.to_stage !== "WEBINAR" || !inMonth(row.created_at)) continue;
        const entryMs = new Date(row.created_at).getTime();
        let outcome = "pending";
        for (let j = i + 1; j < rows.length; j++) {
          const nx = rows[j];
          const t = new Date(nx.created_at).getTime();
          if (t - entryMs > TAT_SLA_MS) { outcome = "fail"; break; }
          if (nx.to_stage === "KTN_CS") { outcome = "pass"; break; }
          if (nx.to_stage === "WEBINAR") { outcome = "closed"; break; }
          if (TAT_CLOSE_STAGES.has(nx.to_stage)) { outcome = "closed"; break; }
        }
        if (outcome === "pending" && Math.min(nowMs, endMs) - entryMs > TAT_SLA_MS) outcome = "fail";
        if (outcome === "pass") { tatTotal++; tatPass++; }
        else if (outcome === "fail") tatTotal++;
      }
    }
    const tatPct = tatTotal ? (tatPass / tatTotal) * 100 : 0;
    for (const m of feePaidMoves) if (m.changed_by === eid) eoi2Paid.add(m.lead_id);
    const eoi2Pct = eoi2Eligible.size ? clampPct((eoi2Paid.size / eoi2Eligible.size) * 100) : 0;
    const crmPct = input?.crm_discipline != null ? clampPct(Number(input.crm_discipline)) : 0;

    const points =
      (conversionPct * weights.conversion + tatPct * weights.tat +
        eoi2Pct * weights.eoi2Payment + crmPct * weights.crm) / 100;
    const finalScore = Math.min(100, Math.round(points));
    const slab = lookupIncentive(incentiveRules, finalScore);

    byExec.set(eid, {
      total: el.length,
      conversionPct: Math.round(conversionPct),
      tatPct: Math.round(tatPct),
      tatCycles: tatTotal, tatPass, tatFail: tatTotal - tatPass,
      eoi2EligibleCount: eoi2Eligible.size,
      conversionPoints: Math.round(conversionPct * weights.conversion) / 100,
      tatPoints: Math.round(tatPct * weights.tat) / 100,
      eoi2Points: Math.round(eoi2Pct * weights.eoi2Payment) / 100,
      crmPoints: Math.round(crmPct * weights.crm) / 100,
      eoi2Pct: Math.round(eoi2Pct),
      crmPct: Math.round(crmPct),
      crmInput: input?.crm_discipline != null ? Number(input.crm_discipline) : null,
      finalScore,
      slabLabel: slab.label,
      incentivePct: slab.pct,
      ktnCs,
      ktnLive: ktnLiveLeads.size,
      feePaid: eoi2Paid.size,
    });
  }
  return { weights, incentiveRules, byExec };
}

const TAT_MOVEMENT_DEFS = {
  lead_eoi1: { from: ["LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE"], to: "EOI_1" },
  eoi1_webinar: { from: ["EOI_1"], to: "WEBINAR" },
  webinar_eoi2: { from: ["WEBINAR", "EOI2_PENDING"], to: "EOI_2" },
  eoi2_payment: { from: ["EOI_2"], to: "FEE_PAID" },
  payment_contract: { from: ["FEE_PAID"], to: "KTN_CS" },
};

async function loadScvModeConfig(supabase, mode) {
  const { data } = await supabase.from("scv_mode_config").select("*").eq("mode", mode).maybeSingle();
  return {
    components: data?.components ?? [],
    tatMovements: data?.tat_movements ?? [],
    incentiveAmount: Number(data?.incentive_amount ?? 10000),
  };
}

async function fetchScvRoster(supabase, cols = "id, full_name") {
  const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "executive");
  const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
  if (!ids.length) return [];
  const { data } = await supabase.from("profiles").select(cols).in("id", ids).order("full_name");
  return data ?? [];
}

async function computeScvModeForExecs(supabase, execIds, mode, r) {
  const cfg = await loadScvModeConfig(supabase, mode);
  const comps = cfg.components.filter((c) => c.enabled);
  const incentiveRules = await loadIncentiveRules(supabase);
  const byExec = new Map();
  if (!execIds.length) return { cfg, byExec };

  const leads = await scvPageAll(() =>
    supabase.from("kob_leads")
      .select("id, code, full_name, assigned_to, stage, created_at, stage_entered_at, mode")
      .in("assigned_to", execIds).eq("mode", mode)
      .lt("created_at", r.end)
      .order("id", { ascending: true }),
  );
  const leadIds = leads.map((l) => l.id);
  const lookback = new Date(new Date(r.start).getTime() - 90 * 86400000).toISOString();
  const hist = await scvPageAllChunked(leadIds, (chunk) =>
    supabase.from("lead_stage_history")
      .select("lead_id, from_stage, to_stage, changed_by, created_at")
      .in("lead_id", chunk).gte("created_at", lookback).lt("created_at", r.end)
      .order("created_at", { ascending: true }),
  );
  const feeMovesAll = await scvPageAll(() =>
    supabase.from("lead_stage_history")
      .select("lead_id, changed_by")
      .eq("from_stage", "EOI_2").eq("to_stage", "FEE_PAID")
      .in("changed_by", execIds)
      .gte("created_at", r.start).lt("created_at", r.end)
      .order("lead_id", { ascending: true }),
  );
  const feeLeadIds = Array.from(new Set(feeMovesAll.map((m) => m.lead_id)));
  const modeOk = new Set();
  for (let i = 0; i < feeLeadIds.length; i += 150) {
    const { data } = await supabase.from("kob_leads").select("id").in("id", feeLeadIds.slice(i, i + 150)).eq("mode", mode);
    for (const d of data ?? []) modeOk.add(d.id);
  }
  const ktnLeads = await scvPageAll(() =>
    supabase.from("kob_leads")
      .select("id, assigned_to, stage_entered_at")
      .eq("stage", "KTN_CS")
      .in("assigned_to", execIds)
      .gte("stage_entered_at", r.start).lt("stage_entered_at", r.end)
      .order("id", { ascending: true }),
  );
  const ktnCsByExec = new Map();
  const ktnWeeklyByExec = new Map();
  const monthStartMs = new Date(r.start).getTime();
  for (const l of ktnLeads) {
    const wk = Math.min(3, Math.floor((new Date(l.stage_entered_at).getTime() - monthStartMs) / (7 * 86400000)));
    const arr = ktnWeeklyByExec.get(l.assigned_to) ?? [0, 0, 0, 0];
    arr[Math.max(0, wk)]++;
    ktnWeeklyByExec.set(l.assigned_to, arr);
  }
  for (const l of ktnLeads) {
    (ktnCsByExec.get(l.assigned_to) ?? ktnCsByExec.set(l.assigned_to, new Set()).get(l.assigned_to)).add(l.id);
  }
  const { data: inputs } = await supabase.from("scv_mode_inputs")
    .select("user_id, ktn_cs_target, discipline, marks")
    .eq("period", r.start.slice(0, 10)).eq("mode", mode).in("user_id", execIds);
  const inputByUser = new Map((inputs ?? []).map((i) => [i.user_id, i]));
  const { data: orgTargetRow } = await supabase.from("kpi_targets")
    .select("target_value").eq("metric", "KTN_CS").eq("period", "monthly")
    .lte("effective_from", r.start.slice(0, 10)).order("effective_from", { ascending: false }).limit(1).maybeSingle();
  const orgKtnCsTarget = orgTargetRow?.target_value != null ? Number(orgTargetRow.target_value) : null;

  const leadsByExec = {};
  for (const l of leads) (leadsByExec[l.assigned_to] ??= []).push(l);
  const histByLead = {};
  for (const h of hist) (histByLead[h.lead_id] ??= []).push(h);

  const startMs = new Date(r.start).getTime();
  const endMs = new Date(r.end).getTime();
  const inMonth = (iso) => { const t = new Date(iso).getTime(); return t >= startMs && t < endMs; };
  const clampPct = (n) => Math.max(0, Math.min(100, n));
  const tatDefs = cfg.tatMovements.filter((m) => m.enabled && TAT_MOVEMENT_DEFS[m.key] && Number(m.days) > 0);

  for (const eid of execIds) {
    const el = leadsByExec[eid] ?? [];
    const input = inputByUser.get(eid);
    const target = input?.ktn_cs_target != null ? Number(input.ktn_cs_target) : orgKtnCsTarget;
    const ktnCs = ktnCsByExec.get(eid)?.size ?? 0;
    const conversionPct = target && target > 0 ? clampPct((ktnCs / target) * 100) : 0;

    let tatSum = 0, tatCount = 0;
    const tatPer = new Map();
    for (const m of tatDefs) tatPer.set(m.key, { leads: new Set(), daysSum: 0, n: 0, scoreSum: 0, rows: [] });
    const ktnLive = new Set();
    const eoi1Eligible = new Set(), eoi1Moved = new Set();
    const eoi2Eligible = new Set(), eoi2Paid = new Set();
    for (const l of el) {
      const rows = histByLead[l.id] ?? [];
      const seenMove = new Set();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!inMonth(row.created_at)) continue;
        if (row.to_stage === "KTN_LIVE") ktnLive.add(l.id);
        if (row.to_stage === "EOI_1") eoi1Eligible.add(l.id);
        if (row.from_stage === "EOI_1" && row.to_stage === "WEBINAR") { eoi1Eligible.add(l.id); eoi1Moved.add(l.id); }
        if (row.to_stage === "EOI_2") eoi2Eligible.add(l.id);
        if (row.from_stage === "EOI_2" && row.to_stage === "FEE_PAID") {
          eoi2Eligible.add(l.id);
          if (mode === "AUTO") eoi2Paid.add(l.id);
        }
        for (const m of tatDefs) {
          const def = TAT_MOVEMENT_DEFS[m.key];
          if (row.to_stage !== def.to || !def.from.includes(row.from_stage)) continue;
          const k = `${m.key}`;
          if (seenMove.has(k)) continue;
          let enteredMs = null;
          for (let j = i - 1; j >= 0; j--) if (rows[j].to_stage === row.from_stage) { enteredMs = new Date(rows[j].created_at).getTime(); break; }
          if (enteredMs == null && m.key === "lead_eoi1") enteredMs = new Date(l.created_at).getTime();
          if (enteredMs == null) continue;
          let returned = false;
          for (let j = i + 1; j < rows.length; j++) if (def.from.includes(rows[j].to_stage)) { returned = true; break; }
          if (returned) continue;
          seenMove.add(k);
          const actualDays = (new Date(row.created_at).getTime() - enteredMs) / 86400000;
          const moveScore = actualDays <= 0 ? 100 : clampPct((Number(m.days) / actualDays) * 100);
          tatSum += moveScore;
          tatCount++;
          const pm = tatPer.get(m.key); pm.leads.add(l.id); pm.daysSum += Math.max(0, actualDays); pm.n++; pm.scoreSum += moveScore;
          pm.rows.push({ leadId: l.id, code: l.code, name: l.full_name, fromAt: new Date(enteredMs).toISOString(), toAt: row.created_at, days: Math.max(0, actualDays) });
        }
      }
    }
    if (mode !== "AUTO") for (const mv of feeMovesAll) if (mv.changed_by === eid && modeOk.has(mv.lead_id)) eoi2Paid.add(mv.lead_id);
    const tatAch = new Map();
    for (const m of tatDefs) { const pm = tatPer.get(m.key); tatAch.set(m.key, pm.n ? pm.scoreSum / pm.n : 0); }
    const tatPct = tatDefs.length ? tatDefs.reduce((s, m) => s + tatAch.get(m.key), 0) / tatDefs.length : 0;
    const eoi1Pct = eoi1Eligible.size ? clampPct((eoi1Moved.size / eoi1Eligible.size) * 100) : 0;
    const eoi2Pct = eoi2Eligible.size ? clampPct((eoi2Paid.size / eoi2Eligible.size) * 100) : 0;
    const disciplinePct = input?.discipline != null ? clampPct(Number(input.discipline)) : 0;
    const marks = input?.marks ?? {};

    let points = 0;
    const components = comps.map((c) => {
      let pct = 0, detail = "";
      switch (c.type) {
        case "conversion": pct = conversionPct; detail = `KTN CS ${ktnCs} / Target ${target ?? "—"}`; break;
        case "tat": pct = tatPct; detail = `${tatCount} movements measured`; break;
        case "eoi1Webinar": pct = eoi1Pct; detail = `Webinar ${eoi1Moved.size} / EOI 1 ${eoi1Eligible.size}`; break;
        case "eoi2Payment": pct = eoi2Pct; detail = `Fee Paid ${eoi2Paid.size} / EOI 2 ${eoi2Eligible.size}`; break;
        case "discipline": pct = disciplinePct; detail = `Mark ${input?.discipline ?? "—"}`; break;
        default: pct = marks[c.key] != null ? clampPct(Number(marks[c.key])) : 0; detail = `Mark ${marks[c.key] ?? "—"}`;
      }
      const pts = (pct * Number(c.weight)) / 100;
      points += pts;
      const tatBreakdown = c.type === "tat" ? tatDefs.map((m) => { const pm = tatPer.get(m.key); return { key: m.key, label: m.label ?? m.key, targetDays: Number(m.days), avgDays: pm.n ? Math.round((pm.daysSum / pm.n) * 10) / 10 : null, count: pm.leads.size, rows: pm.rows, achievementPct: Math.round(tatAch.get(m.key) * 10) / 10, maxPoints: Math.round((Number(c.weight) / tatDefs.length) * 10000) / 10000, earnedPoints: Math.round(((tatAch.get(m.key) / 100) * (Number(c.weight) / tatDefs.length)) * 100) / 100 }; }) : undefined;
      return { key: c.key, label: c.label, weight: Number(c.weight), pct: Math.round(pct), points: Math.round(pts * 100) / 100, detail, type: c.type, tatBreakdown };
    });
    const finalScore = Math.min(100, Math.round(points));
    const slab = lookupIncentive(incentiveRules, finalScore);
    byExec.set(eid, {
      components, finalScore, slabLabel: slab.label, incentivePct: slab.pct, slabAmount: slab.amount,
      ktnCs, ktnLive: ktnLive.size, ktnCsTarget: target,
      ktnWeekly: ktnWeeklyByExec.get(eid) ?? [0, 0, 0, 0],
      weeklyTarget: target && target > 0 ? target / 4 : null,
      discipline: input?.discipline != null ? Number(input.discipline) : null,
      rawTarget: input?.ktn_cs_target ?? null, marks,
    });
  }
  return { cfg, byExec };
}

// ----------------------------------------------------
// COHORT RESPONSES (from kob-dashboard.functions.ts)
// ----------------------------------------------------
async function autoCohortResponses(supabase, windows, sources, targets, manual = false) {
  const leads = new Map();
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
  const hist = [];
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

// ----------------------------------------------------
// OLD IMPLEMENTATIONS
// ----------------------------------------------------

// 1. oldGetRetargetingFunnel
async function oldGetRetargetingFunnel(client, r = {}) {
  const FROM = ["NO", "LATER", "NO_RESPONSE"];
  const TO = ["LEAD_INBOX", "EOI_1", "WEBINAR"];
  const rows = await pageAll(() => {
    let q = client
      .from("lead_stage_history")
      .select("lead_id, from_stage, to_stage, created_at")
      .in("from_stage", FROM)
      .in("to_stage", TO)
      .order("created_at", { ascending: true });
    if (r.from) q = q.gte("created_at", r.from);
    if (r.to) q = q.lte("created_at", r.to);
    return q;
  });
  const sets = {
    LEAD_INBOX: new Set(),
    EOI_1: new Set(),
    WEBINAR: new Set(),
  };
  for (const row of rows) {
    if (!row.lead_id) continue;
    const s = sets[row.to_stage];
    if (s) s.add(row.lead_id);
  }

  const IST_MS = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + IST_MS);
  const istDay = (iso) =>
    new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
  const todayIst = nowIst.toISOString().slice(0, 10);
  const days = [];
  for (let i = 1; i <= 5; i++) {
    days.push(new Date(nowIst.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  const monthStart = todayIst.slice(0, 8) + "01";
  const earliest = days[days.length - 1] < monthStart ? days[days.length - 1] : monthStart;
  const windowFrom = new Date(new Date(`${earliest}T00:00:00.000Z`).getTime() - IST_MS).toISOString();

  const tableRows = await pageAll(() =>
    client
      .from("lead_stage_history")
      .select("lead_id, from_stage, to_stage, created_at")
      .in("from_stage", FROM)
      .in("to_stage", TO)
      .gte("created_at", windowFrom)
      .order("created_at", { ascending: true }),
  );

  const perDay = {};
  const perMtd = {};
  for (const t of TO) {
    perDay[t] = {};
    for (const d of days) perDay[t][d] = new Set();
    perMtd[t] = new Set();
  }
  for (const row of tableRows) {
    if (!row.lead_id) continue;
    const t = row.to_stage;
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
  );

  return {
    leadInbox: sets.LEAD_INBOX.size,
    eoi1: sets.EOI_1.size,
    webinar: sets.WEBINAR.size,
    days,
    table,
  };
}

// 2. oldGetRetargetingQueue
async function oldGetRetargetingQueue(client) {
  const all = [];
  for (let page = 0; page < 20; page++) {
    const { data } = await client
      .from("v_retargeting_queue")
      .select("*")
      .order("next_touch_at")
      .range(page * 1000, page * 1000 + 999);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

// 3. oldGetRetargetingSplit
async function oldGetRetargetingSplit(client, data = {}) {
  const IST_MS = 5.5 * 60 * 60 * 1000;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(data?.asOf ?? "")) ? String(data.asOf) : new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
  const cutoff = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_MS + 86400000 - 1).toISOString();
  const rows = await pageAll(() =>
    client.from("lead_stage_history").select("lead_id, to_stage")
      .in("from_stage", ["NO", "LATER", "NO_RESPONSE"])
      .in("to_stage", ["LEAD_INBOX", "EOI_1", "WEBINAR"])
      .lte("created_at", cutoff).order("created_at", { ascending: true }),
  );
  const sets = { LEAD_INBOX: new Set(), EOI_1: new Set(), WEBINAR: new Set() };
  for (const r of rows) if (r.lead_id) sets[r.to_stage]?.add(r.lead_id);
  return { asOf: day, leadInbox: sets.LEAD_INBOX.size, eoi1: sets.EOI_1.size, webinar: sets.WEBINAR.size };
}

// 4. oldGetScvComponentWeights
async function oldGetScvComponentWeights(client) {
  const weights = await loadScvComponentWeights(client);
  const { data: history } = await client
    .from("scv_weight_changes")
    .select("id, changed_by, component, previous_weight, new_weight, changed_at")
    .order("changed_at", { ascending: false })
    .limit(50);
  const ids = Array.from(new Set((history ?? []).map((h) => h.changed_by).filter(Boolean)));
  const names = new Map();
  if (ids.length) {
    const { data: profs } = await client.from("profiles").select("id, full_name").in("id", ids);
    (profs ?? []).forEach((p) => names.set(p.id, p.full_name));
  }
  return {
    weights,
    history: (history ?? []).map((h) => ({ ...h, changed_by_name: names.get(h.changed_by) ?? "—" })),
  };
}

// 5. oldGetScvLeaderboard
async function oldGetScvLeaderboard(client, data = {}) {
  const { data: execs } = await client
    .from("user_roles").select("user_id")
    .eq("role", "executive");
  const rows = execs ?? [];
  const execIds = rows.map((r) => r.user_id);
  const { data: profs } = execIds.length
    ? await client.from("profiles").select("id, full_name").in("id", execIds)
    : { data: [] };
  const names = {};
  for (const p of profs ?? []) names[p.id] = p.full_name ?? "—";
  const { byExec } = await computeScvForExecs(client, execIds, scvMonthRange(data.month));
  const out = execIds.map((id) => {
    const s = byExec.get(id) ?? { total: 0, ktnLive: 0, feePaid: 0, finalScore: 0 };
    return {
      user_id: id, full_name: names[id] ?? "—",
      lead_count: s.total, avg_scv: s.finalScore,
      conversions: s.ktnLive, fee_paid: s.feePaid,
    };
  });
  out.sort((a, b) => b.avg_scv - a.avg_scv || b.conversions - a.conversions);
  return { rows: out.slice(0, 20), months: await scvAvailableMonths(client) };
}

// 6. oldGetScvModeIncentives
async function oldGetScvModeIncentives(client, userId, adminClient, data = {}) {
  const reader = adminClient || client;
  const { data: conf } = await reader.from("kob_configuration").select("default_mode, incentive_amount").eq("id", 1).maybeSingle();
  const activeMode = conf?.default_mode === "MANUAL" ? "MANUAL" : "AUTO";
  const incentiveAmount = Number(conf?.incentive_amount ?? 10000);
  const mode = data.mode ?? activeMode;
  const team = await fetchScvRoster(reader);
  const { cfg, byExec } = await computeScvModeForExecs(reader, team.map((t) => t.id), mode, scvMonthRange(data.month));
  const rows = team.map((e) => {
    const s = byExec.get(e.id) ?? { components: [], finalScore: 0, slabLabel: "Unrated", incentivePct: 0, ktnCs: 0, ktnLive: 0, ktnCsTarget: null, discipline: null, rawTarget: null, marks: {} };
    const wt = s.weeklyTarget;
    const weekly = s.ktnWeekly ?? [0, 0, 0, 0];
    const amount = wt ? weekly.reduce((sum, c) => sum + (c >= wt ? c * incentiveAmount : 0), 0) : 0;
    return { id: e.id, name: e.full_name, ...s, amount: Math.round(amount) };
  });
  const [{ data: isMgr }, { data: isAdmin }, { data: isTL }] = await Promise.all([
    client.rpc("has_role", { _user_id: userId, _role: "kob_manager" }),
    client.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    client.rpc("has_role", { _user_id: userId, _role: "team_leader" }),
  ]);
  const { data: slabRows } = await reader.from("incentive_rules").select("label, min_score, max_score, incentive_pct, incentive_amount").order("sort_order");
  return {
    mode, activeMode, rows,
    components: cfg.components.filter((c) => c.enabled),
    slabs: (slabRows ?? []).map((r) => ({ label: r.label, minScore: Number(r.min_score), maxScore: Number(r.max_score), pct: Number(r.incentive_pct), amount: Number(r.incentive_amount) })),
    months: await scvAvailableMonths(client),
    canEditTargets: !!(isMgr || isAdmin || isTL),
    canEditConfig: !!(isMgr || isAdmin),
  };
}

// 7. oldGetStageResponseSplit
async function oldGetStageResponseSplit(client, data) {
  const IST_MS_A = 5.5 * 60 * 60 * 1000;
  const nowIstA = new Date(Date.now() + IST_MS_A);
  const monthStart = new Date(
    Date.UTC(nowIstA.getUTCFullYear(), nowIstA.getUTCMonth(), 1) - IST_MS_A,
  ).toISOString();
  const monthEnd = new Date().toISOString();
  const from = data.from ?? monthStart;
  const to = data.to ?? monthEnd;

  const SOURCES = {
    AUTO_FIRED: ["AUTO_FIRED", "EOI_1"],
    WEBINAR: ["WEBINAR"],
    EOI_2: ["EOI_2"],
  };
  const SUCCESS = {
    AUTO_FIRED: ["WEBINAR"],
    WEBINAR: ["EOI_2"],
    EOI_2: ["FORM_FILLED", "FEE_PAID"],
  };
  const negatives = ["NO", "NO_RESPONSE", "LATER"];
  const targets = [...SUCCESS[data.stageKey], ...negatives];

  const { leads, hist } = await autoCohortResponses(
    client,
    [{ from, to }, { from: monthStart, to: monthEnd }],
    [...SOURCES[data.stageKey]],
    targets,
    false,
  );

  const keys = ["INTERESTED", ...negatives];
  const mk = () =>
    Object.fromEntries(keys.map((k) => [k, new Set()]));
  const life = mk();
  const mtd = mk();
  const successSet = new Set(SUCCESS[data.stageKey]);
  for (const r of hist) {
    const created = leads.get(r.lead_id);
    if (!created) continue;
    const k = successSet.has(r.to_stage) ? "INTERESTED" : r.to_stage;
    if (!life[k]) continue;
    if (created >= from && created <= to) life[k].add(r.lead_id);
    if (created >= monthStart && created <= monthEnd) mtd[k].add(r.lead_id);
  }

  return keys.reduce(
    (acc, k) => {
      acc[k] = { mtd: mtd[k].size, lifetime: life[k].size };
      return acc;
    },
    {},
  );
}

// 8. oldGetStateSpread
async function oldGetStateSpread(client) {
  const { data: states } = await client.from("india_states").select("id, name");
  const nameById = new Map((states ?? []).map((s) => [s.id, s.name]));

  const rows = [];
  for (let i = 0; ; i += 1000) {
    const { data: page } = await client
      .from("kob_leads")
      .select("state_id, stage, notes")
      .range(i, i + 999);
    const p = page ?? [];
    rows.push(...p);
    if (p.length < 1000) break;
  }

  const pinOf = (notes) => notes?.match(/(\d{6})/)?.[1] ?? null;
  const pins = Array.from(
    new Set(rows.filter((l) => !l.state_id).map((l) => pinOf(l.notes)).filter(Boolean)),
  );
  const stateByPin = new Map();
  for (let i = 0; i < pins.length; i += 500) {
    const { data: pr } = await client
      .from("india_pincodes")
      .select("pincode, state")
      .in("pincode", pins.slice(i, i + 500));
    for (const p of pr ?? []) if (!stateByPin.has(p.pincode)) stateByPin.set(p.pincode, p.state);
  }
  const titleCase = (s) =>
    s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

  const total = rows.length || 1;
  const agg = new Map();
  for (const l of rows) {
    let key = null;
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

  return Array.from(agg.entries())
    .filter(([, v]) => v.leads > 0)
    .map(([name, v]) => ({
      state: name,
      leads: v.leads,
      conv: `${((v.contracts / v.leads) * 100).toFixed(2)}%`,
      coverage: `${((v.leads / total) * 100).toFixed(2)}%`,
    }))
    .sort((a, b) => b.leads - a.leads);
}

// ----------------------------------------------------
// RUNNER
// ----------------------------------------------------
async function run() {
  console.log("==================================================");
  console.log("STARTING BATCH 8 REGRESSION SUITE");
  console.log("==================================================");

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Authenticate user
  const { data: authData, error: authErr } = await client.auth.signInWithPassword({
    email: env.TEST_USER_EMAIL,
    password: env.TEST_USER_PASSWORD,
  });
  if (authErr || !authData.session) {
    console.error("Failed to authenticate test user:", authErr);
    process.exit(1);
  }
  const token = authData.session.access_token;
  const userId = authData.user.id;
  console.log(`Authenticated as: ${env.TEST_USER_EMAIL} (${userId})`);

  // DB Count Snapshot
  const { count: leadsCountBefore } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: histCountBefore } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: retargetCountBefore } = await adminClient.from("retargeting_schedule").select("*", { count: "exact", head: true });

  const results = [];

  async function check(name, oldFn, path) {
    process.stdout.write(`Testing ${name}... `);
    const oldRes = await oldFn();
    const res = await fetch(`${BACKEND_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const errTxt = await res.text();
      console.log(`FAILED! HTTP ${res.status}: ${errTxt}`);
      results.push({ Function: name, Status: "HTTP_FAIL", Match: "NO" });
      process.exit(1);
    }
    const newRes = await res.json();
    let match = deepEqual(oldRes, newRes);
    if (!match && name === "getRetargetingQueue") {
      const sOld = [...oldRes].sort((a, b) => a.id.localeCompare(b.id));
      const sNew = [...newRes].sort((a, b) => a.id.localeCompare(b.id));
      match = deepEqual(sOld, sNew);
    }
    if (!match) {
      console.log("MISMATCH!");
      console.log("OLD:", JSON.stringify(oldRes, null, 2).slice(0, 500));
      console.log("NEW:", JSON.stringify(newRes, null, 2).slice(0, 500));
      results.push({ Function: name, Status: "MISMATCH", Match: "NO" });
      process.exit(1);
    }
    console.log("PASS ✓ (Deep Match)");
    results.push({ Function: name, Status: "PASS", Match: "YES" });
  }

  // 1. getRetargetingFunnel
  await check(
    "getRetargetingFunnel (no filter)",
    () => oldGetRetargetingFunnel(client),
    `/api/dashboard/retargeting-funnel`,
  );
  await check(
    "getRetargetingFunnel (current month)",
    () => {
      const IST_MS = 5.5 * 60 * 60 * 1000;
      const nowIst = new Date(Date.now() + IST_MS);
      const start = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS).toISOString();
      const end = new Date().toISOString();
      return oldGetRetargetingFunnel(client, { from: start, to: end });
    },
    (() => {
      const IST_MS = 5.5 * 60 * 60 * 1000;
      const nowIst = new Date(Date.now() + IST_MS);
      const start = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS).toISOString();
      const end = new Date().toISOString();
      return `/api/dashboard/retargeting-funnel?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`;
    })(),
  );
  await check(
    "getRetargetingFunnel (custom range 2026-06 to 2026-08)",
    () => oldGetRetargetingFunnel(client, { from: "2026-06-01T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z" }),
    `/api/dashboard/retargeting-funnel?from=2026-06-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z`,
  );

  // 2. getRetargetingQueue
  await check(
    "getRetargetingQueue",
    () => oldGetRetargetingQueue(client),
    `/api/kob/retargeting-queue`,
  );

  // 3. getRetargetingSplit
  await check(
    "getRetargetingSplit (no asOf)",
    () => oldGetRetargetingSplit(client),
    `/api/dashboard/retargeting-split`,
  );
  await check(
    "getRetargetingSplit (asOf 2026-08-15)",
    () => oldGetRetargetingSplit(client, { asOf: "2026-08-15" }),
    `/api/dashboard/retargeting-split?asOf=2026-08-15`,
  );

  // 4. getScvComponentWeights
  await check(
    "getScvComponentWeights",
    () => oldGetScvComponentWeights(client),
    `/api/kob/scv-component-weights`,
  );

  // 5. getScvLeaderboard
  await check(
    "getScvLeaderboard (no month)",
    () => oldGetScvLeaderboard(client),
    `/api/kob/scv-leaderboard`,
  );
  await check(
    "getScvLeaderboard (month 2026-07)",
    () => oldGetScvLeaderboard(client, { month: "2026-07" }),
    `/api/kob/scv-leaderboard?month=2026-07`,
  );

  // 6. getScvModeIncentives
  await check(
    "getScvModeIncentives (no month, no mode)",
    () => oldGetScvModeIncentives(client, userId, adminClient),
    `/api/kob/scv-mode-incentives`,
  );
  await check(
    "getScvModeIncentives (mode AUTO, month 2026-07)",
    () => oldGetScvModeIncentives(client, userId, adminClient, { mode: "AUTO", month: "2026-07" }),
    `/api/kob/scv-mode-incentives?mode=AUTO&month=2026-07`,
  );
  await check(
    "getScvModeIncentives (mode MANUAL, month 2026-08)",
    () => oldGetScvModeIncentives(client, userId, adminClient, { mode: "MANUAL", month: "2026-08" }),
    `/api/kob/scv-mode-incentives?mode=MANUAL&month=2026-08`,
  );

  // 7. getStageResponseSplit
  await check(
    "getStageResponseSplit (AUTO_FIRED, no filter)",
    () => oldGetStageResponseSplit(client, { stageKey: "AUTO_FIRED" }),
    `/api/dashboard/stage-response-split?stageKey=AUTO_FIRED`,
  );
  await check(
    "getStageResponseSplit (WEBINAR, custom range)",
    () => oldGetStageResponseSplit(client, { stageKey: "WEBINAR", from: "2026-06-01T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z" }),
    `/api/dashboard/stage-response-split?stageKey=WEBINAR&from=2026-06-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z`,
  );
  await check(
    "getStageResponseSplit (EOI_2, current month)",
    () => {
      const IST_MS = 5.5 * 60 * 60 * 1000;
      const nowIst = new Date(Date.now() + IST_MS);
      const start = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS).toISOString();
      const end = new Date().toISOString();
      return oldGetStageResponseSplit(client, { stageKey: "EOI_2", from: start, to: end });
    },
    (() => {
      const IST_MS = 5.5 * 60 * 60 * 1000;
      const nowIst = new Date(Date.now() + IST_MS);
      const start = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS).toISOString();
      const end = new Date().toISOString();
      return `/api/dashboard/stage-response-split?stageKey=EOI_2&from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`;
    })(),
  );

  // 8. getStateSpread
  await check(
    "getStateSpread",
    () => oldGetStateSpread(client),
    `/api/dashboard/state-spread`,
  );

  // 9. Auth Failure Verification (401 when no token)
  process.stdout.write("Testing Auth Failure (no token)... ");
  const unauthRes = await fetch(`${BACKEND_BASE}/api/dashboard/state-spread`);
  if (unauthRes.status !== 401) {
    console.log(`FAILED! Expected 401, got ${unauthRes.status}`);
    process.exit(1);
  }
  console.log("PASS ✓ (HTTP 401)");

  // 10. Database Writes Verification
  const { count: leadsCountAfter } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: histCountAfter } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: retargetCountAfter } = await adminClient.from("retargeting_schedule").select("*", { count: "exact", head: true });

  const leadsDelta = leadsCountAfter - leadsCountBefore;
  const histDelta = histCountAfter - histCountBefore;
  const retargetDelta = retargetCountAfter - retargetCountBefore;
  const totalDelta = leadsDelta + histDelta + retargetDelta;

  console.log("\nDatabase Write Check:");
  console.log(`  Leads delta: ${leadsDelta}`);
  console.log(`  Stage history delta: ${histDelta}`);
  console.log(`  Retargeting schedule delta: ${retargetDelta}`);
  console.log(`  Total DB mutations during test: ${totalDelta}`);

  if (totalDelta !== 0) {
    console.error("ERROR: Database mutations detected during read-only tests!");
    process.exit(1);
  }

  console.log("\n==================================================");
  console.log("BATCH 8 REGRESSION SUMMARY");
  console.log("==================================================");
  console.table(results);
  console.log("\nFINAL PARITY RESULT: PASS ✓");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
