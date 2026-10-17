import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { MyRoleResponse } from "@/lib/types";

import { MetricDrilldown } from "@/components/metric-drilldown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";
import { KpiCard } from "@/components/kpi-card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { TrendingUp, Users, IndianRupee, CreditCard, Rocket, Zap, Building2, Map as MapIcon, ChevronRight, LineChart } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { KpiTrendDialog } from "@/components/kpi-trend-dialog";
import { useState } from "react";


export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Shero KOB" }] }),
  component: Dashboard,
});

const STAGE_ORDER = [
  "LEAD_INBOX","AUTO_FIRED","FAILED_FIRE","EOI_1","WEBINAR","WEBINAR_ATTENDED","EOI2_PENDING","EOI_2",
  "FORM_FILLED","FEE_PAID","KTN_CS","KTN_LIVE",
  "NO","LATER","NO_RESPONSE","RETARGETING","DEAD_LEAD",
];
const STAGE_COLORS: Record<string, string> = {
  LEAD_INBOX: "#0891b2", AUTO_FIRED: "#06b6d4", FAILED_FIRE: "#ef4444",
  EOI_1: "#14b8a6", WEBINAR: "#0d9488", WEBINAR_ATTENDED: "#0f766e", EOI2_PENDING: "#65a30d", EOI_2: "#059669",
  FORM_FILLED: "#8b5cf6", FEE_PAID: "#22c55e", AGREEMENT_SIGNED: "#16a34a",
  KTN_CS: "#15803d", KTN_LIVE: "#166534",
  NO: "#dc2626", LATER: "#eab308", NO_RESPONSE: "#f97316",
  RETARGETING: "#f59e0b", DEAD_LEAD: "#71717a",
};
const STAGE_LABEL: Record<string, string> = {
  LEAD_INBOX: "Lead Inbox", AUTO_FIRED: "Auto Fired", FAILED_FIRE: "Failed Fire",
  EOI_1: "EOI 1", WEBINAR: "Webinar", WEBINAR_ATTENDED: "Webinar Attended", EOI2_PENDING: "EOI2 Pending", EOI_2: "EOI 2",
  FORM_FILLED: "Form Filled", FEE_PAID: "Fee Paid", AGREEMENT_SIGNED: "Agreement Signed",
  KTN_CS: "KTN CS", KTN_LIVE: "KTN Live",
  NO: "No", LATER: "Later", NO_RESPONSE: "No-response",
  RETARGETING: "Retargeting", DEAD_LEAD: "Dead Lead",
};

function Stat({ label, value, sub, icon: Icon, tone = "primary", to, params, detailsMetric, detailsTitle, className = "" }: any) {
  const toneMap: Record<string, string> = {
    primary: "border-l-primary",
    success: "border-l-shero-teal",
    warn: "border-l-amber-500",
    info: "border-l-shero-navy/40",
    danger: "border-l-shero-danger",
  };
  const [trendOpen, setTrendOpen] = useState(false);
  const body = (
    <Card className={`border-l-4 ${toneMap[tone]} shadow-sm ${className} ${to ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all" : ""}`}>
      <CardContent className="p-4 h-full flex flex-col">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              {label}
              {to && <ChevronRight className="h-3 w-3 opacity-50" />}
            </div>
            <div className="text-2xl font-bold mt-1">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
          {Icon && <Icon className="h-6 w-6 text-muted-foreground" />}
        </div>
        {detailsMetric && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTrendOpen(true); }}
            className="mt-auto pt-2 w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-primary hover:underline border-t"
          >
            <LineChart className="h-3.5 w-3.5" />
            View Details
          </button>
        )}
      </CardContent>
    </Card>
  );
  const wrapped = to ? <Link to={to as any} params={params} className={`block ${className}`}>{body}</Link> : body;
  return (
    <>
      {wrapped}
      {detailsMetric && (
        <KpiTrendDialog open={trendOpen} onOpenChange={setTrendOpen} metric={detailsMetric} title={detailsTitle ?? label} />
      )}
    </>
  );
}

