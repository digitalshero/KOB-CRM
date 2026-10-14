import { createFileRoute } from "@tanstack/react-router";
import { LeadLink } from "@/components/lead-ref";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/mgr/ktn")({
  head: () => ({ meta: [{ title: "KTN & Activation — Shero KOB" }] }),
  component: KTN,
});

function KTN() {
  const { data = [] } = useQuery({
    queryKey: ["mgr-ktn"],
    queryFn: () => apiClient.get<any[]>("/api/kob/leads?limit=1000"),
  });
  const cs = (data as any[]).filter((l) => l.stage === "KTN_CS");
  const live = (data as any[]).filter((l) => l.stage === "KTN_LIVE");

  const Block = ({ title, rows, tone }: { title: string; rows: any[]; tone: string }) => (
    <Card className={`border-l-4 ${tone} shadow-sm`}>
      <CardHeader><CardTitle className="text-base">{title} ({rows.length})</CardTitle></CardHeader>
      <CardContent className="overflow-auto p-0">
        {rows.length === 0 ? <div className="p-4 text-xs text-muted-foreground">Nothing here yet.</div> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr><th className="p-2">Code</th><th className="p-2">Lead</th><th className="p-2">Brand</th><th className="p-2">City</th><th className="p-2">Language</th></tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="p-2 font-mono text-xs"><LeadLink id={l.id}>{l.code}</LeadLink></td>
                  <td className="p-2 font-medium"><LeadLink id={l.id} className="hover:underline">{l.full_name}</LeadLink></td>
                  <td className="p-2">{l.brands?.name}</td>
                  <td className="p-2">{l.india_cities?.name}</td>
                  <td className="p-2 text-xs">{l.language}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">KTN & Activation</h1>
      <Block title="KTN CS — Kitchen setup in progress" rows={cs} tone="border-l-teal-500" />
      <Block title="KTN Live — Kitchens activated" rows={live} tone="border-l-green-500" />
    </div>
  );
}
