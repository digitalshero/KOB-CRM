import { createFileRoute } from "@tanstack/react-router";
import { LeadLink } from "@/components/lead-ref";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadXlsx, unallocatedToRows } from "@/lib/export-xlsx";

export const Route = createFileRoute("/_authenticated/mgr/unallocated")({
  head: () => ({ meta: [{ title: "Unallocated Leads — Shero KOB" }] }),
  component: Unalloc,
});

function Unalloc() {
  const { data = [] } = useQuery({
    queryKey: ["mgr-unalloc"],
    queryFn: () => apiClient.get<any[]>("/api/kob/unallocated-leads"),
  });
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Unallocated Leads</h1>
        <button
          className="text-xs border px-3 py-1.5 rounded hover:bg-muted"
          disabled={(data as any[]).length === 0}
          onClick={() => downloadXlsx("unallocated-leads", unallocatedToRows(data as any[]), "Unallocated")}
        >
          Download Excel
        </button>
      </div>
      <p className="text-sm text-muted-foreground">{(data as any[]).length} leads without an assigned executive.</p>
      <Card className="border-l-4 border-l-red-500 shadow-sm">
        <CardHeader><CardTitle className="text-base">Queue</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          {(data as any[]).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">All leads are allocated.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
                <tr>
                  <th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Brand</th>
                  <th className="p-2">Language</th><th className="p-2">Mode</th>
                  <th className="p-2">State</th><th className="p-2">City</th><th className="p-2">Source</th><th className="p-2">Stage</th>
                </tr>
              </thead>
              <tbody>
                {(data as any[]).map((l) => (
                  <tr key={l.id} className="border-b hover:bg-muted/40">
                    <td className="p-2 font-mono text-xs"><LeadLink id={l.id}>{l.code}</LeadLink></td>
                    <td className="p-2 font-medium"><LeadLink id={l.id} className="hover:underline">{l.full_name}</LeadLink></td>
                    <td className="p-2">{l.brands?.name}</td>
                    <td className="p-2">{l.language}</td>
                    <td className="p-2 text-xs">{l.mode}</td>
                    <td className="p-2">{l.india_states?.name}</td>
                    <td className="p-2">{l.india_cities?.name}</td>
                    <td className="p-2">{l.lead_sources?.name}</td>
                    <td className="p-2 text-xs">{l.stage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
