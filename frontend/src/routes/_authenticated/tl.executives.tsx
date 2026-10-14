import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, RadarChart,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#0ea5e9", "#a855f7", "#14b8a6", "#eab308"];

export const Route = createFileRoute("/_authenticated/tl/executives")({
  head: () => ({ meta: [{ title: "My Team Executives — Shero KOB" }] }),
  component: TLExecutives,
});

const LANGUAGES = ["TAMIL","TELUGU","MALAYALAM","HINDI","BENGALI","ENGLISH","KANNADA","MARATHI","GUJARATI","OTHERS"];

function TLExecutives() {
  const qc = useQueryClient();

  const { data: execs = [] } = useQuery({
    queryKey: ["tl-execs-roster"],
    queryFn: () => apiClient.get<any[]>("/api/kob/executives-with-stats"),
  });
  const { data: allocs = [] } = useQuery({
    queryKey: ["allocatable-execs"],
    queryFn: () => apiClient.get<any[]>("/api/kob/allocatable-executives"),
  });
  const langByExec = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const e of allocs as any[]) m[e.id] = e.primary_language ?? null;
    return m;
  }, [allocs]);
  const secByExec = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const e of allocs as any[]) m[e.id] = e.secondary_language ?? null;
    return m;
  }, [allocs]);

  const [selectedLang, setSelectedLang] = useState<Record<string, string>>({});
  const [selectedSec, setSelectedSec] = useState<Record<string, string>>({});
  const langMut = useMutation({
    mutationFn: (v: { executiveId: string; primary_language?: string | null; secondary_language?: string | null }) =>
      apiClient.patch(`/api/kob/executives/${v.executiveId}/language`, v),
    onSuccess: () => {
      toast.success("Language updated");
      qc.invalidateQueries({ queryKey: ["allocatable-execs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  const [form, setForm] = useState({ email: "", full_name: "", primary_language: "", secondary_language: "", password: "" });
  const createMut = useMutation({
    mutationFn: () => apiClient.post("/api/kob/executives", {
      email: form.email,
      full_name: form.full_name,
      primary_language: form.primary_language || null,
      secondary_language: form.secondary_language || null,
      password: form.password || undefined,
    }),
    onSuccess: () => {
      toast.success("Executive created and added to your team");
      setForm({ email: "", full_name: "", primary_language: "", secondary_language: "", password: "" });
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "Create failed"),
  });


  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">My Team Executives</h1>
      <p className="text-sm text-muted-foreground">Add executives to your team and set their primary language for language-based auto-assignment.</p>

      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardHeader><CardTitle className="text-base">Add Executive to My Team</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-7 items-end">
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
              <label className="text-xs uppercase text-muted-foreground">Password (optional)</label>
              <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Test@12345" />
            </div>
            <div className="md:col-span-7 flex justify-end">
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
        <CardHeader><CardTitle className="text-base">My Executives ({(execs as any[]).length})</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Executive</th>
                <th className="p-2">Email</th>
                <th className="p-2">Language</th>
                <th className="p-2 text-right">Leads</th>
                <th className="p-2 text-right">EOI 1</th>
                <th className="p-2 text-right">Webinar</th>
                <th className="p-2 text-right">EOI 2</th>
                <th className="p-2 text-right">KTN Live</th>
                <th className="p-2 text-right">Conv %</th>
              </tr>
            </thead>
            <tbody>
              {(execs as any[]).map((e) => {
                const currLang = selectedLang[e.id] ?? langByExec[e.id] ?? "";
                const langChanged = currLang !== (langByExec[e.id] ?? "");
                const currSec = selectedSec[e.id] ?? secByExec[e.id] ?? "";
                const secChanged = currSec !== (secByExec[e.id] ?? "");
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
                          <option value="">— Primary —</option>
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
                          onChange={(ev) => setSelectedSec((s) => ({ ...s, [e.id]: ev.target.value }))}
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

                    <td className="p-2 text-right">{e.leads}</td>
                    <td className="p-2 text-right">{e.eoi1}</td>
                    <td className="p-2 text-right">{e.webinar}</td>
                    <td className="p-2 text-right">{e.eoi2}</td>
                    <td className="p-2 text-right">{e.ktnLive}</td>
                    <td className="p-2 text-right">{e.conversion}%</td>
                  </tr>
                );
              })}
              {(execs as any[]).length === 0 && (
                <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No executives yet. Add one above.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <ExecPerformanceCharts execs={execs as any[]} />
    </div>
  );
}

function ExecPerformanceCharts({ execs }: { execs: any[] }) {
  if (!execs || execs.length === 0) return null;

  const funnelData = execs.map((e) => ({
    name: e.name,
    Leads: Number(e.leads) || 0,
    "EOI 1": Number(e.eoi1) || 0,
    Webinar: Number(e.webinar) || 0,
    "EOI 2": Number(e.eoi2) || 0,
    "KTN Live": Number(e.ktnLive) || 0,
  }));

  const shareData = execs
    .map((e) => ({ name: e.name, value: Number(e.leads) || 0 }))
    .filter((d) => d.value > 0);

  const convData = execs.map((e) => ({
    name: e.name,
    "Conv %": Number(e.conversion) || 0,
  }));

  const ktnData = execs.map((e) => ({
    name: e.name,
    "KTN Live": Number(e.ktnLive) || 0,
  }));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold pt-2">Individual Performance Visualisation</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Funnel by Executive</CardTitle></CardHeader>
          <CardContent style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Leads" fill={COLORS[0]} />
                <Bar dataKey="EOI 1" fill={COLORS[1]} />
                <Bar dataKey="Webinar" fill={COLORS[2]} />
                <Bar dataKey="EOI 2" fill={COLORS[3]} />
                <Bar dataKey="KTN Live" fill={COLORS[4]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Leads Share by Executive</CardTitle></CardHeader>
          <CardContent style={{ height: 320 }}>
            {shareData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No leads yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={shareData} dataKey="value" nameKey="name" outerRadius={110} label={(d: any) => `${d.name} (${d.value})`}>
                    {shareData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Conversion % by Executive</CardTitle></CardHeader>
          <CardContent style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={convData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip />
                <Line type="monotone" dataKey="Conv %" stroke={COLORS[5]} strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">KTN Live by Executive</CardTitle></CardHeader>
          <CardContent style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ktnData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="KTN Live" fill={COLORS[6]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {execs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Performance Radar (per Executive)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {execs.map((e, idx) => {
                const max = Math.max(1, Number(e.leads) || 0);
                const data = [
                  { axis: "Leads", value: Number(e.leads) || 0 },
                  { axis: "EOI 1", value: Number(e.eoi1) || 0 },
                  { axis: "Webinar", value: Number(e.webinar) || 0 },
                  { axis: "EOI 2", value: Number(e.eoi2) || 0 },
                  { axis: "KTN Live", value: Number(e.ktnLive) || 0 },
                ];
                return (
                  <div key={e.id} style={{ height: 240 }}>
                    <div className="text-xs font-medium mb-1">{e.name} — Conv {e.conversion}%</div>
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={data}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10 }} />
                        <PolarRadiusAxis tick={{ fontSize: 9 }} domain={[0, max]} />
                        <Radar dataKey="value" stroke={COLORS[idx % COLORS.length]} fill={COLORS[idx % COLORS.length]} fillOpacity={0.35} />
                        <Tooltip />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