function Dashboard() {
  const [range, setRange] = useDateRange("this_month");
  const rk = [range.preset, range.from.toISOString(), range.to.toISOString()];
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };
  const p = new URLSearchParams();
  if (rangeArg.from) p.set("from", rangeArg.from);
  if (rangeArg.to) p.set("to", rangeArg.to);
  const q = p.toString();
  const qStr = q ? `?${q}` : "";

  const { data: role } = useQuery({
    queryKey: ["my-role"],
    queryFn: () => apiClient.get<MyRoleResponse>("/api/kob/my-role"),
  });
  const { data: kpis, dataUpdatedAt } = useQuery({ queryKey: ["kpis", ...rk], queryFn: () => apiClient.get<any>(`/api/kob/get-dashboard-kpis${qStr}`) });
  const { data: snap = [] } = useQuery({ queryKey: ["kpi-snap", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/get-kpi-snapshot${qStr}`) });
  const { data: funnel = [] } = useQuery({ queryKey: ["funnel", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/get-funnel-by-source${qStr}`) });
  const { data: langFunnel = [] } = useQuery({ queryKey: ["funnel-lang", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/get-funnel-by-language${qStr}`) });
  const { data: brandFunnel = [] } = useQuery({ queryKey: ["funnel-brand", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/get-funnel-by-brand${qStr}`) });
  const { data: stages = [] } = useQuery({ queryKey: ["stages", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/get-stage-distribution${qStr}`) });
  const { data: states = [] } = useQuery({ queryKey: ["states-summary", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/get-state-summary${qStr}`) });
  const { data: myScv } = useQuery({
    queryKey: ["my-scv"],
    queryFn: () => apiClient.get<{ score: number | null }>("/api/kob/my-scv-score"),
  });
  const { data: meta } = useQuery({
    queryKey: ["meta-spend", ...rk],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<any>(`/api/meta/spend-kpis${q ? `?${q}` : ""}`);
    },
  });
  // Control Tower Overview's 4 global KPI cards (Total Leads, KTN, CPL, Fee
  // Paid) — each reuses the exact same source/logic as its reference page,
  // with no role-specific lead scope, so the values are identical for every
  // role that has Page Access to this page. See kob.routes.ts /
  // kob.controller.ts for get-control-tower-total-leads and
  // get-fee-paid-count; get-contracts-count and /api/meta/cpl are the
  // pre-existing, already-global endpoints reused as-is.
  const { data: totalLeadsCT } = useQuery({
    queryKey: ["ct-total-leads", ...rk],
    queryFn: () => apiClient.get<{ count: number }>(`/api/kob/get-control-tower-total-leads${qStr}`),
  });
  const { data: ktnCT } = useQuery({
    queryKey: ["ct-ktn", ...rk],
    queryFn: () => apiClient.get<{ count: number; prev_period: number }>(`/api/kob/get-contracts-count${qStr}`),
  });
  const { data: feePaidCT } = useQuery({
    queryKey: ["ct-fee-paid", ...rk],
    queryFn: () => apiClient.get<{ count: number; prev_period: number }>(`/api/kob/get-fee-paid-count${qStr}`),
  });
  const { data: metaCplCT, error: metaCplCTError } = useQuery({
    queryKey: ["ct-cpl", ...rk],
    queryFn: () => apiClient.get<any>(`/api/meta/cpl${qStr}`),
  });


  const roleLabel = role?.role === "kob_manager" ? "KOB Manager"
    : role?.role === "team_leader" ? "Team Leader"
    : role?.role === "super_admin" ? "Super Admin" : "Language Executive";

  const snapMap = new Map((snap as any[]).map((s) => [s.metric, s]));
  const kpi = (metric: string) => snapMap.get(metric) ?? {};

  const stagesSorted = STAGE_ORDER.map((s) => {
    const found = (stages as any[]).find((x) => x.stage === s);
    return { stage: STAGE_LABEL[s], key: s, count: found?.count ?? 0 };
  }).filter((x) => x.count > 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Control Tower — India</h1>
          <p className="text-sm text-muted-foreground">Welcome back, {role?.profile?.full_name} · {roleLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangeFilter value={range} onChange={setRange} />
          <div className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-md border">
            Last updated: <span suppressHydrationWarning>{dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleString() : "—"}</span>
          </div>
        </div>
      </div>


      {/* My SCV card hidden for now — keep logic intact */}
      {false && (
        <Card className="border-l-4 border-l-shero-navy max-w-xs">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">My SCV</div>
            <div className="text-3xl font-bold mt-1">{myScv?.score ?? "—"}</div>
            <div className="text-[11px] text-muted-foreground mt-1">Your personal SCV over your scope</div>
          </CardContent>
        </Card>
      )}

      {/* KPI Snapshot — 8 stages, spec §17: Target / Run Rate / Achieved / Achieved% / Trend */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">KPI Snapshot — Target · Run Rate · Achieved · Achieved% · Trend</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 auto-rows-fr gap-3">
          {([
            ["TOTAL_LEADS", "Total Leads", Users, "neutral"],
            ["EOI_1", "EOI 1", TrendingUp, "neutral"],
            ["WEBINAR", "Webinar", TrendingUp, "neutral"],
            ["EOI_2", "EOI 2", TrendingUp, "neutral"],
            ["__CPL__", "CPL", IndianRupee, "neutral"],
            ["FEE_PAID", "Fee Paid", CreditCard, "good"],
            ["KTN_CS", "KTN CS", Rocket, "mgmt"],
            ["AUTO_FIRED", "Auto Fired", Rocket, "mgmt"],
            ["ABANDONED_LEADS", "Abandoned Leads", Zap, "risk"],
            ["FAILED_FIRE", "Failed Fire", Zap, "risk"],
            ["__CONVERSION__", "Lead → Conversion %", TrendingUp, "neutral"],
          ] as const).map(([metric, title, Icon, variant]) => {
            if (metric === "__CPL__") {
              // Same source as the KOB Dashboard CPL card (GET /api/meta/cpl)
              // so Control Tower and KOB Dashboard always show the same CPL
              // for the same date range — not the separate spend-kpis figure.
              const cplValue = metaCplCTError || metaCplCT?.error || !metaCplCT?.hasEnabledCampaigns
                ? "—"
                : `₹${(metaCplCT?.cpl ?? 0).toLocaleString()}`;
              return (
                <Stat key="CPL" className="h-full" label="CPL" value={cplValue} sub="cost per lead" tone="info" to="/mgr/marketing" detailsMetric="CPL" />
              );
            }
            if (metric === "__CONVERSION__") {
              return (
                <Stat
                  key="CONVERSION"
                  className="h-full"
                  label="Lead → Conversion %"
                  value={`${(kpis?.totalLeads ? Math.round(((kpis?.ktnLive ?? 0) / kpis.totalLeads) * 1000) / 10 : 0).toFixed(1)}%`}
                  sub="KTN Live / Total Leads"
                  icon={TrendingUp}
                  tone="success"
                  to="/mgr/reports"
                  detailsMetric="CONVERSION"
                />
              );
            }
            const r = kpi(metric) as any;
            const to = metric === "TOTAL_LEADS" || metric === "ABANDONED_LEADS" ? "/leads" : "/exec/$stage";
            const params = metric === "TOTAL_LEADS" || metric === "ABANDONED_LEADS" ? undefined : { stage: metric };

            // Total Leads / KTN / Fee Paid: reuse the Lead Inbox / contracts /
            // fee-paid-count sources (global, no role-specific lead scope)
            // instead of get-kpi-snapshot's separate counts, so these three
            // cards always match Lead Inbox / KTN's current-stage count /
            // Fee Paid's current-stage count for the same date range.
            const achieved =
              metric === "TOTAL_LEADS" ? Number(totalLeadsCT?.count ?? r.achieved ?? 0)
              : metric === "KTN_CS" ? Number(ktnCT?.count ?? r.achieved ?? 0)
              : metric === "FEE_PAID" ? Number(feePaidCT?.count ?? r.achieved ?? 0)
              : Number(r.achieved ?? 0);
            const prevPeriod =
              metric === "KTN_CS" ? (ktnCT?.prev_period ?? r.prev_period ?? null)
              : metric === "FEE_PAID" ? (feePaidCT?.prev_period ?? r.prev_period ?? null)
              : (r.prev_period ?? null);

            return (
              <KpiCard
                key={metric}
                title={title}
                icon={Icon}
                achieved={achieved}
                target={r.target ?? null}
                runRate={r.run_rate ?? null}
                prevPeriod={prevPeriod}
                trendDirection={r.trend}
                variant={variant}
                to={to}
                params={params}
                detailsMetric={metric}
              />
            );
          })}
        </div>
      </div>

      {/* Operational */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Operational</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Parked / Retargeting" value={kpis?.parked ?? 0} tone="warn" to="/mgr/retargeting" detailsMetric="PARKED" />
          <Stat label="Auto Leads" value={kpis?.autoLeads ?? 0} tone="info" to="/mgr/lead-inbox" detailsMetric="AUTO_LEADS" />
          <Stat label="Manual Leads" value={kpis?.manualLeads ?? 0} tone="info" to="/mgr/unallocated-leads" detailsMetric="MANUAL_LEADS" />
        </div>
      </div>


      {/* Market & Spend */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Market & spend</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Active States" value={kpis?.activeStates ?? 0} icon={MapIcon} tone="primary" to="/ceo/geo-control" detailsMetric="ACTIVE_STATES" />
          <Stat label="Active Cities" value={kpis?.activeCities ?? 0} icon={Building2} tone="primary" to="/ceo/geo-control" detailsMetric="ACTIVE_CITIES" />
          <Stat label="Kitchen Scope" value={(kpis?.kitchenScope ?? 0).toLocaleString()} sub="native + other" tone="success" to="/ceo/kitchen-scope" detailsMetric="KITCHEN_SCOPE" />
          <Stat label="Total Spend" value={`₹${(meta?.totalSpend ?? 0).toLocaleString()}`} icon={IndianRupee} tone="warn" to="/mgr/marketing" detailsMetric="SPEND" />
          <Stat label="CAC" value={`₹${(kpis?.cac ?? 0).toLocaleString()}`} sub="cost per KTN Live" tone="danger" to="/mgr/marketing" detailsMetric="CAC" />
        </div>
      </div>


      {/* Row 2: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Funnel by Source</CardTitle></CardHeader>
          <CardContent style={{ height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={funnel as any[]}>
                <XAxis dataKey="source_name" fontSize={11} angle={-15} textAnchor="end" height={60} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total_leads" fill="#0891b2" name="Leads" />
                <Bar dataKey="fee_paid_count" fill="#22c55e" name="Fee Paid" />
                <Bar dataKey="ktn_live_count" fill="#166534" name="KTN Live" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Stage Distribution (16 stages)</CardTitle></CardHeader>
          <CardContent style={{ height: 320 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={stagesSorted} dataKey="count" nameKey="stage" outerRadius={110} label={(e: any) => e.stage}>
                  {stagesSorted.map((s) => (<Cell key={s.key} fill={STAGE_COLORS[s.key] ?? "#888"} />))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Language and Brand funnels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Funnel by Language</CardTitle></CardHeader>
          <CardContent style={{ height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={langFunnel as any[]}>
                <XAxis dataKey="language" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total_leads" fill="#0891b2" name="Leads" />
                <Bar dataKey="fee_paid" fill="#22c55e" name="Fee Paid" />
                <Bar dataKey="ktn_live" fill="#166534" name="KTN Live" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Funnel by Brand (SHF)</CardTitle></CardHeader>
          <CardContent style={{ height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={brandFunnel as any[]}>
                <XAxis dataKey="brand_name" fontSize={10} angle={-25} textAnchor="end" height={70} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total_leads" fill="#0891b2" name="Leads" />
                <Bar dataKey="agreement" fill="#16a34a" name="Agreement" />
                <Bar dataKey="ktn_live" fill="#166534" name="KTN Live" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <MetricDrilldown from={rangeArg.from} to={rangeArg.to} />


      {/* State breakdown */}
      <Card>
        <CardHeader><CardTitle className="text-base">State-wise Performance</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground uppercase border-b">
                <tr>
                  <th className="p-2">State</th>
                  <th className="p-2 text-right">Leads</th>
                  <th className="p-2 text-right">Fee Paid</th>
                  <th className="p-2 text-right">KTN Live</th>
                  <th className="p-2 text-right">Kitchen Scope</th>
                  <th className="p-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {(states as any[]).map((s) => (
                  <tr key={s.id} className="border-b hover:bg-muted/40">
                    <td className="p-2 font-medium">{s.name} <span className="text-xs text-muted-foreground">({s.code})</span></td>
                    <td className="p-2 text-right">{s.leads}</td>
                    <td className="p-2 text-right text-emerald-600">{s.fee_paid}</td>
                    <td className="p-2 text-right text-green-700 font-medium">{s.ktn_live}</td>
                    <td className="p-2 text-right">{s.scope.toLocaleString()}</td>
                    <td className="p-2 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs ${s.active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {s.active ? "Active" : "OFF"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
