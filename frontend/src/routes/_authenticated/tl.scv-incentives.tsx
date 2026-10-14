import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Info, Plus, Scale, Settings2, Trash2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScvMonthSelect, currentScvMonth, scvMonthLabel } from "@/components/ScvMonthSelect";
import { ScvCalculationGuide } from "@/components/ScvCalculationGuide";

export const Route = createFileRoute("/_authenticated/tl/scv-incentives")({
  head: () => ({ meta: [{ title: "SCV & Incentives — Shero KOB" }] }),
  component: TLScv,
});

type Mode = "AUTO" | "MANUAL";

function fmtTat(days: number) {
  const totalMins = Math.round(days * 1440);
  if (totalMins < 60) return `${totalMins} ${totalMins === 1 ? "min" : "mins"}`;
  const d = Math.floor(totalMins / 1440), h = Math.floor((totalMins % 1440) / 60), mi = totalMins % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} ${d === 1 ? "day" : "days"}`);
  if (h) parts.push(`${h} ${h === 1 ? "hr" : "hrs"}`);
  if (mi && !d) parts.push(`${mi} ${mi === 1 ? "min" : "mins"}`);
  return parts.join(" ") || "0 mins";
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { month: "short", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true });
}

function slabLetter(slab: string) {
  if (slab.startsWith("Platinum")) return { letter: "A", cls: "font-bold text-green-600" };
  if (slab.startsWith("Gold")) return { letter: "B", cls: "font-bold text-foreground" };
  if (slab.startsWith("Silver")) return { letter: "C", cls: "font-bold text-foreground" };
  if (slab.startsWith("Bronze")) return { letter: "D", cls: "font-bold text-foreground" };
  return { letter: "E", cls: "font-bold text-red-600" };
}

function TLScv() {
  const [cfgTab, setCfgTab] = useState<"scv" | "incentive">("scv");
  const [sDraft, setSDraft] = useState<any[]>([]);
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentScvMonth());
  // Bumped after every config/inputs save so the refetch uses a fresh URL
  // (GET server functions can otherwise be served from the HTTP cache).
  const [refresh, setRefresh] = useState(0);
  const { data } = useQuery({
    queryKey: ["scv-mode", month, refresh],
    queryFn: () => apiClient.get<any>(`/api/kob/scv-mode-incentives?month=${encodeURIComponent(month)}&ts=${refresh}`),
    staleTime: 0,
  });
  const d = data as any;
  // The CEO Dashboard Auto/Manual switch is the single global mode selector:
  // the page always calculates in that mode; the other mode shows nothing.
  const mode: Mode = d?.mode ?? "AUTO";
  const rows = d?.rows ?? [];
  const months = d?.months ?? [month];
  const comps: any[] = d?.components ?? [];
  const markComps = comps.filter((c) => c.type === "mark");
  const hasDiscipline = comps.some((c) => c.type === "discipline");
  const tableRows = rows;
  const canEditTargets = !!d?.canEditTargets;
  const canEditConfig = !!d?.canEditConfig;
  const [open, setOpen] = useState<string | null>(null);
  const selectedExecutive = rows.find((e: any) => e.id === open);
  const [slabInfoOpen, setSlabInfoOpen] = useState(false);
  const [tatInfo, setTatInfo] = useState<any | null>(null);
  const [tatDrill, setTatDrill] = useState<any | null>(null);

  // Monthly inputs
  const [inputsOpen, setInputsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const showInputs = () => {
    setDrafts(Object.fromEntries(rows.map((e: any) => [e.id, {
      target: e.rawTarget == null ? "" : String(e.rawTarget),
      discipline: e.discipline == null ? "" : String(e.discipline),
      ...Object.fromEntries(markComps.map((c) => [c.key, e.marks?.[c.key] == null ? "" : String(e.marks[c.key])])),
    }])));
    setInputsOpen(true);
  };
  const setDraft = (id: string, k: string, v: string) => setDrafts((cur) => ({ ...cur, [id]: { ...(cur[id] ?? {}), [k]: v } }));
  const num = (s?: string) => (s == null || s.trim() === "" ? null : Number(s));
  const saveInputs = async () => {
    const parsed = rows.map((e: any) => {
      const dr = drafts[e.id] ?? {};
      const marks: Record<string, number> = {};
      for (const c of markComps) { const v = num(dr[c.key]); if (v != null) marks[c.key] = v; }
      return { e, target: num(dr.target), discipline: num(dr.discipline), marks };
    });
    if (parsed.some((p: any) => p.target != null && (!Number.isInteger(p.target) || p.target < 0 || p.target > 100000))) { toast.error("KTN CS Target must be a whole number 0–100000"); return; }
    if (parsed.some((p: any) => [p.discipline, ...Object.values(p.marks)].some((v: any) => v != null && (!Number.isFinite(v) || v < 0 || v > 100)))) { toast.error("Marks must be between 0 and 100"); return; }
    setSaving(true);
    try {
      await Promise.all(parsed.map((p: any) => apiClient.post("/api/kob/scv/mode-input", { userId: p.e.id, month, mode, ktnCsTarget: p.target, discipline: p.discipline, marks: p.marks })));
      setRefresh((n) => n + 1);
      await qc.invalidateQueries({ queryKey: ["scv-mode"] });
      toast.success("Monthly inputs saved");
      setInputsOpen(false);
    } catch (err: any) { toast.error(err?.message ?? "Save failed"); } finally { setSaving(false); }
  };

  // Configuration
  const [cfgOpen, setCfgOpen] = useState(false);
  const { data: cfgData } = useQuery({ queryKey: ["scv-mode-config", mode], queryFn: () => apiClient.get<any>(`/api/kob/scv-mode-config?mode=${mode}`), enabled: cfgOpen });
  const [cDraft, setCDraft] = useState<any[]>([]);
  const [tDraft, setTDraft] = useState<any[]>([]);
  const [aDraft, setADraft] = useState<string>("10000");
  const [cfgSaving, setCfgSaving] = useState(false);
  const [tatHelpOpen, setTatHelpOpen] = useState(false);
  useEffect(() => {
    if (cfgOpen && cfgData) {
      setCDraft(((cfgData as any).components ?? []).map((c: any) => ({ ...c, weight: String(c.weight) })));
      setTDraft(((cfgData as any).tatMovements ?? []).map((t: any) => ({ ...t, days: String(t.days) })));
      setADraft(String((cfgData as any).incentiveAmount ?? 10000));
      setSDraft(((cfgData as any).slabs ?? []).map((r: any) => ({ ...r, incentive_pct: String(r.incentive_pct), incentive_amount: String(r.incentive_amount) })));
    }
  }, [cfgOpen, cfgData]);
  const cTotal = cDraft.filter((c) => c.enabled).reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const updC = (i: number, patch: any) => setCDraft((cur) => cur.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const updT = (i: number, patch: any) => setTDraft((cur) => cur.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const saveCfg = async () => {
    const components = cDraft.map((c) => ({ key: c.key, label: String(c.label).trim(), type: c.type, weight: Number(c.weight), enabled: !!c.enabled }));
    if (components.some((c) => !c.label)) { toast.error("Every component needs a name"); return; }
    if (components.some((c) => !Number.isInteger(c.weight) || c.weight < 0 || c.weight > 100)) { toast.error("Each weight must be a whole number 0–100"); return; }
    if (cTotal !== 100) { toast.error(`Enabled weights must total 100% (currently ${cTotal}%)`); return; }
    const tatMovements = tDraft.map((t) => ({ key: t.key, label: t.label, days: Number(t.days), enabled: !!t.enabled }));
    if (tatMovements.some((t) => !(t.days > 0))) { toast.error("TAT target days must be above 0"); return; }
    const incentiveAmount = Number(aDraft);
    if (!Number.isFinite(incentiveAmount) || incentiveAmount < 0) { toast.error("Incentive amount must be 0 or more"); return; }
    setCfgSaving(true);
    try {
      await apiClient.post("/api/kob/scv/mode-config", { mode, components, tatMovements, incentiveAmount });
      setRefresh((n) => n + 1);
      await Promise.all([qc.invalidateQueries({ queryKey: ["scv-mode"] }), qc.invalidateQueries({ queryKey: ["scv-mode-config", mode] })]);
      toast.success(`${mode === "AUTO" ? "Auto" : "Manual"} SCV configuration saved`);
      setCfgOpen(false);
    } catch (err: any) { toast.error(err?.message ?? "Save failed"); } finally { setCfgSaving(false); }
  };
  const saveSlabs = async () => {
    const incentiveAmount = aDraft.trim() === "" ? NaN : Number(aDraft);
    if (!Number.isFinite(incentiveAmount) || incentiveAmount < 0) { toast.error("Incentive amount must be 0 or more"); return; }
    setCfgSaving(true);
    try {
      await apiClient.post("/api/kob/scv/incentive-amount", { mode, incentiveAmount });
      setRefresh((n) => n + 1);
      await Promise.all([qc.invalidateQueries({ queryKey: ["scv-mode"] }), qc.invalidateQueries({ queryKey: ["scv-mode-config", mode] })]);
      toast.success("Incentive configuration saved");
      setCfgOpen(false);
    } catch (err: any) { toast.error(err?.message ?? "Save failed"); } finally { setCfgSaving(false); }
  };
  const hasTat = cDraft.some((c) => c.type === "tat" && c.enabled);
  const modeLabel = mode === "AUTO" ? "Auto" : "Manual";

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">SCV & Incentives</h1>
          <p className="text-sm text-muted-foreground">
            {modeLabel} SCV: {comps.map((c) => `${c.label} ${c.weight}`).join(" · ")}. All values for the selected month only.
            {d?.activeMode && <> CRM is currently in {d.activeMode === "AUTO" ? "Auto" : "Manual"} mode.</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border p-0.5" role="group" aria-label="SCV mode (set on CEO Dashboard)">
            <Button size="sm" variant={mode === "AUTO" ? "default" : "ghost"} className="h-7 px-3" disabled title="Mode is set on the CEO Dashboard">Auto Mode</Button>
            <Button size="sm" variant={mode === "MANUAL" ? "default" : "ghost"} className="h-7 px-3" disabled title="Mode is set on the CEO Dashboard">Manual Mode</Button>
          </div>
          <Button size="sm" variant="outline" onClick={() => setCfgOpen(true)}><Scale /> Configure</Button>
          {canEditTargets && <Button size="sm" onClick={showInputs}><Settings2 /> Monthly Inputs</Button>}
          <ScvMonthSelect months={months} value={month} onChange={setMonth} />
          <ScvCalculationGuide mode={mode} components={comps} slabs={d?.slabs ?? []} />
        </div>
      </div>

      <Dialog open={!!tatInfo} onOpenChange={(o) => { if (!o) setTatInfo(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>TAT Compliance Breakdown{selectedExecutive ? ` — ${selectedExecutive.name}` : ""}</DialogTitle>
            <DialogDescription>Enabled TAT movements for {scvMonthLabel(month)}.</DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">TAT Movement</th>
                  <th className="p-3 text-center">Target</th>
                  <th className="p-3 text-center">Avg. Actual TAT</th>
                  <th className="p-3 text-right">Conversion Count</th>
                  <th className="p-3 text-right">Achievement</th>
                  <th className="p-3 text-right">Max Pts</th>
                  <th className="p-3 text-right">Earned Pts</th>
                </tr>
              </thead>
              <tbody>
                {(tatInfo?.tatBreakdown ?? []).length === 0 && (
                  <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No TAT movements are enabled.</td></tr>
                )}
                {(tatInfo?.tatBreakdown ?? []).map((m: any) => (
                  <tr key={m.key} className="border-b last:border-b-0">
                    <td className="p-3 font-medium">{m.label}</td>
                    <td className="p-3 text-center">{m.targetDays} {m.targetDays === 1 ? "day" : "days"}</td>
                    <td className="p-3 text-center">{m.avgDays == null ? "—" : `${m.avgDays} ${m.avgDays === 1 ? "day" : "days"}`}</td>
                    <td className="p-3 text-right font-semibold">
                      {m.count > 0 ? (
                        <button type="button" className="text-primary underline underline-offset-2 hover:opacity-80" onClick={() => setTatDrill(m)}>{m.count}</button>
                      ) : m.count}
                    </td>
                    <td className="p-3 text-right">{m.achievementPct ?? 0}%</td>
                    <td className="p-3 text-right">{Number(m.maxPoints ?? 0).toFixed(2)}</td>
                    <td className="p-3 text-right font-semibold">{Number(m.earnedPoints ?? 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTatInfo(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!tatDrill} onOpenChange={(o) => { if (!o) setTatDrill(null); }}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
          <DialogHeader>
            <DialogTitle>{tatDrill?.label} — Conversion Details</DialogTitle>
            <DialogDescription>
              {(tatDrill?.rows ?? []).length} movements{selectedExecutive ? ` · ${selectedExecutive.name}` : ""} · {scvMonthLabel(month)}
              {(tatDrill?.rows ?? []).length > 0 && ` · Avg ${fmtTat(tatDrill.rows.reduce((s: number, r: any) => s + r.days, 0) / tatDrill.rows.length)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Lead ID</th>
                  <th className="p-3">Lead Name</th>
                  <th className="p-3">From Stage Time</th>
                  <th className="p-3">To Stage Time</th>
                  <th className="p-3 text-right">Actual TAT</th>
                </tr>
              </thead>
              <tbody>
                {(tatDrill?.rows ?? []).map((r: any, i: number) => (
                  <tr key={`${r.leadId}-${i}`} className="border-b last:border-b-0">
                    <td className="p-3 font-mono text-xs">{r.code}</td>
                    <td className="p-3">{r.name}</td>
                    <td className="p-3">{fmtTime(r.fromAt)}</td>
                    <td className="p-3">{fmtTime(r.toAt)}</td>
                    <td className="p-3 text-right font-medium">{fmtTat(r.days)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTatDrill(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inputsOpen} onOpenChange={setInputsOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col gap-0 p-0">
          <DialogHeader className="border-b p-5 pr-12">
            <DialogTitle>{modeLabel} Monthly Inputs — {scvMonthLabel(month)}</DialogTitle>
            <DialogDescription>These values apply only to {modeLabel} SCV for {scvMonthLabel(month)}.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-auto px-5 py-3">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background text-left text-xs uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="py-3">Executive / TL</th>
                  <th className="w-36 min-w-36 px-2 py-3 text-right">KTN CS Target</th>
                  {hasDiscipline && <th className="w-36 min-w-36 px-2 py-3 text-right">Personal Discipline %</th>}
                  {markComps.map((c) => <th key={c.key} className="w-36 min-w-36 px-2 py-3 text-right">{c.label} %</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((e: any) => (
                  <tr key={e.id} className="border-b">
                    <td className="py-3 font-medium">{e.name}</td>
                    <td className="py-3 pl-3"><Input type="number" min={0} max={100000} className="ml-auto w-28 text-right" value={drafts[e.id]?.target ?? ""} onChange={(ev) => setDraft(e.id, "target", ev.target.value)} aria-label={`${e.name} KTN CS Target`} /></td>
                    {hasDiscipline && <td className="py-3 pl-3"><Input type="number" min={0} max={100} className="ml-auto w-28 text-right" value={drafts[e.id]?.discipline ?? ""} onChange={(ev) => setDraft(e.id, "discipline", ev.target.value)} aria-label={`${e.name} Personal Discipline`} /></td>}
                    {markComps.map((c) => (
                      <td key={c.key} className="py-3 pl-3"><Input type="number" min={0} max={100} className="ml-auto w-28 text-right" value={drafts[e.id]?.[c.key] ?? ""} onChange={(ev) => setDraft(e.id, c.key, ev.target.value)} aria-label={`${e.name} ${c.label}`} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter className="border-t p-4">
            <Button variant="outline" onClick={() => setInputsOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveInputs} disabled={saving}><Check /> {saving ? "Saving…" : "Save Month Inputs"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-0 p-0">
          <DialogHeader className="border-b p-5 pr-12">
            <DialogTitle>{modeLabel} SCV Configuration</DialogTitle>
            <DialogDescription>
              {canEditConfig ? `Changes apply only to ${modeLabel} SCV. Enabled weights must total 100%.` : "View only — only CEO or Manager can change the configuration."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-4">
            <div className="inline-flex items-center rounded-md border p-0.5" role="group" aria-label="Configuration type">
              <Button size="sm" variant={cfgTab === "scv" ? "default" : "ghost"} className="h-7 px-3" onClick={() => setCfgTab("scv")}>SCV Configuration</Button>
              <Button size="sm" variant={cfgTab === "incentive" ? "default" : "ghost"} className="h-7 px-3" onClick={() => setCfgTab("incentive")}>Incentive Configuration</Button>
            </div>
            {cfgTab === "incentive" && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Incentive</div>
                <div className="flex items-center gap-3">
                  <label htmlFor="incentive-amount" className="text-sm font-medium">Incentive Amount (₹)</label>
                  <Input id="incentive-amount" type="number" min={0} step={100} className="w-36 text-right" value={aDraft} disabled={!canEditConfig} onChange={(ev) => setADraft(ev.target.value)} />
                  <span className="text-xs text-muted-foreground">per eligible contract</span>
                </div>
                <p className="text-xs text-muted-foreground">Weekly Target = Monthly KTN CS Target ÷ 4. Each week (days 1–7, 8–14, 15–21, 22–month end): if KTN CS contracts ≥ Weekly Target, Incentive = contracts × Incentive Amount; otherwise ₹0. Independent of SCV score.</p>
              </div>
            )}
            {cfgTab === "scv" && (<>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Components</div>
              {cDraft.map((c, i) => (
                <div key={c.key} className="flex items-center gap-2">
                  <Switch checked={!!c.enabled} disabled={!canEditConfig} onCheckedChange={(v) => updC(i, { enabled: v })} aria-label={`Enable ${c.label}`} />
                  <Input className="flex-1" value={c.label} disabled={!canEditConfig} onChange={(ev) => updC(i, { label: ev.target.value })} aria-label="Component name" />
                  <span className="w-24 text-xs text-muted-foreground">{c.type === "mark" ? "Manager mark" : "Built-in"}</span>
                  <Input type="number" min={0} max={100} className="w-20 text-right" value={c.weight} disabled={!canEditConfig} onChange={(ev) => updC(i, { weight: ev.target.value })} aria-label={`${c.label} weight`} />
                  <span className="text-sm text-muted-foreground">%</span>
                  {canEditConfig && (
                    <Button size="icon" variant="ghost" aria-label={`Delete ${c.label}`} onClick={() => setCDraft((cur) => cur.filter((_, j) => j !== i))}><Trash2 /></Button>
                  )}
                </div>
              ))}
              {canEditConfig && (
                <Button size="sm" variant="outline" onClick={() => setCDraft((cur) => [...cur, { key: `mark_${Date.now()}`, label: "New component", type: "mark", weight: "0", enabled: true }])}>
                  <Plus /> Add component
                </Button>
              )}
              <div className={`flex justify-between border-t pt-3 text-sm font-semibold ${cTotal === 100 ? "text-primary" : "text-destructive"}`}>
                <span>Total (enabled)</span><span>{cTotal}% / 100%</span>
              </div>
            </div>
            {hasTat && (
              <div className="space-y-2">
                <div className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
                  TAT movements — target days
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setTatHelpOpen(true)} aria-label="How TAT Compliance is calculated">
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </div>
                {(() => {
                  const w = Number(cDraft.find((c) => c.type === "tat")?.weight) || 0;
                  const n = tDraft.filter((x) => !!x.enabled).length;
                  const r = (v: number) => Math.round(v * 100) / 100;
                  const maxPts = n > 0 ? r(w / n) : 0;
                  const share = n > 0 ? r(100 / n) : 0;
                  return (
                    <Dialog open={tatHelpOpen} onOpenChange={setTatHelpOpen}>
                      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>How TAT Compliance Works</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 text-sm">
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              ["TAT Weightage", `${w}%`],
                              ["Enabled Movements", `${n}`],
                              ["Each Movement Weight", `${share}%`],
                              ["Max Pts / Movement", `${maxPts} pts`],
                            ].map(([k, v]) => (
                              <div key={k} className="rounded-md border bg-muted/40 p-2">
                                <div className="text-xs text-muted-foreground">{k}</div>
                                <div className="text-base font-semibold">{v}</div>
                              </div>
                            ))}
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">How it works</div>
                            <ol className="space-y-1.5">
                              <li><span className="font-medium">1. Equal share</span> — <span className="text-muted-foreground">{w} pts ÷ {n} movements = {maxPts} pts each</span></li>
                              <li><span className="font-medium">2. Achievement</span> — <span className="text-muted-foreground">Target ÷ Actual × 100 (max 100%)</span></li>
                              <li><span className="font-medium">3. Earned Points</span> — <span className="text-muted-foreground">Achievement % × {maxPts} pts</span></li>
                              <li><span className="font-medium">4. 0 conversions</span> — <span className="text-muted-foreground">0% achievement = 0 pts</span></li>
                              <li><span className="font-medium">5. Disabled</span> — <span className="text-muted-foreground">excluded; weight shared equally among enabled</span></li>
                            </ol>
                          </div>
                          <div className="rounded-md border bg-muted/40 p-3">
                            <div className="text-xs font-semibold uppercase text-muted-foreground">Final TAT</div>
                            <div className="font-medium">Total Earned Pts ÷ {w} pts × 100</div>
                            <div className="text-muted-foreground">Example: {r(w * 0.8)} / {w} pts = 80% TAT Compliance</div>
                          </div>
                        </div>
                        <DialogFooter><Button variant="outline" onClick={() => setTatHelpOpen(false)}>Close</Button></DialogFooter>
                      </DialogContent>
                    </Dialog>
                  );
                })()}
                {(() => {
                  const enabledCount = tDraft.filter((x) => !!x.enabled).length;
                  const share = enabledCount > 0 ? 100 / enabledCount : 0;
                  const fmtShare = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)}%`;
                  return (<>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                      <span className="w-9" />
                      <span className="flex-1">TAT Movement</span>
                      <span className="w-16 text-right">Weight %</span>
                      <span className="w-[7.5rem] text-right">Target Days</span>
                    </div>
                    {tDraft.map((t, i) => (
                      <div key={t.key} className="flex items-center gap-2">
                        <Switch checked={!!t.enabled} disabled={!canEditConfig} onCheckedChange={(v) => updT(i, { enabled: v })} aria-label={`Enable ${t.label}`} />
                        <span className="flex-1 text-sm">{t.label}</span>
                        <span className="w-16 text-right text-sm tabular-nums">{t.enabled ? fmtShare(share) : "—"}</span>
                        <Input type="number" min={0.1} step={0.5} className="w-20 text-right" value={t.days} disabled={!canEditConfig} onChange={(ev) => updT(i, { days: ev.target.value })} aria-label={`${t.label} target days`} />
                        <span className="text-sm text-muted-foreground">days</span>
                      </div>
                    ))}
                  </>);
                })()}
                <p className="text-xs text-muted-foreground">TAT % = Target ÷ Actual × 100 per movement (max 100%), averaged over all movements in the month.</p>
              </div>
            )}
            </>)}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Change history</div>
              {((cfgData as any)?.history ?? []).length === 0 ? (
                <div className="text-xs text-muted-foreground">No changes yet.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground"><tr className="border-b">
                    <th className="py-1">When</th><th className="py-1">Changed by</th><th className="py-1">Item</th><th className="py-1">Previous</th><th className="py-1">New</th>
                  </tr></thead>
                  <tbody>
                    {((cfgData as any)?.history ?? []).map((h: any) => (
                      <tr key={h.id} className="border-b">
                        <td className="py-1">{new Date(h.changed_at).toLocaleString("en-IN")}</td>
                        <td className="py-1">{h.changed_by_name}</td>
                        <td className="py-1">{h.component}</td>
                        <td className="py-1">{h.previous_value ?? "—"}</td>
                        <td className="py-1">{h.new_value ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <DialogFooter className="border-t p-4">
            <Button variant="outline" onClick={() => setCfgOpen(false)} disabled={cfgSaving}>{canEditConfig ? "Cancel" : "Close"}</Button>
            {canEditConfig && cfgTab === "incentive" && <Button onClick={saveSlabs} disabled={cfgSaving}><Check /> {cfgSaving ? "Saving…" : "Save Incentive Configuration"}</Button>}
            {canEditConfig && cfgTab === "scv" && <Button onClick={saveCfg} disabled={cfgSaving || cTotal !== 100}><Check /> {cfgSaving ? "Saving…" : "Save Configuration"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedExecutive} onOpenChange={(isOpen) => { if (!isOpen) setOpen(null); }}>
        <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col gap-0 p-0">
          {selectedExecutive && (
            <>
              <DialogHeader className="border-b p-5 pr-12">
                <DialogTitle>SCV Score Breakdown — {selectedExecutive.name}</DialogTitle>
                <DialogDescription>{modeLabel} metric component score breakdown for {scvMonthLabel(month)}.</DialogDescription>
              </DialogHeader>
              <div className="min-h-0 overflow-auto p-5">
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="p-3">COMPONENT</th>
                        <th className="p-3">ACTUAL</th>
                        <th className="p-3 text-center">WEIGHTAGE</th>
                        <th className="p-3 text-right">SCV %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedExecutive.components ?? []).map((component: any) => (
                        <tr key={component.key} className="border-b last:border-b-0">
                          <td className="p-3 font-medium">
                            {component.type === "tat" && Array.isArray(component.tatBreakdown) ? (
                              <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setTatInfo(component)}>{component.label}</button>
                            ) : component.label}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {component.pct}%{component.detail ? ` (${component.detail})` : ""}
                          </td>
                          <td className="p-3 text-center text-muted-foreground">{component.weight}%</td>
                          <td className="p-3 text-right text-muted-foreground">{component.points}%</td>
                        </tr>
                      ))}
                      <tr className="border-t bg-muted/20">
                        <td className="p-3 font-semibold">Total SCV Score</td>
                        <td className="p-3 font-semibold">{Math.round((selectedExecutive.components ?? []).reduce((s: number, c: any) => s + Number(c.pct ?? 0), 0) * 100) / 100}%</td>
                        <td className="p-3 text-center font-semibold">{Math.round((selectedExecutive.components ?? []).reduce((s: number, c: any) => s + Number(c.weight ?? 0), 0) * 100) / 100}%</td>
                        <td className="p-3 text-right">
                          <div className="text-base font-bold text-primary">{selectedExecutive.finalScore}%</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <DialogFooter className="border-t p-4">
                <Button variant="outline" onClick={() => setOpen(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={slabInfoOpen} onOpenChange={setSlabInfoOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>SCV Incentive Eligibility</DialogTitle>
            <DialogDescription>Information only — for reference.</DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Slab</th>
                  <th className="p-3">SCV Score</th>
                  <th className="p-3 text-right">Incentive Eligibility (Payout %)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { slab: "A", score: "90 and above", payout: "100%" },
                  { slab: "B", score: "80–89", payout: "80%" },
                  { slab: "C", score: "70–79", payout: "60%" },
                  { slab: "D", score: "60–69", payout: "40%" },
                  { slab: "E", score: "Below 60", payout: "No incentive / manager review" },
                ].map((r) => (
                  <tr key={r.slab} className="border-b last:border-b-0">
                    <td className="p-3 font-medium">{r.slab}</td>
                    <td className="p-3 text-muted-foreground">{r.score}</td>
                    <td className="p-3 text-right">{r.payout}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <Card><CardContent className="overflow-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
            <tr>
              <th className="p-2">Executive</th>
              <th className="p-2 text-right">SCV</th>
              <th className="p-2 text-right">OVERALL %</th>
              {comps.map((c) => <th key={c.key} className="p-2 text-right">{c.label} %</th>)}
              <th className="p-2 text-right">KTN CS</th>
              <th className="p-2">Slab</th>
              <th className="p-2 text-right">Payout %</th>
              <th className="p-2 text-right">
                <span className="inline-flex items-center gap-1">
                  INCENTIVE
                  <button
                    type="button"
                    aria-label="SCV Incentive Eligibility"
                    title="SCV Incentive Eligibility"
                    className="inline-flex text-muted-foreground hover:text-foreground"
                    onClick={() => setSlabInfoOpen(true)}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(tableRows as any[]).map((e) => (
              <tr key={`${e.id}-${month}-${mode}`} className="border-b hover:bg-muted/40">
                <td className="p-2 font-medium">
                  <button type="button" className="text-left hover:underline" onClick={() => setOpen(e.id)}>
                    {e.name}
                  </button>
                </td>
                <td className="p-2 text-right font-semibold">{e.finalScore}</td>
                <td className="p-2 text-right">
                  {(() => {
                    const cs = e.components ?? [];
                    const overall = cs.length ? Math.round(cs.reduce((s: number, c: any) => s + (Number(c.pct) || 0), 0) / cs.length) : 0;
                    return `${overall}%`;
                  })()}
                </td>
                {comps.map((c) => {
                  const v = (e.components ?? []).find((x: any) => x.key === c.key);
                  return <td key={c.key} className="p-2 text-right">{v?.pct ?? 0}%</td>;
                })}
                <td className="p-2 text-right">{e.ktnCs}</td>
                <td className="p-2 text-center">{(() => { const s = slabLetter(e.slabLabel); return <span className={s.cls}>{s.letter}</span>; })()}</td>
                <td className="p-2 text-right">{e.incentivePct}%</td>
                <td className="p-2 text-right font-medium">₹{e.amount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
