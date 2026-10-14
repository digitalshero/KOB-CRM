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

// Helpers for OLD implementation logic mirroring src/lib/kob-dashboard.functions.ts & src/lib/kob.functions.ts
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

const AUTO_PROGRESSIONS = [
  { key: "eoi1", to: "EOI_1", from: ["LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE"] },
  { key: "webinarSent", to: "WEBINAR", from: ["EOI_1"] },
  { key: "eoi2", to: "EOI_2", from: ["WEBINAR", "WEBINAR_ATTENDED", "EOI2_PENDING"] },
  { key: "feePaid", to: "FEE_PAID", from: ["EOI_2"] },
  { key: "contractSigned", to: "KTN_CS", from: ["FEE_PAID"] },
];

function autoProgressionKey(from, to) {
  if (!from) return null;
  const p = AUTO_PROGRESSIONS.find((x) => x.to === to);
  if (!p || !p.from.includes(from)) return null;
  return p.key;
}

function makeCounter(spans, out) {
  const seen = spans.map(() => ({}));
  return (i, key, leadId) => {
    const bag = (seen[i][key] ??= new Set());
    if (bag.has(leadId)) return;
    bag.add(leadId);
    out[i][key] += 1;
  };
}

async function oldComputeAutoBuckets(supabase, adminClient, spans) {
  const out = spans.map(() => ({
    leadGenerated: 0,
    eoi1: 0,
    webinarSent: 0,
    webinarAttended: 0,
    eoi2: 0,
    feePaid: 0,
    contractSigned: 0,
  }));
  if (spans.length === 0) return out;

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
  const cohorts = spans.map(
    (s) => new Set(cohortLeads.filter((l) => inSpan(l.created_at, s)).map((l) => l.id)),
  );
  cohorts.forEach((c, i) => (out[i].leadGenerated = c.size));

  const bump = makeCounter(spans, out);
  const ids = cohortLeads.map((l) => l.id);
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
      const key = autoProgressionKey(h.from_stage, h.to_stage);
      if (!key) continue;
      cohorts.forEach((set, i) => {
        if (set.has(h.lead_id)) bump(i, key, h.lead_id);
      });
    }
  }

  const { min, max } = bounds(spans);
  const historyDb = adminClient || supabase;
  const batches = await pageAll(() =>
    historyDb
      .from("webinar_batches")
      .select("id, scheduled_at")
      .gte("scheduled_at", min)
      .lte("scheduled_at", max)
      .order("scheduled_at", { ascending: true }),
  );
  const batchTime = new Map(batches.map((b) => [b.id, String(b.scheduled_at ?? "")]));
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
      for (const a of att) {
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

function combinedProgressionKey(from, to) {
  if (!from) return null;
  const p = COMBINED_PROGRESSIONS.find((x) => x.to === to);
  if (!p) return null;
  if (!p.from.includes(from)) return null;
  return p.key;
}

async function oldCombinedFirstEntries(supabase) {
  const out = {};
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

async function runBatch5Regression() {
  console.log("==================================================");
  console.log("BATCH 5: REGRESSION VALIDATION");
  console.log("==================================================");

  // Authenticate test user
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData, error: authErr } = await authClient.auth.signInWithPassword({
    email: env.TEST_USER_EMAIL,
    password: env.TEST_USER_PASSWORD,
  });
  if (authErr) throw new Error(`Auth failed: ${authErr.message}`);

  const token = authData.session.access_token;
  const userId = authData.user.id;
  console.log(`✓ Authenticated test user: ${userId}`);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Capture pre-test DB row counts to verify 0 writes
  const { count: preLeads } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: preHist } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: preBrands } = await adminClient.from("brands").select("*", { count: "exact", head: true });

  const currentMonthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const currentMonthEnd = new Date().toISOString();
  const customFrom = "2026-07-01T00:00:00.000Z";
  const customTo = "2026-07-31T23:59:59.999Z";

  // Build standard spans (5 days + MTD)
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const testSpans = [];
  for (let i = 1; i <= 5; i++) {
    const start = new Date(base);
    start.setDate(base.getDate() - i);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    testSpans.push({ from: start.toISOString(), to: end.toISOString() });
  }
  const mStart = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
  const yEnd = new Date(base);
  yEnd.setDate(base.getDate() - 1);
  yEnd.setHours(23, 59, 59, 999);
  testSpans.push({ from: mStart.toISOString(), to: yEnd.toISOString() });

  const testCases = [
    // 1. getAbandonedFunnel
    {
      name: "getAbandonedFunnel (no filter)",
      url: `${BACKEND_BASE}/api/dashboard/abandoned-funnel`,
      oldFn: async () => {
        const TO = ["NO", "LATER", "NO_RESPONSE"];
        const rows = await pageAll(() =>
          userClient
            .from("lead_stage_history")
            .select("lead_id, from_stage, to_stage, created_at")
            .in("to_stage", TO)
            .not("from_stage", "is", null)
            .order("created_at", { ascending: true }),
        );
        const sets = { NO: new Set(), LATER: new Set(), NO_RESPONSE: new Set() };
        for (const row of rows) {
          if (!row.lead_id) continue;
          sets[row.to_stage]?.add(row.lead_id);
        }

        const IST_MS = 5.5 * 60 * 60 * 1000;
        const nowIst = new Date(Date.now() + IST_MS);
        const istDay = (iso) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
        const todayIst = nowIst.toISOString().slice(0, 10);
        const days = [];
        for (let i = 1; i <= 5; i++) {
          days.push(new Date(nowIst.getTime() - i * 86400000).toISOString().slice(0, 10));
        }
        const monthStart = todayIst.slice(0, 8) + "01";
        const earliest = days[days.length - 1] < monthStart ? days[days.length - 1] : monthStart;
        const windowFrom = new Date(new Date(`${earliest}T00:00:00.000Z`).getTime() - IST_MS).toISOString();

        const tableRows = await pageAll(() =>
          userClient
            .from("lead_stage_history")
            .select("lead_id, from_stage, to_stage, created_at")
            .in("to_stage", TO)
            .not("from_stage", "is", null)
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
          TO.map((t) => [t, { daily: days.map((d) => perDay[t][d].size), mtd: perMtd[t].size }]),
        );

        return {
          no: sets.NO.size,
          later: sets.LATER.size,
          noResponse: sets.NO_RESPONSE.size,
          days,
          table,
        };
      },
    },
    {
      name: "getAbandonedFunnel (current month)",
      url: `${BACKEND_BASE}/api/dashboard/abandoned-funnel?from=${encodeURIComponent(currentMonthStart)}&to=${encodeURIComponent(currentMonthEnd)}`,
      oldFn: async () => {
        const TO = ["NO", "LATER", "NO_RESPONSE"];
        const rows = await pageAll(() =>
          userClient
            .from("lead_stage_history")
            .select("lead_id, from_stage, to_stage, created_at")
            .in("to_stage", TO)
            .not("from_stage", "is", null)
            .gte("created_at", currentMonthStart)
            .lte("created_at", currentMonthEnd)
            .order("created_at", { ascending: true }),
        );
        const sets = { NO: new Set(), LATER: new Set(), NO_RESPONSE: new Set() };
        for (const row of rows) {
          if (!row.lead_id) continue;
          sets[row.to_stage]?.add(row.lead_id);
        }

        const IST_MS = 5.5 * 60 * 60 * 1000;
        const nowIst = new Date(Date.now() + IST_MS);
        const istDay = (iso) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
        const todayIst = nowIst.toISOString().slice(0, 10);
        const days = [];
        for (let i = 1; i <= 5; i++) {
          days.push(new Date(nowIst.getTime() - i * 86400000).toISOString().slice(0, 10));
        }
        const monthStart = todayIst.slice(0, 8) + "01";
        const earliest = days[days.length - 1] < monthStart ? days[days.length - 1] : monthStart;
        const windowFrom = new Date(new Date(`${earliest}T00:00:00.000Z`).getTime() - IST_MS).toISOString();

        const tableRows = await pageAll(() =>
          userClient
            .from("lead_stage_history")
            .select("lead_id, from_stage, to_stage, created_at")
            .in("to_stage", TO)
            .not("from_stage", "is", null)
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
          TO.map((t) => [t, { daily: days.map((d) => perDay[t][d].size), mtd: perMtd[t].size }]),
        );

        return {
          no: sets.NO.size,
          later: sets.LATER.size,
          noResponse: sets.NO_RESPONSE.size,
          days,
          table,
        };
      },
    },
    {
      name: "getAbandonedFunnel (custom range 2026-07)",
      url: `${BACKEND_BASE}/api/dashboard/abandoned-funnel?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`,
      oldFn: async () => {
        const TO = ["NO", "LATER", "NO_RESPONSE"];
        const rows = await pageAll(() =>
          userClient
            .from("lead_stage_history")
            .select("lead_id, from_stage, to_stage, created_at")
            .in("to_stage", TO)
            .not("from_stage", "is", null)
            .gte("created_at", customFrom)
            .lte("created_at", customTo)
            .order("created_at", { ascending: true }),
        );
        const sets = { NO: new Set(), LATER: new Set(), NO_RESPONSE: new Set() };
        for (const row of rows) {
          if (!row.lead_id) continue;
          sets[row.to_stage]?.add(row.lead_id);
        }

        const IST_MS = 5.5 * 60 * 60 * 1000;
        const nowIst = new Date(Date.now() + IST_MS);
        const istDay = (iso) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
        const todayIst = nowIst.toISOString().slice(0, 10);
        const days = [];
        for (let i = 1; i <= 5; i++) {
          days.push(new Date(nowIst.getTime() - i * 86400000).toISOString().slice(0, 10));
        }
        const monthStart = todayIst.slice(0, 8) + "01";
        const earliest = days[days.length - 1] < monthStart ? days[days.length - 1] : monthStart;
        const windowFrom = new Date(new Date(`${earliest}T00:00:00.000Z`).getTime() - IST_MS).toISOString();

        const tableRows = await pageAll(() =>
          userClient
            .from("lead_stage_history")
            .select("lead_id, from_stage, to_stage, created_at")
            .in("to_stage", TO)
            .not("from_stage", "is", null)
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
          TO.map((t) => [t, { daily: days.map((d) => perDay[t][d].size), mtd: perMtd[t].size }]),
        );

        return {
          no: sets.NO.size,
          later: sets.LATER.size,
          noResponse: sets.NO_RESPONSE.size,
          days,
          table,
        };
      },
    },

    // 2. getAbandonedLeads
    {
      name: "getAbandonedLeads",
      url: `${BACKEND_BASE}/api/kob/abandoned-leads`,
      oldFn: async () => {
        const ABANDONED_STAGES = [
          "LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE", "EOI_1", "WEBINAR", "EOI_2",
          "FORM_FILLED", "FEE_PAID", "KTN_CS",
        ];
        const { data: role } = await userClient.rpc("get_user_role", { _user_id: userId });
        const r = role ?? "executive";

        let q = userClient
          .from("v_abandoned_leads")
          .select("lead_id, code, full_name, stage, assigned_to, team_leader_id, brand_id, brand_name, language, stage_entered_at, days_in_stage, is_abandoned")
          .eq("is_abandoned", true);

        if (r === "executive") q = q.eq("assigned_to", userId);

        const { data, error } = await q.order("days_in_stage", { ascending: false }).limit(1000);
        if (error) throw new Error(error.message);
        const rows = data ?? [];

        const ids = Array.from(new Set(rows.flatMap((x) => [x.assigned_to, x.team_leader_id]).filter(Boolean)));
        let names = {};
        if (ids.length) {
          const { data: profs } = await userClient.from("profiles").select("id, full_name").in("id", ids);
          for (const p of profs ?? []) names[p.id] = p.full_name;
        }

        const summary = {};
        for (const s of ABANDONED_STAGES) summary[s] = 0;
        for (const row of rows) summary[row.stage] = (summary[row.stage] ?? 0) + 1;

        const enriched = rows.map((x) => ({
          ...x,
          assigned_to_name: x.assigned_to ? names[x.assigned_to] ?? null : null,
          team_leader_name: x.team_leader_id ? names[x.team_leader_id] ?? null : null,
          days_in_stage: Math.floor(Number(x.days_in_stage ?? 0)),
        }));

        return { rows: enriched, summary, stages: ABANDONED_STAGES };
      },
    },

    // 3. getAbandonedSplit
    {
      name: "getAbandonedSplit (default / no asOf)",
      url: `${BACKEND_BASE}/api/dashboard/abandoned-split`,
      oldFn: async () => {
        const TO = ["NO", "LATER", "NO_RESPONSE"];
        const FROM = new Set(["LEAD_INBOX", "AUTO_FIRED", "EOI_1", "WEBINAR", "WEBINAR_ATTENDED", "EOI2_PENDING", "EOI_2"]);
        const IST_MS = 5.5 * 60 * 60 * 1000;
        const day = new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
        const cutoff = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_MS + 86400000 - 1).toISOString();
        const entries = await pageAll(() =>
          userClient.from("lead_stage_history").select("lead_id")
            .in("to_stage", TO).lte("created_at", cutoff).order("created_at", { ascending: true }),
        );
        const leadIds = Array.from(new Set(entries.map((x) => x.lead_id).filter(Boolean)));
        const last = new Map();
        for (let i = 0; i < leadIds.length; i += 200) {
          const chunk = leadIds.slice(i, i + 200);
          const rows = await pageAll(() =>
            userClient.from("lead_stage_history").select("lead_id, from_stage, to_stage, created_at")
              .in("lead_id", chunk).lte("created_at", cutoff).order("created_at", { ascending: true }),
          );
          for (const row of rows) last.set(row.lead_id, row);
        }
        const sets = { NO: new Set(), LATER: new Set(), NO_RESPONSE: new Set() };
        for (const [id, row] of last) {
          if (!TO.includes(row.to_stage) || !FROM.has(row.from_stage)) continue;
          sets[row.to_stage].add(id);
        }
        return { asOf: day, noResponse: sets.NO_RESPONSE.size, no: sets.NO.size, later: sets.LATER.size };
      },
    },
    {
      name: "getAbandonedSplit (asOf=2026-10-10)",
      url: `${BACKEND_BASE}/api/dashboard/abandoned-split?asOf=2026-10-10`,
      oldFn: async () => {
        const TO = ["NO", "LATER", "NO_RESPONSE"];
        const FROM = new Set(["LEAD_INBOX", "AUTO_FIRED", "EOI_1", "WEBINAR", "WEBINAR_ATTENDED", "EOI2_PENDING", "EOI_2"]);
        const IST_MS = 5.5 * 60 * 60 * 1000;
        const day = "2026-10-10";
        const cutoff = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_MS + 86400000 - 1).toISOString();
        const entries = await pageAll(() =>
          userClient.from("lead_stage_history").select("lead_id")
            .in("to_stage", TO).lte("created_at", cutoff).order("created_at", { ascending: true }),
        );
        const leadIds = Array.from(new Set(entries.map((x) => x.lead_id).filter(Boolean)));
        const last = new Map();
        for (let i = 0; i < leadIds.length; i += 200) {
          const chunk = leadIds.slice(i, i + 200);
          const rows = await pageAll(() =>
            userClient.from("lead_stage_history").select("lead_id, from_stage, to_stage, created_at")
              .in("lead_id", chunk).lte("created_at", cutoff).order("created_at", { ascending: true }),
          );
          for (const row of rows) last.set(row.lead_id, row);
        }
        const sets = { NO: new Set(), LATER: new Set(), NO_RESPONSE: new Set() };
        for (const [id, row] of last) {
          if (!TO.includes(row.to_stage) || !FROM.has(row.from_stage)) continue;
          sets[row.to_stage].add(id);
        }
        return { asOf: day, noResponse: sets.NO_RESPONSE.size, no: sets.NO.size, later: sets.LATER.size };
      },
    },

    // 4. getAllocationBreakdownByTL
    {
      name: "getAllocationBreakdownByTL",
      url: `${BACKEND_BASE}/api/kob/allocation-breakdown-by-tl`,
      oldFn: async () => {
        const { data: profiles } = await userClient.from("profiles").select("id, full_name, team_leader_id");
        const { data: roles } = await userClient.from("user_roles").select("user_id, role");
        const { data: leads } = await userClient.from("kob_leads").select("id, team_leader_id, assigned_to");

        const roleByUser = {};
        for (const r of roles ?? []) (roleByUser[r.user_id] ??= []).push(r.role);

        const tls = (profiles ?? []).filter((p) => roleByUser[p.id]?.includes("team_leader"));
        const execCountByTL = {};
        for (const p of profiles ?? []) {
          if (roleByUser[p.id]?.includes("executive") && p.team_leader_id) {
            execCountByTL[p.team_leader_id] = (execCountByTL[p.team_leader_id] ?? 0) + 1;
          }
        }

        let orgUnassignedToTL = 0;
        let orgUnallocatedWithinTeam = 0;
        const perTL = {};
        for (const l of leads ?? []) {
          const tl = l.team_leader_id;
          const assigned = l.assigned_to;
          if (!tl) { orgUnassignedToTL += 1; continue; }
          perTL[tl] ??= { received: 0, allocated: 0, unallocated: 0 };
          perTL[tl].received += 1;
          if (assigned) perTL[tl].allocated += 1;
          else { perTL[tl].unallocated += 1; orgUnallocatedWithinTeam += 1; }
        }

        const rows = tls.map((tl) => ({
          id: tl.id,
          name: tl.full_name,
          teamSize: execCountByTL[tl.id] ?? 0,
          received: perTL[tl.id]?.received ?? 0,
          allocated: perTL[tl.id]?.allocated ?? 0,
          unallocated: perTL[tl.id]?.unallocated ?? 0,
        })).sort((a, b) => b.received - a.received);

        return { rows, orgUnassignedToTL, orgUnallocatedWithinTeam };
      },
    },

    // 5. getAutoFunnel
    {
      name: "getAutoFunnel (no filter)",
      url: `${BACKEND_BASE}/api/dashboard/auto-funnel`,
      oldFn: async () => {
        const span = {
          from: new Date(0).toISOString(),
          to: new Date().toISOString(),
        };
        const [b] = await oldComputeAutoBuckets(userClient, adminClient, [span]);
        return {
          leadGenerated: b.leadGenerated,
          eoi1: b.eoi1,
          webinarSent: b.webinarSent,
          webinarAccepted: b.webinarAttended,
          eoi2: b.eoi2,
          feePaid: b.feePaid,
          contractSigned: b.contractSigned,
        };
      },
    },
    {
      name: "getAutoFunnel (current month)",
      url: `${BACKEND_BASE}/api/dashboard/auto-funnel?from=${encodeURIComponent(currentMonthStart)}&to=${encodeURIComponent(currentMonthEnd)}`,
      oldFn: async () => {
        const span = {
          from: currentMonthStart,
          to: currentMonthEnd,
        };
        const [b] = await oldComputeAutoBuckets(userClient, adminClient, [span]);
        return {
          leadGenerated: b.leadGenerated,
          eoi1: b.eoi1,
          webinarSent: b.webinarSent,
          webinarAccepted: b.webinarAttended,
          eoi2: b.eoi2,
          feePaid: b.feePaid,
          contractSigned: b.contractSigned,
        };
      },
    },
    {
      name: "getAutoFunnel (custom range 2026-07)",
      url: `${BACKEND_BASE}/api/dashboard/auto-funnel?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`,
      oldFn: async () => {
        const span = {
          from: customFrom,
          to: customTo,
        };
        const [b] = await oldComputeAutoBuckets(userClient, adminClient, [span]);
        return {
          leadGenerated: b.leadGenerated,
          eoi1: b.eoi1,
          webinarSent: b.webinarSent,
          webinarAccepted: b.webinarAttended,
          eoi2: b.eoi2,
          feePaid: b.feePaid,
          contractSigned: b.contractSigned,
        };
      },
    },

    // 6. getAutoFunnelBuckets
    {
      name: "getAutoFunnelBuckets (6 spans)",
      url: `${BACKEND_BASE}/api/dashboard/auto-funnel-buckets?spans=${encodeURIComponent(JSON.stringify(testSpans))}`,
      oldFn: async () => {
        return oldComputeAutoBuckets(userClient, adminClient, testSpans);
      },
    },
    {
      name: "getAutoFunnelBuckets (empty spans)",
      url: `${BACKEND_BASE}/api/dashboard/auto-funnel-buckets?spans=${encodeURIComponent(JSON.stringify([]))}`,
      oldFn: async () => {
        return oldComputeAutoBuckets(userClient, adminClient, []);
      },
    },

    // 7. getBrandPerformance
    {
      name: "getBrandPerformance (no filter)",
      url: `${BACKEND_BASE}/api/dashboard/brand-performance`,
      oldFn: async () => {
        const { data: brands } = await userClient
          .from("brands")
          .select("id, name, code")
          .eq("active", true)
          .order("code");
        const leads = await pageAll(() => userClient.from("kob_leads").select("brand_id, stage"));
        const map = new Map();
        const byName = new Map();
        for (const b of brands ?? []) {
          const row = { brand: b.name, code: b.code, leads: 0, contracts: 0 };
          map.set(b.id, row);
          byName.set(String(b.name).trim().toLowerCase(), row);
        }
        for (const l of leads) {
          const row = l.brand_id ? map.get(l.brand_id) : undefined;
          if (!row) continue;
          row.leads++;
        }
        const ktnHist = await pageAll(() =>
          userClient.from("lead_stage_history").select("lead_id").eq("to_stage", "KTN_CS"),
        );
        const enteredIds = new Set(ktnHist.map((h) => h.lead_id));
        const ktn = (
          await pageAll(() =>
            userClient.from("kob_leads").select("id, cuisine").eq("stage", "KTN_CS").not("cuisine", "is", null),
          )
        ).filter((l) => enteredIds.has(l.id));
        const seen = new Set();
        for (const l of ktn) {
          if (seen.has(l.id)) continue;
          seen.add(l.id);
          const row = byName.get(String(l.cuisine).trim().toLowerCase());
          if (row) row.contracts++;
        }
        return Array.from(map.values()).map((row) => ({
          ...row,
          conv: row.leads > 0 ? Math.round((row.contracts / row.leads) * 1000) / 10 : 0,
          pending: row.leads - row.contracts,
        }));
      },
    },
    {
      name: "getBrandPerformance (current month)",
      url: `${BACKEND_BASE}/api/dashboard/brand-performance?from=${encodeURIComponent(currentMonthStart)}&to=${encodeURIComponent(currentMonthEnd)}`,
      oldFn: async () => {
        const { data: brands } = await userClient
          .from("brands")
          .select("id, name, code")
          .eq("active", true)
          .order("code");
        const leads = await pageAll(() =>
          userClient
            .from("kob_leads")
            .select("brand_id, stage")
            .gte("created_at", currentMonthStart)
            .lte("created_at", currentMonthEnd),
        );
        const map = new Map();
        const byName = new Map();
        for (const b of brands ?? []) {
          const row = { brand: b.name, code: b.code, leads: 0, contracts: 0 };
          map.set(b.id, row);
          byName.set(String(b.name).trim().toLowerCase(), row);
        }
        for (const l of leads) {
          const row = l.brand_id ? map.get(l.brand_id) : undefined;
          if (!row) continue;
          row.leads++;
        }
        const ktnHist = await pageAll(() =>
          userClient
            .from("lead_stage_history")
            .select("lead_id")
            .eq("to_stage", "KTN_CS")
            .gte("created_at", currentMonthStart)
            .lte("created_at", currentMonthEnd),
        );
        const enteredIds = new Set(ktnHist.map((h) => h.lead_id));
        const ktn = (
          await pageAll(() =>
            userClient.from("kob_leads").select("id, cuisine").eq("stage", "KTN_CS").not("cuisine", "is", null),
          )
        ).filter((l) => enteredIds.has(l.id));
        const seen = new Set();
        for (const l of ktn) {
          if (seen.has(l.id)) continue;
          seen.add(l.id);
          const row = byName.get(String(l.cuisine).trim().toLowerCase());
          if (row) row.contracts++;
        }
        return Array.from(map.values()).map((row) => ({
          ...row,
          conv: row.leads > 0 ? Math.round((row.contracts / row.leads) * 1000) / 10 : 0,
          pending: row.leads - row.contracts,
        }));
      },
    },
    {
      name: "getBrandPerformance (custom range 2026-07)",
      url: `${BACKEND_BASE}/api/dashboard/brand-performance?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`,
      oldFn: async () => {
        const { data: brands } = await userClient
          .from("brands")
          .select("id, name, code")
          .eq("active", true)
          .order("code");
        const leads = await pageAll(() =>
          userClient
            .from("kob_leads")
            .select("brand_id, stage")
            .gte("created_at", customFrom)
            .lte("created_at", customTo),
        );
        const map = new Map();
        const byName = new Map();
        for (const b of brands ?? []) {
          const row = { brand: b.name, code: b.code, leads: 0, contracts: 0 };
          map.set(b.id, row);
          byName.set(String(b.name).trim().toLowerCase(), row);
        }
        for (const l of leads) {
          const row = l.brand_id ? map.get(l.brand_id) : undefined;
          if (!row) continue;
          row.leads++;
        }
        const ktnHist = await pageAll(() =>
          userClient
            .from("lead_stage_history")
            .select("lead_id")
            .eq("to_stage", "KTN_CS")
            .gte("created_at", customFrom)
            .lte("created_at", customTo),
        );
        const enteredIds = new Set(ktnHist.map((h) => h.lead_id));
        const ktn = (
          await pageAll(() =>
            userClient.from("kob_leads").select("id, cuisine").eq("stage", "KTN_CS").not("cuisine", "is", null),
          )
        ).filter((l) => enteredIds.has(l.id));
        const seen = new Set();
        for (const l of ktn) {
          if (seen.has(l.id)) continue;
          seen.add(l.id);
          const row = byName.get(String(l.cuisine).trim().toLowerCase());
          if (row) row.contracts++;
        }
        return Array.from(map.values()).map((row) => ({
          ...row,
          conv: row.leads > 0 ? Math.round((row.contracts / row.leads) * 1000) / 10 : 0,
          pending: row.leads - row.contracts,
        }));
      },
    },

    // 8. getCombinedFunnel
    {
      name: "getCombinedFunnel (no filter)",
      url: `${BACKEND_BASE}/api/dashboard/combined-funnel`,
      oldFn: async () => {
        const leadRows = await pageAll(() =>
          userClient.from("kob_leads").select("id, stage").order("created_at", { ascending: true }),
        );
        const pop = new Map();
        for (const l of leadRows) pop.set(l.id, l.stage);

        const first = await oldCombinedFirstEntries(userClient);
        const pick = (stage) => {
          const s = new Set();
          for (const [id, ts] of first[stage]) s.add(id);
          return s;
        };
        const reached = {
          EOI_1: pick("EOI_1"),
          WEBINAR: pick("WEBINAR"),
          EOI_2: pick("EOI_2"),
          FEE_PAID: pick("FEE_PAID"),
          KTN_CS: pick("KTN_CS"),
        };

        const current = new Map(pop);
        const missing = new Set();
        for (const s of Object.values(reached)) for (const id of s) if (!current.has(id)) missing.add(id);
        const miss = [...missing];
        for (let i = 0; i < miss.length; i += 200) {
          const { data: rows } = await userClient
            .from("kob_leads")
            .select("id, stage")
            .in("id", miss.slice(i, i + 200));
          for (const l of rows ?? []) current.set(l.id, l.stage);
        }

        const stuck = (set, stage) => {
          let n = 0;
          for (const id of set) if (current.get(id) === stage) n++;
          return n;
        };

        let leadsNotMoved = 0;
        for (const stage of pop.values()) if (stage === "LEAD_INBOX") leadsNotMoved++;

        return {
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
        };
      },
    },
    {
      name: "getCombinedFunnel (current month)",
      url: `${BACKEND_BASE}/api/dashboard/combined-funnel?from=${encodeURIComponent(currentMonthStart)}&to=${encodeURIComponent(currentMonthEnd)}`,
      oldFn: async () => {
        const leadRows = await pageAll(() =>
          userClient
            .from("kob_leads")
            .select("id, stage")
            .gte("created_at", currentMonthStart)
            .lte("created_at", currentMonthEnd)
            .order("created_at", { ascending: true }),
        );
        const pop = new Map();
        for (const l of leadRows) pop.set(l.id, l.stage);

        const first = await oldCombinedFirstEntries(userClient);
        const inR = (ts) => ts >= currentMonthStart && ts <= currentMonthEnd;
        const pick = (stage) => {
          const s = new Set();
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

        const current = new Map(pop);
        const missing = new Set();
        for (const s of Object.values(reached)) for (const id of s) if (!current.has(id)) missing.add(id);
        const miss = [...missing];
        for (let i = 0; i < miss.length; i += 200) {
          const { data: rows } = await userClient
            .from("kob_leads")
            .select("id, stage")
            .in("id", miss.slice(i, i + 200));
          for (const l of rows ?? []) current.set(l.id, l.stage);
        }

        const stuck = (set, stage) => {
          let n = 0;
          for (const id of set) if (current.get(id) === stage) n++;
          return n;
        };

        let leadsNotMoved = 0;
        for (const stage of pop.values()) if (stage === "LEAD_INBOX") leadsNotMoved++;

        return {
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
        };
      },
    },
    {
      name: "getCombinedFunnel (custom range 2026-07)",
      url: `${BACKEND_BASE}/api/dashboard/combined-funnel?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`,
      oldFn: async () => {
        const leadRows = await pageAll(() =>
          userClient
            .from("kob_leads")
            .select("id, stage")
            .gte("created_at", customFrom)
            .lte("created_at", customTo)
            .order("created_at", { ascending: true }),
        );
        const pop = new Map();
        for (const l of leadRows) pop.set(l.id, l.stage);

        const first = await oldCombinedFirstEntries(userClient);
        const inR = (ts) => ts >= customFrom && ts <= customTo;
        const pick = (stage) => {
          const s = new Set();
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

        const current = new Map(pop);
        const missing = new Set();
        for (const s of Object.values(reached)) for (const id of s) if (!current.has(id)) missing.add(id);
        const miss = [...missing];
        for (let i = 0; i < miss.length; i += 200) {
          const { data: rows } = await userClient
            .from("kob_leads")
            .select("id, stage")
            .in("id", miss.slice(i, i + 200));
          for (const l of rows ?? []) current.set(l.id, l.stage);
        }

        const stuck = (set, stage) => {
          let n = 0;
          for (const id of set) if (current.get(id) === stage) n++;
          return n;
        };

        let leadsNotMoved = 0;
        for (const stage of pop.values()) if (stage === "LEAD_INBOX") leadsNotMoved++;

        return {
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
        };
      },
    },
  ];

  const results = [];

  for (const tc of testCases) {
    console.log(`\nTesting ${tc.name}...`);
    try {
      const oldRes = await tc.oldFn();
      const newHttpRes = await fetch(tc.url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!newHttpRes.ok) {
        const errText = await newHttpRes.text();
        throw new Error(`Endpoint ${tc.url} returned HTTP ${newHttpRes.status}: ${errText}`);
      }

      const newRes = await newHttpRes.json();
      const match = deepEqual(oldRes, newRes);

      const oldLen = Array.isArray(oldRes) ? `${oldRes.length} items` : typeof oldRes === "object" ? "Object" : String(oldRes);
      const newLen = Array.isArray(newRes) ? `${newRes.length} items` : typeof newRes === "object" ? "Object" : String(newRes);

      console.log(`  OLD: ${oldLen}`);
      console.log(`  NEW: ${newLen}`);
      console.log(`  DEEP MATCH: ${match ? "YES ✓" : "NO ✗"}`);

      if (!match) {
        console.error("Mismatch details:");
        console.error("OLD sample:", JSON.stringify(oldRes).slice(0, 300));
        console.error("NEW sample:", JSON.stringify(newRes).slice(0, 300));
      }

      results.push({
        name: tc.name,
        oldResult: oldLen,
        newResult: newLen,
        match: match ? "YES" : "NO",
      });
    } catch (err) {
      console.error(`  ERROR testing ${tc.name}:`, err.message);
      results.push({
        name: tc.name,
        oldResult: "ERROR",
        newResult: err.message,
        match: "NO",
      });
    }
  }

  // Auth failure check (401 when no auth header)
  console.log("\nTesting Auth Failure (no token)...");
  const unauthRes = await fetch(`${BACKEND_BASE}/api/dashboard/auto-funnel`);
  const unauthOk = unauthRes.status === 401;
  console.log(`  Unauthenticated request returned HTTP ${unauthRes.status} (expected 401): ${unauthOk ? "YES ✓" : "NO ✗"}`);

  // DB write count verification
  const { count: postLeads } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: postHist } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: postBrands } = await adminClient.from("brands").select("*", { count: "exact", head: true });

  const writesDelta = Math.abs(postLeads - preLeads) + Math.abs(postHist - preHist) + Math.abs(postBrands - preBrands);
  console.log(`\nDatabase Write Check:`);
  console.log(`  Leads delta: ${postLeads - preLeads}`);
  console.log(`  Stage history delta: ${postHist - preHist}`);
  console.log(`  Brands delta: ${postBrands - preBrands}`);
  console.log(`  Total DB mutations during test: ${writesDelta}`);

  console.log("\n==================================================");
  console.log("BATCH 5 REGRESSION SUMMARY");
  console.log("==================================================");
  console.table(results);

  const allPassed = results.every((r) => r.match === "YES") && unauthOk && writesDelta === 0;
  console.log(`\nFINAL PARITY RESULT: ${allPassed ? "PASS ✓" : "FAIL ✗"}`);
  if (!allPassed) {
    process.exit(1);
  }
}

runBatch5Regression().catch((err) => {
  console.error("FATAL Regression script error:", err);
  process.exit(1);
});
