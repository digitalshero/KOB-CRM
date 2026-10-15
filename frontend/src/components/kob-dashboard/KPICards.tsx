import { Users, FileText, Filter, IndianRupee, Flame, Ban, TrendingUp, TrendingDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { DateRangeValue } from "@/components/date-range-filter";
import { KPIS } from "./data";
import { useState } from "react";
import { LeadsTrendChart } from "./LeadsTrendChart";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

const ICONS: Record<string, typeof Users> = {
  users: Users,
  file: FileText,
  filter: Filter,
  rupee: IndianRupee,
  flame: Flame,
  ban: Ban,
};

type Card = (typeof KPIS)[number];

function pctChange(current: number, prev: number | null | undefined) {
  if (prev == null || Number(prev) === 0) return null;
  return ((current - Number(prev)) / Number(prev)) * 100;
}

function fmtPct(n: number | null) {
  if (n == null) return { text: "—", dir: "up" as const };
  return { text: `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`, dir: (n >= 0 ? "up" : "down") as "up" | "down" };
}

export function KPICards({ range }: { range: DateRangeValue }) {
  const [trendOpen, setTrendOpen] = useState(false);
  const [cplModalOpen, setCplModalOpen] = useState(false);
  const [trendMetric, setTrendMetric] = useState<"conv" | "leads" | "contracts">("conv");
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };
  const rangeKey = [range.preset, rangeArg.from, rangeArg.to];

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
  // Same filter rule as the Lead Inbox page (/api/kob/leads -> listLeadRows),
  // so this card's total matches the Lead Inbox page's count exactly instead
  // of get-kpi-snapshot's separate created_at-only tally.
  const { data: leadInboxCount } = useQuery({
    queryKey: ["lead-inbox-count", ...rangeKey],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<{ count: number }>(`/api/kob/get-lead-inbox-count${q ? `?${q}` : ""}`);
    },
  });
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

  const row = (metric: string) => (snap as any[]).find((x) => x.metric === metric) ?? {};

  const totalLeads = row("TOTAL_LEADS");
  const ktnCs = row("KTN_CS");
  const leadsAchieved = Number(leadInboxCount?.count ?? totalLeads.achieved ?? 0);
  const contractsAchieved = Number(ktnCs.achieved ?? 0);
  const conv = leadsAchieved > 0 ? (contractsAchieved / leadsAchieved) * 100 : 0;

  const ach = (achieved: number, target: any) =>
    target != null && Number(target) !== 0
      ? { ach: `Ach ${((achieved / Number(target)) * 100).toFixed(2)}%`, tone: (achieved >= Number(target) * 0.9 ? "good" : "bad") as "good" | "bad" }
      : { ach: "No target", tone: "good" as const };

  const live: Record<string, Partial<Card>> = {
    leads: (() => {
      const m = fmtPct(pctChange(leadsAchieved, totalLeads.prev_period));
      const a = ach(leadsAchieved, totalLeads.target);
      return {
        value: leadsAchieved.toLocaleString(),
        mom: m.text,
        momDir: m.dir,
        target: totalLeads.target != null ? `Target: ${Number(totalLeads.target).toLocaleString()}` : "No target",
        ach: a.ach,
        achTone: a.tone,
        runRate: totalLeads.run_rate != null ? Number(totalLeads.run_rate).toLocaleString() : "",
      };
    })(),
    contracts: (() => {
      const ktnCsCount = Number(contracts?.count ?? 0);
      const m = fmtPct(pctChange(ktnCsCount, contracts?.prev_period));
      const a = ach(ktnCsCount, ktnCs.target);
      return {
        value: ktnCsCount.toLocaleString(),
        mom: m.text,
        momDir: m.dir,
        target: ktnCs.target != null ? `Target: ${Number(ktnCs.target).toLocaleString()}` : "No target",
        ach: a.ach,
        achTone: a.tone,
        runRate: ktnCs.run_rate != null ? Number(ktnCs.run_rate).toLocaleString() : "",
      };
    })(),
    conv: {
      value: `${conv.toFixed(2)}%`,
      mom: "—",
      momDir: "up",
      target: "Contracts / Leads",
      ach: `${contractsAchieved.toLocaleString()} contracts`,
      achTone: "good",
      runRate: "",
    },
    cpl: (() => {
      if (metaCplError || metaCpl?.error) {
        return {
          value: "Unavailable",
          mom: "—",
          momDir: "down" as const,
          target: "Meta API unavailable",
          ach: "Error",
          achTone: "bad" as const,
          runRate: "",
        };
      }
      if (!metaCpl?.hasEnabledCampaigns || (metaCpl?.enabledCount ?? 0) === 0) {
        return {
          value: "—",
          mom: "—",
          momDir: "down" as const,
          target: "No campaigns selected",
          ach: "0 selected",
          achTone: "bad" as const,
          runRate: "Configure in Campaign Mgmt",
        };
      }
      const cplVal = metaCpl.cpl ?? 0;
      return {
        value: `₹${cplVal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
        mom: "—",
        momDir: "down" as const,
        target: `${metaCpl.enabledCount} enabled campaign${metaCpl.enabledCount === 1 ? "" : "s"}`,
        ach: `${(metaCpl.totalLeads ?? 0).toLocaleString()} Meta leads`,
        achTone: "good" as const,
        runRate: `Spend: ₹${(metaCpl.totalSpend ?? 0).toLocaleString()}`,
      };
    })(),
    abandoned: (() => {
      const ab = row("ABANDONED_LEADS");
      const achieved = Number(ab.achieved ?? 0);
      const m = fmtPct(pctChange(achieved, ab.prev_period));
      const af = Number(row("AUTO_FIRED").achieved ?? 0);
      return {
        value: achieved.toLocaleString(),
        mom: m.text,
        momDir: m.dir,
        target: "Total Leads − Auto Fired",
        ach: `${af.toLocaleString()} auto fired`,
        achTone: (achieved > 0 ? "bad" : "good") as "good" | "bad",
        runRate: ab.run_rate != null ? Number(ab.run_rate).toLocaleString() : "",
      };
    })(),
    failedFire: (() => {
      const ff = row("FAILED_FIRE");
      const achieved = Number(ff.achieved ?? 0);
      const m = fmtPct(pctChange(achieved, ff.prev_period));
      return {
        value: achieved.toLocaleString(),
        mom: m.text,
        momDir: m.dir,
        target: "No message triggered",
        ach: `${leadsAchieved.toLocaleString()} total leads`,
        achTone: (achieved > 0 ? "bad" : "good") as "good" | "bad",
        runRate: ff.run_rate != null ? Number(ff.run_rate).toLocaleString() : "",
      };
    })(),
  };

  const PLACEHOLDERS = new Set(["zones", "void"]);

  return (
    <>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
        {KPIS.map((base) => {
          const k2 = { ...base, ...(live[base.key] ?? {}) } as Card;
          const Icon = ICONS[k2.icon] ?? Users;
          const Trend = k2.momDir === "up" ? TrendingUp : TrendingDown;
          const isPlaceholder = PLACEHOLDERS.has(k2.key);
          const isClickable = k2.key === "conv" || k2.key === "leads" || k2.key === "contracts" || k2.key === "cpl";
          return (
            <div
              key={k2.key}
              onClick={
                isClickable
                  ? () => {
                      if (k2.key === "cpl") {
                        setCplModalOpen(true);
                      } else {
                        setTrendMetric(k2.key as "conv" | "leads" | "contracts");
                        setTrendOpen(true);
                      }
                    }
                  : undefined
              }
              className={`min-w-0 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)] ${
                isClickable ? "cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5" : ""
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {k2.label}
                </div>
                {isPlaceholder ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
                    🚧 Coming Soon (Dummy Data)
                  </span>
                ) : (
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                )}
              </div>

              {(
                <>

              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="truncate text-[22px] font-extrabold leading-none tracking-tight sm:text-[26px]">{k2.value}</div>

                <div
                  className={`flex shrink-0 items-center gap-1 text-[11px] font-semibold ${
                    k2.momDir === "up" ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  <span className="text-muted-foreground font-medium">MoM</span>
                  <Trend className="h-3 w-3" />
                  {k2.mom}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px]">
                <span className="min-w-0 truncate text-muted-foreground">{k2.target}</span>
                <span
                  className={`rounded-md px-1.5 py-0.5 font-semibold ${
                    k2.achTone === "good" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {k2.ach}
                </span>
              </div>

              {k2.runRate && (
                <div className="mt-1.5 flex items-center justify-between border-t border-border/50 pt-1.5 text-[11px]">
                  <span className="text-muted-foreground">Run Rate</span>
                  <span className="font-semibold">{k2.runRate}</span>
                </div>
              )}
                </>
              )}
            </div>

          );
        })}
      </div>

      <Dialog open={trendOpen} onOpenChange={setTrendOpen}>
        <DialogContent className="max-w-4xl overflow-y-auto sm:max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {trendMetric === "leads"
                ? "Leads Trend"
                : trendMetric === "contracts"
                ? "Contracts Trend"
                : "Conversion % — Leads & Contracts Trend"}
            </DialogTitle>
          </DialogHeader>
          <LeadsTrendChart range={range} />
        </DialogContent>
      </Dialog>

      <Dialog open={cplModalOpen} onOpenChange={setCplModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <IndianRupee className="h-5 w-5 text-primary" />
              Cost Per Lead (CPL) — Meta Ads
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1 text-sm">
            <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Source:</span>
                <span className="font-semibold">Meta Marketing API</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ad Account:</span>
                <span className="font-mono">Barottas (act_278974773282719)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Calculation:</span>
                <span className="font-mono font-medium">Total Spend ÷ Total Meta Leads</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border p-2.5 bg-card">
                <div className="text-[11px] text-muted-foreground uppercase font-medium">Selected Spend</div>
                <div className="text-lg font-bold mt-1">₹{(metaCpl?.totalSpend ?? 0).toLocaleString()}</div>
              </div>
              <div className="rounded-lg border p-2.5 bg-card">
                <div className="text-[11px] text-muted-foreground uppercase font-medium">Meta Leads</div>
                <div className="text-lg font-bold mt-1">{(metaCpl?.totalLeads ?? 0).toLocaleString()}</div>
              </div>
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-primary">Combined CPL</div>
                <div className="text-[11px] text-muted-foreground">
                  {metaCpl?.enabledCount ?? 0} campaign{(metaCpl?.enabledCount ?? 0) === 1 ? "" : "s"} selected
                </div>
              </div>
              <div className="text-2xl font-extrabold text-primary">
                {!metaCpl?.hasEnabledCampaigns ? "—" : `₹${(metaCpl?.cpl ?? 0).toFixed(2)}`}
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Calculated exclusively from campaigns enabled in <strong>Campaign Management</strong>. CRM-generated and organic leads are not mixed into this metric.
            </p>

            <div className="flex justify-end pt-1">
              <Link to="/campaign-management" onClick={() => setCplModalOpen(false)}>
                <Button size="sm" className="gap-1.5">
                  Manage Campaigns
                </Button>
              </Link>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
