import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ceo/geo-control")({
  head: () => ({ meta: [{ title: "State / District / City — Shero KOB" }] }),
  component: CeoGeoControl,
});

function CeoGeoControl() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({

    queryKey: ["states"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-states"),
  });
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">State / District / City</h1>
        <p className="text-sm text-muted-foreground">Enable or disable states for KOB operations. Disabling a state removes it from all routing.</p>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
            <tr><th className="p-2">Code</th><th className="p-2">State</th><th className="p-2">Region</th><th className="p-2 text-right">Active</th></tr>
          </thead>
          <tbody>
            {(data as any[]).map((s) => (
              <tr key={s.id} className="border-b">
                <td className="p-2 font-mono text-xs">{s.code}</td>
                <td className="p-2 font-medium">{s.name}</td>
                <td className="p-2">{s.region}</td>
                <td className="p-2 text-right">
                  <Switch checked={s.active} onCheckedChange={async (v) => {
                    await apiClient.patch(`/api/kob/entities/india_states/${s.id}/toggle`, { active: v });
                    qc.invalidateQueries(); toast.success(v ? "State enabled" : "State disabled");
                  }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
