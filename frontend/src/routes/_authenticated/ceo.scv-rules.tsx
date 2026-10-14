import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";
import { Trophy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ceo/scv-rules")({
  head: () => ({ meta: [{ title: "SCV Rules — Shero KOB" }] }),
  component: CeoScvRules,
});

const WEIGHT_FIELDS: Array<[string, string]> = [
  ["weight_conversion",       "Conversion %"],
  ["weight_tat",              "TAT Compliance"],
  ["weight_eoi1_webinar",     "EOI 1 → Webinar"],
  ["weight_eoi2_payment",     "EOI 2 → Payment"],
  ["weight_crm_discipline",   "CRM Discipline"],
];

function NumField({ label, val, onChange }: { label: string; val: any; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 items-center">
      <Label className="text-sm">{label}</Label>
      <Input type="number" step="1" value={val ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function CeoScvRules() {
  const qc = useQueryClient();

  const { data: rules } = useQuery({
    queryKey: ["scv-rules"],
    queryFn: () => apiClient.get<any>("/api/kob/get-scv-rules"),
  });
  const { data: incentives = [] } = useQuery({ queryKey: ["incentive-rules"], queryFn: () => apiClient.get<any[]>("/api/kob/get-incentive-rules") });

  const [wForm, setWForm] = useState<any>(null);
  const [incForm, setIncForm] = useState<Record<string, any>>({});
  const curW = wForm ?? (rules as any);

  if (!curW) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const upd = (k: string, v: string) => setWForm({ ...curW, [k]: v === "" ? 0 : parseInt(v) });
  const sum = WEIGHT_FIELDS.reduce((s, [k]) => s + Number(curW[k] ?? 0), 0);
  const balanced = sum === 100;

  const saveWeights = async () => {
    if (!balanced) { toast.error(`Weights must sum to 100 (currently ${sum})`); return; }
    try {
      await apiClient.patch("/api/kob/scv-rules", {
        weight_conversion: Number(curW.weight_conversion),
        weight_tat: Number(curW.weight_tat),
        weight_eoi1_webinar: Number(curW.weight_eoi1_webinar),
        weight_eoi2_payment: Number(curW.weight_eoi2_payment),
        weight_crm_discipline: Number(curW.weight_crm_discipline),
      });
      toast.success("SCV weights saved (audit-logged)");
      setWForm(null);
      qc.invalidateQueries({ queryKey: ["scv-rules"] });
    } catch (e: any) { toast.error(e.message); }
  };

  const saveIncentive = async (r: any) => {
    const patch = { ...(incForm[r.id] ?? r) };
    try {
      await apiClient.patch(`/api/kob/incentive-rules/${r.id}`, {
        label: String(patch.label),
        min_score: parseInt(patch.min_score),
        max_score: parseInt(patch.max_score),
        incentive_pct: parseInt(patch.incentive_pct),
      });
      toast.success("Slab saved");
      setIncForm({ ...incForm, [r.id]: undefined });
      qc.invalidateQueries({ queryKey: ["incentive-rules"] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">SCV & Incentive Rules</h1>
        <p className="text-sm text-muted-foreground">
          Sales Composite Value (spec §16) — 5 weighted components summing to 100. Incentive slabs map final score to payout %.
        </p>
      </div>

      <Card className={`border-l-4 shadow-sm ${balanced ? "border-l-emerald-500" : "border-l-rose-500"}`}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4" /> SCV Component Weights
            <span className={`ml-auto text-xs font-semibold ${balanced ? "text-emerald-600" : "text-rose-600"}`}>Sum: {sum} / 100</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {WEIGHT_FIELDS.map(([k, label]) => (
            <NumField key={k} label={label} val={curW[k]} onChange={(v) => upd(k, v)} />
          ))}
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-amber-500 shadow-sm">
        <CardHeader><CardTitle className="text-base">Incentive Eligibility Slabs</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Label</th>
                <th className="p-2 text-right">Min Score</th>
                <th className="p-2 text-right">Max Score</th>
                <th className="p-2 text-right">Incentive %</th>
                <th className="p-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {(incentives as any[]).map((r) => {
                const cur = incForm[r.id] ?? r;
                const setF = (k: string, v: any) => setIncForm({ ...incForm, [r.id]: { ...cur, [k]: v } });
                const dirty = incForm[r.id] !== undefined;
                return (
                  <tr key={r.id} className="border-b">
                    <td className="p-2"><Input value={cur.label ?? ""} onChange={(e) => setF("label", e.target.value)} /></td>
                    <td className="p-2 text-right"><Input type="number" value={cur.min_score ?? ""} onChange={(e) => setF("min_score", e.target.value)} /></td>
                    <td className="p-2 text-right"><Input type="number" value={cur.max_score ?? ""} onChange={(e) => setF("max_score", e.target.value)} /></td>
                    <td className="p-2 text-right"><Input type="number" value={cur.incentive_pct ?? ""} onChange={(e) => setF("incentive_pct", e.target.value)} /></td>
                    <td className="p-2 text-right">
                      <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty} onClick={() => saveIncentive(r)}>Save</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={saveWeights} disabled={!wForm || !balanced}>Save SCV Weights</Button>
      </div>
    </div>
  );
}
