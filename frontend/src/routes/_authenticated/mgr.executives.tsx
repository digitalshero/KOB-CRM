import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/mgr/executives")({
  head: () => ({ meta: [{ title: "Executive Management — Shero KOB" }] }),
  component: MgrExecutives,
});

const LANGUAGES = ["TAMIL","TELUGU","MALAYALAM","HINDI","BENGALI","ENGLISH","KANNADA","MARATHI","GUJARATI","OTHERS"];

function MgrExecutives() {
  const qc = useQueryClient();

  const { data: execs = [] } = useQuery({
    queryKey: ["mgr-execs-roster"],
    queryFn: () => apiClient.get<any[]>("/api/kob/executives-with-stats"),
  });
  const { data: profiles = [] } = useQuery({ queryKey: ["mgr-profiles"], queryFn: () => apiClient.get<any[]>("/api/kob/list-all-profiles") });
  const { data: allocs = [] } = useQuery({
    queryKey: ["allocatable-execs"],
    queryFn: () => apiClient.get<any[]>("/api/kob/allocatable-executives"),
  });
  const tls = (profiles as any[]).filter((p) => p.roles?.includes("team_leader"));
  const langByExec = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const e of allocs as any[]) m[e.id] = e.primary_language ?? null;
    return m;
  }, [allocs]);
  const secLangByExec = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const e of allocs as any[]) m[e.id] = e.secondary_language ?? null;
    return m;
  }, [allocs]);

  const [selected, setSelected] = useState<Record<string, string>>({});
  const [selectedLang, setSelectedLang] = useState<Record<string, string>>({});
  const [selectedSecLang, setSelectedSecLang] = useState<Record<string, string>>({});
  const reassignMut = useMutation({
    mutationFn: (v: { executiveId: string; teamLeaderId: string }) =>
      apiClient.patch(`/api/kob/executives/${v.executiveId}/team-leader`, { teamLeaderId: v.teamLeaderId }),
    onSuccess: () => {
      toast.success("Executive reassigned");
      qc.invalidateQueries({ queryKey: ["mgr-execs-roster"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Reassignment failed"),
  });
  const langMut = useMutation({
    mutationFn: (v: { executiveId: string; primary_language?: string | null; secondary_language?: string | null }) =>
      apiClient.patch(`/api/kob/executives/${v.executiveId}/language`, v),
    onSuccess: () => {
      toast.success("Language updated");
      qc.invalidateQueries({ queryKey: ["allocatable-execs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  // Create form state
  const [form, setForm] = useState({ email: "", full_name: "", primary_language: "", secondary_language: "", team_leader_id: "", password: "" });
  const createMut = useMutation({
    mutationFn: () => apiClient.post("/api/kob/executives", {
      email: form.email,
      full_name: form.full_name,
      primary_language: form.primary_language || null,
      secondary_language: form.secondary_language || null,
      team_leader_id: form.team_leader_id || null,
      password: form.password || undefined,
    }),
    onSuccess: () => {
      toast.success("Executive created");
      setForm({ email: "", full_name: "", primary_language: "", secondary_language: "", team_leader_id: "", password: "" });
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "Create failed"),
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Executive Management</h1>
      <p className="text-sm text-muted-foreground">Add executives, set their primary language (used for auto-assignment on new Lead Inbox entries), and reassign to Team Leaders.</p>

      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardHeader><CardTitle className="text-base">Add Executive</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-6 items-end">
            <div className="md:col-span-2">
              <label className="text-xs uppercase text-muted-foreground">Full name</label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Priya S." />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs uppercase text-muted-foreground">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="exec@shero.test" />
            </div>
            <div>
              <label className="text-xs uppercase text-muted-foreground">Primary language</label>
              <select className="w-full h-9 border rounded px-2 text-sm bg-background"
                value={form.primary_language}
                onChange={(e) => setForm({ ...form, primary_language: e.target.value })}>
                <option value="">— Select —</option>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-muted-foreground">Secondary language</label>
              <select className="w-full h-9 border rounded px-2 text-sm bg-background"
                value={form.secondary_language}
                onChange={(e) => setForm({ ...form, secondary_language: e.target.value })}>
                <option value="">— Select —</option>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-muted-foreground">Team Leader</label>
              <select className="w-full h-9 border rounded px-2 text-sm bg-background"
                value={form.team_leader_id}
                onChange={(e) => setForm({ ...form, team_leader_id: e.target.value })}>
                <option value="">— Unassigned —</option>
                {tls.map((tl) => <option key={tl.id} value={tl.id}>{tl.full_name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs uppercase text-muted-foreground">Password (optional)</label>
              <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Test@12345" />
            </div>
            <div className="md:col-span-4 flex justify-end">
              <Button
                disabled={!form.email || !form.full_name || createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? "Creating…" : "Create Executive"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardHeader><CardTitle className="text-base">Executives ({(execs as any[]).length})</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Executive</th>
                <th className="p-2">Email</th>
                <th className="p-2">Language</th>
                <th className="p-2">Current TL</th>
                <th className="p-2 text-right">Leads</th>
                <th className="p-2 text-right">Conv %</th>
                <th className="p-2">Reassign TL</th>
              </tr>
            </thead>
            <tbody>
              {(execs as any[]).map((e) => {
                const sel = selected[e.id] ?? e.teamLeaderId ?? "";
                const changed = sel && sel !== e.teamLeaderId;
                const currLang = selectedLang[e.id] ?? langByExec[e.id] ?? "";
                const langChanged = currLang !== (langByExec[e.id] ?? "");
                const currSec = selectedSecLang[e.id] ?? secLangByExec[e.id] ?? "";
                const secChanged = currSec !== (secLangByExec[e.id] ?? "");
                return (
                  <tr key={e.id} className="border-b hover:bg-muted/40">
                    <td className="p-2 font-medium">{e.name}</td>
                    <td className="p-2 text-xs">{e.email}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-1 flex-wrap">
                        <select
                          className="text-xs border rounded px-1 py-1 bg-background"
                          value={currLang}
                          onChange={(ev) => setSelectedLang((s) => ({ ...s, [e.id]: ev.target.value }))}
                        >
                          <option value="">—</option>
                          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                        {langChanged && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={langMut.isPending}
                            onClick={() => langMut.mutate({ executiveId: e.id, primary_language: currLang || null })}
                          >
                            Save
                          </Button>
                        )}
                        <select
                          className="text-xs border rounded px-1 py-1 bg-background"
                          value={currSec}
                          onChange={(ev) => setSelectedSecLang((s) => ({ ...s, [e.id]: ev.target.value }))}
                        >
                          <option value="">— Secondary —</option>
                          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                        {secChanged && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={langMut.isPending}
                            onClick={() => langMut.mutate({ executiveId: e.id, secondary_language: currSec || null })}
                          >
                            Save
                          </Button>
                        )}
                      </div>
                    </td>
                    <td className="p-2 text-xs">{e.teamLeaderName}</td>
                    <td className="p-2 text-right">{e.leads}</td>
                    <td className="p-2 text-right">{e.conversion}%</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <select
                          className="text-xs border rounded px-1 py-1 bg-background"
                          value={sel}
                          onChange={(ev) => setSelected((s) => ({ ...s, [e.id]: ev.target.value }))}
                        >
                          <option value="">— Select TL —</option>
                          {tls.map((tl) => (
                            <option key={tl.id} value={tl.id}>{tl.full_name}</option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          disabled={!changed || reassignMut.isPending}
                          onClick={() => reassignMut.mutate({ executiveId: e.id, teamLeaderId: sel })}
                        >
                          Reassign
                        </Button>
                      </div>
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
