import { createFileRoute } from "@tanstack/react-router";
import { LeadLink } from "@/components/lead-ref";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/tl/retargeting")({
  head: () => ({ meta: [{ title: "Retargeting Queue — Shero KOB" }] }),
  component: TLRetarget,
});

function TLRetarget() {
  const { data = [] } = useQuery({
    queryKey: ["tl-retarget"],
    queryFn: () => apiClient.get<any[]>("/api/kob/tl-retargeting"),
  });
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Retargeting Queue</h1>
      <Card><CardContent className="overflow-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
            <tr>
              <th className="p-2">Lead</th><th className="p-2">Code</th>
              <th className="p-2">Bucket</th><th className="p-2 text-right">Phase</th>
              <th className="p-2 text-right">Attempts</th><th className="p-2">Next Touch</th>
              <th className="p-2">Stage</th><th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data as any[]).length === 0 && (
              <tr><td className="p-4 text-center text-muted-foreground" colSpan={8}>No retargeting entries for your team.</td></tr>
            )}
            {(data as any[]).map((r) => (
              <tr key={r.id} className="border-b hover:bg-muted/40">
                <td className="p-2 font-medium">{r.lead_id ? <LeadLink id={r.lead_id} className="hover:underline">{r.lead?.full_name ?? "—"}</LeadLink> : (r.lead?.full_name ?? "—")}</td>
                <td className="p-2 font-mono text-xs">{r.lead_id ? <LeadLink id={r.lead_id}>{r.lead?.code}</LeadLink> : r.lead?.code}</td>
                <td className="p-2 text-xs">{r.bucket}</td>
                <td className="p-2 text-right">{r.phase}</td>
                <td className="p-2 text-right">{r.attempts_done}</td>
                <td className="p-2 text-xs">{r.next_touch_at ? new Date(r.next_touch_at).toLocaleString() : "—"}</td>
                <td className="p-2 text-xs">{r.lead?.stage}</td>
                <td className="p-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${r.is_dead ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                    {r.is_dead ? "Dead" : "Active"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
