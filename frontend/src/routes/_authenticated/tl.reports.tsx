import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tl/reports")({
  beforeLoad: async () => {
    const r = await apiClient.get<any>("/api/kob/my-role");
    if (r?.role === "team_leader" || r?.role === "executive") {
      throw redirect({ to: "/tl/overview" });
    }
  },
  head: () => ({ meta: [{ title: "Reports — Shero KOB" }] }),
  component: TLReports,
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
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function TLReports() {
  const [range, setRange] = useDateRange("yesterday");
  const rk = [range.preset, range.from.toISOString(), range.to.toISOString()];
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };
  const qStr = `from=${encodeURIComponent(rangeArg.from)}&to=${encodeURIComponent(rangeArg.to)}`;
  const { data: ov } = useQuery({ queryKey: ["tl-overview", ...rk], queryFn: () => apiClient.get<any>(`/api/kob/tl-overview?${qStr}`) });
  const { data: execs = [] } = useQuery({ queryKey: ["tl-execs", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/tl-executive-performance?${qStr}`) });
  const { data: brands = [] } = useQuery({ queryKey: ["tl-brands", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/tl-brand-performance?${qStr}`) });
  const { data: langs = [] } = useQuery({ queryKey: ["tl-langs", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/tl-language-performance?${qStr}`) });
  const { data: leads = [] } = useQuery({ queryKey: ["tl-leads-all", ...rk], queryFn: () => apiClient.get<any[]>("/api/kob/leads?limit=500") });

  const reports = [
    { name: "team-overview", label: "Team Overview KPIs", data: ov ? [ov] : [] },
    { name: "executive-performance", label: "Executive Performance", data: execs as any[] },
    { name: "brand-performance", label: "Brand Performance", data: brands as any[] },
    { name: "language-performance", label: "Language Performance", data: langs as any[] },
    { name: "leads", label: "All Leads (flattened)", data: (leads as any[]).map((l) => ({
        code: l.code, name: l.full_name, phone: l.phone, stage: l.stage, mode: l.mode,
        language: l.language, brand: l.brands?.name, state: l.india_states?.name,
        source: l.lead_sources?.name, scv: l.scv_score, created_at: l.created_at,
      })) },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground">Export team-scope datasets as CSV.</p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reports.map((r) => (
          <Card key={r.name}>
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
