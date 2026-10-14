import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/tl/my-team")({
  head: () => ({ meta: [{ title: "My Team — Shero KOB" }] }),
  component: MyTeam,
});

function MyTeam() {
  const { data = [] } = useQuery({
    queryKey: ["tl-execs"],
    queryFn: () => apiClient.get<any[]>("/api/kob/tl-executive-performance"),
  });
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">My Team</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data as any[]).map((e) => (
          <Card key={e.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{e.name}</CardTitle>
              <div className="text-xs text-muted-foreground">{e.email} · {e.language}</div>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="flex justify-between"><span>Assigned Leads</span><span className="font-medium">{e.leads}</span></div>
              <div className="flex justify-between"><span>KTN Live</span><span className="text-green-700 font-medium">{e.ktnLive}</span></div>
              <div className="flex justify-between"><span>KTN Live %</span><span>{e.conversion}%</span></div>
              <div className="flex justify-between"><span>SCV Score</span><span>{e.scv}</span></div>
              <div className="flex justify-between"><span>TAT Compliance</span><span>{e.tat}%</span></div>
              <div className="pt-2 border-t mt-2 flex justify-between items-center">
                <span className={`text-xs px-2 py-0.5 rounded ${e.incentive === "Eligible" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>{e.incentive}</span>
                <Link to="/tl/executive-performance" className="text-xs text-primary hover:underline">View details →</Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
