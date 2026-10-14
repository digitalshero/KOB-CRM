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

async function pageAll(build) {
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

// ----------------------------------------------------
// OLD IMPLEMENTATIONS
// ----------------------------------------------------

// 1. oldListWebinarEligibleLeads
async function oldListWebinarEligibleLeads(supabase, { language, search } = {}) {
  let q = supabase
    .from("kob_leads")
    .select("id, code, full_name, phone, stage, language, assigned_to, created_at")
    .eq("stage", "WEBINAR")
    .order("created_at", { ascending: false })
    .limit(500);

  if (language && language !== "ALL") {
    q = q.eq("language", language.toUpperCase());
  }
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    q = q.or(`full_name.ilike.${term},code.ilike.${term},phone.ilike.${term}`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// 2. oldGetExecPerformanceSummary
async function oldGetExecPerformanceSummary(supabase, userId, adminClient, data = {}) {
  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  const db = ((role ?? "executive")) === "executive" || !adminClient ? supabase : adminClient;

  const { data: roleRows } = await db
    .from("user_roles")
    .select("user_id")
    .eq("role", "executive");
  const execIds = ((roleRows ?? [])).map((r) => r.user_id);
  if (execIds.length === 0) return [];

  const { data: profs } = await db
    .from("profiles")
    .select("id, full_name")
    .in("id", execIds);

  const rows = await pageAll(() => {
    let q = db.from("kob_leads").select("assigned_to");
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    return q;
  });

  const ktnHist = await pageAll(() => {
    let q = db
      .from("lead_stage_history")
      .select("lead_id, kob_leads!inner(assigned_to, stage)")
      .eq("to_stage", "KTN_CS")
      .eq("kob_leads.stage", "KTN_CS");
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    return q;
  });
  const history = (ktnHist ?? [])
    .map((h) => ({ lead_id: h.lead_id, changed_by: h.kob_leads?.assigned_to ?? null }))
    .filter((h) => h.changed_by);

  const refDate = data.from ? new Date(data.from) : new Date();
  const period = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, "0")}-01`;
  const { data: cfgRow } = await db.from("kob_configuration").select("default_mode").limit(1).maybeSingle();
  const mode = cfgRow?.default_mode === "MANUAL" ? "MANUAL" : "AUTO";
  const { data: inputs } = await db
    .from("scv_mode_inputs")
    .select("user_id, ktn_cs_target")
    .eq("period", period)
    .eq("mode", mode)
    .in("user_id", execIds);
  const targetByUser = new Map(
    (inputs ?? []).map((i) => [i.user_id, i.ktn_cs_target != null ? Number(i.ktn_cs_target) : null]),
  );
  const { data: orgTargetRow } = await db
    .from("kpi_targets")
    .select("target_value")
    .eq("metric", "KTN_CS")
    .eq("period", "monthly")
    .lte("effective_from", period)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const execTarget = Number(orgTargetRow?.target_value ?? 0);

  const UNASSIGNED = "__unassigned__";
  const byExec = new Map();
  for (const l of rows) {
    const key = l.assigned_to ?? UNASSIGNED;
    const e = byExec.get(key) ?? { leads: 0, contracts: 0 };
    e.leads += 1;
    byExec.set(key, e);
  }
  const credited = new Set();
  for (const h of history) {
    const key = h.changed_by;
    const dedupeKey = `${key}:${h.lead_id}`;
    if (credited.has(dedupeKey)) continue;
    credited.add(dedupeKey);
    const e = byExec.get(key) ?? { leads: 0, contracts: 0 };
    e.contracts += 1;
    byExec.set(key, e);
  }

  const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
  const shape = (id, name, target) => {
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

  const execRows = (profs ?? []).map((p) => shape(p.id, p.full_name, targetByUser.get(p.id) ?? execTarget));
  const otherRows = [...byExec.keys()]
    .filter((k) => k !== UNASSIGNED && !nameById.has(k))
    .map((k) => shape(k, "Other user", 0));

  const unassigned = shape(UNASSIGNED, "Unassigned", 0);
  return [...execRows, ...otherRows, ...(unassigned.leads > 0 ? [unassigned] : [])];
}

// 3. oldGetFunnelStageLeads
async function oldGetFunnelStageLeads(supabase, adminClient, r) {
  let leadIds = [];

  if (r.stageKey === "LEAD_GENERATED") {
    const rows = await pageAll(() => {
      let q = supabase.from("kob_leads").select("id").order("created_at", { ascending: true });
      if (r.from) q = q.gte("created_at", r.from);
      if (r.to) q = q.lte("created_at", r.to);
      return q;
    });
    leadIds = rows.map((l) => l.id);

    if (r.mode && r.mode !== "all") {
      const mrows = await pageAll(() => {
        let m = supabase
          .from("audit_logs")
          .select("entity_id")
          .eq("action", "lead_manual_create")
          .order("created_at", { ascending: true });
        if (r.from) m = m.gte("created_at", r.from);
        if (r.to) m = m.lte("created_at", r.to);
        return m;
      });
      const manual = new Set(mrows.map((x) => x.entity_id).filter(Boolean));
      leadIds = leadIds.filter((id) => (r.mode === "manual" ? manual.has(id) : !manual.has(id)));
    }
  } else if (r.stageKey === "WEBINAR_ATTENDED") {
    const historyDb = adminClient ?? supabase;
    const batches = await pageAll(() => {
      let q = historyDb
        .from("webinar_batches")
        .select("id, name, scheduled_at, language")
        .order("scheduled_at", { ascending: false });
      if (r.from) q = q.gte("scheduled_at", r.from);
      if (r.to) q = q.lte("scheduled_at", r.to);
      return q;
    });
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const batchIds = [...batchMap.keys()];
    const historyRows = [];
    for (let i = 0; i < batchIds.length; i += 200) {
      const chunk = batchIds.slice(i, i + 200);
      historyRows.push(
        ...(await pageAll(() =>
          historyDb
            .from("webinar_attendance")
            .select("id, lead_id, batch_id, marked_at")
            .eq("attended", true)
            .in("batch_id", chunk)
            .order("id", { ascending: false }),
        )),
      );
    }
    if (historyRows.length === 0) return { total: 0, leads: [], webinarRows: [] };

    const uniqueLeadIds = [...new Set(historyRows.map((a) => a.lead_id).filter(Boolean))];
    const leadMap = new Map();
    for (let i = 0; i < uniqueLeadIds.length; i += 150) {
      const { data: leads, error } = await historyDb
        .from("kob_leads")
        .select("id, code, full_name, phone, stage, language, created_at, assigned_to")
        .in("id", uniqueLeadIds.slice(i, i + 150));
      if (error) throw error;
      for (const lead of leads ?? []) leadMap.set(lead.id, lead);
    }
    const assignedIds = [...new Set([...leadMap.values()].map((l) => l.assigned_to).filter(Boolean))];
    const executiveMap = new Map();
    if (assignedIds.length) {
      const { data: profiles, error } = await historyDb
        .from("profiles")
        .select("id, full_name")
        .in("id", assignedIds);
      if (error) throw error;
      for (const profile of profiles ?? []) executiveMap.set(profile.id, profile.full_name);
    }

    const webinarRows = historyRows.map((attendance) => {
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
    return { total: webinarRows.length, leads: [], webinarRows };
  } else {
    const rows = await pageAll(() => {
      let q = supabase
        .from("lead_stage_history")
        .select("lead_id, to_stage, created_at, changed_by")
        .eq("to_stage", r.stageKey)
        .order("created_at", { ascending: true });
      if (r.mode === "auto") q = q.is("changed_by", null);
      if (r.mode === "manual") q = q.not("changed_by", "is", null);
      if (r.from) q = q.gte("created_at", r.from);
      if (r.to) q = q.lte("created_at", r.to);
      return q;
    });
    leadIds = [...new Set(rows.map((h) => h.lead_id).filter(Boolean))];
  }

  if (leadIds.length === 0) return { total: 0, leads: [] };
  const total = leadIds.length;

  const { data: leads } = await supabase
    .from("kob_leads")
    .select("id, code, full_name, phone, stage, language, assigned_to, created_at")
    .in("id", leadIds.slice(0, 300))
    .order("created_at", { ascending: false });

  return { total, leads: leads ?? [] };
}

// 4. oldGetLeadDetail
async function oldGetLeadDetail(supabase, adminClient, { leadId }) {
  const db = adminClient ?? supabase;
  const { data: lead, error } = await db
    .from("kob_leads")
    .select("*, brands(name, code), india_states(name, code), india_cities(name, tier), lead_sources(name, category)")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(`Lead fetch failed: ${error.message}`);
  if (!lead) throw new Error(`Lead not found (id=${leadId})`);

  const { data: history } = await db
    .from("lead_stage_history")
    .select("id, from_stage, to_stage, created_at, changed_by, note")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  const { data: activities } = await db
    .from("lead_activities")
    .select("id, activity_type, detail, created_at, actor_id")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  const actorIds = Array.from(new Set([
    ...(history ?? []).map((h) => h.changed_by).filter(Boolean),
    ...(activities ?? []).map((a) => a.actor_id).filter(Boolean),
  ]));
  const profileIds = Array.from(new Set([
    ...actorIds,
    lead.assigned_to,
    lead.team_leader_id,
  ].filter(Boolean)));
  let actors = {};
  let people = {};
  if (profileIds.length) {
    const { data: profs } = await db.from("profiles").select("id, full_name, email").in("id", profileIds);
    for (const p of profs ?? []) {
      actors[p.id] = p.full_name;
      people[p.id] = { full_name: p.full_name, email: p.email };
    }
  }
  return { lead, history: history ?? [], activities: activities ?? [], actors, people };
}

// 5. oldGetMyExecOverview
async function oldGetMyExecOverview(supabase, userId, data = {}) {
  let q = supabase
    .from("kob_leads")
    .select("id, code, full_name, stage, last_activity_at, updated_at, created_at, assigned_to")
    .eq("assigned_to", userId);
  if (data?.from) q = q.gte("created_at", data.from);
  if (data?.to) q = q.lte("created_at", data.to);
  const { data: leads, error } = await q;
  if (error) throw error;

  const rows = leads ?? [];
  const stageCounts = {};
  for (const l of rows) stageCounts[l.stage] = (stageCounts[l.stage] ?? 0) + 1;

  const TAT_HOURS = 48;
  const now = Date.now();
  const tatAlerts = rows
    .map((l) => {
      const last = new Date(l.last_activity_at ?? l.updated_at ?? l.created_at).getTime();
      const hours = Math.round((now - last) / 3600000);
      return { id: l.id, code: l.code, full_name: l.full_name, stage: l.stage, hours };
    })
    .filter((r) => r.hours > TAT_HOURS)
    .sort((a, b) => b.hours - a.hours);

  const leadIds = rows.map((l) => l.id);
  let dueToday = [];
  if (leadIds.length) {
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const { data: rt } = await supabase
      .from("retargeting_schedule")
      .select("id, lead_id, bucket, next_touch_at, phase, kob_leads(code, full_name)")
      .in("lead_id", leadIds)
      .eq("is_dead", false)
      .lte("next_touch_at", today.toISOString())
      .order("next_touch_at", { ascending: true });
    dueToday = rt ?? [];
  }

  const reached = { WEBINAR: new Set(), EOI_2: new Set(), KTN_CS: new Set() };
  for (const l of rows) {
    if (reached[l.stage]) reached[l.stage].add(l.id);
  }
  let webinarAttended = 0;
  if (leadIds.length) {
    for (let i = 0; i < leadIds.length; i += 200) {
      const chunk = leadIds.slice(i, i + 200);
      const { data: hist } = await supabase
        .from("lead_stage_history")
        .select("lead_id, to_stage")
        .in("lead_id", chunk)
        .in("to_stage", ["WEBINAR", "EOI_2", "KTN_CS"]);
      for (const h of hist ?? []) reached[h.to_stage]?.add(h.lead_id);

      const { data: att } = await supabase
        .from("webinar_attendance")
        .select("lead_id")
        .in("lead_id", chunk)
        .eq("attended", true);
      webinarAttended += new Set((att ?? []).map((a) => a.lead_id)).size;
    }
  }

  return {
    total: rows.length,
    stageCounts,
    tatAlerts,
    tatThreshold: TAT_HOURS,
    dueToday,
    kpis: {
      webinarInvited: reached.WEBINAR.size,
      webinarAttended,
      eoi2: reached.EOI_2.size,
      ktnCs: reached.KTN_CS.size,
    },
  };
}

// 6. oldGetScvModeConfig
async function oldGetScvModeConfig(supabase, { mode }) {
  const { data: cfgRow } = await supabase.from("scv_mode_config").select("*").eq("mode", mode).maybeSingle();
  const cfg = {
    components: cfgRow?.components ?? [],
    tatMovements: cfgRow?.tat_movements ?? [],
    incentiveAmount: Number(cfgRow?.incentive_amount ?? 10000),
  };
  const { data: glob } = await supabase.from("kob_configuration").select("incentive_amount").eq("id", 1).maybeSingle();
  const { data: history } = await supabase.from("scv_mode_config_changes")
    .select("id, changed_by, component, previous_value, new_value, changed_at")
    .eq("mode", mode).order("changed_at", { ascending: false }).limit(50);
  const ids = Array.from(new Set((history ?? []).map((h) => h.changed_by).filter(Boolean)));
  const names = new Map();
  if (ids.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    (profs ?? []).forEach((p) => names.set(p.id, p.full_name));
  }
  const { data: slabs } = await supabase.from("incentive_rules").select("id, label, min_score, max_score, incentive_pct, incentive_amount, sort_order").order("sort_order");
  return { ...cfg, slabs: slabs ?? [], incentiveAmount: Number(glob?.incentive_amount ?? 10000), history: (history ?? []).map((h) => ({ ...h, changed_by_name: names.get(h.changed_by) ?? "—" })) };
}

// 7. oldGetTATBreachDetailed
async function oldGetTATBreachDetailed(supabase, adminClient) {
  const { data: leads } = await supabase.from("kob_leads").select("id, code, full_name, stage, created_at, updated_at, last_activity_at, assigned_to");
  const leadIds = (leads ?? []).map((l) => l.id);
  if (!leadIds.length) return { first: [], transitions: {}, retargeting: [] };
  const assigneeIds = Array.from(new Set((leads ?? []).map((l) => l.assigned_to).filter(Boolean)));
  const execMap = new Map();
  if (assigneeIds.length) {
    const db = adminClient ?? supabase;
    const { data: profs } = await db.from("profiles").select("id, full_name").in("id", assigneeIds);
    for (const p of profs ?? []) execMap.set(p.id, p.full_name);
  }

  const execName = (l) => (l?.assigned_to ? execMap.get(l.assigned_to) ?? "—" : "—");
  const { data: hist } = await supabase.from("lead_stage_history").select("lead_id, from_stage, to_stage, changed_at").in("lead_id", leadIds).order("changed_at");
  const { data: acts } = await supabase.from("lead_activities").select("lead_id, created_at").in("lead_id", leadIds).order("created_at");
  const { data: rt } = await supabase.from("retargeting_schedule").select("lead_id, next_touch_at, attempts_done, bucket, is_dead").in("lead_id", leadIds);

  const SLA = {
    "LEAD_INBOX->EOI_1": 24, "EOI_1->WEBINAR": 72, "WEBINAR->EOI_2": 48,
    "EOI_2->FEE_PAID": 96, "FEE_PAID->AGREEMENT_SIGNED": 72,
    "AGREEMENT_SIGNED->KTN_CS": 168, "KTN_CS->KTN_LIVE": 336,
  };
  const byLead = {};
  for (const h of hist ?? []) (byLead[h.lead_id] ??= []).push(h);
  const leadMap = new Map((leads ?? []).map((l) => [l.id, l]));

  const transitions = {};
  for (const key of Object.keys(SLA)) transitions[key] = [];
  for (const [lid, rows] of Object.entries(byLead)) {
    const l = leadMap.get(lid);
    if (!l) continue;
    for (const r of rows) {
      const key = `${r.from_stage ?? "NEW"}->${r.to_stage}`;
      const sla = SLA[key];
      if (!sla) continue;
      const prev = rows.filter((x) => new Date(x.changed_at) < new Date(r.changed_at)).slice(-1)[0];
      const start = prev ? new Date(prev.changed_at) : new Date(l.created_at);
      const elapsedH = (new Date(r.changed_at).getTime() - start.getTime()) / 3600000;
      if (elapsedH > sla) {
        transitions[key].push({
          lead: l.code, name: l.full_name, exec_name: execName(l),
          slaHours: sla, elapsedHours: Math.round(elapsedH), breach: Math.round(elapsedH - sla),
        });
      }
    }
  }
  const actsByLead = {};
  for (const a of acts ?? []) (actsByLead[a.lead_id] ??= []).push(a);
  const first = [];
  for (const l of leads ?? []) {
    const f = actsByLead[l.id]?.[0];
    const elapsed = ((f ? new Date(f.created_at) : new Date()).getTime() - new Date(l.created_at).getTime()) / 3600000;
    if (elapsed > 24) first.push({ lead: l.code, name: l.full_name, exec_name: execName(l), elapsedHours: Math.round(elapsed), contacted: !!f });
  }
  const now = Date.now();
  const retargeting = (rt ?? [])
    .filter((r) => r.next_touch_at && new Date(r.next_touch_at).getTime() < now && !r.is_dead)
    .map((r) => {
      const l = leadMap.get(r.lead_id);
      const overdueH = Math.round((now - new Date(r.next_touch_at).getTime()) / 3600000);
      return { lead: l?.code, name: l?.full_name, exec_name: execName(l), bucket: r.bucket, attempts: r.attempts_done, overdueHours: overdueH };
    })
    .slice(0, 100);

  return { first: first.slice(0, 100), transitions, retargeting };
}

// 8. oldGetWebinarHistory
async function oldGetWebinarHistory(supabase, adminClient, data = {}) {
  const db = adminClient ?? supabase;

  let bq = db
    .from("webinar_batches")
    .select("id, name, scheduled_at, language")
    .order("scheduled_at", { ascending: false });
  if (data.from) bq = bq.gte("scheduled_at", data.from);
  if (data.to) bq = bq.lte("scheduled_at", data.to);
  const { data: batches, error: bErr } = await bq;
  if (bErr) throw bErr;

  const batchList = batches ?? [];
  if (!batchList.length) return { rows: [], totals: { total: 0, attended: 0, defaulters: 0 } };
  const batchMap = {};
  for (const b of batchList) batchMap[b.id] = b;

  const { data: att, error: aErr } = await db
    .from("webinar_attendance")
    .select("id, batch_id, lead_id, attended, marked_at, defaulter_marked_at, created_at")
    .in("batch_id", batchList.map((b) => b.id));
  if (aErr) throw aErr;

  const list = att ?? [];
  const leadIds = [...new Set(list.map((r) => r.lead_id).filter(Boolean))];
  const leadMap = {};
  for (let i = 0; i < leadIds.length; i += 150) {
    const { data: leads, error: lErr } = await db
      .from("kob_leads")
      .select("id, code, full_name, phone, stage, language, assigned_to")
      .in("id", leadIds.slice(i, i + 150));
    if (lErr) throw lErr;
    for (const l of leads ?? []) leadMap[l.id] = l;
  }

  const execIds = [...new Set(Object.values(leadMap).map((l) => l.assigned_to).filter(Boolean))];
  const execMap = {};
  if (execIds.length) {
    const { data: profs } = await db
      .from("profiles").select("id, full_name").in("id", execIds);
    for (const p of profs ?? []) execMap[p.id] = p.full_name;
  }

  const rows = list.map((r) => {
    const b = batchMap[r.batch_id] ?? {};
    const l = leadMap[r.lead_id] ?? {};
    return {
      id: r.id,
      batch_name: b.name ?? "—",
      scheduled_at: b.scheduled_at ?? null,
      batch_language: b.language ?? null,
      lead_id: r.lead_id,
      code: l.code ?? "",
      full_name: l.full_name ?? "—",
      phone: l.phone ?? "",
      language: l.language ?? "",
      stage: l.stage ?? "",
      executive: l.assigned_to ? execMap[l.assigned_to] ?? "—" : "—",
      attended: !!r.attended,
      status: r.attended ? "Attended" : "Defaulter",
      marked_at: r.marked_at ?? null,
      defaulter_marked_at: r.defaulter_marked_at ?? null,
    };
  }).sort((a, b) => String(b.scheduled_at ?? "").localeCompare(String(a.scheduled_at ?? "")));

  return {
    rows,
    totals: {
      total: rows.length,
      attended: rows.filter((r) => r.attended).length,
      defaulters: rows.filter((r) => !r.attended).length,
    },
  };
}

// ----------------------------------------------------
// RUN VALIDATION
// ----------------------------------------------------

async function run() {
  console.log("==================================================");
  console.log("BATCH 11 READ-ONLY REGRESSION TEST SUITE");
  console.log("==================================================");

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const adminClient = SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

  console.log(`Authenticating as ${env.TEST_USER_EMAIL}...`);
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: env.TEST_USER_EMAIL,
    password: env.TEST_USER_PASSWORD,
  });

  if (authError || !authData.session) {
    console.error("Auth failed:", authError);
    process.exit(1);
  }

  const token = authData.session.access_token;
  const userId = authData.user.id;
  console.log(`Authenticated successfully! User ID: ${userId}`);

  // Fetch 2 existing lead IDs for getLeadDetail test
  const { data: sampleLeads } = await adminClient.from("kob_leads").select("id").limit(2);
  const leadId1 = sampleLeads?.[0]?.id;
  const leadId2 = sampleLeads?.[1]?.id;
  console.log(`Sample lead IDs for testing: ${leadId1}, ${leadId2}`);

  // Check initial counts to ensure ZERO database writes occur
  const { count: leadsCountBefore } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: histCountBefore } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: attCountBefore } = await adminClient.from("webinar_attendance").select("*", { count: "exact", head: true });
  const { count: actCountBefore } = await adminClient.from("lead_activities").select("*", { count: "exact", head: true });
  const { count: rtCountBefore } = await adminClient.from("retargeting_schedule").select("*", { count: "exact", head: true });

  const results = [];

  async function check(name, oldFn, endpointPath, options = {}) {
    process.stdout.write(`Testing: ${name}... `);
    const oldRes = await oldFn();

    const fetchUrl = `${BACKEND_BASE}${endpointPath}`;
    const newHttpRes = await fetch(fetchUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!newHttpRes.ok) {
      console.log(`FAILED! HTTP ${newHttpRes.status} on ${fetchUrl}`);
      const errBody = await newHttpRes.text();
      console.error("Error body:", errBody);
      process.exit(1);
    }

    const newRes = await newHttpRes.json();

    const isMatch = deepEqual(oldRes, newRes);
    if (!isMatch) {
      console.log("FAILED! Deep comparison mismatch.");
      console.log("OLD Sample:", JSON.stringify(oldRes)?.slice(0, 300));
      console.log("NEW Sample:", JSON.stringify(newRes)?.slice(0, 300));
      process.exit(1);
    }

    console.log("PASS ✓ (Deep Match 100%)");
    results.push({
      Function: name,
      Endpoint: endpointPath,
      Status: "MATCH",
      Rows: Array.isArray(newRes) ? newRes.length : (newRes?.rows ? newRes.rows.length : (newRes?.leads ? newRes.leads.length : Object.keys(newRes).length)),
    });
  }

  // 1. listWebinarEligibleLeads
  await check(
    "listWebinarEligibleLeads (default)",
    () => oldListWebinarEligibleLeads(client),
    `/api/webinar/eligible-leads`,
  );
  await check(
    "listWebinarEligibleLeads (language filter)",
    () => oldListWebinarEligibleLeads(client, { language: "TAMIL" }),
    `/api/webinar/eligible-leads?language=TAMIL`,
  );
  await check(
    "listWebinarEligibleLeads (search filter)",
    () => oldListWebinarEligibleLeads(client, { search: "test" }),
    `/api/webinar/eligible-leads?search=test`,
  );

  // 2. getExecPerformanceSummary
  await check(
    "getExecPerformanceSummary (default)",
    () => oldGetExecPerformanceSummary(client, userId, adminClient),
    `/api/dashboard/executive-performance-summary`,
  );
  const now = new Date();
  const mtdFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01T00:00:00.000Z`;
  await check(
    "getExecPerformanceSummary (month range)",
    () => oldGetExecPerformanceSummary(client, userId, adminClient, { from: mtdFrom }),
    `/api/dashboard/executive-performance-summary?from=${encodeURIComponent(mtdFrom)}`,
  );

  // 3. getFunnelStageLeads
  await check(
    "getFunnelStageLeads (LEAD_GENERATED all)",
    () => oldGetFunnelStageLeads(client, adminClient, { stageKey: "LEAD_GENERATED", mode: "all" }),
    `/api/dashboard/funnel-stage-leads?stageKey=LEAD_GENERATED&mode=all`,
  );
  await check(
    "getFunnelStageLeads (LEAD_GENERATED auto)",
    () => oldGetFunnelStageLeads(client, adminClient, { stageKey: "LEAD_GENERATED", mode: "auto" }),
    `/api/dashboard/funnel-stage-leads?stageKey=LEAD_GENERATED&mode=auto`,
  );
  await check(
    "getFunnelStageLeads (LEAD_GENERATED manual)",
    () => oldGetFunnelStageLeads(client, adminClient, { stageKey: "LEAD_GENERATED", mode: "manual" }),
    `/api/dashboard/funnel-stage-leads?stageKey=LEAD_GENERATED&mode=manual`,
  );
  await check(
    "getFunnelStageLeads (WEBINAR_ATTENDED)",
    () => oldGetFunnelStageLeads(client, adminClient, { stageKey: "WEBINAR_ATTENDED" }),
    `/api/dashboard/funnel-stage-leads?stageKey=WEBINAR_ATTENDED`,
  );
  await check(
    "getFunnelStageLeads (EOI_1)",
    () => oldGetFunnelStageLeads(client, adminClient, { stageKey: "EOI_1", mode: "all" }),
    `/api/dashboard/funnel-stage-leads?stageKey=EOI_1&mode=all`,
  );

  // 4. getLeadDetail
  if (leadId1) {
    await check(
      "getLeadDetail (lead 1)",
      () => oldGetLeadDetail(client, adminClient, { leadId: leadId1 }),
      `/api/kob/lead-detail?leadId=${leadId1}`,
    );
  }
  if (leadId2) {
    await check(
      "getLeadDetail (lead 2)",
      () => oldGetLeadDetail(client, adminClient, { leadId: leadId2 }),
      `/api/kob/lead-detail?leadId=${leadId2}`,
    );
  }

  // 5. getMyExecOverview
  await check(
    "getMyExecOverview (default)",
    () => oldGetMyExecOverview(client, userId),
    `/api/kob/my-exec-overview`,
  );
  await check(
    "getMyExecOverview (date range)",
    () => oldGetMyExecOverview(client, userId, { from: mtdFrom }),
    `/api/kob/my-exec-overview?from=${encodeURIComponent(mtdFrom)}`,
  );

  // 6. getScvModeConfig
  await check(
    "getScvModeConfig (AUTO)",
    () => oldGetScvModeConfig(client, { mode: "AUTO" }),
    `/api/kob/scv-mode-config?mode=AUTO`,
  );
  await check(
    "getScvModeConfig (MANUAL)",
    () => oldGetScvModeConfig(client, { mode: "MANUAL" }),
    `/api/kob/scv-mode-config?mode=MANUAL`,
  );

  // 7. getTATBreachDetailed
  await check(
    "getTATBreachDetailed",
    () => oldGetTATBreachDetailed(client, adminClient),
    `/api/kob/tat-breach-detailed`,
  );

  // 8. getWebinarHistory
  await check(
    "getWebinarHistory (default)",
    () => oldGetWebinarHistory(client, adminClient),
    `/api/webinar/history`,
  );
  await check(
    "getWebinarHistory (date range)",
    () => oldGetWebinarHistory(client, adminClient, { from: mtdFrom }),
    `/api/webinar/history?from=${encodeURIComponent(mtdFrom)}`,
  );

  // 9. Auth Failure Verification (401 when no token)
  process.stdout.write("Testing Auth Failure (no token)... ");
  const unauthRes = await fetch(`${BACKEND_BASE}/api/webinar/eligible-leads`);
  if (unauthRes.status !== 401) {
    console.log(`FAILED! Expected 401, got ${unauthRes.status}`);
    process.exit(1);
  }
  console.log("PASS ✓ (HTTP 401)");

  // 10. Database Writes Verification
  const { count: leadsCountAfter } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: histCountAfter } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: attCountAfter } = await adminClient.from("webinar_attendance").select("*", { count: "exact", head: true });
  const { count: actCountAfter } = await adminClient.from("lead_activities").select("*", { count: "exact", head: true });
  const { count: rtCountAfter } = await adminClient.from("retargeting_schedule").select("*", { count: "exact", head: true });

  const leadsDelta = leadsCountAfter - leadsCountBefore;
  const histDelta = histCountAfter - histCountBefore;
  const attDelta = attCountAfter - attCountBefore;
  const actDelta = actCountAfter - actCountBefore;
  const rtDelta = rtCountAfter - rtCountBefore;
  const totalDelta = leadsDelta + histDelta + attDelta + actDelta + rtDelta;

  console.log("\nDatabase Write Check:");
  console.log(`  Leads delta: ${leadsDelta}`);
  console.log(`  Stage history delta: ${histDelta}`);
  console.log(`  Webinar attendance delta: ${attDelta}`);
  console.log(`  Lead activities delta: ${actDelta}`);
  console.log(`  Retargeting schedule delta: ${rtDelta}`);
  console.log(`  Total DB mutations during test: ${totalDelta}`);

  if (totalDelta !== 0) {
    console.error("ERROR: Database mutations detected during read-only tests!");
    process.exit(1);
  }

  console.log("\n==================================================");
  console.log("BATCH 11 REGRESSION SUMMARY");
  console.log("==================================================");
  console.table(results);
  console.log("\nFINAL PARITY RESULT: PASS ✓");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
