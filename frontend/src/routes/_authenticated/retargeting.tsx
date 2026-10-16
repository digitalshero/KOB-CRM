import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LeadLink } from "@/components/lead-ref";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";

export const Route = createFileRoute("/_authenticated/retargeting")({
  head: () => ({ meta: [{ title: "Retargeting — Shero KOB" }] }),
  component: RetargetingPage,
});

function RetargetingPage() {
  const [range, setRange] = useDateRange("this_month", "retargeting");
  const { data: raw = [] } = useQuery({ queryKey: ["rt-queue"], queryFn: () => apiClient.get<any[]>("/api/kob/retargeting-queue") });
  const data = React.useMemo(() => {
    const from = range.from.getTime();
    const to = range.to.getTime();
    return (raw as any[]).filter((r) => {
      if (!r.next_touch_at) return false;
      const t = new Date(r.next_touch_at).getTime();
      return t >= from && t <= to;
    });
  }, [raw, range]);
  const buckets = data.reduce<Record<string, any[]>>((acc, r) => { (acc[r.bucket] ||= []).push(r); return acc; }, {});

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Retargeting Queue</h1>
          <p className="text-sm text-muted-foreground">{data.length} leads scheduled for follow-up · filtered by next touch date</p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {["NO_RESPONSE", "LATER", "NO"].map((b) => (
          <Card key={b} className={`border-l-4 ${b === "NO_RESPONSE" ? "border-l-amber-500" : b === "LATER" ? "border-l-yellow-500" : "border-l-shero-danger"}`}>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{b.replace("_", " ")}</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-bold">{buckets[b]?.length ?? 0}</div><div className="text-xs text-muted-foreground">in queue</div></CardContent>
          </Card>
        ))}
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Total Retargeting</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {["NO_RESPONSE", "LATER", "NO"].reduce((sum, b) => sum + (buckets[b]?.length ?? 0), 0)}
            </div>
            <div className="text-xs text-muted-foreground">No Response + Later + No</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Upcoming Touches</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr><th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Bucket</th><th className="p-2">City</th><th className="p-2">Attempts</th><th className="p-2">Next Touch</th></tr>
            </thead>
            <tbody>
              {(data as any[]).slice(0, 100).map((r) => (
                <tr key={r.id} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-mono text-xs">{r.lead_id ? <LeadLink id={r.lead_id}>{r.code}</LeadLink> : r.code}</td>
                  <td className="p-2 font-medium">{r.lead_id ? <LeadLink id={r.lead_id} className="hover:underline">{r.full_name}</LeadLink> : r.full_name}</td>
                  <td className="p-2">{r.bucket}</td>
                  <td className="p-2">{r.city_name} · {r.state_name}</td>
                  <td className="p-2">{r.attempts_done}</td>
                  <td className="p-2">{new Date(r.next_touch_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
