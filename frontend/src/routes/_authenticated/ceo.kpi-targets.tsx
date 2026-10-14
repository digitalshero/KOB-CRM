import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { FileBarChart, Plus, Trash2, Wallet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ceo/kpi-targets")({
  head: () => ({ meta: [{ title: "KPI Targets — Shero KOB" }] }),
  component: CeoKpiTargets,
});

const METRICS = [
  "TOTAL_LEADS", "LEAD_INBOX", "AUTO_FIRED", "FAILED_FIRE",
  "EOI_1", "WEBINAR", "EOI_2", "FORM_FILLED", "FEE_PAID",
  "KTN_CS", "KTN_LIVE",
  "NO", "LATER", "NO_RESPONSE", "RETARGETING", "DEAD_LEAD",
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function CeoKpiTargets() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["kpi-t"], queryFn: () => apiClient.get<any[]>("/api/kob/list-kpi-targets") });
  const [values, setValues] = useState<Record<string, number>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const now = new Date();
  const currentKey = monthKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const [monthFilter, setMonthFilter] = useState(now.getMonth());
  const selectedKey = monthKey(new Date(now.getFullYear(), monthFilter, 1));

  const allRows = data as any[];
  const rows = allRows.filter(
    (t) => String(t.effective_from ?? "").slice(0, 10) === selectedKey,
  );

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    month: now.getMonth(),
    year: now.getFullYear(),
    metric: METRICS[0],
    target_value: "",
  });

  async function addTarget() {
    const value = Number(draft.target_value);
    if (!draft.metric) return toast.error("Metric is required");
    if (!Number.isFinite(value) || value < 0) return toast.error("Enter a valid target value");
    const eff = monthKey(new Date(draft.year, draft.month, 1));
    const dup = allRows.some(
      (t) => t.metric === draft.metric && String(t.effective_from ?? "").slice(0, 10) === eff,
    );
    if (dup) return toast.error(`A target for ${draft.metric} already exists for that month`);
    setSaving(true);
    try {
      await apiClient.post("/api/kob/kpi-targets", { metric: draft.metric, period: "monthly", target_value: value, effective_from: eff });
      toast.success("Target created");
      setOpen(false);
      setDraft({ ...draft, target_value: "" });
      await qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">KPI Targets</h1>
          <p className="text-sm text-muted-foreground">Targets drive the CEO KPI Snapshot. Achieved ÷ Target = % Achieved. All edits are audit-logged.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add Target</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add KPI Target</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">Month</label>
                  <select
                    className="w-full border rounded px-2 py-2 text-sm bg-background"
                    value={draft.month}
                    onChange={(e) => setDraft({ ...draft, month: Number(e.target.value) })}
                  >
                    {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">Year</label>
                  <Input
                    type="number"
                    value={draft.year}
                    onChange={(e) => setDraft({ ...draft, year: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Metric</label>
                <select
                  className="w-full border rounded px-2 py-2 text-sm bg-background"
                  value={draft.metric}
                  onChange={(e) => setDraft({ ...draft, metric: e.target.value })}
                >
                  {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Target Value</label>
                <Input
                  type="number"
                  min={0}
                  value={draft.target_value}
                  onChange={(e) => setDraft({ ...draft, target_value: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={addTarget} disabled={saving}>{saving ? "Saving…" : "Save Target"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Target Month</label>
        <select
          className="border rounded px-2 py-1 text-sm bg-background"
          value={monthFilter}
          onChange={(e) => setMonthFilter(Number(e.target.value))}
        >
          {MONTHS.map((month, index) => (
            <option key={month} value={index}>{month}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">{selectedKey}</span>
      </div>

      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileBarChart className="h-4 w-4" /> Existing Targets</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Metric</th>
                <th className="p-2">Period</th>
                <th className="p-2 w-40">Target</th>
                <th className="p-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t: any) => (
                <tr key={t.id} className="border-b">
                  <td className="p-2 font-medium">{t.metric}</td>
                  <td className="p-2">{t.period}</td>
                  <td className="p-2">
                    <Input
                      type="number"
                      defaultValue={t.target_value}
                      onChange={(e) => setValues({ ...values, [t.metric]: parseFloat(e.target.value) })}
                    />
                  </td>
                  <td className="p-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const v = values[t.metric] ?? t.target_value;
                          await apiClient.post("/api/kob/kpi-targets", { metric: t.metric, period: t.period, target_value: Number(v), effective_from: String(t.effective_from).slice(0, 10) });
                          toast.success("Target updated");
                          qc.invalidateQueries();
                        }}
                      >Save</Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-1"
                        disabled={deletingId === t.id}
                        onClick={async () => {
                          if (!window.confirm(`Delete the ${t.metric} target?`)) return;
                          setDeletingId(t.id);
                          try {
                            await apiClient.delete(`/api/kob/kpi-targets/${t.id}`);
                            toast.success("Target deleted");
                            await qc.invalidateQueries();
                          } catch (e: any) {
                            toast.error(e?.message ?? "Delete failed");
                          } finally {
                            setDeletingId(null);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </Button>
                    </div>
                  </td>

                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No KPI targets for this month — use Add Target.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <MarketingTargets period={selectedKey} />
    </div>
  );
}

const MKT: Array<{ metric: "SPEND" | "LEADS" | "CPL" | "CAC"; label: string; hint: string }> = [
  { metric: "SPEND", label: "Marketing Budget (₹)", hint: "Planned monthly ad spend" },
  { metric: "LEADS", label: "Lead Target", hint: "Leads expected from spend" },
  { metric: "CPL", label: "Target CPL (₹)", hint: "Cost per lead" },
  { metric: "CAC", label: "Target CAC (₹)", hint: "Cost per acquired kitchen" },
];

function MarketingTargets({ period }: { period: string }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["mkt-targets", period],
    queryFn: () => apiClient.get<any[]>(`/api/kob/list-marketing-targets${period ? `?period=${encodeURIComponent(period)}` : ""}`),
  });
  const tgt = new Map<string, number>((data as any[]).map((t) => [t.metric, Number(t.target_value)]));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  async function save(metric: "SPEND" | "LEADS" | "CPL" | "CAC") {
    const raw = draft[metric];
    const value = raw === undefined || raw === "" ? Number(tgt.get(metric) ?? 0) : Number(raw);
    if (!Number.isFinite(value) || value < 0) return toast.error("Enter a valid value");
    setSaving(metric);
    try {
      await apiClient.post("/api/kob/marketing-targets", { metric, target_value: value, period });
      toast.success(`${metric} target saved`);
      setDraft((d) => { const n = { ...d }; delete n[metric]; return n; });
      await qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card className="border-l-4 border-l-primary shadow-sm">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4" /> Marketing Targets — {period}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {MKT.map((m) => (
          <div key={m.metric} className="space-y-1">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                value={draft[m.metric] ?? String(tgt.get(m.metric) ?? "")}
                onChange={(e) => setDraft({ ...draft, [m.metric]: e.target.value })}
              />
              <Button size="sm" disabled={saving === m.metric} onClick={() => save(m.metric)}>
                {saving === m.metric ? "…" : "Save"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">{m.hint}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

