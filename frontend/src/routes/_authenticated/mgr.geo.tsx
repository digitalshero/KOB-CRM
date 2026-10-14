import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/mgr/geo")({
  head: () => ({ meta: [{ title: "Language / Geo — Shero KOB" }] }),
  component: MgrGeo,
});

function MgrGeo() {
  const { data: langs = [] } = useQuery({
    queryKey: ["mgr-langs"],
    queryFn: () => apiClient.get<any[]>("/api/kob/get-funnel-by-language"),
  });
  const { data: states = [] } = useQuery({
    queryKey: ["mgr-states"],
    queryFn: () => apiClient.get<any[]>("/api/kob/get-state-summary"),
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Language / Geo</h1>
      <Card className="border-l-4 border-l-purple-500 shadow-sm">
        <CardHeader><CardTitle className="text-base">By Language</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr><th className="p-2">Language</th><th className="p-2 text-right">Leads</th><th className="p-2 text-right">Fee Paid</th><th className="p-2 text-right">KTN Live</th></tr>
            </thead>
            <tbody>
              {(langs as any[]).map((l) => (
                <tr key={l.language} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-medium">{l.language}</td>
                  <td className="p-2 text-right">{l.total_leads}</td>
                  <td className="p-2 text-right">{l.fee_paid}</td>
                  <td className="p-2 text-right text-green-700 font-medium">{l.ktn_live}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card className="border-l-4 border-l-cyan-500 shadow-sm">
        <CardHeader><CardTitle className="text-base">By State</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr><th className="p-2">State</th><th className="p-2 text-right">Leads</th><th className="p-2 text-right">Fee Paid</th><th className="p-2 text-right">KTN Live</th><th className="p-2 text-right">Kitchen Scope</th></tr>
            </thead>
            <tbody>
              {(states as any[]).map((s) => (
                <tr key={s.id} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-medium">{s.name} <span className="text-xs text-muted-foreground">({s.code})</span></td>
                  <td className="p-2 text-right">{s.leads}</td>
                  <td className="p-2 text-right">{s.fee_paid}</td>
                  <td className="p-2 text-right text-green-700">{s.ktn_live}</td>
                  <td className="p-2 text-right">{s.scope.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
