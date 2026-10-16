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
import { toast } from "sonner";
import { KpiTrendDialog } from "@/components/kpi-trend-dialog";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2, Users, Rocket, Zap, CreditCard,
  TrendingUp, TrendingDown, Minus, Map, IndianRupee, ChevronRight,
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
    success: "border-l-shero-teal",
    warn: "border-l-amber-500",
    info: "border-l-shero-navy/40",
    danger: "border-l-shero-danger",
  };
  const [trendOpen, setTrendOpen] = useState(false);
  const body = (
    <Card className={`h-full border-l-[3px] ${toneMap[tone]} shadow-none ring-1 ring-border/60 ${className} ${to ? "cursor-pointer transition-shadow hover:shadow-sm" : ""}`}>
      <CardContent className="p-3.5 h-full flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />}
        </div>
        <div className="text-[1.65rem] font-semibold leading-none tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
        {detailsMetric && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTrendOpen(true); }}
            className="mt-auto -mx-3.5 -mb-3.5 px-3.5 py-2 w-[calc(100%+1.75rem)] inline-flex items-center justify-center gap-1 text-[11px] font-medium text-primary hover:bg-muted/50 border-t border-border/60"
          >
            View Details <ChevronRight className="h-3 w-3" />
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


/**
 * CEO Overview-only KPI card — a visual-only restyle of the shared
 * components/kpi-card.tsx layout (same fields, same semantics, same
 * drill-down behavior). Kept local to this file rather than editing the
 * shared component, since kpi-card.tsx is also used by dashboard.tsx,
 * mgr.kpi-targets.tsx, mgr.marketing.tsx and tl.overview.tsx and this
 * change must stay scoped to CEO Overview only.
 */
const CEO_KPI_BORDER: Record<string, string> = {
  good: "border-l-shero-teal",
  risk: "border-l-shero-danger",
  attention: "border-l-amber-500",
  neutral: "border-l-shero-navy/40",
  mgmt: "border-l-shero-navy",
};

function CeoKpiCard({
  title, icon: Icon, target, achieved, runRate, prevPeriod, trendDirection,
  variant = "neutral", format, to, params, detailsMetric,
}: {
  title: string;
  icon?: LucideIcon;
  target?: number | null;
  achieved: number;
  runRate?: number | null;
  prevPeriod?: number | null;
  trendDirection?: "up" | "down" | "flat";
  variant?: "neutral" | "good" | "risk" | "attention" | "mgmt";
  format?: (n: number) => string;
  to?: string;
  params?: Record<string, string>;
  detailsMetric?: string;
}) {
  const [trendOpen, setTrendOpen] = useState(false);
  const border = CEO_KPI_BORDER[variant] ?? CEO_KPI_BORDER.neutral;
  const fmt = format ?? ((n: number) => n.toLocaleString());

  const achievedPct = target != null && target > 0 ? Math.round((achieved / target) * 1000) / 10 : null;

  let trendPct: number | null = null;
  if (prevPeriod === 0) trendPct = achieved > 0 ? 100 : 0;
  else if (prevPeriod != null) trendPct = Math.round(((achieved - prevPeriod) / prevPeriod) * 1000) / 10;
  const dir: "up" | "down" | "flat" =
    trendDirection ?? (trendPct == null ? "flat" : trendPct > 0 ? "up" : trendPct < 0 ? "down" : "flat");
  const TrendIcon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const trendTone = dir === "up" ? "text-emerald-600" : dir === "down" ? "text-rose-600" : "text-muted-foreground";
  const pctTone =
    achievedPct == null ? "text-muted-foreground"
    : achievedPct >= 80 ? "text-emerald-600"
    : achievedPct >= 50 ? "text-amber-600" : "text-rose-600";

  const card = (
    <Card className={`h-full border-l-[3px] ${border} shadow-none ring-1 ring-border/60 ${to ? "cursor-pointer transition-shadow hover:shadow-sm" : ""}`}>
      <CardContent className="p-3.5 h-full flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />}
        </div>

        <div className="text-[1.65rem] font-semibold leading-none tabular-nums">{fmt(achieved)}</div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/60">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground/80">Target</div>
            <div className="text-xs font-medium tabular-nums">{target != null && target > 0 ? fmt(target) : "—"}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground/80">Run Rate</div>
            <div className="text-xs font-medium tabular-nums">{runRate != null ? fmt(Math.round(runRate)) : "—"}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground/80">Achieved</div>
            <div className={`text-xs font-medium tabular-nums ${pctTone}`}>{achievedPct != null ? `${achievedPct}%` : "—"}</div>
          </div>
        </div>

        <div className={`flex items-center gap-1 text-[11px] ${trendTone}`}>
          <TrendIcon className="h-3 w-3" />
          <span>{trendPct == null ? "No prior period" : `${trendPct > 0 ? "+" : ""}${trendPct}% vs previous`}</span>
        </div>

        {detailsMetric && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTrendOpen(true); }}
            className="mt-auto -mx-3.5 -mb-3.5 px-3.5 py-2 w-[calc(100%+1.75rem)] inline-flex items-center justify-center gap-1 text-[11px] font-medium text-primary hover:bg-muted/50 border-t border-border/60"
          >
            View Details <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </CardContent>
    </Card>
  );

  const wrapped = to ? <Link to={to as any} params={params as any} className="block h-full">{card}</Link> : card;

  return (
    <>
      {wrapped}
      {detailsMetric && (
        <KpiTrendDialog open={trendOpen} onOpenChange={setTrendOpen} metric={detailsMetric} title={title} />
      )}
    </>
  );
}

