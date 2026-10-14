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

const bounds = (spans) => ({
  min: spans.reduce((a, s) => (s.from < a ? s.from : a), spans[0].from),
  max: spans.reduce((a, s) => (s.to > a ? s.to : a), spans[0].to),
});

const inSpan = (ts, s) => ts >= s.from && ts <= s.to;

function makeCounter(spans, out) {
  const seen = spans.map(() => ({}));
  return (i, key, leadId) => {
    const bag = (seen[i][key] ??= new Set());
    if (bag.has(leadId)) return;
    bag.add(leadId);
    out[i][key] += 1;
  };
}

// ----------------------------------------------------
// 1. OLD getManualFunnelBuckets implementation
// ----------------------------------------------------
const MANUAL_PROGRESSIONS = [
  { key: "eoi1", to: "EOI_1", from: ["LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE"] },
  { key: "webinar", to: "WEBINAR", from: ["EOI_1"] },
  { key: "eoi2", to: "EOI_2", from: ["WEBINAR", "WEBINAR_ATTENDED", "EOI2_PENDING"] },
  { key: "feePaid", to: "FEE_PAID", from: ["EOI_2"] },
  { key: "contractSigned", to: "KTN_CS", from: ["FEE_PAID"] },
];

function manualProgressionKey(from, to) {
  if (!from) return null;
  const p = MANUAL_PROGRESSIONS.find((x) => x.to === to);
  if (!p || !p.from.includes(from)) return null;
  return p.key;
}

