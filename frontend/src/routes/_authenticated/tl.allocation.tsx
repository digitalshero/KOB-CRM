import { createFileRoute } from "@tanstack/react-router";
import { LeadLink } from "@/components/lead-ref";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { downloadXlsx, unallocatedToRows } from "@/lib/export-xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";

const LANGS = ["TAMIL", "TELUGU", "MALAYALAM", "ENGLISH"] as const;

function NewLeadDialog() {
  const qc = useQueryClient();
  const { data: sources = [] } = useQuery({ queryKey: ["lead-sources"], queryFn: () => apiClient.get<any[]>("/api/kob/list-sources") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", language: "TAMIL", source_id: "", pincode: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const manualDefault = useMemo(
    () => (sources as any[]).find((s) => String(s.name).toLowerCase() === "manual")?.id ?? "",
    [sources],
  );
  const sourceId = form.source_id || manualDefault;

  const mut = useMutation({
    mutationFn: () =>
      apiClient.post<{ id: string; code: string }>("/api/kob/leads/manual", {
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        language: form.language as any,
        source_id: sourceId || null,
        pincode: form.pincode.trim(),
      }),
    onSuccess: (r: any) => {
      toast.success(`Lead ${r.code} created`);
      setForm({ full_name: "", phone: "", language: "TAMIL", source_id: "", pincode: "" });
      setOpen(false);
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create lead"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">+ New Lead</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create New Lead</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name *</Label><Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Full name" /></div>
          <div><Label>Phone Number *</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit mobile" /></div>
          <div>
            <Label>Language</Label>
            <select className="w-full border rounded px-2 py-2 text-sm bg-background" value={form.language} onChange={(e) => set("language", e.target.value)}>
              {LANGS.map((l) => <option key={l} value={l}>{l.charAt(0) + l.slice(1).toLowerCase()}</option>)}
            </select>
          </div>
          <div>
            <Label>Lead Source</Label>
            <select className="w-full border rounded px-2 py-2 text-sm bg-background" value={sourceId} onChange={(e) => set("source_id", e.target.value)}>
              <option value="">Manual</option>
              {(sources as any[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div><Label>Pincode (optional)</Label><Input value={form.pincode} onChange={(e) => set("pincode", e.target.value)} placeholder="6-digit pincode" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!form.full_name.trim() || !form.phone.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Saving…" : "Save Lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


export const Route = createFileRoute("/_authenticated/tl/allocation")({
  head: () => ({ meta: [{ title: "Lead Allocation — Shero KOB" }] }),
  component: TLAllocation,
});

function Stat({ label, value, tone = "" }: { label: string; value: any; tone?: string }) {
  return (
    <Card className="border-l-4 border-l-primary shadow-sm"><CardContent className="p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div>
    </CardContent></Card>
  );
}

function TLAllocation() {
  const qc = useQueryClient();

  const { data: ov } = useQuery({
    queryKey: ["tl-overview"],
    queryFn: () => apiClient.get<any>("/api/kob/tl-overview"),
  });
  const { data: execs = [] } = useQuery({
    queryKey: ["tl-execs"],
    queryFn: () => apiClient.get<any[]>("/api/kob/tl-executive-performance"),
  });
  const { data: leads = [] } = useQuery({
    queryKey: ["tl-leads-all"],
    queryFn: () => apiClient.get<any[]>("/api/kob/leads?limit=200000"),
  });
  const { data: unallocatedData = [] } = useQuery({
    queryKey: ["tl-unallocated"],
    queryFn: () => apiClient.get<any[]>("/api/kob/unallocated-leads"),
  });

  const { data: team = [] } = useQuery({
    queryKey: ["tl-team"],
    queryFn: () => apiClient.get<any[]>("/api/kob/my-team"),
  });
  const { data: allExecs = [] } = useQuery({
    queryKey: ["allocatable-execs"],
    queryFn: () => apiClient.get<any[]>("/api/kob/allocatable-executives"),
  });
  // Fall back to all executives when none are linked to this Team Leader yet.
  const assignOptions = useMemo(() => {
    const list = (team as any[]).length > 0 ? (team as any[]) : (allExecs as any[]);
    return list.map((t) => ({ id: t.id, label: t.full_name }));
  }, [team, allExecs]);
  const { data: modeData } = useQuery({
    queryKey: ["tl-alloc-mode"],
    queryFn: () => apiClient.get<{ mode: "MANUAL" | "ROUND_ROBIN" }>("/api/kob/get-my-allocation-mode"),
  });
  const mode = modeData?.mode ?? "MANUAL";

  const modeMut = useMutation({
    mutationFn: (m: "MANUAL" | "ROUND_ROBIN") => apiClient.patch<{ ok: boolean; mode: string }>("/api/kob/my-allocation-mode", { mode: m }),
    onSuccess: (r: any) => {
      toast.success(`Allocation set to ${r.mode === "ROUND_ROBIN" ? "Round-Robin" : "Manual"}`);
      qc.invalidateQueries({ queryKey: ["tl-alloc-mode"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const [selected, setSelected] = useState<Record<string, string>>({});
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());
  const [bulkExec, setBulkExec] = useState<string>("");
  const m = useMutation({
    mutationFn: (v: { leadId: string; executiveId: string }) => apiClient.patch(`/api/kob/leads/${v.leadId}/assignee`, { executiveId: v.executiveId }),
    onSuccess: () => { toast.success("Reassigned"); qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const bulkMut = useMutation({
    mutationFn: async (v: { leadIds: string[]; executiveId: string }) => {
      const results = await Promise.allSettled(
        v.leadIds.map((id) => apiClient.patch(`/api/kob/leads/${id}/assignee`, { executiveId: v.executiveId })),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.length - ok;
      return { ok, fail };
    },
    onSuccess: (r) => {
      if (r.fail === 0) toast.success(`Assigned ${r.ok} leads`);
      else toast.warning(`Assigned ${r.ok}, ${r.fail} failed`);
      setBulkIds(new Set());
      setBulkExec("");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message ?? "Bulk assign failed"),
  });

  const unallocated = (unallocatedData as any[]) ?? [];
  const allocated = (leads as any[]).filter((l) => l.assigned_to);

  const [reIds, setReIds] = useState<Set<string>>(new Set());
  const [reExec, setReExec] = useState<string>("");
  const allReSelected = allocated.length > 0 && allocated.every((l: any) => reIds.has(l.id));
  const toggleRe = (id: string) => setReIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAllRe = () => setReIds((s) => {
    if (allReSelected) { const n = new Set(s); allocated.forEach((l: any) => n.delete(l.id)); return n; }
    const n = new Set(s); allocated.forEach((l: any) => n.add(l.id)); return n;
  });
  const reBulkMut = useMutation({
    mutationFn: async (v: { leadIds: string[]; executiveId: string }) => {
      const results = await Promise.allSettled(
        v.leadIds.map((id) => apiClient.patch(`/api/kob/leads/${id}/assignee`, { executiveId: v.executiveId })),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      return { ok, fail: results.length - ok };
    },
    onSuccess: (r) => {
      if (r.fail === 0) toast.success(`Reassigned ${r.ok} leads`);
      else toast.warning(`Reassigned ${r.ok}, ${r.fail} failed`);
      setReIds(new Set());
      setReExec("");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message ?? "Bulk reassign failed"),
  });
  const visibleUnallocated = unallocated;
  const allVisibleSelected = visibleUnallocated.length > 0 && visibleUnallocated.every((l: any) => bulkIds.has(l.id));
  const toggleOne = (id: string) => setBulkIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setBulkIds((s) => {
    if (allVisibleSelected) { const n = new Set(s); visibleUnallocated.forEach((l: any) => n.delete(l.id)); return n; }
    const n = new Set(s); visibleUnallocated.forEach((l: any) => n.add(l.id)); return n;
  });


  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Lead Allocation</h1>
        <NewLeadDialog />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total Received" value={ov?.totalAssigned ?? "…"} />
        <Stat label="Allocated" value={ov?.allocated ?? "…"} tone="text-green-600" />
        <Stat label="Unallocated" value={ov?.unallocated ?? "…"} tone="text-red-600" />
        <Card className="border-l-4 border-l-emerald-500 shadow-sm"><CardContent className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Auto Allocation</div>
          <div className="flex items-center gap-3 mt-2">
            <Switch
              checked={mode === "ROUND_ROBIN"}
              disabled={modeMut.isPending}
              onCheckedChange={(v) => modeMut.mutate(v ? "ROUND_ROBIN" : "MANUAL")}
            />
            <span className={`text-sm font-semibold ${mode === "ROUND_ROBIN" ? "text-emerald-600" : "text-muted-foreground"}`}>
              {mode === "ROUND_ROBIN" ? "Round-Robin" : "Manual"}
            </span>
          </div>
        </CardContent></Card>
      </div>

      <Card className="border-l-4 border-l-blue-500 shadow-sm">
        <CardHeader><CardTitle className="text-base">Executive Workload</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b">
              <tr><th className="p-2">Executive</th><th className="p-2 text-right">Assigned</th><th className="p-2 text-right">Active Funnel</th><th className="p-2 text-right">KTN Live</th></tr>
            </thead>
            <tbody>
              {(execs as any[]).map((e) => (
                <tr key={e.id} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-medium">{e.name}</td>
                  <td className="p-2 text-right">{e.leads}</td>
                  <td className="p-2 text-right">{e.eoi1 + e.webinar + e.eoi2 + e.feePaid + e.agreement + e.ktnCs}</td>
                  <td className="p-2 text-right text-green-700 font-medium">{e.ktnLive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {unallocated.length > 0 && (
        <Card className="border-l-4 border-l-red-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">Unallocated Leads · Manual Assign ({unallocated.length})</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{bulkIds.size} selected</span>
              <select
                className="border rounded px-2 py-1 text-xs bg-background"
                value={bulkExec}
                onChange={(e) => setBulkExec(e.target.value)}
                disabled={bulkIds.size === 0 || bulkMut.isPending}
              >
                <option value="">Bulk assign to…</option>
                {assignOptions.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <button
                className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded disabled:opacity-50"
                disabled={bulkIds.size === 0 || !bulkExec || bulkMut.isPending}
                onClick={() => bulkMut.mutate({ leadIds: Array.from(bulkIds), executiveId: bulkExec })}
              >
                {bulkMut.isPending ? "Assigning…" : `Bulk Assign (${bulkIds.size})`}
              </button>
              <button
                className="text-xs border px-3 py-1.5 rounded hover:bg-muted"
                onClick={() => downloadXlsx("unallocated-leads", unallocatedToRows(unallocated), "Unallocated")}
              >
                Download Excel
              </button>
            </div>
          </CardHeader>
          <CardContent className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="p-2 w-8"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /></th>
                  <th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Stage</th><th className="p-2">Language</th><th className="p-2">Assign to</th><th></th>
                </tr>
              </thead>
              <tbody>
                {visibleUnallocated.map((l: any) => (
                  <tr key={l.id} className={`border-b ${bulkIds.has(l.id) ? "bg-primary/5" : ""}`}>
                    <td className="p-2"><input type="checkbox" checked={bulkIds.has(l.id)} onChange={() => toggleOne(l.id)} /></td>
                    <td className="p-2 font-mono text-xs"><LeadLink id={l.id}>{l.code}</LeadLink></td>
                    <td className="p-2"><LeadLink id={l.id} className="hover:underline">{l.full_name}</LeadLink></td>
                    <td className="p-2 text-xs">{l.stage}</td>
                    <td className="p-2 text-xs">{l.language}</td>
                    <td className="p-2">
                      <select className="border rounded px-2 py-1 text-xs bg-background"
                        value={selected[l.id] ?? ""}
                        onChange={(e) => setSelected((s) => ({ ...s, [l.id]: e.target.value }))}>
                        <option value="">Choose executive…</option>
                        {assignOptions.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <button className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded disabled:opacity-50"
                        disabled={!selected[l.id] || m.isPending}
                        onClick={() => m.mutate({ leadId: l.id, executiveId: selected[l.id]! })}>
                        Assign
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card className="border-l-4 border-l-amber-500 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Reallocation Queue ({allocated.length})</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{reIds.size} selected</span>
            <select
              className="border rounded px-2 py-1 text-xs bg-background"
              value={reExec}
              onChange={(e) => setReExec(e.target.value)}
              disabled={reIds.size === 0 || reBulkMut.isPending}
            >
              <option value="">Bulk assign to…</option>
              {assignOptions.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <button
              className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded disabled:opacity-50"
              disabled={reIds.size === 0 || !reExec || reBulkMut.isPending}
              onClick={() => reBulkMut.mutate({ leadIds: Array.from(reIds), executiveId: reExec })}
            >
              {reBulkMut.isPending ? "Assigning…" : `Bulk Assign (${reIds.size})`}
            </button>
          </div>
        </CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b">
              <tr>
                <th className="p-2 w-8"><input type="checkbox" checked={allReSelected} onChange={toggleAllRe} /></th>
                <th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Current</th><th className="p-2">Reassign to</th><th></th>
              </tr>
            </thead>
            <tbody>
              {allocated.map((l: any) => {
                const cur = assignOptions.find((t) => t.id === l.assigned_to);
                return (
                  <tr key={l.id} className={`border-b ${reIds.has(l.id) ? "bg-primary/5" : ""}`}>
                    <td className="p-2"><input type="checkbox" checked={reIds.has(l.id)} onChange={() => toggleRe(l.id)} /></td>
                    <td className="p-2 font-mono text-xs"><LeadLink id={l.id}>{l.code}</LeadLink></td>
                    <td className="p-2"><LeadLink id={l.id} className="hover:underline">{l.full_name}</LeadLink></td>
                    <td className="p-2 text-xs">{cur?.label ?? "—"}</td>
                    <td className="p-2">
                      <select className="border rounded px-2 py-1 text-xs bg-background"
                        value={selected[l.id] ?? ""}
                        onChange={(e) => setSelected((s) => ({ ...s, [l.id]: e.target.value }))}>
                        <option value="">Choose…</option>
                        {assignOptions.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <button className="text-xs border px-3 py-1 rounded disabled:opacity-50"
                        disabled={!selected[l.id] || m.isPending}
                        onClick={() => m.mutate({ leadId: l.id, executiveId: selected[l.id]! })}>Move</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>


    </div>
  );
}
