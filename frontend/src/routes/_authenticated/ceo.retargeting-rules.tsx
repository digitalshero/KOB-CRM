import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function noSteps(cur: any): Step[] {
  const cad = Number(cur.rt_no_days) || 0;
  const max = Math.max(0, Math.floor(Number(cur.rt_no_attempts) || 0));
  const byAttempts = (cur.rt_no_dead_mode ?? "DAYS") === "ATTEMPTS";
  const deadAtt = Math.floor(Number(cur.rt_no_dead_attempts) || 0);
  const sent = byAttempts ? Math.min(max, deadAtt) : max;
  const steps: Step[] = [];
  const shown = Math.min(sent, 6);
  for (let i = 1; i <= shown; i++) steps.push({ title: `Attempt ${i}`, lines: [`Day ${cad * i}`] });
  if (sent > shown) steps.push({ title: "…", lines: [`Up to Attempt ${sent} (Day ${cad * sent})`] });
  if (!byAttempts || deadAtt > max) steps.push({ title: "Messages complete", lines: [`${max} / ${max} attempts`, "Lead stays in NO"] });
  steps.push({ title: "Dead Lead", tone: "dead", lines: [byAttempts ? `After ${deadAtt} successful attempt(s)` : `After ${cur.rt_no_dead_days} days in NO`] });
  return steps;
}

export const Route = createFileRoute("/_authenticated/ceo/retargeting-rules")({
  head: () => ({ meta: [{ title: "Retargeting Rules — Shero KOB" }] }),
  component: CeoRetargetingRules,
});

const RT_FIELDS = [
  "rt_no_days", "rt_no_attempts",
  "rt_later_first_days", "rt_later_first_attempts", "rt_later_then_days",
  "rt_noresp_first_days", "rt_noresp_first_attempts", "rt_noresp_second_days", "rt_noresp_second_attempts", "rt_noresp_final_days",
  "rt_later_first_msg_days", "rt_later_dead_days",
  "rt_noresp_first_msg_days", "rt_noresp_dead_days",
] as const;

type Step = { title: string; lines: string[]; tone?: "dead" };

function Sequence({ steps }: { steps: Step[] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sequence (live)</p>
      {steps.map((st, i) => (
        <div key={i}>
          {i > 0 && <div className="text-center text-muted-foreground text-xs leading-4">↓</div>}
          <div className={"rounded-md border px-3 py-2 " + (st.tone === "dead" ? "border-destructive/40 bg-destructive/5" : "bg-muted/40")}>
            <p className={"text-xs font-semibold uppercase " + (st.tone === "dead" ? "text-destructive" : "text-foreground")}>{st.title}</p>
            {st.lines.map((l, j) => <p key={j} className="text-xs text-muted-foreground">{l}</p>)}
          </div>
        </div>
      ))}
    </div>
  );
}

const SectionLabel = ({ children }: { children: string }) => (
  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
);

function validateRt(v: any): string | null {
  const s = v === null || v === undefined ? "" : String(v).trim();
  if (s === "") return "Required";
  const n = Number(s);
  if (!Number.isFinite(n)) return "Must be a valid number";
  if (!Number.isInteger(n)) return "Must be a whole number";
  if (n <= 0) return "Must be greater than 0";
  return null;
}

function Field({ label, val, onChange, error }: { label: string; val: any; onChange: (v: string) => void; error?: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-2 items-start">
      <Label className="text-sm pt-2">{label}</Label>
      <div>
        <Input type="number" step="any" value={val ?? ""} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} className={error ? "border-destructive" : undefined} />
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    </div>
  );
}

