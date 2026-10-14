import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/mgr/audit")({
  head: () => ({ meta: [{ title: "Audit Logs — Shero KOB" }] }),
  component: MgrAudit,
});

function MgrAudit() {
  const { data = [] } = useQuery({
    queryKey: ["mgr-audit"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-audit-logs"),
  });
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Audit Logs</h1>
      <p className="text-sm text-muted-foreground">Every configuration change and lead action is recorded here.</p>
      <Card className="border-l-4 border-l-slate-500 shadow-sm">
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr><th className="p-2">When</th><th className="p-2">Actor</th><th className="p-2">Action</th><th className="p-2">Entity</th><th className="p-2">Meta</th></tr>
            </thead>
            <tbody>
              {(data as any[]).map((a) => (
                <tr key={a.id} className="border-b">
                  <td className="p-2 text-xs">{new Date(a.created_at).toLocaleString()}</td>
                  <td className="p-2 font-mono text-xs">{a.actor_id?.slice(0, 8)}</td>
                  <td className="p-2">{a.action}</td>
                  <td className="p-2">{a.entity}</td>
                  <td className="p-2 text-xs font-mono">{JSON.stringify(a.meta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
