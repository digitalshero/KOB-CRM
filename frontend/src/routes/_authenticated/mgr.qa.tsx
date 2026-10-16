import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiClient } from "@/lib/api-client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, FlaskConical, Trash2, Download, RefreshCw, Calculator, Zap, PlayCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mgr/qa")({
  head: () => ({ meta: [{ title: "QA Test Panel — Shero KOB" }] }),
  component: QAPanel,
});

const STAGES = [
  "LEAD_INBOX","AUTO_FIRED","FAILED_FIRE","EOI_1","WEBINAR","EOI_2",
  "FORM_FILLED","FEE_PAID","KTN_CS","KTN_LIVE",
  "NO","LATER","NO_RESPONSE","RETARGETING","DEAD_LEAD",
];

type LogEntry = { at: string; ok: boolean; label: string; detail?: string };

function QAPanel() {
  const qc = useQueryClient();
  const { data: role } = useQuery<any>({ queryKey: ["my-role"], queryFn: () => apiClient.get<any>("/api/kob/my-role") });
  const isMgr = role?.role === "kob_manager" || role?.role === "super_admin";

  const { data: staff } = useQuery({
    queryKey: ["qa-staff"],
    queryFn: () => apiClient.get<{ tls: any[]; execs: any[] }>("/api/qa/staff"),
    enabled: isMgr,
  });

  const [leadId, setLeadId] = useState<string | null>(null);
  const [leadCode, setLeadCode] = useState<string>("");
  const [tlId, setTlId] = useState("");
  const [execId, setExecId] = useState("");
  const [stage, setStage] = useState("EOI_1");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [verify, setVerify] = useState<any>(null);
  const [lifecycle, setLifecycle] = useState<{ results: Array<{ ok: boolean; label: string; detail?: string }>; passed: number; failed: number } | null>(null);
  const [lifecycleRunning, setLifecycleRunning] = useState(false);

  const push = (ok: boolean, label: string, detail?: string) =>
    setLog((prev) => [{ at: new Date().toLocaleTimeString(), ok, label, detail }, ...prev].slice(0, 40));

  const run = async (label: string, fn: () => Promise<any>) => {
    try { const r = await fn(); push(true, label, typeof r === "object" ? JSON.stringify(r) : String(r ?? "")); return r; }
    catch (e: any) { push(false, label, e?.message ?? String(e)); return null; }
  };

  const invalidateAll = () =>
    qc.invalidateQueries({ predicate: () => true });

  if (!isMgr) {
    return (
      <div className="p-6">
        <Card className="border-l-4 border-l-red-500 max-w-lg">
          <CardContent className="p-6 flex items-center gap-3">
            <XCircle className="h-6 w-6 text-red-500" />
            <div>
              <div className="font-semibold">Access restricted</div>
              <div className="text-sm text-muted-foreground">QA Test Panel is visible only to CEO Office / KOB Manager.</div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const downloadCsv = async () => {
    const rows = await apiClient.get<any[]>("/api/kob/leads?limit=1000");
    const found = (rows as any[]).find((r) => r.id === leadId);
    push(!!found, "Report export includes lead", found ? `Row: ${found.code}` : "Lead not in export");
    if (!rows?.length) return;
    const keys = Object.keys(rows[0]).filter((k) => typeof (rows[0] as any)[k] !== "object");
    const csv = [keys.join(","), ...(rows as any[]).map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `qa-leads-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FlaskConical className="h-6 w-6 text-primary" /> QA Test Panel — KOB V1</h1>
          <p className="text-sm text-muted-foreground">End-to-end verification harness. Visible to CEO Office / Manager only.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={lifecycleRunning}
            onClick={async () => {
              setLifecycleRunning(true); setLifecycle(null);
              try {
                const r = await apiClient.post<any>("/api/qa/lifecycle/run");
                setLifecycle(r as any);
                push((r as any).failed === 0, `Full Lifecycle Test: ${(r as any).passed} passed / ${(r as any).failed} failed`);
                invalidateAll();
              } catch (e: any) {
                push(false, "Full Lifecycle Test crashed", e?.message ?? String(e));
              } finally { setLifecycleRunning(false); }
            }}
            className="flex items-center gap-2 text-sm px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            <PlayCircle className="h-4 w-4" /> {lifecycleRunning ? "Running…" : "Run Full Lifecycle Test"}
          </button>
          <button onClick={() => run("Run Retargeting Advancement Now", async () => {
              const r = await apiClient.post<any>("/api/qa/retargeting/advance");
              const msg = `advanced=${r?.advanced ?? 0} · killed=${r?.killed ?? 0} · processed=${r?.processed ?? 0}`;
              return msg;
            }).then(invalidateAll)}
            className="flex items-center gap-2 text-sm px-3 py-2 rounded bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100">
            <Zap className="h-4 w-4" /> Run Retargeting Advancement Now
          </button>
          <button onClick={() => run("Compute SCV scores (all executives)", () => apiClient.post("/api/qa/compute-scv-scores")).then(invalidateAll)}
            className="flex items-center gap-2 text-sm px-3 py-2 rounded bg-shero-mint text-shero-navy border border-shero-navy/20 hover:bg-shero-mint/70">
            <Calculator className="h-4 w-4" /> Compute SCV scores
          </button>
          <button onClick={() => run("Cleanup QA leads", () => apiClient.post("/api/qa/cleanup")).then(invalidateAll)}
            className="flex items-center gap-2 text-sm px-3 py-2 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
            <Trash2 className="h-4 w-4" /> Cleanup QA leads
          </button>
        </div>
      </div>

      {/* Current subject */}
      <Card className="border-l-4 border-l-primary">
        <CardHeader className="pb-2"><CardTitle className="text-base">Current test lead</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">{leadId ?? "—"}</span></div>
          <div><span className="text-muted-foreground">Code:</span> <span className="font-mono">{leadCode || "—"}</span></div>
          <button onClick={async () => {
            const r = await run("1. Create sample lead", () => apiClient.post<{ id: string; code: string; full_name: string }>("/api/qa/sample-lead"));
            if (r?.id) { setLeadId(r.id); setLeadCode(r.code); invalidateAll(); }
          }} className="ml-auto text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground">Create sample lead</button>
        </CardContent>
      </Card>

      {/* Full Lifecycle results */}
      {lifecycle && (
        <Card className={`border-l-4 ${lifecycle.failed === 0 ? "border-l-emerald-600" : "border-l-red-600"}`}>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <PlayCircle className="h-4 w-4" /> Full Lifecycle Test — Results
            </CardTitle>
            <div className="text-sm">
              <span className="text-emerald-700 font-semibold">✅ {lifecycle.passed} passed</span>
              {" · "}
              <span className={lifecycle.failed > 0 ? "text-red-700 font-semibold" : "text-muted-foreground"}>❌ {lifecycle.failed} failed</span>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="text-xs space-y-0.5 font-mono max-h-96 overflow-auto">
              {lifecycle.results.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  {r.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />}
                  <span className={r.ok ? "" : "text-red-700 font-semibold"}>{r.label}</span>
                  {r.detail && <span className="text-muted-foreground truncate">— {r.detail}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Actions grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-l-4 border-l-shero-teal">
          <CardHeader className="pb-2"><CardTitle className="text-base">2. Assign to Team Leader</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            <select className="flex-1 border rounded px-2 py-1 text-sm" value={tlId} onChange={(e) => setTlId(e.target.value)}>
              <option value="">Select TL…</option>
              {(staff?.tls ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>)}
            </select>
            <button disabled={!leadId || !tlId} onClick={() =>
              run("2. Assign TL", () => apiClient.patch(`/api/qa/leads/${leadId}/team-leader`, { tlId })).then(invalidateAll)
            } className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground disabled:opacity-40">Assign</button>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-shero-teal">
          <CardHeader className="pb-2"><CardTitle className="text-base">3. Assign to Executive</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            <select className="flex-1 border rounded px-2 py-1 text-sm" value={execId} onChange={(e) => setExecId(e.target.value)}>
              <option value="">Select Executive…</option>
              {(staff?.execs ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>)}
            </select>
            <button disabled={!leadId || !execId} onClick={() =>
              run("3. Assign Executive", () => apiClient.patch(`/api/qa/leads/${leadId}/executive`, { execId })).then(invalidateAll)
            } className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground disabled:opacity-40">Assign</button>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-shero-navy">
          <CardHeader className="pb-2"><CardTitle className="text-base">4. Move through KOB stages</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <select className="flex-1 border rounded px-2 py-1 text-sm" value={stage} onChange={(e) => setStage(e.target.value)}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button disabled={!leadId} onClick={() =>
                run(`4. Move → ${stage}`, () => apiClient.post(`/api/qa/leads/${leadId}/stage`, { stage })).then(invalidateAll)
              } className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground disabled:opacity-40">Move</button>
            </div>
            <button onClick={async () => {
              // Always start from a fresh lead — walking a lead that's already at
              // KTN_LIVE (terminal) or in a retargeting bucket would fail validation.
              const fresh = await run("Walk: create fresh lead", () => apiClient.post<{ id: string; code: string; full_name: string }>("/api/qa/sample-lead"));
              if (!fresh?.id) { invalidateAll(); return; }
              setLeadId(fresh.id); setLeadCode(fresh.code);
              for (const s of ["EOI_1","WEBINAR","EOI_2","FORM_FILLED","FEE_PAID","KTN_CS","KTN_LIVE"]) {
                await run(`Walk → ${s}`, () => apiClient.post(`/api/qa/leads/${fresh.id}/stage`, { stage: s }));
              }
              invalidateAll();
            }} className="w-full text-xs px-3 py-1.5 rounded border border-primary text-primary hover:bg-primary/10">
              Walk full happy-path (creates fresh lead → EOI 1 → KTN Live)
            </button>

          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardHeader className="pb-2"><CardTitle className="text-base">5-9. Milestones & Retargeting</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <button disabled={!leadId} onClick={() => run("5. Trigger retargeting", () => apiClient.post("/api/qa/retargeting/trigger", { leadId })).then(invalidateAll)}
              className="text-xs px-2 py-1.5 rounded bg-amber-100 text-amber-800 disabled:opacity-40">5. Retargeting</button>
            <button disabled={!leadId} onClick={() => run("6. Mark Fee Paid", () => apiClient.post(`/api/qa/leads/${leadId}/stage`, { stage: "FEE_PAID" })).then(invalidateAll)}
              className="text-xs px-2 py-1.5 rounded bg-green-100 text-green-800 disabled:opacity-40">6. Fee Paid</button>
            <button disabled={!leadId} onClick={() => run("8. Mark KTN CS", () => apiClient.post(`/api/qa/leads/${leadId}/stage`, { stage: "KTN_CS" })).then(invalidateAll)}
              className="text-xs px-2 py-1.5 rounded bg-emerald-100 text-emerald-800 disabled:opacity-40">8. KTN CS</button>
            <button disabled={!leadId} onClick={() => run("9. Mark KTN Live", () => apiClient.post(`/api/qa/leads/${leadId}/stage`, { stage: "KTN_LIVE" })).then(invalidateAll)}
              className="text-xs px-2 py-1.5 rounded bg-emerald-100 text-emerald-800 disabled:opacity-40 col-span-2">9. KTN Live</button>
          </CardContent>
        </Card>
      </div>

      {/* Verification */}
      <Card className="border-l-4 border-l-green-600">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">10-14. Verify system state</CardTitle>
          <div className="flex gap-2">
            <button disabled={!leadId} onClick={async () => {
              const r = await run("10-13. Verify", () => apiClient.post("/api/qa/verify", { leadId }));
              if (r) setVerify(r);
            }} className="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Verify
            </button>
            <button disabled={!leadId} onClick={() => run("13. Recalc SCV", () => apiClient.post("/api/qa/recalc-scv", { leadId })).then(invalidateAll)}
              className="text-sm px-3 py-1.5 rounded border">13. Recalc SCV</button>
            <button disabled={!leadId} onClick={downloadCsv}
              className="text-sm px-3 py-1.5 rounded border flex items-center gap-1">
              <Download className="h-3 w-3" /> 14. Export CSV
            </button>
          </div>

        </CardHeader>
        <CardContent>
          {!verify ? (
            <div className="text-sm text-muted-foreground">Run a Verify to see dashboard counts, stage history and audit log.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="font-semibold mb-1">10. Dashboard counts</div>
                <ul className="text-xs space-y-0.5">
                  <li>Total: <b>{verify.counts.totalLeads}</b></li>
                  <li>Fee Paid: <b>{verify.counts.feePaid}</b></li>
                  <li>Agreement: <b>{verify.counts.agreement}</b></li>
                  <li>KTN CS: <b>{verify.counts.ktnCs}</b></li>
                  <li>KTN Live: <b>{verify.counts.ktnLive}</b></li>
                  <li>Retargeting: <b>{verify.counts.retargeting}</b></li>
                </ul>
                <div className="text-[10px] text-muted-foreground mt-2">Lead stage: <b>{verify.lead?.stage}</b> · SCV <b>{verify.lead?.scv_score}</b></div>
              </div>
              <div>
                <div className="font-semibold mb-1">11. Stage history ({verify.stageHistoryCount})</div>
                <ul className="text-xs max-h-40 overflow-auto space-y-0.5">
                  {verify.history.map((h: any, i: number) => (
                    <li key={i}>{h.from_stage ?? "—"} → <b>{h.to_stage}</b> <span className="text-muted-foreground">{new Date(h.changed_at).toLocaleTimeString()}</span></li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-semibold mb-1">12. Audit log ({verify.auditCount})</div>
                <ul className="text-xs max-h-40 overflow-auto space-y-0.5">
                  {verify.audits.map((a: any, i: number) => (
                    <li key={i}><b>{a.action}</b> <span className="text-muted-foreground">{new Date(a.created_at).toLocaleTimeString()}</span></li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run log */}
      <Card className="border-l-4 border-l-slate-400">
        <CardHeader className="pb-2"><CardTitle className="text-base">Test run log</CardTitle></CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <div className="text-sm text-muted-foreground">Actions will be logged here.</div>
          ) : (
            <ul className="text-xs space-y-1 max-h-72 overflow-auto font-mono">
              {log.map((l, i) => (
                <li key={i} className="flex items-start gap-2">
                  {l.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 text-red-600 mt-0.5" />}
                  <span className="text-muted-foreground">{l.at}</span>
                  <span className="font-semibold">{l.label}</span>
                  {l.detail && <span className="text-muted-foreground truncate">— {l.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