function CeoOverview() {
  const [range, setRange] = useDateRange("this_month");
  const rangeKey = [range.preset, range.from.toISOString(), range.to.toISOString()];
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };
  const days = Math.max(1, (range.to.getTime() - range.from.getTime()) / 86400000);
  const runRateFor = (achieved: number) => Math.round((achieved / days) * 30 * 10) / 10;
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
  // Same Meta Ads CPL source/calculation as the Meta campaigns page and
  // KOB Dashboard's CPL card (GET /api/meta/cpl) — no second CPL formula.
  const { data: metaCpl, error: metaCplError } = useQuery({
    queryKey: ["meta-cpl-enabled", ...rangeKey],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<any>(`/api/meta/cpl${q ? `?${q}` : ""}`);
    },
  });
  // Same stage_entered_at-scoped semantics as KOB Dashboard's Contracts KPI.
  const { data: contracts } = useQuery({
    queryKey: ["ceo-contracts", ...rangeKey],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<{ count: number; prev_period: number }>(`/api/kob/get-contracts-count${q ? `?${q}` : ""}`);
    },
  });
  // Leads currently in EOI_2 that entered EOI_2 within the selected period
  // (not a lifetime/created_at count) — same pattern as Contracts above.
  const { data: eoi2 } = useQuery({
    queryKey: ["ceo-eoi2", ...rangeKey],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<{ count: number; prev_period: number }>(`/api/kob/get-eoi2-count${q ? `?${q}` : ""}`);
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
              // Same Meta Ads CPL source/calculation as the Meta campaigns
              // page and KOB Dashboard (GET /api/meta/cpl) — not the
              // dashboard-kpis static cost_per_lead figure.
              if (metaCplError || metaCpl?.error) {
                return (
                  <Stat key="CPL" className="h-full" label="CPL" value="Unavailable" sub="Meta API unavailable" icon={IndianRupee} tone="danger" to="/mgr/marketing" detailsMetric="CPL" />
                );
              }
              if (!metaCpl?.hasEnabledCampaigns || (metaCpl?.enabledCount ?? 0) === 0) {
                return (
                  <Stat key="CPL" className="h-full" label="CPL" value="—" sub="No campaigns selected" icon={IndianRupee} tone="info" to="/mgr/marketing" detailsMetric="CPL" />
                );
              }
              const cplVal = metaCpl.cpl ?? 0;
              return (
                <Stat
                  key="CPL"
                  className="h-full"
                  label="CPL"
                  value={`₹${cplVal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
                  sub={`${metaCpl.enabledCount} campaign${metaCpl.enabledCount === 1 ? "" : "s"} · ${(metaCpl.totalLeads ?? 0).toLocaleString()} leads`}
                  icon={IndianRupee}
                  tone="info"
                  to="/mgr/marketing"
                  detailsMetric="CPL"
                />
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

            // KTN_CS and EOI_2 reuse the stage_entered_at-scoped count (same
            // semantics as KOB Dashboard's Contracts KPI / getContractsCount)
            // instead of get-kpi-snapshot's created_at-filtered current-stage
            // count, which undercounts leads created earlier but that moved
            // into the stage during the selected period.
            const achieved =
              metric === "KTN_CS" ? Number(contracts?.count ?? 0)
              : metric === "EOI_2" ? Number(eoi2?.count ?? 0)
              : Number(r.achieved ?? 0);
            const prevPeriod =
              metric === "KTN_CS" ? Number(contracts?.prev_period ?? 0)
              : metric === "EOI_2" ? Number(eoi2?.prev_period ?? 0)
              : r.prev_period ?? null;
            const runRate = metric === "KTN_CS" || metric === "EOI_2" ? runRateFor(achieved) : r.run_rate ?? null;
            const trendDirection = metric === "KTN_CS" || metric === "EOI_2" ? undefined : r.trend;

            return (
              <CeoKpiCard
                key={metric}
                title={title}
                icon={Icon}
                achieved={achieved}
                target={r.target ?? null}
                runRate={runRate}
                prevPeriod={prevPeriod}
                trendDirection={trendDirection}
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
