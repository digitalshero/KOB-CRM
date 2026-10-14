import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/exe/reports")({
  beforeLoad: async () => {
    const r = await apiClient.get<any>("/api/kob/my-role");
    if (r?.role === "team_leader" || r?.role === "executive") {
      throw redirect({ to: "/exe/overview" });
    }
  },
  head: () => ({ meta: [{ title: "My Reports — Shero KOB" }] }),
  component: ExeReports,
});

function toCsv(rows: any[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}
function download(name: string, rows: any[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function ExeReports() {
  const { data: leadsRaw = [] } = useQuery({
    queryKey: ["exe-my-leads-csv"],
    queryFn: () => apiClient.get<any[]>("/api/kob/leads?limit=1000"),
  });
  const { data: histRaw = [] } = useQuery({
    queryKey: ["exe-my-stage-history"],
    queryFn: () => apiClient.get<any[]>("/api/kob/my-stage-history"),
  });

  const leads = leadsRaw as any[];
  const hist = histRaw as any[];

  const total = leads.length;
  const ktnLive = leads.filter((l) => l.stage === "KTN_LIVE").length;
  const convPct = total ? Math.round((ktnLive / total) * 1000) / 10 : 0;
  const avgScv = total
    ? Math.round((leads.reduce((s, l) => s + (l.scv_score ?? 0), 0) / total) * 10) / 10
    : 0;

  const leadsFlat = leads.map((l) => ({
    code: l.code, name: l.full_name, phone: l.phone, stage: l.stage, mode: l.mode,
    language: l.language, brand: l.brands?.name, state: l.india_states?.name,
    source: l.lead_sources?.name, scv: l.scv_score, created_at: l.created_at,
  }));

  const reports = [
    { name: "my-leads", label: "My Leads", data: leadsFlat },
    { name: "my-stage-history", label: "My Stage History", data: hist },
  ];

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">My Reports</h1>
        <p className="text-sm text-muted-foreground">Your personal activity — assigned leads only.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-primary shadow-sm">
          <CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">Total Leads</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{total}</CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary shadow-sm">
          <CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">KTN Live</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{ktnLive}</CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary shadow-sm">
          <CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">Conversion %</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{convPct}%</CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary shadow-sm">
          <CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">Avg SCV</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{avgScv}</CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reports.map((r) => (
          <Card key={r.name} className="border-l-4 border-l-primary shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-base">{r.label}</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">{r.data.length} rows</div>
              <button
                onClick={() => download(r.name, r.data)}
                disabled={!r.data.length}
                className="flex items-center gap-2 text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded disabled:opacity-50">
                <Download className="h-4 w-4" /> Download CSV
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
