import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";
import { KpiCard as SnapshotKpiCard } from "@/components/kpi-card";
import { KpiTrendDialog } from "@/components/kpi-trend-dialog";
import {
  TrendingUp, TrendingDown, Minus, Users, CreditCard, Rocket, Zap,
  Building2, Map as MapIcon, IndianRupee, ChevronRight, LineChart,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";


function Stat({ label, value, sub, icon: Icon, tone = "primary", to, params, detailsMetric, detailsTitle }: any) {
  const toneMap: Record<string, string> = {
    primary: "border-l-primary",
    success: "border-l-shero-teal",
    warn: "border-l-amber-500",
    info: "border-l-shero-navy/40",
    danger: "border-l-shero-danger",
  };
  const [trendOpen, setTrendOpen] = useState(false);
  const body = (
    <Card className={`border-l-4 ${toneMap[tone]} shadow-sm h-full ${to ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all" : ""}`}>
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
  const wrapped = to ? <Link to={to as any} params={params} className="block h-full">{body}</Link> : body;
  return (
    <>
      {wrapped}
      {detailsMetric && (
        <KpiTrendDialog open={trendOpen} onOpenChange={setTrendOpen} metric={detailsMetric} title={detailsTitle ?? label} />
      )}
    </>
  );
}






export const Route = createFileRoute("/_authenticated/tl/overview")({
  head: () => ({ meta: [{ title: "TL Overview — Shero KOB" }] }),
  component: TLOverview,
});

function TrendIcon({ trend }: { trend?: string }) {
  if (trend === "up") return <TrendingUp className="h-4 w-4 text-green-600" />;
  if (trend === "down") return <TrendingDown className="h-4 w-4 text-red-600" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function KpiCard({ title, achieved, target, runRate, achievedPct, trend, to, params }: {
  title: string; achieved: number | string; target?: number; runRate?: number; achievedPct?: number; trend?: string;
  to?: string; params?: Record<string, string>;
}) {
  const card = (
    <Card className={`border-l-4 border-l-primary ${to ? "cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5" : ""}`}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{title}</div>
        <div className="text-2xl font-bold mt-1">{typeof achieved === "number" ? achieved.toLocaleString() : achieved}</div>
        <div className="grid grid-cols-3 gap-1 mt-3 text-[10px] uppercase text-muted-foreground">
          <div>Target</div><div>Run Rate</div><div>Ach %</div>
        </div>
        <div className="grid grid-cols-3 gap-1 text-xs font-medium">
          <div>{target?.toLocaleString() ?? "—"}</div>
          <div>{runRate != null ? Math.round(runRate).toLocaleString() : "—"}</div>
          <div className={(achievedPct ?? 0) >= 80 ? "text-green-600" : (achievedPct ?? 0) >= 50 ? "text-amber-600" : "text-red-600"}>
            {achievedPct != null ? `${achievedPct}%` : "—"}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <TrendIcon trend={trend} /><span>Trend</span>
        </div>
      </CardContent>
    </Card>
  );
  if (!to) return card;
  return <Link to={to as any} params={params as any} className="block">{card}</Link>;
}


function TLOverview() {
  const qc = useQueryClient();
  const [range, setRange] = useDateRange("yesterday");
  const rangeKey = [range.preset, range.from.toISOString(), range.to.toISOString()];
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };
  const qStr = `from=${encodeURIComponent(rangeArg.from)}&to=${encodeURIComponent(rangeArg.to)}`;
  const { data: ov, dataUpdatedAt } = useQuery({
    queryKey: ["tl-overview", ...rangeKey],
    queryFn: () => apiClient.get<any>(`/api/kob/tl-overview?${qStr}`),
  });
  const { data: snap = [] } = useQuery({ queryKey: ["kpi-snap", ...rangeKey], queryFn: () => apiClient.get<any[]>(`/api/kob/get-kpi-snapshot?${qStr}`) });
  const { data: myScv } = useQuery({
    queryKey: ["my-scv"],
    queryFn: () => apiClient.get<{ score: number | null }>("/api/kob/my-scv-score"),
  });
  const { data: modeData } = useQuery({
    queryKey: ["tl-alloc-mode"],
    queryFn: () => apiClient.get<{ mode: "MANUAL" | "ROUND_ROBIN" }>("/api/kob/get-my-allocation-mode"),
  });
  const mode = modeData?.mode ?? "MANUAL";
  const { data: cfg } = useQuery({ queryKey: ["kob-config"], queryFn: () => apiClient.get<any>("/api/kob/get-config") });
  const entryMode = (cfg as any)?.default_mode === "AUTO" ? "AUTO" : "MANUAL";
  const modeMut = useMutation({
    mutationFn: (m: "MANUAL" | "ROUND_ROBIN") => apiClient.patch<{ ok: boolean; mode: string }>("/api/kob/my-allocation-mode", { mode: m }),
    onSuccess: (r: any) => {
      toast.success(`Allocation set to ${r.mode === "ROUND_ROBIN" ? "Round-Robin" : "Manual"}`);
      qc.invalidateQueries({ queryKey: ["tl-alloc-mode"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
  const entryMut = useMutation({
    mutationFn: (m: "AUTO" | "MANUAL") => apiClient.patch("/api/kob/config", { default_mode: m }),
    onSuccess: (_r, m) => {
      toast.success(`Lead entry mode set to ${m}`);
      qc.invalidateQueries({ queryKey: ["kob-config"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const k = (m: string) => (snap as any[]).find((s: any) => s.metric === m) ?? {};



  if (!ov) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const snapCards: Array<[string, string, any, "neutral" | "good" | "mgmt"]> = [
    ["TOTAL_LEADS", "Total Leads", Users, "neutral"],
    ["EOI_1", "EOI 1", TrendingUp, "neutral"],
    ["WEBINAR", "Webinar", TrendingUp, "neutral"],
    ["EOI_2", "EOI 2", TrendingUp, "neutral"],
    ["FEE_PAID", "Fee Paid", CreditCard, "good"],
    
    ["KTN_CS", "KTN CS", Rocket, "mgmt"],
    ["KTN_LIVE", "KTN Live", Zap, "good"],
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Team Leader Overview</h1>
          <p className="text-sm text-muted-foreground">Team size: {ov.teamSize} executives · {ov.totalAssigned} leads in your scope</p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangeFilter value={range} onChange={setRange} />
          <div className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-md border">
            Last updated: {new Date(dataUpdatedAt || Date.now()).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl">
        <Card className="border-l-4 border-l-shero-navy">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">My SCV</div>
            <div className="text-3xl font-bold mt-1">{myScv?.score ?? "—"}</div>
            <div className="text-[11px] text-muted-foreground mt-1">Computed over your whole team's leads</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Auto Allocation</div>
            <div className="flex items-center gap-3 mt-2">
              <Switch
                checked={mode === "ROUND_ROBIN"}
                disabled={modeMut.isPending}
                onCheckedChange={(v) => modeMut.mutate(v ? "ROUND_ROBIN" : "MANUAL")}
              />
              <span className={`text-sm font-semibold ${mode === "ROUND_ROBIN" ? "text-emerald-600" : "text-muted-foreground"}`}>
                {mode === "ROUND_ROBIN" ? "Round-Robin (Auto)" : "Manual"}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">
              {mode === "ROUND_ROBIN" ? "New leads auto-assign to your team executives in rotation." : "You assign new leads manually from the allocation page."}
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-shero-teal">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Lead Entry Mode</div>
            <div className="flex items-center gap-3 mt-2">
              <Switch
                checked={entryMode === "AUTO"}
                disabled={entryMut.isPending}
                onCheckedChange={(v) => entryMut.mutate(v ? "AUTO" : "MANUAL")}
              />
              <span className={`text-sm font-semibold ${entryMode === "AUTO" ? "text-shero-teal" : "text-muted-foreground"}`}>
                {entryMode === "AUTO" ? "AUTO" : "MANUAL"}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">
              {entryMode === "AUTO" ? "New leads skip Inbox and fire to Gallabox automatically." : "New leads land in Lead Inbox for manual first-contact."}
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">KPI Snapshot — Target · Run Rate · Achieved · Achieved% · Trend</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {snapCards.map(([metric, title, Icon, variant]) => {
            const r = k(metric) as any;
            const to = metric === "TOTAL_LEADS" ? "/leads" : "/exec/$stage";
            const params = metric === "TOTAL_LEADS" ? undefined : { stage: metric };
            return (
              <SnapshotKpiCard
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
          <Stat label="Allocated Leads" value={ov.allocated} tone="info" to="/tl/allocation" detailsMetric="ALLOCATED" />
          <Stat label="Unallocated Leads" value={ov.unallocated} tone="warn" to="/tl/allocation" detailsMetric="UNALLOCATED" />
          <Stat label="Parked / Retargeting" value={ov.parked ?? 0} tone="warn" to="/tl/retargeting" detailsMetric="PARKED" />
          <Stat label="Auto Leads" value={ov.autoLeads ?? 0} tone="info" to="/tl/allocation" detailsMetric="AUTO_LEADS" />
          <Stat label="Manual Leads" value={ov.manualLeads ?? 0} tone="info" to="/tl/allocation" detailsMetric="MANUAL_LEADS" />
          <Stat
            label="Lead → Conversion %"
            value={`${(ov.totalAssigned ? Math.round((ov.ktnLive / ov.totalAssigned) * 1000) / 10 : 0).toFixed(1)}%`}
            sub="KTN Live / Total"
            icon={TrendingUp}
            tone="success"
            to="/tl/reports"
            detailsMetric="CONVERSION"
          />
          <Stat label="Team SCV" value={ov.teamScv} sub="team average" tone="primary" to="/tl/scv-incentives" />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Market & spend</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Active States" value={ov.activeStates ?? 0} icon={MapIcon} tone="primary" to="/ceo/geo-control" detailsMetric="ACTIVE_STATES" />
          <Stat label="Active Cities" value={ov.activeCities ?? 0} icon={Building2} tone="primary" to="/ceo/geo-control" detailsMetric="ACTIVE_CITIES" />
          <Stat label="Kitchen Scope" value={(ov.kitchenScope ?? 0).toLocaleString()} sub="native + other" tone="success" to="/ceo/kitchen-scope" detailsMetric="KITCHEN_SCOPE" />
          <Stat label="Total Spend" value={`₹${(ov.totalSpend ?? 0).toLocaleString()}`} icon={IndianRupee} tone="warn" to="/mgr/marketing" detailsMetric="SPEND" />
          <Stat label="Avg CPL" value={`₹${ov.cpl}`} sub="cost per lead" tone="info" to="/mgr/marketing" detailsMetric="CPL" />
          <Stat label="Avg CAC" value={`₹${ov.cac}`} sub="cost per KTN Live" tone="danger" to="/mgr/marketing" detailsMetric="CAC" />
        </div>

      </div>
    </div>
  );
}