async function oldComputeManualBuckets(supabase, spans) {
  const out = spans.map(() => ({
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
  const cohorts = spans.map(
    (s) => new Set(cohortLeads.filter((l) => inSpan(l.created_at, s)).map((l) => l.id)),
  );
  spans.forEach(
    (s, i) =>
      (out[i].leadGenerated = cohortLeads.filter(
        (l) => l.mode === "MANUAL" && inSpan(l.created_at, s),
      ).length),
  );

  const bump = makeCounter(spans, out);
  const ids = cohortLeads.map((l) => l.id);
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
      const key = manualProgressionKey(h.from_stage, h.to_stage);
      if (!key) continue;
      cohorts.forEach((set, i) => {
        if (set.has(h.lead_id)) bump(i, key, h.lead_id);
      });
    }
  }

  return out;
}

// ----------------------------------------------------
// 2. OLD getManualStageResponseSplit implementation
// ----------------------------------------------------
async function oldAutoCohortResponses(
  supabase,
  windows,
  sources,
  targets,
  manual = false,
) {
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

const OLD_MANUAL_SPLIT_SUCCESS = {
  EOI_1: ["WEBINAR"],
  WEBINAR: ["EOI_2"],
  EOI_2: ["FORM_FILLED", "FEE_PAID", "KTN_CS"],
};

async function oldGetManualStageResponseSplit(supabase, { stageKey, from: customFrom, to: customTo }) {
  const IST_MS = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + IST_MS);
  const y = nowIst.getUTCFullYear();
  const m = nowIst.getUTCMonth();
  const rangeStart = new Date(Date.UTC(y, m, 1) - IST_MS).toISOString();
  const rangeEnd = new Date().toISOString();

  const successTargets = OLD_MANUAL_SPLIT_SUCCESS[stageKey] ?? [];
  const negatives = ["NO", "NO_RESPONSE", "LATER"];

  const from = customFrom ?? rangeStart;
  const to = customTo ?? rangeEnd;

  const { leads, hist } = await oldAutoCohortResponses(
    supabase,
    [{ from, to }, { from: rangeStart, to: rangeEnd }],
    [stageKey],
    [...successTargets, ...negatives],
    true,
  );

  const keys = ["INTERESTED", "NO", "NO_RESPONSE", "LATER"];
  const life = {};
  const mtd = {};
  for (const k of keys) {
    life[k] = new Set();
    mtd[k] = new Set();
  }

  for (const r of hist) {
    const created = leads.get(r.lead_id);
    if (!created) continue;
    const k = successTargets.includes(r.to_stage) ? "INTERESTED" : r.to_stage;
    if (!life[k]) continue;
    if (created >= from && created <= to) life[k].add(r.lead_id);
    if (created >= rangeStart && created <= rangeEnd) mtd[k].add(r.lead_id);
  }

  const out = {};
  for (const k of keys) out[k] = { mtd: mtd[k].size, lifetime: life[k].size };
  return out;
}

// ----------------------------------------------------
// 3. OLD getMarketingKpis implementation
// ----------------------------------------------------
function monthStart(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function nextMonthStart(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

async function oldComputeMarketingTotals(supabase, fromIso, toIso, spendOverride) {
  const { data: leads } = await supabase
    .from("kob_leads")
    .select("stage, lead_sources(cost_per_lead)")
    .gte("created_at", fromIso)
    .lt("created_at", toIso);
  const rows = leads ?? [];
  const totalLeads = rows.length;
  const totalSpend =
    spendOverride !== undefined
      ? spendOverride
      : rows.reduce((s, l) => s + Number(l.lead_sources?.cost_per_lead ?? 0), 0);
  const ktnLive = rows.filter((l) => l.stage === "KTN_LIVE").length;
  const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const cac = ktnLive > 0 ? totalSpend / ktnLive : 0;
  return { SPEND: totalSpend, LEADS: totalLeads, CPL: cpl, CAC: cac };
}

async function oldGetMarketingKpis(supabase) {
  const now = new Date();
  const curStart = monthStart(now);
  const nextStart = nextMonthStart(now);
  const prevStart = monthStart(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));

  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const daysElapsed = Math.max(1, dayOfMonth);

  const runRate = (v) => (v / daysElapsed) * daysInMonth;

  const { data: targets } = await supabase
    .from("marketing_kpi_targets")
    .select("metric, target_value")
    .eq("period", curStart.toISOString().slice(0, 10));
  const tmap = new Map();
  for (const t of targets ?? []) tmap.set(t.metric, Number(t.target_value));

  const { data: prevTargets } = await supabase
    .from("marketing_kpi_targets")
    .select("metric, target_value")
    .eq("period", prevStart.toISOString().slice(0, 10))
    .eq("metric", "SPEND");
  const prevBudget = Number((prevTargets ?? [])[0]?.target_value ?? 0);

  const budget = tmap.get("SPEND");
  const curSpend = budget !== undefined ? (budget / daysInMonth) * daysElapsed : undefined;
  const prevSpend = prevBudget > 0 ? prevBudget : undefined;

  const cur = await oldComputeMarketingTotals(supabase, curStart.toISOString(), nextStart.toISOString(), curSpend);
  const prev = await oldComputeMarketingTotals(supabase, prevStart.toISOString(), curStart.toISOString(), prevSpend);

  const metrics = ["SPEND", "LEADS", "CPL", "CAC"];
  return metrics.map((m) => ({
    metric: m,
    achieved: cur[m],
    prev_period: prev[m],
    run_rate: m === "CPL" || m === "CAC" ? cur[m] : runRate(cur[m]),
    target: tmap.get(m) ?? null,
    period: curStart.toISOString().slice(0, 10),
  }));
}

// ----------------------------------------------------
// 4. OLD getMetricDrilldown implementation
// ----------------------------------------------------
const PARKED_STAGES = new Set(["RETARGETING", "NO", "LATER", "NO_RESPONSE"]);
const metricPred = (metric) => (l) => {
  switch (metric) {
    case "TOTAL_LEADS":
    case "SPEND":
    case "CPL":
    case "CAC":
    case "ACTIVE_STATES":
    case "ACTIVE_CITIES":
    case "KITCHEN_SCOPE":
      return true;
    case "PARKED": return PARKED_STAGES.has(l.stage);
    case "AUTO_LEADS": return l.mode === "AUTO";
    case "MANUAL_LEADS": return l.mode === "MANUAL";
    case "CONVERSION": return l.stage === "KTN_LIVE";
    default: return l.stage === metric;
  }
};

async function oldGetMetricDrilldown(supabase, { metric, from, to }) {
  let q = supabase.from("kob_leads").select("stage, language, city_id, created_at");
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);
  const { data: leads } = await q;
  const pred = metricPred(metric);
  const rows = (leads ?? []).filter(pred);
  const cityIds = Array.from(new Set(rows.map((r) => r.city_id).filter(Boolean)));
  let cityMap = new Map();
  if (cityIds.length) {
    const { data: cities } = await supabase.from("india_cities").select("id, name").in("id", cityIds);
    for (const c of cities ?? []) cityMap.set(c.id, c.name);
  }
  const byCity = new Map();
  const byLang = new Map();
  for (const r of rows) {
    const cname = r.city_id ? (cityMap.get(r.city_id) ?? "Unknown") : "Unassigned";
    byCity.set(cname, (byCity.get(cname) ?? 0) + 1);
    const lang = r.language ?? "Others";
    byLang.set(lang, (byLang.get(lang) ?? 0) + 1);
  }
  const sortDesc = (m) =>
    Array.from(m.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return { byCity: sortDesc(byCity).slice(0, 25), byLanguage: sortDesc(byLang) };
}

// ----------------------------------------------------
// 5. OLD getMyRetargetingQueue implementation
// ----------------------------------------------------
async function oldGetMyRetargetingQueue(supabase, userId) {
  const { data: leads } = await supabase
    .from("kob_leads")
    .select("id, code, full_name")
    .eq("assigned_to", userId);
  const leadIds = (leads ?? []).map((l) => l.id);
  if (leadIds.length === 0) return [];
  const { data: rows } = await supabase
    .from("retargeting_schedule")
    .select("id, lead_id, bucket, next_touch_at, attempts_done, phase, is_dead")
    .in("lead_id", leadIds)
    .eq("is_dead", false)
    .order("next_touch_at", { ascending: true });
  const byId = new Map((leads ?? []).map((l) => [l.id, l]));
  return (rows ?? []).map((r) => ({ ...r, lead: byId.get(r.lead_id) }));
}

// ----------------------------------------------------
// 6. OLD getMyStageHistory implementation
// ----------------------------------------------------
async function oldGetMyStageHistory(supabase, userId) {
  const { data: leads } = await supabase
    .from("kob_leads")
    .select("id, code, full_name")
    .eq("assigned_to", userId);
  const ids = (leads ?? []).map((l) => l.id);
  if (ids.length === 0) return [];
  const { data: hist } = await supabase
    .from("lead_stage_history")
    .select("lead_id, from_stage, to_stage, changed_at")
    .in("lead_id", ids)
    .order("changed_at", { ascending: false });
  const byId = new Map((leads ?? []).map((l) => [l.id, l]));
  return (hist ?? []).map((h) => ({
    code: byId.get(h.lead_id)?.code,
    name: byId.get(h.lead_id)?.full_name,
    from_stage: h.from_stage,
    to_stage: h.to_stage,
    changed_at: h.changed_at,
  }));
}

// ----------------------------------------------------
// 7. OLD getMyScvScore implementation
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
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
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
const TAT_CLOSE_STAGES = new Set(["NO", "LATER", "NO_RESPONSE", "RETARGETING", "DEAD_LEAD", "NON_SERVICEABLE", "NO_VACANCY", "DUPLICATE_LEAD"]);
const TAT_SLA_MS = 96 * 3600000;

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

async function oldComputeScvForExecs(supabase, execIds, range) {
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
  for (const h of hist ?? []) (histByLead[h.lead_id] ??= []).push(h);
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
    for (const m of feePaidMoves ?? []) if (m.changed_by === eid) eoi2Paid.add(m.lead_id);
    const eoi2Pct = eoi2Eligible.size ? clampPct((eoi2Paid.size / eoi2Eligible.size) * 100) : 0;
    const crmPct = input?.crm_discipline != null ? clampPct(Number(input.crm_discipline)) : 0;

    const points =
      (conversionPct * weights.conversion + tatPct * weights.tat +
        eoi2Pct * weights.eoi2Payment + crmPct * weights.crm) / 100;
    const finalScore = Math.min(100, Math.round(points));
    const slab = lookupIncentive(incentiveRules, finalScore);

    byExec.set(eid, {
      total: el.length, converted: ktnCs,
      ktnCsTarget: target,
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

async function oldGetMyScvScore(supabase, userId) {
  const { byExec } = await oldComputeScvForExecs(supabase, [userId]);
  const s = byExec.get(userId);
  return { score: (s?.finalScore ?? null) };
}

// ----------------------------------------------------
// 8. OLD getMyTeam implementation
// ----------------------------------------------------
async function oldGetMyTeam(supabase) {
  const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "executive");
  const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
  if (!ids.length) return [];
  const { data } = await supabase.from("profiles").select("id, full_name, email, phone").in("id", ids);
  return data ?? [];
}

// ====================================================
// TEST SUITE EXECUTION
// ====================================================
async function run() {
  console.log("==================================================");
  console.log("BATCH 7: REGRESSION VALIDATION");
  console.log("==================================================");

  // Authenticate test user
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: env.TEST_USER_EMAIL,
    password: env.TEST_USER_PASSWORD,
  });
  if (authError || !authData.session) {
    console.error("Auth error:", authError);
    process.exit(1);
  }
  const token = authData.session.access_token;
  const userId = authData.user.id;
  console.log(`✓ Authenticated test user: ${userId}`);

  const results = [];

  async function check(name, oldFn, newUrl) {
    process.stdout.write(`Testing ${name}... `);
    const oldRes = await oldFn();
    const res = await fetch(`${BACKEND_BASE}${newUrl}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.log(`\n  FAILED: HTTP ${res.status}`);
      const text = await res.text();
      console.log(`  Body: ${text}`);
      process.exit(1);
    }
    const newRes = await res.json();
    const match = deepEqual(oldRes, newRes);
    if (!match) {
      console.log(`\n  DEEP MISMATCH!`);
      console.log(`  OLD:`, JSON.stringify(oldRes).slice(0, 300));
      console.log(`  NEW:`, JSON.stringify(newRes).slice(0, 300));
      process.exit(1);
    }
    console.log(`PASS ✓`);
    results.push({
      name,
      oldResult: typeof oldRes === "object" ? (Array.isArray(oldRes) ? `${oldRes.length} items` : "Object") : String(oldRes),
      newResult: typeof newRes === "object" ? (Array.isArray(newRes) ? `${newRes.length} items` : "Object") : String(newRes),
      match: "YES",
    });
  }

  // Record initial counts to verify 0 writes
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { count: leadsCountBefore } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: histCountBefore } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: retargetCountBefore } = await adminClient.from("retargeting_schedule").select("*", { count: "exact", head: true });

  // 1. getManualFunnelBuckets
  const testSpans = [
    { from: "2026-07-01T00:00:00.000Z", to: "2026-07-05T23:59:59.999Z" },
    { from: "2026-07-06T00:00:00.000Z", to: "2026-07-10T23:59:59.999Z" },
  ];
  await check(
    "getManualFunnelBuckets (test spans)",
    () => oldComputeManualBuckets(client, testSpans),
    `/api/dashboard/manual-funnel-buckets?spans=${encodeURIComponent(JSON.stringify(testSpans))}`,
  );
  await check(
    "getManualFunnelBuckets (empty spans)",
    () => oldComputeManualBuckets(client, []),
    `/api/dashboard/manual-funnel-buckets?spans=${encodeURIComponent(JSON.stringify([]))}`,
  );

  // 2. getManualStageResponseSplit
  await check(
    "getManualStageResponseSplit (EOI_1, no filter)",
    () => oldGetManualStageResponseSplit(client, { stageKey: "EOI_1" }),
    `/api/dashboard/manual-stage-response-split?stageKey=EOI_1`,
  );
  await check(
    "getManualStageResponseSplit (WEBINAR, custom range 2026-07)",
    () => oldGetManualStageResponseSplit(client, { stageKey: "WEBINAR", from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.999Z" }),
    `/api/dashboard/manual-stage-response-split?stageKey=WEBINAR&from=2026-07-01T00:00:00.000Z&to=2026-07-31T23:59:59.999Z`,
  );
  await check(
    "getManualStageResponseSplit (EOI_2, no filter)",
    () => oldGetManualStageResponseSplit(client, { stageKey: "EOI_2" }),
    `/api/dashboard/manual-stage-response-split?stageKey=EOI_2`,
  );

  // 3. getMarketingKpis
  await check(
    "getMarketingKpis",
    () => oldGetMarketingKpis(client),
    `/api/kob/marketing-kpis`,
  );

  // 4. getMetricDrilldown
  await check(
    "getMetricDrilldown (TOTAL_LEADS, no filter)",
    () => oldGetMetricDrilldown(client, { metric: "TOTAL_LEADS" }),
    `/api/kob/metric-drilldown?metric=TOTAL_LEADS`,
  );
  await check(
    "getMetricDrilldown (AUTO_LEADS, custom range 2026-07)",
    () => oldGetMetricDrilldown(client, { metric: "AUTO_LEADS", from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.999Z" }),
    `/api/kob/metric-drilldown?metric=AUTO_LEADS&from=2026-07-01T00:00:00.000Z&to=2026-07-31T23:59:59.999Z`,
  );
  await check(
    "getMetricDrilldown (PARKED, no filter)",
    () => oldGetMetricDrilldown(client, { metric: "PARKED" }),
    `/api/kob/metric-drilldown?metric=PARKED`,
  );

  // 5. getMyRetargetingQueue
  await check(
    "getMyRetargetingQueue",
    () => oldGetMyRetargetingQueue(client, userId),
    `/api/kob/my-retargeting-queue`,
  );

  // 6. getMyScvScore
  await check(
    "getMyScvScore",
    () => oldGetMyScvScore(client, userId),
    `/api/kob/my-scv-score`,
  );

  // 7. getMyStageHistory
  await check(
    "getMyStageHistory",
    () => oldGetMyStageHistory(client, userId),
    `/api/kob/my-stage-history`,
  );

  // 8. getMyTeam
  await check(
    "getMyTeam",
    () => oldGetMyTeam(client),
    `/api/kob/my-team`,
  );

  // 9. Auth Failure Verification (401 when no token)
  process.stdout.write("Testing Auth Failure (no token)... ");
  const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/my-team`);
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
  console.log("BATCH 7 REGRESSION SUMMARY");
  console.log("==================================================");
  console.table(results);
  console.log("\nFINAL PARITY RESULT: PASS ✓");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