function CeoRetargetingRules() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["cfg"], queryFn: () => apiClient.get<any>("/api/kob/get-config") });
  const [form, setForm] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const cur = form ?? (data as any);
  if (!cur) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const upd = (k: string, v: any) => setForm({ ...cur, [k]: v });
  const save = async () => {
    const errs: Record<string, string | null> = {};
    let bad = false;
    const deadKey = (cur.rt_no_dead_mode ?? "DAYS") === "ATTEMPTS" ? "rt_no_dead_attempts" : "rt_no_dead_days";
    const keys = [...RT_FIELDS, deadKey];
    for (const k of keys) { errs[k] = validateRt(cur[k]); if (errs[k]) bad = true; }
    setErrors(errs);
    if (bad) { toast.error("Please fix the highlighted fields. Nothing was saved."); return; }
    const p = { ...cur }; delete p.id; delete p.updated_at;
    for (const k of keys) p[k] = Number(String(cur[k]).trim());
    try {
      await apiClient.patch("/api/kob/config", p);
      toast.success("Changes saved successfully.");
      qc.invalidateQueries();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Retargeting Rules</h1>
        <p className="text-sm text-muted-foreground">CEO Office master. Cadence + attempts per bucket. Every save is audit-logged.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-rose-500 shadow-sm">
          <CardHeader><CardTitle className="text-base text-red-600">NO</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <SectionLabel>Configuration</SectionLabel>
            <Field label="Cadence (days)" val={cur.rt_no_days} onChange={(v) => upd("rt_no_days", v)} error={errors["rt_no_days"]} />
            <Field label="Max attempts" val={cur.rt_no_attempts} onChange={(v) => upd("rt_no_attempts", v)} error={errors["rt_no_attempts"]} />
            <div className="grid grid-cols-2 gap-2 items-center">
              <Label className="text-sm">Dead Lead based on</Label>
              <Select value={cur.rt_no_dead_mode ?? "DAYS"} onValueChange={(v) => upd("rt_no_dead_mode", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAYS">Number of Days</SelectItem>
                  <SelectItem value="ATTEMPTS">Number of Attempts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(cur.rt_no_dead_mode ?? "DAYS") === "ATTEMPTS" ? (
              <Field label="Dead Lead after attempts" val={cur.rt_no_dead_attempts} onChange={(v) => upd("rt_no_dead_attempts", v)} error={errors["rt_no_dead_attempts"]} />
            ) : (
              <Field label="Dead Lead after (days)" val={cur.rt_no_dead_days} onChange={(v) => upd("rt_no_dead_days", v)} error={errors["rt_no_dead_days"]} />
            )}
            <Sequence steps={noSteps(cur)} />
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500 shadow-sm">
          <CardHeader><CardTitle className="text-base text-yellow-600">LATER</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <SectionLabel>Configuration</SectionLabel>
            <Field label="First message — days" val={cur.rt_later_first_msg_days} onChange={(v) => upd("rt_later_first_msg_days", v)} error={errors["rt_later_first_msg_days"]} />
            <Field label="First phase — days" val={cur.rt_later_first_days} onChange={(v) => upd("rt_later_first_days", v)} error={errors["rt_later_first_days"]} />
            <Field label="First phase — attempts" val={cur.rt_later_first_attempts} onChange={(v) => upd("rt_later_first_attempts", v)} error={errors["rt_later_first_attempts"]} />
            <Field label="Then phase — days" val={cur.rt_later_then_days} onChange={(v) => upd("rt_later_then_days", v)} error={errors["rt_later_then_days"]} />
            <Field label="Dead Lead after (days)" val={cur.rt_later_dead_days} onChange={(v) => upd("rt_later_dead_days", v)} error={errors["rt_later_dead_days"]} />
            <Sequence steps={[
              { title: "1st Message", lines: [`Day ${cur.rt_later_first_msg_days} • 1 attempt`, "From any stage"] },
              { title: "First Phase", lines: [`Every ${cur.rt_later_first_days} days • ${cur.rt_later_first_attempts} attempts`] },
              { title: "Then Phase", lines: [`Every ${cur.rt_later_then_days} days`] },
              { title: "Dead Lead", tone: "dead", lines: [`After ${cur.rt_later_dead_days} days`] },
            ]} />
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500 shadow-sm">
          <CardHeader><CardTitle className="text-base text-amber-700">NO-RESPONSE</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <SectionLabel>Configuration</SectionLabel>
            <Field label="First message (days)" val={cur.rt_noresp_first_msg_days} onChange={(v) => upd("rt_noresp_first_msg_days", v)} error={errors["rt_noresp_first_msg_days"]} />
            <Field label="Phase 1 days" val={cur.rt_noresp_first_days} onChange={(v) => upd("rt_noresp_first_days", v)} error={errors["rt_noresp_first_days"]} />
            <Field label="Phase 1 attempts" val={cur.rt_noresp_first_attempts} onChange={(v) => upd("rt_noresp_first_attempts", v)} error={errors["rt_noresp_first_attempts"]} />
            <Field label="Phase 2 days" val={cur.rt_noresp_second_days} onChange={(v) => upd("rt_noresp_second_days", v)} error={errors["rt_noresp_second_days"]} />
            <Field label="Phase 2 attempts" val={cur.rt_noresp_second_attempts} onChange={(v) => upd("rt_noresp_second_attempts", v)} error={errors["rt_noresp_second_attempts"]} />
            <Field label="Final phase days" val={cur.rt_noresp_final_days} onChange={(v) => upd("rt_noresp_final_days", v)} error={errors["rt_noresp_final_days"]} />
            <Field label="Dead Lead after (days)" val={cur.rt_noresp_dead_days} onChange={(v) => upd("rt_noresp_dead_days", v)} error={errors["rt_noresp_dead_days"]} />
            <Sequence steps={[
              { title: "First message", lines: [`After ${cur.rt_noresp_first_msg_days} day(s)`] },
              { title: "Phase 1", lines: [`Every ${cur.rt_noresp_first_days} day(s)`, `${cur.rt_noresp_first_attempts} attempts`] },
              { title: "Phase 2", lines: [`Every ${cur.rt_noresp_second_days} days`, `${cur.rt_noresp_second_attempts} attempts`] },
              { title: "Final phase", lines: [`Every ${cur.rt_noresp_final_days} days`, "Ongoing until Dead Lead"] },
              { title: "Dead Lead", tone: "dead", lines: [`After ${cur.rt_noresp_dead_days} days`] },
            ]} />
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={!form}>Save rules</Button>
      </div>
    </div>
  );
}
