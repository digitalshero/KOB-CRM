import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mgr/reports")({
  head: () => ({ meta: [{ title: "Reports — Shero KOB" }] }),
  component: MgrReports,
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

function MgrReports() {
  const [range, setRange] = useDateRange("yesterday");
  const rk = [range.preset, range.from.toISOString(), range.to.toISOString()];
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };
  const p = new URLSearchParams();
  if (rangeArg.from) p.set("from", rangeArg.from);
  if (rangeArg.to) p.set("to", rangeArg.to);
  const q = p.toString();
  const qStr = q ? `?${q}` : "";

  const { data: kpis } = useQuery({ queryKey: ["kpis", ...rk], queryFn: () => apiClient.get<any>(`/api/kob/get-dashboard-kpis${qStr}`) });
  const { data: fSrc = [] } = useQuery({ queryKey: ["funnel-src", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/get-funnel-by-source${qStr}`) });
  const { data: fLang = [] } = useQuery({ queryKey: ["funnel-lang", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/get-funnel-by-language${qStr}`) });
  const { data: fBrand = [] } = useQuery({ queryKey: ["funnel-brand", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/get-funnel-by-brand${qStr}`) });
  const { data: states = [] } = useQuery({ queryKey: ["states-summary", ...rk], queryFn: () => apiClient.get<any[]>(`/api/kob/get-state-summary${qStr}`) });
  const { data: leads = [] } = useQuery({
    queryKey: ["mgr-leads-csv", ...rk],
    queryFn: () => apiClient.get<any[]>("/api/kob/leads?limit=1000"),
  });

  const reports = [
    { name: "kpis", label: "Dashboard KPIs", data: kpis ? [kpis] : [] },
    { name: "funnel-source", label: "Funnel by Source", data: fSrc as any[] },
    { name: "funnel-language", label: "Funnel by Language", data: fLang as any[] },
    { name: "funnel-brand", label: "Funnel by Brand", data: fBrand as any[] },
    { name: "state-summary", label: "State Performance", data: states as any[] },
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
          <p className="text-sm text-muted-foreground">Download organisational datasets as CSV.</p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
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
