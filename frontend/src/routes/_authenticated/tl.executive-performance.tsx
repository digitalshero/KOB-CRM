import { createFileRoute } from "@tanstack/react-router";
import { LeadLink } from "@/components/lead-ref";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/tl/executive-performance")({
  head: () => ({ meta: [{ title: "Executive Performance — Shero KOB" }] }),
  component: ExecPerf,
});

function ExecPerf() {
  const { data = [] } = useQuery({
    queryKey: ["tl-execs"],
    queryFn: () => apiClient.get<any[]>("/api/kob/tl-executive-performance"),
  });
  const { data: leads = [] } = useQuery({
    queryKey: ["tl-leads-all"],
    queryFn: () => apiClient.get<any[]>("/api/kob/leads?limit=500"),
  });
  const [openExec, setOpenExec] = useState<string | null>(null);
  const detail = openExec ? (leads as any[]).filter((l) => l.assigned_to === openExec) : [];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Executive Performance</h1>
      <Card>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Executive</th><th className="p-2">Language</th>
                <th className="p-2 text-right">Leads</th>
                <th className="p-2 text-right">EOI 1</th><th className="p-2 text-right">Webinar</th><th className="p-2 text-right">EOI 2</th>
                <th className="p-2 text-right">Fee Paid</th><th className="p-2 text-right">Agreement</th>
                <th className="p-2 text-right">KTN CS</th><th className="p-2 text-right">KTN Live</th>
                <th className="p-2 text-right">KTN Live %</th><th className="p-2 text-right">TAT</th>
                <th className="p-2 text-right">SCV</th><th className="p-2">Incentive</th>
              </tr>
            </thead>
            <tbody>
              {(data as any[]).map((e) => (
                <tr key={e.id} className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => setOpenExec(openExec === e.id ? null : e.id)}>
                  <td className="p-2 font-medium text-primary">{e.name}</td>
                  <td className="p-2 text-xs">{e.language}</td>
                  <td className="p-2 text-right">{e.leads}</td>
                  <td className="p-2 text-right">{e.eoi1}</td><td className="p-2 text-right">{e.webinar}</td><td className="p-2 text-right">{e.eoi2}</td>
                  <td className="p-2 text-right">{e.feePaid}</td><td className="p-2 text-right">{e.agreement}</td>
                  <td className="p-2 text-right">{e.ktnCs}</td><td className="p-2 text-right text-green-700 font-medium">{e.ktnLive}</td>
                  <td className="p-2 text-right">{e.conversion}%</td>
                  <td className="p-2 text-right">{e.tat}%</td>
                  <td className="p-2 text-right">{e.scv}</td>
                  <td className="p-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${e.incentive === "Eligible" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>{e.incentive}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {openExec && (
        <Card>
          <CardHeader><CardTitle className="text-base">Executive Detail — {(data as any[]).find((e) => e.id === openExec)?.name}</CardTitle></CardHeader>
          <CardContent className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr><th className="p-2">Code</th><th className="p-2">Lead</th><th className="p-2">Stage</th><th className="p-2">Language</th><th className="p-2">Brand</th><th className="p-2">SCV</th></tr>
              </thead>
              <tbody>
                {detail.slice(0, 100).map((l: any) => (
                  <tr key={l.id} className="border-b">
                    <td className="p-2 font-mono text-xs"><LeadLink id={l.id}>{l.code}</LeadLink></td>
                    <td className="p-2"><LeadLink id={l.id} className="hover:underline">{l.full_name}</LeadLink></td>
                    <td className="p-2 text-xs">{l.stage}</td>
                    <td className="p-2 text-xs">{l.language}</td>
                    <td className="p-2 text-xs">{l.brands?.name ?? "—"}</td>
                    <td className="p-2 text-xs">{l.scv_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
