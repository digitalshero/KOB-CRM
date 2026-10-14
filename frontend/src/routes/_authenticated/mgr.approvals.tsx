import { createFileRoute } from "@tanstack/react-router";
import { LeadLink } from "@/components/lead-ref";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/mgr/approvals")({
  head: () => ({ meta: [{ title: "Approvals — Shero KOB" }] }),
  component: Approvals,
});

function Approvals() {
  const { data = [] } = useQuery({
    queryKey: ["mgr-approvals"],
    queryFn: () => apiClient.get<any[]>("/api/kob/leads?limit=500"),
  });
  const feePaid = (data as any[]).filter((l) => l.stage === "FEE_PAID");
  const ktnCs = (data as any[]).filter((l) => l.stage === "KTN_CS");

  const Block = ({ title, rows, tone }: { title: string; rows: any[]; tone: string }) => (
    <Card className={`border-l-4 ${tone} shadow-sm`}>
      <CardHeader><CardTitle className="text-base">{title} ({rows.length})</CardTitle></CardHeader>
      <CardContent className="overflow-auto p-0">
        {rows.length === 0 ? <div className="p-4 text-xs text-muted-foreground">Nothing pending.</div> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr><th className="p-2">Code</th><th className="p-2">Lead</th><th className="p-2">Brand</th><th className="p-2">State</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="p-2 font-mono text-xs"><LeadLink id={l.id}>{l.code}</LeadLink></td>
                  <td className="p-2"><LeadLink id={l.id} className="hover:underline">{l.full_name}</LeadLink></td>
                  <td className="p-2">{l.brands?.name}</td>
                  <td className="p-2">{l.india_states?.name}</td>
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
      <h1 className="text-2xl font-bold">Approvals</h1>
      <p className="text-sm text-muted-foreground">Leads awaiting managerial sign-off at each milestone.</p>
      <Block title="Fee Paid — awaiting CS handover" rows={feePaid} tone="border-l-emerald-500" />
      <Block title="KTN CS — awaiting Go-Live" rows={ktnCs} tone="border-l-teal-500" />
    </div>
  );
}
