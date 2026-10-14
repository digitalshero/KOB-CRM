import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";
import { KpiCard } from "@/components/kpi-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Wallet, Users, Coins, Target, Settings2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mgr/marketing")({
  head: () => ({ meta: [{ title: "Marketing Analytics — Shero KOB" }] }),
  component: Marketing,
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString()}`;
const num = (n: number) => Math.round(n).toLocaleString();

function Marketing() {
  const qc = useQueryClient();

  const [range, setRange] = useDateRange("yesterday");
  const rk = [range.preset, range.from.toISOString(), range.to.toISOString()];
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };
  const { data: funnel = [] } = useQuery({
    queryKey: ["mgr-funnel-src", ...rk],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<any[]>(`/api/kob/get-funnel-by-source${q ? `?${q}` : ""}`);
    },
  });
  const { data: sources = [] } = useQuery({
    queryKey: ["mgr-sources", ...rk],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-sources"),
  });
  const { data: kpis = [] } = useQuery({
    queryKey: ["mgr-mkt-kpis"],
    queryFn: () => apiClient.get<any[]>("/api/kob/marketing-kpis"),
  });

  const currentMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  const [open, setOpen] = useState(false);
  const [targetMonth, setTargetMonth] = useState<string>(currentMonth);
  const periodIso = `${targetMonth}-01`;

  const { data: targets = [] } = useQuery({
    queryKey: ["mgr-mkt-targets", periodIso],
    queryFn: () => apiClient.get<any[]>(`/api/kob/list-marketing-targets${periodIso ? `?period=${encodeURIComponent(periodIso)}` : ""}`),
  });

  const kpiMap = new Map<string, any>((kpis as any[]).map((k) => [k.metric, k]));
  const tgtMap = new Map<string, number>((targets as any[]).map((t) => [t.metric, Number(t.target_value)]));

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft({
        SPEND: String(tgtMap.get("SPEND") ?? ""),
        LEADS: String(tgtMap.get("LEADS") ?? ""),
        CPL: String(tgtMap.get("CPL") ?? ""),
        CAC: String(tgtMap.get("CAC") ?? ""),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targets, targetMonth]);

  async function saveTargets() {
    setSaving(true);
    try {
      const metrics: Array<"SPEND" | "LEADS" | "CPL" | "CAC"> = ["SPEND", "LEADS", "CPL", "CAC"];
      for (const m of metrics) {
        const v = Number(draft[m]);
        if (!Number.isFinite(v) || v < 0) continue;
        if (v === tgtMap.get(m)) continue;
        await apiClient.post("/api/kob/marketing-targets", { metric: m, target_value: v, period: periodIso });
      }
      toast.success(`Targets updated for ${targetMonth}`);
      await qc.invalidateQueries({ queryKey: ["mgr-mkt-targets"] });
      await qc.invalidateQueries({ queryKey: ["mgr-mkt-kpis"] });
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }


  const kSpend = kpiMap.get("SPEND") ?? {};
  const kLeads = kpiMap.get("LEADS") ?? {};
  const kCpl = kpiMap.get("CPL") ?? {};
  const kCac = kpiMap.get("CAC") ?? {};

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Marketing Analytics</h1>
          <p className="text-xs text-muted-foreground">
            Top tiles show calendar month-to-date vs monthly target (MoM trend). Tables below use the selected date range.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Settings2 className="h-4 w-4" /> Set Targets
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Set Monthly Marketing Targets</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">Month</label>
                  <Input
                    type="month"
                    value={targetMonth}
                    onChange={(e) => setTargetMonth(e.target.value || currentMonth)}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Targets apply to the entire selected calendar month.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(["SPEND", "LEADS", "CPL", "CAC"] as const).map((m) => (
                    <div key={m}>
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">
                        {m === "SPEND" ? "Spend (₹)" : m === "LEADS" ? "Leads" : m === "CPL" ? "CPL (₹)" : "CAC (₹)"}
                      </label>
                      <Input
                        type="number"
                        min={0}
                        value={draft[m] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [m]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={saveTargets} disabled={saving}>{saving ? "Saving…" : "Save Targets"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DateRangeFilter value={range} onChange={setRange} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          title="Total Spend (MTD)"
          icon={Wallet}
          achieved={Number(kSpend.achieved ?? 0)}
          target={kSpend.target ?? null}
          runRate={kSpend.run_rate ?? null}
          prevPeriod={kSpend.prev_period ?? null}
          variant="neutral"
          format={inr}
        />
        <KpiCard
          title="Leads (MTD)"
          icon={Users}
          achieved={Number(kLeads.achieved ?? 0)}
          target={kLeads.target ?? null}
          runRate={kLeads.run_rate ?? null}
          prevPeriod={kLeads.prev_period ?? null}
          variant="neutral"
          format={num}
          to="/leads"
        />

        <KpiCard
          title="CPL (MTD)"
          icon={Coins}
          achieved={Number(kCpl.achieved ?? 0)}
          target={kCpl.target ?? null}
          runRate={kCpl.run_rate ?? null}
          prevPeriod={kCpl.prev_period ?? null}
          variant="attention"
          format={inr}
        />
        <KpiCard
          title="CAC per KTN Live (MTD)"
          icon={Target}
          achieved={Number(kCac.achieved ?? 0)}
          target={kCac.target ?? null}
          runRate={kCac.run_rate ?? null}
          prevPeriod={kCac.prev_period ?? null}
          variant="good"
          format={inr}
        />
      </div>

      <Card className="border-l-4 border-l-blue-500 shadow-sm">
        <CardHeader><CardTitle className="text-base">Source Performance</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Source</th><th className="p-2 text-right">Leads</th><th className="p-2 text-right">Fee Paid</th>
                <th className="p-2 text-right">KTN Live</th><th className="p-2 text-right">Spend</th><th className="p-2 text-right">CPL</th>
              </tr>
            </thead>
            <tbody>
              {(funnel as any[]).map((r) => (
                <tr key={r.source_name} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-medium">{r.source_name}</td>
                  <td className="p-2 text-right">{r.total_leads}</td>
                  <td className="p-2 text-right">{r.fee_paid_count}</td>
                  <td className="p-2 text-right text-green-700">{r.ktn_live_count}</td>
                  <td className="p-2 text-right">₹{Number(r.total_spend ?? 0).toLocaleString()}</td>
                  <td className="p-2 text-right">₹{r.total_leads ? Math.round(Number(r.total_spend ?? 0) / r.total_leads).toLocaleString() : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-slate-500 shadow-sm">
        <CardHeader><CardTitle className="text-base">Source Catalogue</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr><th className="p-2">Source</th><th className="p-2">Category</th><th className="p-2 text-right">CPL (₹)</th><th className="p-2">Active</th></tr>
            </thead>
            <tbody>
              {(sources as any[]).map((s) => (
                <tr key={s.id} className="border-b">
                  <td className="p-2 font-medium">{s.name}</td>
                  <td className="p-2">{s.category}</td>
                  <td className="p-2 text-right">₹{s.cost_per_lead}</td>
                  <td className="p-2 text-xs">{s.active ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
