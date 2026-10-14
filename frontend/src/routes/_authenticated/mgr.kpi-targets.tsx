import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi-card";
import { useState } from "react";
import { toast } from "sonner";
import {
  FileBarChart, Users, TrendingUp, CreditCard, Rocket, Zap,
  ClipboardList, Handshake,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mgr/kpi-targets")({
  head: () => ({ meta: [{ title: "KPI Targets — KOB Manager" }] }),
  component: MgrKpiTargets,
});

type Variant = "neutral" | "good" | "risk" | "attention" | "mgmt";
const METRICS: Array<{ metric: string; title: string; icon: LucideIcon; variant: Variant }> = [
  { metric: "TOTAL_LEADS",      title: "Total Leads",      icon: Users,         variant: "neutral" },
  { metric: "EOI_1",            title: "EOI 1",            icon: TrendingUp,    variant: "neutral" },
  { metric: "WEBINAR",          title: "Webinar",          icon: TrendingUp,    variant: "neutral" },
  { metric: "EOI_2",            title: "EOI 2",            icon: Handshake,     variant: "neutral" },
  { metric: "FORM_FILLED",      title: "Form Filled",      icon: ClipboardList, variant: "neutral" },
  { metric: "FEE_PAID",         title: "Fee Paid",         icon: CreditCard,    variant: "good" },
  
  { metric: "KTN_CS",           title: "KTN CS",           icon: Rocket,        variant: "mgmt" },
  { metric: "KTN_LIVE",         title: "KTN Live",         icon: Zap,           variant: "good" },
];

function MgrKpiTargets() {
  const qc = useQueryClient();

  const { data: targets = [] } = useQuery({
    queryKey: ["kpi-t"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-kpi-targets"),
  });
  const { data: snap = [] } = useQuery({
    queryKey: ["kpi-snap-mtd"],
    queryFn: () => apiClient.get<any[]>("/api/kob/get-kpi-snapshot"),
  });

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const targetMap = new Map<string, any>();
  for (const t of targets as any[]) {
    // Latest effective_from wins per metric (monthly only in this view).
    const cur = targetMap.get(t.metric);
    if (!cur || new Date(t.effective_from) > new Date(cur.effective_from)) {
      targetMap.set(t.metric, t);
    }
  }
  const snapMap = new Map<string, any>((snap as any[]).map((s) => [s.metric, s]));

  async function save(metric: string) {
    const raw = drafts[metric];
    const current = Number(targetMap.get(metric)?.target_value ?? 0);
    const value = raw === undefined || raw === "" ? current : Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter a valid non-negative number");
      return;
    }
    setSaving(metric);
    try {
      await apiClient.post("/api/kob/kpi-targets", { metric, period: "monthly", target_value: value });
      toast.success(`${metric} target updated`);
      setDrafts((d) => { const n = { ...d }; delete n[metric]; return n; });
      await qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">KPI Targets</h1>
          <p className="text-sm text-muted-foreground">
            Set the monthly Target for each funnel metric. Run Rate, Achieved and Achieved% are
            calculated live from lead activity — you only edit Target. Saves are audit-logged and
            reflect immediately on the CEO KPI Snapshot.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileBarChart className="h-4 w-4" /> Period: Monthly (MTD)
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {METRICS.map((m) => {
          const t = targetMap.get(m.metric);
          const s = snapMap.get(m.metric) ?? {};
          const currentTarget = Number(t?.target_value ?? 0);
          const draftVal = drafts[m.metric];
          const dirty = draftVal !== undefined && Number(draftVal) !== currentTarget;
          return (
            <Card key={m.metric} className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono text-muted-foreground">{m.metric}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <KpiCard
                  title={m.title}
                  icon={m.icon}
                  achieved={Number(s.achieved ?? 0)}
                  target={s.target ?? currentTarget ?? null}
                  runRate={s.run_rate ?? null}
                  prevPeriod={s.prev_period ?? null}
                  trendDirection={s.trend}
                  variant={m.variant}
                />
                <div className="flex items-end gap-2 pt-1">
                  <div className="flex-1">
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground block mb-1">
                      Set monthly target
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={draftVal ?? String(currentTarget)}
                      onChange={(e) => setDrafts({ ...drafts, [m.metric]: e.target.value })}
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={!dirty || saving === m.metric}
                    onClick={() => save(m.metric)}
                  >
                    {saving === m.metric ? "Saving…" : "Save"}
                  </Button>
                </div>
                {t?.effective_from && (
                  <div className="text-[10px] text-muted-foreground">
                    Effective from {new Date(t.effective_from).toLocaleDateString()}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
