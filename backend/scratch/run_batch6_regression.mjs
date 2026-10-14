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
  if (!p || !p.from.includes(from)) return null;
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

const COMBINED_STAGE_KEYS = {
  EOI_1: "eoi1",
  WEBINAR: "webinar",
  EOI_2: "eoi2",
  FEE_PAID: "feePaid",
  KTN_CS: "contractSigned",
};

async function oldComputeCombinedBuckets(supabase, spans) {
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
  const leads = await pageAll(() =>
    supabase
      .from("kob_leads")
      .select("id, created_at")
      .gte("created_at", min)
      .lte("created_at", max)
      .order("created_at", { ascending: true }),
  );
  spans.forEach((s, i) => {
    out[i].leadGenerated = leads.filter((l) => inSpan(l.created_at, s)).length;
  });

  const first = await oldCombinedFirstEntries(supabase);
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

const COMBINED_SPLIT_SOURCES = {
  EOI_1: ["EOI_1"],
  WEBINAR: ["WEBINAR", "WEBINAR_ATTENDED"],
  EOI_2: ["EOI_2"],
};
const COMBINED_SPLIT_SUCCESS = {
  EOI_1: ["WEBINAR"],
  WEBINAR: ["WEBINAR_ATTENDED", "EOI2_PENDING", "EOI_2"],
  EOI_2: ["FORM_FILLED", "FEE_PAID", "KTN_CS"],
};
const SPLIT_NEG = ["NO", "NO_RESPONSE", "LATER"];
const SPLIT_KEYS = ["INTERESTED", "NO", "NO_RESPONSE", "LATER", "PENDING"];

async function oldCombinedSplitClassify(supabase, stageKey) {
  const firstMap = (await oldCombinedFirstEntries(supabase))[stageKey] ?? new Map();
  const success = COMBINED_SPLIT_SUCCESS[stageKey] ?? [];
  const rows = await pageAll(() =>
    supabase
      .from("lead_stage_history")
      .select("id, lead_id, from_stage, to_stage, created_at")
      .in("from_stage", COMBINED_SPLIT_SOURCES[stageKey])
      .in("to_stage", [...success, ...SPLIT_NEG])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  );
  const cls = new Map();
  for (const r of rows) {
    const entry = firstMap.get(r.lead_id);
    if (!entry || cls.has(r.lead_id) || r.created_at < entry) continue;
    if (r.from_stage === r.to_stage) continue;
    cls.set(r.lead_id, success.includes(r.to_stage) ? "INTERESTED" : r.to_stage);
  }
  return { first: firstMap, cls };
}

const EXECUTIVE_SUMMARY_STAGES = [
  "LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE", "EOI_1", "WEBINAR", "WEBINAR_ATTENDED", "EOI2_PENDING",
  "EOI_2", "FORM_FILLED", "FEE_PAID", "AGREEMENT_SIGNED", "KTN_CS", "KTN_LIVE",
  "NO", "LATER", "NO_RESPONSE", "RETARGETING", "DEAD_LEAD", "NON_SERVICEABLE", "NO_VACANCY", "DUPLICATE_LEAD",
];

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

function bucketStart(d, unit) {
  const x = new Date(d);
  if (unit === "month") { x.setUTCDate(1); x.setUTCHours(0,0,0,0); return x; }
  const day = x.getUTCDay(); const diff = (day + 6) % 7;
  x.setUTCDate(x.getUTCDate() - diff); x.setUTCHours(0,0,0,0); return x;
}
function addBuckets(d, n, unit) {
  const x = new Date(d);
  if (unit === "month") x.setUTCMonth(x.getUTCMonth() + n);
  else x.setUTCDate(x.getUTCDate() + n * 7);
  return x;
}
function labelOf(d, unit) {
  if (unit === "month") return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  const m = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `W ${m}`;
}
function seriesFor(rows, metric, buckets, unit) {
  const pred = metricPred(metric);
  const out = [];
  for (let i = 0; i < buckets.length; i++) {
    const start = buckets[i].getTime();
    const end = (i + 1 < buckets.length ? buckets[i + 1] : addBuckets(buckets[i], 1, unit)).getTime();
    let c = 0;
    for (const l of rows) {
      const t = new Date(l.created_at).getTime();
      if (t >= start && t < end && pred(l)) c++;
    }
    out.push({ period: labelOf(buckets[i], unit), value: c });
  }
  const n = out.length;
  const xs = out.map((_, i) => i);
  const ys = out.map(o => o.value);
  const sx = xs.reduce((a,b)=>a+b,0);
  const sy = ys.reduce((a,b)=>a+b,0);
  const sxx = xs.reduce((a,b)=>a+b*b,0);
  const sxy = xs.reduce((a,b,i)=>a+b*ys[i],0);
  const denom = n * sxx - sx * sx || 1;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return out.map((o, i) => ({ ...o, trend: Math.max(0, Math.round((intercept + slope * i) * 10) / 10) }));
}

async function runBatch6Regression() {
  console.log("==================================================");
  console.log("BATCH 6: REGRESSION VALIDATION");
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

  // Check role of user to match orgRead behavior
  const { data: role } = await userClient.rpc("get_user_role", { _user_id: userId });
  const isExec = (role ?? "executive") === "executive";
  const orgDb = isExec ? userClient : adminClient;

  // Capture pre-test DB row counts to verify 0 writes
  const { count: preLeads } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: preHist } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: preEval } = await adminClient.from("evaluation_responses").select("*", { count: "exact", head: true });

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

  // Get sample lead for lead evaluation
  const { data: sampleLeads } = await userClient.from("kob_leads").select("id").limit(1);
  const sampleLeadId = sampleLeads?.[0]?.id || "00000000-0000-0000-0000-000000000000";

  const testCases = [
    // 1. getCombinedFunnelBuckets
    {
      name: "getCombinedFunnelBuckets (6 spans)",
      url: `${BACKEND_BASE}/api/dashboard/combined-funnel-buckets?spans=${encodeURIComponent(JSON.stringify(testSpans))}`,
      oldFn: async () => {
        return oldComputeCombinedBuckets(userClient, testSpans);
      },
    },
    {
      name: "getCombinedFunnelBuckets (empty spans)",
      url: `${BACKEND_BASE}/api/dashboard/combined-funnel-buckets?spans=${encodeURIComponent(JSON.stringify([]))}`,
      oldFn: async () => {
        return oldComputeCombinedBuckets(userClient, []);
      },
    },

    // 2. getCombinedStageResponseSplit
    {
      name: "getCombinedStageResponseSplit (EOI_1, no filter)",
      url: `${BACKEND_BASE}/api/dashboard/combined-stage-response-split?stageKey=EOI_1`,
      oldFn: async () => {
        const IST_MS = 5.5 * 60 * 60 * 1000;
        const nowIst = new Date(Date.now() + IST_MS);
        const monthStart = new Date(
          Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS,
        ).toISOString();
        const now = new Date().toISOString();
        const from = monthStart;
        const to = now;
        const { first, cls } = await oldCombinedSplitClassify(userClient, "EOI_1");
        const out = {};
        for (const k of SPLIT_KEYS) out[k] = { mtd: 0, lifetime: 0 };
        let eligible = 0;
        for (const [id, ts] of first) {
          const k = cls.get(id) ?? "PENDING";
          if (ts >= from && ts <= to) { out[k].lifetime++; eligible++; }
          if (ts >= monthStart && ts <= now) out[k].mtd++;
        }
        return { ...out, eligible };
      },
    },
    {
      name: "getCombinedStageResponseSplit (WEBINAR, current month)",
      url: `${BACKEND_BASE}/api/dashboard/combined-stage-response-split?stageKey=WEBINAR&from=${encodeURIComponent(currentMonthStart)}&to=${encodeURIComponent(currentMonthEnd)}`,
      oldFn: async () => {
        const IST_MS = 5.5 * 60 * 60 * 1000;
        const nowIst = new Date(Date.now() + IST_MS);
        const monthStart = new Date(
          Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS,
        ).toISOString();
        const now = new Date().toISOString();
        const from = currentMonthStart;
        const to = currentMonthEnd;
        const { first, cls } = await oldCombinedSplitClassify(userClient, "WEBINAR");
        const out = {};
        for (const k of SPLIT_KEYS) out[k] = { mtd: 0, lifetime: 0 };
        let eligible = 0;
        for (const [id, ts] of first) {
          const k = cls.get(id) ?? "PENDING";
          if (ts >= from && ts <= to) { out[k].lifetime++; eligible++; }
          if (ts >= monthStart && ts <= now) out[k].mtd++;
        }
        return { ...out, eligible };
      },
    },
    {
      name: "getCombinedStageResponseSplit (EOI_2, custom range 2026-07)",
      url: `${BACKEND_BASE}/api/dashboard/combined-stage-response-split?stageKey=EOI_2&from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`,
      oldFn: async () => {
        const IST_MS = 5.5 * 60 * 60 * 1000;
        const nowIst = new Date(Date.now() + IST_MS);
        const monthStart = new Date(
          Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1) - IST_MS,
        ).toISOString();
        const now = new Date().toISOString();
        const from = customFrom;
        const to = customTo;
        const { first, cls } = await oldCombinedSplitClassify(userClient, "EOI_2");
        const out = {};
        for (const k of SPLIT_KEYS) out[k] = { mtd: 0, lifetime: 0 };
        let eligible = 0;
        for (const [id, ts] of first) {
          const k = cls.get(id) ?? "PENDING";
          if (ts >= from && ts <= to) { out[k].lifetime++; eligible++; }
          if (ts >= monthStart && ts <= now) out[k].mtd++;
        }
        return { ...out, eligible };
      },
    },

    // 3. getCombinedStageResponseSplitTable
    {
      name: "getCombinedStageResponseSplitTable (EOI_1, no filter)",
      url: `${BACKEND_BASE}/api/dashboard/combined-stage-response-split-table?stageKey=EOI_1`,
      oldFn: async () => {
        const IST_MS = 5.5 * 60 * 60 * 1000;
        const nowIst = new Date(Date.now() + IST_MS);
        const istDay = (iso) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
        const todayIst = nowIst.toISOString().slice(0, 10);
        const days = [];
        for (let i = 0; i < 5; i++) days.push(new Date(nowIst.getTime() - i * 86400000).toISOString().slice(0, 10));
        const monthStart = todayIst.slice(0, 8) + "01";
        const inRange = (ts) => true;

        const { first, cls } = await oldCombinedSplitClassify(userClient, "EOI_1");
        const b = {};
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
          key: k,
          daily: days.map((d) => b[k][d]),
          mtd: b[k].mtd,
          lifetime: b[k].lifetime,
        }));
        return { days, rows: rowsOut };
      },
    },
    {
      name: "getCombinedStageResponseSplitTable (WEBINAR, current month)",
      url: `${BACKEND_BASE}/api/dashboard/combined-stage-response-split-table?stageKey=WEBINAR&from=${encodeURIComponent(currentMonthStart)}&to=${encodeURIComponent(currentMonthEnd)}`,
      oldFn: async () => {
        const IST_MS = 5.5 * 60 * 60 * 1000;
        const nowIst = new Date(Date.now() + IST_MS);
        const istDay = (iso) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
        const todayIst = nowIst.toISOString().slice(0, 10);
        const days = [];
        for (let i = 0; i < 5; i++) days.push(new Date(nowIst.getTime() - i * 86400000).toISOString().slice(0, 10));
        const monthStart = todayIst.slice(0, 8) + "01";
        const inRange = (ts) => ts >= currentMonthStart && ts <= currentMonthEnd;

        const { first, cls } = await oldCombinedSplitClassify(userClient, "WEBINAR");
        const b = {};
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
          key: k,
          daily: days.map((d) => b[k][d]),
          mtd: b[k].mtd,
          lifetime: b[k].lifetime,
        }));
        return { days, rows: rowsOut };
      },
    },
    {
      name: "getCombinedStageResponseSplitTable (EOI_2, custom range 2026-07)",
      url: `${BACKEND_BASE}/api/dashboard/combined-stage-response-split-table?stageKey=EOI_2&from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`,
      oldFn: async () => {
        const IST_MS = 5.5 * 60 * 60 * 1000;
        const nowIst = new Date(Date.now() + IST_MS);
        const istDay = (iso) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
        const todayIst = nowIst.toISOString().slice(0, 10);
        const days = [];
        for (let i = 0; i < 5; i++) days.push(new Date(nowIst.getTime() - i * 86400000).toISOString().slice(0, 10));
        const monthStart = todayIst.slice(0, 8) + "01";
        const inRange = (ts) => ts >= customFrom && ts <= customTo;

        const { first, cls } = await oldCombinedSplitClassify(userClient, "EOI_2");
        const b = {};
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
          key: k,
          daily: days.map((d) => b[k][d]),
          mtd: b[k].mtd,
          lifetime: b[k].lifetime,
        }));
        return { days, rows: rowsOut };
      },
    },

    // 4. getExecutiveStageSummary
    {
      name: "getExecutiveStageSummary (no filter)",
      url: `${BACKEND_BASE}/api/kob/executive-stage-summary`,
      oldFn: async () => {
        const db = orgDb;
        const { data: roles } = await db.from("user_roles").select("user_id, role").eq("role", "executive");
        const execIds = (roles ?? []).map((r) => r.user_id);
        if (!execIds.length) return { executives: [], stages: EXECUTIVE_SUMMARY_STAGES };

        const { data: profilesRaw } = await db
          .from("profiles")
          .select("id, full_name, email, team_leader_id, assignment_active")
          .in("id", execIds)
          .order("full_name", { ascending: true });
        const profiles = profilesRaw ?? [];
        const scopedExecIds = profiles.map((p) => p.id);

        const leads = [];
        if (scopedExecIds.length) {
          const PAGE = 1000;
          for (let i = 0; ; i += PAGE) {
            let q = db
              .from("kob_leads")
              .select("id, assigned_to, stage")
              .in("assigned_to", scopedExecIds)
              .order("id", { ascending: true });
            const { data: pageData, error } = await q.range(i, i + PAGE - 1);
            if (error) throw new Error(error.message);
            const page = pageData ?? [];
            leads.push(...page);
            if (page.length < PAGE) break;
          }
        }

        const countsByExec = {};
        for (const l of leads) {
          (countsByExec[l.assigned_to] ??= {})[l.stage] = ((countsByExec[l.assigned_to]?.[l.stage]) ?? 0) + 1;
        }

        const executives = profiles.map((p) => {
          const ec = countsByExec[p.id] ?? {};
          return {
            id: p.id,
            name: p.full_name,
            email: p.email,
            team_leader_id: p.team_leader_id,
            counts: Object.fromEntries(
              EXECUTIVE_SUMMARY_STAGES.map((stage) => [stage, ec[stage] ?? 0]),
            ),
            total: Object.values(ec).reduce((a, b) => a + b, 0),
          };
        });

        const combined = {};
        for (const e of executives) {
          for (const stage of EXECUTIVE_SUMMARY_STAGES) {
            combined[stage] = (combined[stage] ?? 0) + (e.counts[stage] ?? 0);
          }
        }
        const combinedTotal = Object.values(combined).reduce((a, b) => a + b, 0);

        return {
          executives,
          stages: EXECUTIVE_SUMMARY_STAGES,
          combined: { id: "all", name: "All Executives", counts: combined, total: combinedTotal },
        };
      },
    },
    {
      name: "getExecutiveStageSummary (current month)",
      url: `${BACKEND_BASE}/api/kob/executive-stage-summary?from=${encodeURIComponent(currentMonthStart)}&to=${encodeURIComponent(currentMonthEnd)}`,
      oldFn: async () => {
        const db = orgDb;
        const { data: roles } = await db.from("user_roles").select("user_id, role").eq("role", "executive");
        const execIds = (roles ?? []).map((r) => r.user_id);
        if (!execIds.length) return { executives: [], stages: EXECUTIVE_SUMMARY_STAGES };

        const { data: profilesRaw } = await db
          .from("profiles")
          .select("id, full_name, email, team_leader_id, assignment_active")
          .in("id", execIds)
          .order("full_name", { ascending: true });
        const profiles = profilesRaw ?? [];
        const scopedExecIds = profiles.map((p) => p.id);

        const leads = [];
        if (scopedExecIds.length) {
          const PAGE = 1000;
          for (let i = 0; ; i += PAGE) {
            let q = db
              .from("kob_leads")
              .select("id, assigned_to, stage")
              .in("assigned_to", scopedExecIds)
              .gte("stage_entered_at", currentMonthStart)
              .lte("stage_entered_at", currentMonthEnd)
              .order("id", { ascending: true });
            const { data: pageData, error } = await q.range(i, i + PAGE - 1);
            if (error) throw new Error(error.message);
            const page = pageData ?? [];
            leads.push(...page);
            if (page.length < PAGE) break;
          }
        }

        const countsByExec = {};
        for (const l of leads) {
          (countsByExec[l.assigned_to] ??= {})[l.stage] = ((countsByExec[l.assigned_to]?.[l.stage]) ?? 0) + 1;
        }

        const executives = profiles.map((p) => {
          const ec = countsByExec[p.id] ?? {};
          return {
            id: p.id,
            name: p.full_name,
            email: p.email,
            team_leader_id: p.team_leader_id,
            counts: Object.fromEntries(
              EXECUTIVE_SUMMARY_STAGES.map((stage) => [stage, ec[stage] ?? 0]),
            ),
            total: Object.values(ec).reduce((a, b) => a + b, 0),
          };
        });

        const combined = {};
        for (const e of executives) {
          for (const stage of EXECUTIVE_SUMMARY_STAGES) {
            combined[stage] = (combined[stage] ?? 0) + (e.counts[stage] ?? 0);
          }
        }
        const combinedTotal = Object.values(combined).reduce((a, b) => a + b, 0);

        return {
          executives,
          stages: EXECUTIVE_SUMMARY_STAGES,
          combined: { id: "all", name: "All Executives", counts: combined, total: combinedTotal },
        };
      },
    },

    // 5. getKpiTrend
    {
      name: "getKpiTrend (TOTAL_LEADS)",
      url: `${BACKEND_BASE}/api/kob/kpi-trend?metric=TOTAL_LEADS`,
      oldFn: async () => {
        const now = new Date();
        const monthStart = bucketStart(now, "month");
        const weekStart = bucketStart(now, "week");
        const monthBuckets = [];
        for (let i = 5; i >= 0; i--) monthBuckets.push(addBuckets(monthStart, -i, "month"));
        const weekBuckets = [];
        for (let i = 23; i >= 0; i--) weekBuckets.push(addBuckets(weekStart, -i, "week"));
        const earliest = monthBuckets[0] < weekBuckets[0] ? monthBuckets[0] : weekBuckets[0];
        const { data: rows } = await userClient
          .from("kob_leads")
          .select("stage, mode, created_at")
          .gte("created_at", earliest.toISOString());
        const src = rows ?? [];
        return {
          monthly: seriesFor(src, "TOTAL_LEADS", monthBuckets, "month"),
          weekly: seriesFor(src, "TOTAL_LEADS", weekBuckets, "week"),
        };
      },
    },
    {
      name: "getKpiTrend (AUTO_LEADS)",
      url: `${BACKEND_BASE}/api/kob/kpi-trend?metric=AUTO_LEADS`,
      oldFn: async () => {
        const now = new Date();
        const monthStart = bucketStart(now, "month");
        const weekStart = bucketStart(now, "week");
        const monthBuckets = [];
        for (let i = 5; i >= 0; i--) monthBuckets.push(addBuckets(monthStart, -i, "month"));
        const weekBuckets = [];
        for (let i = 23; i >= 0; i--) weekBuckets.push(addBuckets(weekStart, -i, "week"));
        const earliest = monthBuckets[0] < weekBuckets[0] ? monthBuckets[0] : weekBuckets[0];
        const { data: rows } = await userClient
          .from("kob_leads")
          .select("stage, mode, created_at")
          .gte("created_at", earliest.toISOString());
        const src = rows ?? [];
        return {
          monthly: seriesFor(src, "AUTO_LEADS", monthBuckets, "month"),
          weekly: seriesFor(src, "AUTO_LEADS", weekBuckets, "week"),
        };
      },
    },

    // 6. getLeadEvaluation
    {
      name: "getLeadEvaluation",
      url: `${BACKEND_BASE}/api/evaluation/lead?lead_id=${sampleLeadId}`,
      oldFn: async () => {
        const [{ data: responses }, { data: score }] = await Promise.all([
          userClient.from("evaluation_responses").select("*").eq("lead_id", sampleLeadId),
          userClient.from("v_lead_evaluation_score").select("*").eq("lead_id", sampleLeadId).maybeSingle(),
        ]);
        return { responses: responses ?? [], score: score ?? null };
      },
    },

    // 7. getLeadsTrend
    {
      name: "getLeadsTrend (no filter)",
      url: `${BACKEND_BASE}/api/dashboard/leads-trend`,
      oldFn: async () => {
        const from = new Date(Date.now() - 29 * 864e5).toISOString();
        const to = new Date().toISOString();
        const IST = 5.5 * 3600 * 1000;
        const dayKey = (ts) => new Date(new Date(ts).getTime() + IST).toISOString().slice(0, 10);
        const label = (key) => {
          const d = new Date(`${key}T00:00:00Z`);
          return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${String(d.getUTCDate()).padStart(2, "0")}`;
        };

        const leadRows = await pageAll(() =>
          userClient.from("kob_leads").select("id, created_at").gte("created_at", from).lte("created_at", to),
        );
        const contractRows = await pageAll(() =>
          userClient
            .from("lead_stage_history")
            .select("lead_id, to_stage, created_at")
            .eq("to_stage", "KTN_CS")
            .gte("created_at", from)
            .lte("created_at", to),
        );

        const keys = [];
        const start = new Date(`${dayKey(from)}T00:00:00Z`).getTime();
        const end = new Date(`${dayKey(to)}T00:00:00Z`).getTime();
        for (let t = start; t <= end && keys.length < 400; t += 864e5) {
          keys.push(new Date(t).toISOString().slice(0, 10));
        }

        const leadsBy = new Map();
        for (const l of leadRows) leadsBy.set(dayKey(l.created_at), (leadsBy.get(dayKey(l.created_at)) ?? 0) + 1);
        const contractsBy = new Map();
        for (const h of contractRows) {
          const k = dayKey(h.created_at);
          if (!contractsBy.has(k)) contractsBy.set(k, new Set());
          contractsBy.get(k).add(h.lead_id);
        }

        return keys.map((k) => {
          const leads = leadsBy.get(k) ?? 0;
          const contracts = contractsBy.get(k)?.size ?? 0;
          return {
            date: label(k),
            leads,
            contracts,
            conv: leads > 0 ? Number(((contracts / leads) * 100).toFixed(2)) : 0,
          };
        });
      },
    },
    {
      name: "getLeadsTrend (custom range 2026-07)",
      url: `${BACKEND_BASE}/api/dashboard/leads-trend?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`,
      oldFn: async () => {
        const from = customFrom;
        const to = customTo;
        const IST = 5.5 * 3600 * 1000;
        const dayKey = (ts) => new Date(new Date(ts).getTime() + IST).toISOString().slice(0, 10);
        const label = (key) => {
          const d = new Date(`${key}T00:00:00Z`);
          return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${String(d.getUTCDate()).padStart(2, "0")}`;
        };

        const leadRows = await pageAll(() =>
          userClient.from("kob_leads").select("id, created_at").gte("created_at", from).lte("created_at", to),
        );
        const contractRows = await pageAll(() =>
          userClient
            .from("lead_stage_history")
            .select("lead_id, to_stage, created_at")
            .eq("to_stage", "KTN_CS")
            .gte("created_at", from)
            .lte("created_at", to),
        );

        const keys = [];
        const start = new Date(`${dayKey(from)}T00:00:00Z`).getTime();
        const end = new Date(`${dayKey(to)}T00:00:00Z`).getTime();
        for (let t = start; t <= end && keys.length < 400; t += 864e5) {
          keys.push(new Date(t).toISOString().slice(0, 10));
        }

        const leadsBy = new Map();
        for (const l of leadRows) leadsBy.set(dayKey(l.created_at), (leadsBy.get(dayKey(l.created_at)) ?? 0) + 1);
        const contractsBy = new Map();
        for (const h of contractRows) {
          const k = dayKey(h.created_at);
          if (!contractsBy.has(k)) contractsBy.set(k, new Set());
          contractsBy.get(k).add(h.lead_id);
        }

        return keys.map((k) => {
          const leads = leadsBy.get(k) ?? 0;
          const contracts = contractsBy.get(k)?.size ?? 0;
          return {
            date: label(k),
            leads,
            contracts,
            conv: leads > 0 ? Number(((contracts / leads) * 100).toFixed(2)) : 0,
          };
        });
      },
    },

    // 8. getManualFunnel
    {
      name: "getManualFunnel (no filter)",
      url: `${BACKEND_BASE}/api/dashboard/manual-funnel`,
      oldFn: async () => {
        const span = {
          from: new Date(0).toISOString(),
          to: new Date().toISOString(),
        };
        const [b] = await oldComputeManualBuckets(userClient, [span]);
        return b;
      },
    },
    {
      name: "getManualFunnel (current month)",
      url: `${BACKEND_BASE}/api/dashboard/manual-funnel?from=${encodeURIComponent(currentMonthStart)}&to=${encodeURIComponent(currentMonthEnd)}`,
      oldFn: async () => {
        const span = {
          from: currentMonthStart,
          to: currentMonthEnd,
        };
        const [b] = await oldComputeManualBuckets(userClient, [span]);
        return b;
      },
    },
    {
      name: "getManualFunnel (custom range 2026-07)",
      url: `${BACKEND_BASE}/api/dashboard/manual-funnel?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`,
      oldFn: async () => {
        const span = {
          from: customFrom,
          to: customTo,
        };
        const [b] = await oldComputeManualBuckets(userClient, [span]);
        return b;
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
  const unauthRes = await fetch(`${BACKEND_BASE}/api/dashboard/manual-funnel`);
  const unauthOk = unauthRes.status === 401;
  console.log(`  Unauthenticated request returned HTTP ${unauthRes.status} (expected 401): ${unauthOk ? "YES ✓" : "NO ✗"}`);

  // DB write count verification
  const { count: postLeads } = await adminClient.from("kob_leads").select("*", { count: "exact", head: true });
  const { count: postHist } = await adminClient.from("lead_stage_history").select("*", { count: "exact", head: true });
  const { count: postEval } = await adminClient.from("evaluation_responses").select("*", { count: "exact", head: true });

  const writesDelta = Math.abs(postLeads - preLeads) + Math.abs(postHist - preHist) + Math.abs(postEval - preEval);
  console.log(`\nDatabase Write Check:`);
  console.log(`  Leads delta: ${postLeads - preLeads}`);
  console.log(`  Stage history delta: ${postHist - preHist}`);
  console.log(`  Evaluation responses delta: ${postEval - preEval}`);
  console.log(`  Total DB mutations during test: ${writesDelta}`);

  console.log("\n==================================================");
  console.log("BATCH 6 REGRESSION SUMMARY");
  console.log("==================================================");
  console.table(results);

  const allPassed = results.every((r) => r.match === "YES") && unauthOk && writesDelta === 0;
  console.log(`\nFINAL PARITY RESULT: ${allPassed ? "PASS ✓" : "FAIL ✗"}`);
  if (!allPassed) {
    process.exit(1);
  }
}

runBatch6Regression().catch((err) => {
  console.error("FATAL Regression script error:", err);
  process.exit(1);
});
