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

async function fetchScvRoster(supabase, cols = "id, full_name") {
  const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "executive");
  const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
  if (!ids.length) return [];
  const { data } = await supabase.from("profiles").select(cols).in("id", ids).order("full_name");
  return data ?? [];
}

async function fetchExecRoster(supabase, cols = "id, full_name, email, phone") {
  const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "executive");
  const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
  if (!ids.length) return [];
  const { data } = await supabase.from("profiles").select(cols).in("id", ids);
  return data ?? [];
}

async function fetchScopedLeads(supabase, r = {}) {
  const cols = "id, code, full_name, phone, stage, mode, language, assigned_to, team_leader_id, brand_id, source_id, state_id, city_id, scv_score, created_at, updated_at, converted_at, last_activity_at, brands(name, code), lead_sources(name, cost_per_lead), india_states(name)";
  const out = [];
  const PAGE = 1000;
  for (let i = 0; ; i += PAGE) {
    let q = supabase.from("kob_leads").select(cols).order("created_at", { ascending: false });
    if (r.from) q = q.gte("created_at", r.from);
    if (r.to) q = q.lte("created_at", r.to);
    const { data, error } = await q.range(i, i + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

async function budgetedSpendForRange(supabase, r = {}) {
  if (!r.from && !r.to) return null;
  const start = r.from ? new Date(r.from) : new Date(r.to);
  const end = r.to ? new Date(r.to) : new Date();
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return null;

  // Collect month keys spanned by the range.
  const months = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const { data: rows } = await supabase
    .from("marketing_kpi_targets")
    .select("period, target_value")
    .eq("metric", "SPEND")
    .in("period", months);
  const byMonth = new Map();
  for (const row of rows ?? []) byMonth.set(String(row.period).slice(0, 10), Number(row.target_value ?? 0));
  if (byMonth.size === 0) return null;

  let total = 0;
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (day <= endDay) {
    const key = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const budget = byMonth.get(key);
    if (budget) {
      const daysInMonth = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
      total += budget / daysInMonth;
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return Math.round(total);
}

async function orgRead(supabase, userId, adminClient) {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (((role ?? "executive")) === "executive" || !adminClient) return supabase;
  return adminClient;
}

// ----------------------------------------------------
// OLD IMPLEMENTATIONS
// ----------------------------------------------------

// 1. oldGetTLOverview
async function oldGetTLOverview(supabase, userId, adminClient, data = {}) {
  const client = await orgRead(supabase, userId, adminClient);
  const leads = await fetchScopedLeads(client, data);
  const team = await fetchExecRoster(client, "id");
  const stageCount = (s) => leads.filter((l) => l.stage === s).length;
  const allocated = leads.filter((l) => l.assigned_to).length;
  const unallocated = leads.length - allocated;
  const budgetedTL = await budgetedSpendForRange(supabase, data);
  const totalSpend = budgetedTL ?? leads.reduce((s, l) => s + Number(l.lead_sources?.cost_per_lead ?? 0), 0);

  const ktnLive = stageCount("KTN_LIVE");
  const scvAvg = leads.length ? Math.round(leads.reduce((s, l) => s + (l.scv_score ?? 0), 0) / leads.length) : 0;
  const parked = leads.filter((l) => ["NO_RESPONSE", "LATER", "NO", "RETARGETING"].includes(l.stage)).length;
  const autoLeads = leads.filter((l) => l.mode === "AUTO").length;
  const manualLeads = leads.filter((l) => l.mode === "MANUAL").length;
  const { count: activeStates } = await supabase.from("india_states").select("*", { count: "exact", head: true }).eq("active", true);
  const { count: activeCities } = await supabase.from("india_cities").select("*", { count: "exact", head: true }).eq("active", true);
  const { data: scope } = await supabase.from("v_city_scope").select("kitchen_scope");
  const kitchenScope = (scope ?? []).reduce((s, r) => s + Number(r.kitchen_scope ?? 0), 0);
  return {
    totalAssigned: leads.length,
    allocated, unallocated,
    teamSize: team.length,
    eoi1: stageCount("EOI_1"),
    webinar: stageCount("WEBINAR"),
    eoi2: stageCount("EOI_2"),
    feePaid: stageCount("FEE_PAID"),
    agreement: stageCount("AGREEMENT_SIGNED"),
    ktnCs: stageCount("KTN_CS"),
    ktnLive,
    totalLeads: leads.length,
    totalSpend,
    cpl: leads.length ? Math.round(totalSpend / leads.length) : 0,
    cac: ktnLive ? Math.round(totalSpend / ktnLive) : 0,
    teamScv: scvAvg,
    parked,
    autoLeads,
    manualLeads,
    activeStates: activeStates ?? 0,
    activeCities: activeCities ?? 0,
    kitchenScope,
  };
}

// 2. oldGetTLExecutivePerformance
async function oldGetTLExecutivePerformance(supabase, userId, adminClient, data = {}) {
  const client = await orgRead(supabase, userId, adminClient);
  const leads = await fetchScopedLeads(client, data);
  const team = await fetchExecRoster(client, "id, full_name, email");
  return team.map((e) => {
    const el = leads.filter((l) => l.assigned_to === e.id);
    const c = (s) => el.filter((l) => l.stage === s).length;
    const ktnLive = c("KTN_LIVE");
    const langs = {};
    el.forEach((l) => { if (l.language) langs[l.language] = (langs[l.language] ?? 0) + 1; });
    const language = Object.entries(langs).sort((a,b) => b[1]-a[1])[0]?.[0] ?? "—";
    const now = Date.now();
    const active = el.filter((l) => !["DEAD_LEAD","KTN_LIVE","NO"].includes(l.stage));
    const compliant = active.filter((l) => {
      const created = new Date(l.created_at).getTime();
      const last = new Date(l.last_activity_at ?? l.updated_at).getTime();
      return (last - created) <= 48 * 3600 * 1000 || (now - last) <= 48 * 3600 * 1000;
    }).length;
    const tat = active.length ? Math.round((compliant / active.length) * 100) : 100;
    const scv = el.length ? Math.round(el.reduce((s, l) => s + (l.scv_score ?? 0), 0) / el.length) : 0;
    const conv = el.length ? Math.round((ktnLive / el.length) * 100) : 0;
    const incentive = scv >= 70 && ktnLive >= 1 ? "Eligible" : "Not eligible";
    return {
      id: e.id, name: e.full_name, email: e.email, language,
      leads: el.length,
      eoi1: c("EOI_1"), webinar: c("WEBINAR"), eoi2: c("EOI_2"),
      feePaid: c("FEE_PAID"), agreement: c("AGREEMENT_SIGNED"),
      ktnCs: c("KTN_CS"), ktnLive,
      conversion: conv, tat, scv, incentive,
    };
  });
}

// 3. oldGetTLBrandPerformance
async function oldGetTLBrandPerformance(supabase, userId, adminClient, data = {}) {
  const client = await orgRead(supabase, userId, adminClient);
  const leads = await fetchScopedLeads(client, data);
  const bmap = {};
  for (const l of leads) {
    const b = l.brands?.name ?? "Unassigned";
    if (!bmap[b]) bmap[b] = { brand: b, leads: 0, eoi1: 0, webinar: 0, eoi2: 0, feePaid: 0, agreement: 0, ktnCs: 0, ktnLive: 0, spend: 0 };
    bmap[b].leads++;
    bmap[b].spend += Number(l.lead_sources?.cost_per_lead ?? 0);
    if (l.stage === "EOI_1") bmap[b].eoi1++;
    if (l.stage === "WEBINAR") bmap[b].webinar++;
    if (l.stage === "EOI_2") bmap[b].eoi2++;
    if (l.stage === "FEE_PAID") bmap[b].feePaid++;
    if (l.stage === "AGREEMENT_SIGNED") bmap[b].agreement++;
    if (l.stage === "KTN_CS") bmap[b].ktnCs++;
    if (l.stage === "KTN_LIVE") bmap[b].ktnLive++;
  }
  return Object.values(bmap).map((b) => ({
    ...b,
    cac: b.ktnLive ? Math.round(b.spend / b.ktnLive) : 0,
    conversion: b.leads ? Math.round((b.ktnLive / b.leads) * 100) : 0,
  }));
}

// 4. oldGetTLLanguagePerformance
async function oldGetTLLanguagePerformance(supabase, userId, adminClient, data = {}) {
  const client = await orgRead(supabase, userId, adminClient);
  const leads = await fetchScopedLeads(client, data);
  const team = await fetchExecRoster(client, "id, full_name");
  const lmap = {};
  for (const l of leads) {
    const lang = l.language ?? "Others";
    if (!lmap[lang]) lmap[lang] = { language: lang, leads: 0, execs: new Set(), eoi1: 0, webinar: 0, eoi2: 0, ktnCs: 0, ktnLive: 0, tatSum: 0, tatN: 0 };
    lmap[lang].leads++;
    if (l.assigned_to) lmap[lang].execs.add(l.assigned_to);
    if (l.stage === "EOI_1") lmap[lang].eoi1++;
    if (l.stage === "WEBINAR") lmap[lang].webinar++;
    if (l.stage === "EOI_2") lmap[lang].eoi2++;
    if (l.stage === "KTN_CS") lmap[lang].ktnCs++;
    if (l.stage === "KTN_LIVE") lmap[lang].ktnLive++;
    const t = new Date(l.last_activity_at ?? l.updated_at).getTime() - new Date(l.created_at).getTime();
    lmap[lang].tatSum += t; lmap[lang].tatN++;
  }
  return Object.values(lmap).map((v) => ({
    language: v.language, leads: v.leads,
    executives: [...v.execs].map((id) => team.find((t) => t.id === id)?.full_name).filter(Boolean).join(", "),
    execCount: v.execs.size,
    eoi1: v.eoi1, webinar: v.webinar, eoi2: v.eoi2, ktnCs: v.ktnCs, ktnLive: v.ktnLive,
    tatHours: v.tatN ? Math.round(v.tatSum / v.tatN / 3600000) : 0,
    conversion: v.leads ? Math.round((v.ktnLive / v.leads) * 100) : 0,
  }));
}

// 5. oldGetTLTATBreach
async function oldGetTLTATBreach(supabase, userId, adminClient) {
  const client = await orgRead(supabase, userId, adminClient);
  const leads = await fetchScopedLeads(client);
  const leadIds = leads.map((l) => l.id);
  if (!leadIds.length) return { transitions: [], firstContact: [] };

  const hist = [];
  for (let i = 0; i < leadIds.length; i += 150) {
    const chunk = leadIds.slice(i, i + 150);
    const { data: h } = await supabase.from("lead_stage_history").select("lead_id, from_stage, to_stage, changed_at").in("lead_id", chunk).order("changed_at");
    if (h) hist.push(...h);
  }
  const acts = [];
  for (let i = 0; i < leadIds.length; i += 150) {
    const chunk = leadIds.slice(i, i + 150);
    const { data: a } = await supabase.from("lead_activities").select("lead_id, created_at").in("lead_id", chunk).order("created_at");
    if (a) acts.push(...a);
  }

  const SLA_HOURS = {
    "LEAD_INBOX->EOI_1": 24, "EOI_1->WEBINAR": 72, "WEBINAR->EOI_2": 48,
    "EOI_2->FEE_PAID": 96, "FEE_PAID->AGREEMENT_SIGNED": 72,
    "AGREEMENT_SIGNED->KTN_CS": 168, "KTN_CS->KTN_LIVE": 336,
  };
  const byLead = {};
  for (const h of hist ?? []) {
    (byLead[h.lead_id] ??= []).push(h);
  }
  const transitions = [];
  for (const l of leads) {
    const rows = byLead[l.id] ?? [];
    for (const r of rows) {
      const key = `${r.from_stage ?? "NEW"}->${r.to_stage}`;
      const sla = SLA_HOURS[key];
      if (!sla) continue;
      const prev = rows.filter((x) => new Date(x.changed_at) < new Date(r.changed_at)).slice(-1)[0];
      const start = prev ? new Date(prev.changed_at) : new Date(l.created_at);
      const elapsedH = (new Date(r.changed_at).getTime() - start.getTime()) / 3600000;
      if (elapsedH > sla) {
        transitions.push({
          lead: l.code, name: l.full_name, transition: key.replace(/_/g, " "),
          slaHours: sla, elapsedHours: Math.round(elapsedH), breach: Math.round(elapsedH - sla),
        });
      }
    }
  }
  const actsByLead = {};
  for (const a of acts ?? []) (actsByLead[a.lead_id] ??= []).push(a);
  const firstContact = [];
  for (const l of leads) {
    const first = actsByLead[l.id]?.[0];
    const elapsed = ((first ? new Date(first.created_at) : new Date()).getTime() - new Date(l.created_at).getTime()) / 3600000;
    if (elapsed > 24) firstContact.push({ lead: l.code, name: l.full_name, elapsedHours: Math.round(elapsed), contacted: !!first });
  }
  return {
    transitions: transitions.slice(0, 100),
    firstContact: firstContact.slice(0, 100),
  };
}

// 6. oldGetTLRetargeting
async function oldGetTLRetargeting(supabase, userId, adminClient) {
  const client = await orgRead(supabase, userId, adminClient);
  const leads = await fetchScopedLeads(client);
  const leadIds = leads.map((l) => l.id);
  if (!leadIds.length) return [];
  const schedule = [];
  for (let i = 0; i < leadIds.length; i += 150) {
    const chunk = leadIds.slice(i, i + 150);
    const { data } = await supabase.from("retargeting_schedule").select("*").in("lead_id", chunk).order("next_touch_at");
    if (data) schedule.push(...data);
  }
  const map = new Map((leads ?? []).map((l) => [l.id, l]));
  return (schedule ?? []).map((r) => ({ ...r, lead: map.get(r.lead_id) }));
}

// 7. oldGetTLScvIncentives
async function oldGetTLScvIncentives(supabase, userId, adminClient, data = {}) {
  const scvReader = adminClient || supabase;
  const { data: execRoles } = await scvReader.from("user_roles").select("user_id").eq("role", "executive");
  const execSet = new Set((execRoles ?? []).map((r) => r.user_id));
  const team = (await fetchScvRoster(scvReader)).filter((e) => execSet.has(e.id));
  const execIds = team.map((t) => t.id);
  const { byExec, weights } = await computeScvForExecs(scvReader, execIds, scvMonthRange(data.month));
  const BASE_INCENTIVE = 10000;
  const rows = team.map((e) => {
    const s = byExec.get(e.id) ?? {
      conversionPct: 0, tatPct: 0, eoi2Pct: 0, crmPct: 0,
      finalScore: 0, slabLabel: "Unrated", incentivePct: 0,
      ktnCs: 0, ktnLive: 0, ktnCsTarget: null, crmInput: null,
    };
    const amount = Math.round(BASE_INCENTIVE * (s.incentivePct / 100));
    return {
      id: e.id, name: e.full_name,
      scvScore: s.finalScore,
      conversionScore: s.conversionPct,
      tatScore: s.tatPct,
      eoi2Score: s.eoi2Pct,
      crmScore: s.crmPct,
      ktnCsTarget: s.ktnCsTarget, crmInput: s.crmInput,
      ktnCs: s.ktnCs, ktnLive: s.ktnLive,
      slab: s.slabLabel, incentivePct: s.incentivePct, amount,
      breakdown: {
        tatPass: s.tatPass ?? 0, tatFail: s.tatFail ?? 0, tatCycles: s.tatCycles ?? 0,
        eoi2Eligible: s.eoi2EligibleCount ?? 0, feePaid: s.feePaid ?? 0,
        conversionPoints: s.conversionPoints ?? 0, tatPoints: s.tatPoints ?? 0,
        eoi2Points: s.eoi2Points ?? 0, crmPoints: s.crmPoints ?? 0,
      },
    };
  });
  const [{ data: isMgr }, { data: isAdmin }, { data: isTL }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "kob_manager" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "team_leader" }),
  ]);
  return {
    rows,
    months: await scvAvailableMonths(supabase),
    canEdit: !!(isMgr || isAdmin || isTL),
    canEditTargets: !!(isMgr || isAdmin || isTL),
    weights,
    canEditWeights: !!(isMgr || isAdmin),
  };
}

// 8. oldGetUnallocatedLeads
async function oldGetUnallocatedLeads(supabase, userId, adminClient) {
  const client = await orgRead(supabase, userId, adminClient);
  const PAGE = 1000;
  const out = [];
  for (let page = 0; ; page++) {
    const { data, error } = await client
      .from("kob_leads")
      .select("id, code, full_name, phone, stage, mode, language, assigned_to, created_at, brands(name), india_states(name), india_cities(name), lead_sources(name)")
      .is("assigned_to", null)
      .order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ----------------------------------------------------
// RUNNER
// ----------------------------------------------------
async function run() {
  console.log("==================================================");
  console.log("STARTING BATCH 9 REGRESSION SUITE");
  console.log("==================================================");

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Authenticate test user
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

  // 1. getTLOverview
  await check(
    "getTLOverview (no filter)",
    () => oldGetTLOverview(client, userId, adminClient),
    `/api/kob/tl-overview`,
  );
  await check(
    "getTLOverview (current month)",
    () => {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const end = now.toISOString();
      return oldGetTLOverview(client, userId, adminClient, { from: start, to: end });
    },
    (() => {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const end = now.toISOString();
      return `/api/kob/tl-overview?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`;
    })(),
  );
  await check(
    "getTLOverview (custom range 2026-06 to 2026-08)",
    () => oldGetTLOverview(client, userId, adminClient, { from: "2026-06-01T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z" }),
    `/api/kob/tl-overview?from=2026-06-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z`,
  );

  // 2. getTLExecutivePerformance
  await check(
    "getTLExecutivePerformance (no filter)",
    () => oldGetTLExecutivePerformance(client, userId, adminClient),
    `/api/kob/tl-executive-performance`,
  );
  await check(
    "getTLExecutivePerformance (custom range 2026-06 to 2026-08)",
    () => oldGetTLExecutivePerformance(client, userId, adminClient, { from: "2026-06-01T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z" }),
    `/api/kob/tl-executive-performance?from=2026-06-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z`,
  );

  // 3. getTLBrandPerformance
  await check(
    "getTLBrandPerformance (no filter)",
    () => oldGetTLBrandPerformance(client, userId, adminClient),
    `/api/kob/tl-brand-performance`,
  );
  await check(
    "getTLBrandPerformance (custom range 2026-06 to 2026-08)",
    () => oldGetTLBrandPerformance(client, userId, adminClient, { from: "2026-06-01T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z" }),
    `/api/kob/tl-brand-performance?from=2026-06-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z`,
  );

  // 4. getTLLanguagePerformance
  await check(
    "getTLLanguagePerformance (no filter)",
    () => oldGetTLLanguagePerformance(client, userId, adminClient),
    `/api/kob/tl-language-performance`,
  );
  await check(
    "getTLLanguagePerformance (custom range 2026-06 to 2026-08)",
    () => oldGetTLLanguagePerformance(client, userId, adminClient, { from: "2026-06-01T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z" }),
    `/api/kob/tl-language-performance?from=2026-06-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z`,
  );

  // 5. getTLTATBreach
  await check(
    "getTLTATBreach",
    () => oldGetTLTATBreach(client, userId, adminClient),
    `/api/kob/tl-tat-breach`,
  );

  // 6. getTLRetargeting
  await check(
    "getTLRetargeting",
    () => oldGetTLRetargeting(client, userId, adminClient),
    `/api/kob/tl-retargeting`,
  );

  // 7. getTLScvIncentives
  await check(
    "getTLScvIncentives (no month)",
    () => oldGetTLScvIncentives(client, userId, adminClient),
    `/api/kob/tl-scv-incentives`,
  );
  await check(
    "getTLScvIncentives (month 2026-07)",
    () => oldGetTLScvIncentives(client, userId, adminClient, { month: "2026-07" }),
    `/api/kob/tl-scv-incentives?month=2026-07`,
  );

  // 8. getUnallocatedLeads
  await check(
    "getUnallocatedLeads",
    () => oldGetUnallocatedLeads(client, userId, adminClient),
    `/api/kob/unallocated-leads`,
  );

  // 9. Auth Failure Verification (401 when no token)
  process.stdout.write("Testing Auth Failure (no token)... ");
  const unauthRes = await fetch(`${BACKEND_BASE}/api/kob/tl-overview`);
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
  console.log("BATCH 9 REGRESSION SUMMARY");
  console.log("==================================================");
  console.table(results);
  console.log("\nFINAL PARITY RESULT: PASS ✓");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
