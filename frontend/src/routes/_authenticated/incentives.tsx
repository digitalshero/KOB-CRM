import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScvMonthSelect, currentScvMonth } from "@/components/ScvMonthSelect";

export const Route = createFileRoute("/_authenticated/incentives")({
  head: () => ({ meta: [{ title: "Incentives — Shero KOB" }] }),
  component: IncentivesPage,
});

function IncentivesPage() {
  const [month, setMonth] = useState(currentScvMonth());
  const { data: lbData } = useQuery({
    queryKey: ["scv-lb", month],
    queryFn: () => apiClient.get<any>(`/api/kob/scv-leaderboard?month=${encodeURIComponent(month)}`),
  });
  const lb = lbData?.rows ?? [];
  const months = lbData?.months ?? [month];
  const { data: slabs = [] } = useQuery({
    queryKey: ["incentive-rules"],
    queryFn: () => apiClient.get<any[]>("/api/kob/get-incentive-rules"),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Incentives & SCV</h1>
          <p className="text-sm text-muted-foreground">
            Sales Composite Value (Conversion 35 · TAT 25 · EOI2→Payment 15 · CRM Discipline 25). Slabs configurable in CEO → SCV Rules.
          </p>
        </div>
        <ScvMonthSelect months={months} value={month} onChange={setMonth} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(slabs as any[]).map((s) => (
          <Card key={s.id} className="border-l-4 border-l-purple-500">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-2xl font-bold">{s.incentive_pct}%</div>
              <div className="text-xs text-muted-foreground">Score {s.min_score}–{s.max_score}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">SCV Leaderboard (live)</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Rank</th>
                <th className="p-2">Executive</th>
                <th className="p-2 text-right">Leads</th>
                <th className="p-2 text-right">SCV</th>
                <th className="p-2 text-right">Fee Paid</th>
                <th className="p-2 text-right">KTN Live</th>
              </tr>
            </thead>
            <tbody>
              {(lb as any[]).map((r, i) => (
                <tr key={r.user_id} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-bold">#{i + 1}</td>
                  <td className="p-2 font-medium">{r.full_name}</td>
                  <td className="p-2 text-right">{r.lead_count}</td>
                  <td className="p-2 text-right">{r.avg_scv}</td>
                  <td className="p-2 text-right">{r.fee_paid}</td>
                  <td className="p-2 text-right text-green-600">{r.conversions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
