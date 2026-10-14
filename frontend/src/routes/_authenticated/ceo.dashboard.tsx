import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { MetricDrilldown } from "@/components/metric-drilldown";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";
import { KpiCard } from "@/components/kpi-card";
import { toast } from "sonner";
import { KpiTrendDialog } from "@/components/kpi-trend-dialog";
import { useState } from "react";
import {
  Building2, Users, Rocket, Zap, CreditCard,
  TrendingUp, Map, IndianRupee, ChevronRight, LineChart,
} from "lucide-react";



export const Route = createFileRoute("/_authenticated/ceo/dashboard")({
  head: () => ({ meta: [{ title: "CEO Control Tower — Shero KOB" }] }),
  component: CeoOverview,
});

function ModeControlCard() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ["kob-config"], queryFn: () => apiClient.get<any>("/api/kob/get-config") });
  const defaultMode = (cfg as any)?.default_mode ?? "AUTO";
  const save = async (patch: Record<string, any>) => {
    await apiClient.patch("/api/kob/config", patch);
    await qc.invalidateQueries({ queryKey: ["kob-config"] });
    toast.success("Mode control updated");
  };
  return (
    <Card className="border-l-4 border-l-primary shadow-sm">
      <CardHeader className="pb-2"><CardTitle className="text-base">Mode Control</CardTitle></CardHeader>
      <CardContent className="p-6 pt-2 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm font-medium">Default Mode for new leads</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Applied at intake when the caller doesn't specify a mode.</p>
          </div>
          <div className="flex gap-2">
            {(["AUTO","MANUAL"] as const).map((m) => (
              <Button key={m} size="sm" variant={defaultMode === m ? "default" : "outline"}
                onClick={() => save({ default_mode: m })}>{m}</Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, icon: Icon, tone = "primary", to, params, detailsMetric, detailsTitle, className = "" }: any) {
  const toneMap: Record<string, string> = {
    primary: "border-l-primary",
    success: "border-l-emerald-500",
    warn: "border-l-amber-500",
    info: "border-l-sky-500",
    danger: "border-l-rose-500",
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


function CeoOverview() {
  const [range, setRange] = useDateRange("yesterday");
  const rangeKey = [range.preset, range.from.toISOString(), range.to.toISOString()];
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };
  const { data: k } = useQuery({
    queryKey: ["ceo-kpis", ...rangeKey],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<any>(`/api/kob/get-dashboard-kpis${q ? `?${q}` : ""}`);
    },
  });
  const { data: snap = [] } = useQuery({
    queryKey: ["ceo-snap", ...rangeKey],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<any[]>(`/api/kob/get-kpi-snapshot${q ? `?${q}` : ""}`);
    },
  });
  const { data: funnel = [] } = useQuery({
    queryKey: ["ceo-funnel-src", ...rangeKey],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<any[]>(`/api/kob/get-funnel-by-source${q ? `?${q}` : ""}`);
    },
  });
  const { data: langFunnel = [] } = useQuery({
    queryKey: ["ceo-funnel-lang", ...rangeKey],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<any[]>(`/api/kob/get-funnel-by-language${q ? `?${q}` : ""}`);
    },
  });
  const lastUpdated = new Date().toLocaleString();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">CEO Control Tower</h1>
          <p className="text-sm text-muted-foreground">Org-wide KPI overview. All values from Supabase views — no hard-coded numbers.</p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangeFilter value={range} onChange={setRange} />
          <div className="text-xs text-muted-foreground">Last updated: {lastUpdated}</div>
        </div>
      </div>

      <ModeControlCard />

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
            ["PARKED", "Parked / Retargeting", Zap, "risk"],
            ["__CONVERSION__", "Lead → Conversion %", TrendingUp, "neutral"],

          ] as const).map(([metric, title, Icon, variant]) => {
            if (metric === "__CPL__") {
              return (
                <Stat key="CPL" className="h-full" label="CPL" value={`₹${(k?.cpl ?? 0).toLocaleString()}`} sub="cost per lead" tone="info" to="/mgr/marketing" detailsMetric="CPL" />
              );
            }
            if (metric === "__CONVERSION__") {
              return (
                <Stat
                  key="CONVERSION"
                  className="h-full"
                  label="Lead → Conversion %"
                  value={`${(k?.totalLeads ? Math.round(((k?.ktnLive ?? 0) / k.totalLeads) * 1000) / 10 : 0).toFixed(1)}%`}
                  sub="KTN Live / Total Leads"
                  icon={TrendingUp}
                  tone="success"
                  to="/mgr/reports"
                  detailsMetric="CONVERSION"
                />
              );
            }
            const r = (snap as any[]).find((x) => x.metric === metric) ?? {};
            const to = metric === "TOTAL_LEADS" ? "/leads" : metric === "PARKED" ? "/retargeting" : metric === "ABANDONED_LEADS" ? "/leads" : "/exec/$stage";
            const params = metric === "TOTAL_LEADS" || metric === "PARKED" || metric === "ABANDONED_LEADS" ? undefined : { stage: metric };

            return (
              <KpiCard
                key={metric}
                title={title}
                icon={Icon}
                achieved={Number(r.achieved ?? 0)}
                target={r.target ?? null}
                runRate={r.run_rate ?? null}
                prevPeriod={r.prev_period ?? null}
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

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Operational</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Parked / Retargeting" value={k?.parked ?? 0} tone="warn" to="/mgr/retargeting" detailsMetric="PARKED" />
          <Stat label="Auto Leads" value={k?.autoLeads ?? 0} tone="info" to="/mgr/lead-inbox" detailsMetric="AUTO_LEADS" />
          <Stat label="Manual Leads" value={k?.manualLeads ?? 0} tone="info" to="/mgr/unallocated-leads" detailsMetric="MANUAL_LEADS" />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Market & spend</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Active States" value={k?.activeStates ?? 0} icon={Map} tone="primary" to="/ceo/geo-control" detailsMetric="ACTIVE_STATES" />
          <Stat label="Active Cities" value={k?.activeCities ?? 0} icon={Building2} tone="primary" to="/ceo/geo-control" detailsMetric="ACTIVE_CITIES" />
          <Stat label="Kitchen Scope" value={(k?.kitchenScope ?? 0).toLocaleString()} sub="native + other" tone="success" to="/ceo/kitchen-scope" detailsMetric="KITCHEN_SCOPE" />
          <Stat label="Total Spend" value={`₹${(k?.totalSpend ?? 0).toLocaleString()}`} icon={IndianRupee} tone="warn" to="/mgr/marketing" detailsMetric="SPEND" />
          <Stat label="CAC" value={`₹${(k?.cac ?? 0).toLocaleString()}`} sub="cost per KTN Live" tone="danger" to="/mgr/marketing" detailsMetric="CAC" />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Funnel Analytics</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Funnel by Source</CardTitle></CardHeader>
            <CardContent style={{ height: 300 }}>
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
        </div>
      </div>

      <MetricDrilldown from={rangeArg.from} to={rangeArg.to} />
    </div>
  );
}
