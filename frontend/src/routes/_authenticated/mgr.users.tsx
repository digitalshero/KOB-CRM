import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/mgr/users")({
  head: () => ({ meta: [{ title: "Users & Roles — Shero KOB" }] }),
  component: MgrUsers,
});

function MgrUsers() {
  const { data = [] } = useQuery({
    queryKey: ["mgr-users"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-all-profiles"),
  });
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Users & Roles</h1>
      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Phone</th><th className="p-2">Roles</th><th className="p-2">Team Leader</th></tr>
            </thead>
            <tbody>
              {(data as any[]).map((u) => (
                <tr key={u.id} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-medium">{u.full_name}</td>
                  <td className="p-2 text-xs">{u.email}</td>
                  <td className="p-2 text-xs">{u.phone ?? "—"}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {(u.roles ?? []).map((r: string) => (
                        <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{r}</span>
                      ))}
                    </div>
                  </td>
                  <td className="p-2 text-xs font-mono">{u.team_leader_id?.slice(0, 8) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Add/edit users via Configuration → Audit-logged elevation. Direct role management coming with the next admin API pass.</p>
    </div>
  );
}
