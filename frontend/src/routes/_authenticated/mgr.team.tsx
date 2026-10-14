import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/mgr/team")({
  head: () => ({ meta: [{ title: "Team Performance — Shero KOB" }] }),
  component: MgrTeam,
});

function MgrTeam() {
  const { data: profiles = [] } = useQuery({ queryKey: ["mgr-profiles"], queryFn: () => apiClient.get<any[]>("/api/kob/list-all-profiles") });
  const { data: leads = [] } = useQuery({
    queryKey: ["mgr-leads"],
    queryFn: () => apiClient.get<any[]>("/api/kob/leads?limit=1000"),
  });

  const tls = (profiles as any[]).filter((p) => p.roles?.includes("team_leader"));
  const perTL = tls.map((tl) => {
    const team = (profiles as any[]).filter((p) => p.team_leader_id === tl.id);
    const teamIds = new Set(team.map((t) => t.id));
    const teamLeads = (leads as any[]).filter((l) => teamIds.has(l.assigned_to));
    const c = (s: string) => teamLeads.filter((l) => l.stage === s).length;
    return {
      id: tl.id, name: tl.full_name, size: team.length,
      leads: teamLeads.length,
      feePaid: c("FEE_PAID"), agreement: c("AGREEMENT_SIGNED"),
      ktnCs: c("KTN_CS"), ktnLive: c("KTN_LIVE"),
    };
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Team Performance</h1>
      <Card className="border-l-4 border-l-blue-500 shadow-sm">
        <CardHeader><CardTitle className="text-base">Team Leaders</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Team Leader</th><th className="p-2 text-right">Team Size</th>
                <th className="p-2 text-right">Leads</th><th className="p-2 text-right">Fee Paid</th>
                <th className="p-2 text-right">Agreement</th><th className="p-2 text-right">KTN CS</th>
                <th className="p-2 text-right">KTN Live</th>
              </tr>
            </thead>
            <tbody>
              {perTL.map((t) => (
                <tr key={t.id} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-medium">{t.name}</td>
                  <td className="p-2 text-right">{t.size}</td>
                  <td className="p-2 text-right">{t.leads}</td>
                  <td className="p-2 text-right">{t.feePaid}</td>
                  <td className="p-2 text-right">{t.agreement}</td>
                  <td className="p-2 text-right">{t.ktnCs}</td>
                  <td className="p-2 text-right text-green-700 font-medium">{t.ktnLive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
