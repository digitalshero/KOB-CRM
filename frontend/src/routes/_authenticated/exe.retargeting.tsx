import { createFileRoute } from "@tanstack/react-router";
import { LeadLink } from "@/components/lead-ref";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/exe/retargeting")({
  head: () => ({ meta: [{ title: "Retargeting Queue — Shero KOB" }] }),
  component: ExeRetargeting,
});

function ExeRetargeting() {
  const { data = [] } = useQuery({
    queryKey: ["exe-retargeting-queue"],
    queryFn: () => apiClient.get<any[]>("/api/kob/my-retargeting-queue"),
  });
  const rows = data as any[];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">My Retargeting Queue</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} active recovery {rows.length === 1 ? "lead" : "leads"} · sorted by next touch. System-managed by the retargeting engine.
        </p>
      </div>
      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardContent className="overflow-auto p-0">
          {rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No active retargeting leads.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
                <tr>
                  <th className="p-2">Code</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Bucket</th>
                  <th className="p-2">Next Touch</th>
                  <th className="p-2 text-right">Attempts</th>
                  <th className="p-2 text-right">Phase</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const nt = r.next_touch_at ? new Date(r.next_touch_at) : null;
                  const overdue = nt ? nt < today : false;
                  return (
                    <tr key={r.id} className="border-b hover:bg-muted/40">
                      <td className="p-2 font-mono text-xs">{r.lead_id ? <LeadLink id={r.lead_id}>{r.lead?.code}</LeadLink> : r.lead?.code}</td>
                      <td className="p-2 font-medium">{r.lead_id ? <LeadLink id={r.lead_id} className="hover:underline">{r.lead?.full_name}</LeadLink> : r.lead?.full_name}</td>
                      <td className="p-2 text-xs">{r.bucket}</td>
                      <td className={`p-2 text-xs ${overdue ? "text-red-600 font-semibold" : ""}`}>
                        {nt ? nt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"}
                        {overdue ? " (overdue)" : ""}
                      </td>
                      <td className="p-2 text-right">{r.attempts_done}</td>
                      <td className="p-2 text-right">{r.phase}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
