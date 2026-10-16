import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/tl/tat-breach")({
  head: () => ({ meta: [{ title: "TAT Breach — Shero KOB" }] }),
  component: TATBreach,
});

const SECTIONS: Array<[string, string]> = [
  ["LEAD_INBOX->EOI_1", "Lead → First Contact (EOI 1)"],
  ["EOI_1->WEBINAR", "EOI 1 → Webinar"],
  ["WEBINAR->EOI_2", "Webinar → EOI 2"],
  ["EOI_2->FEE_PAID", "EOI 2 → Fee Paid"],
  ["FEE_PAID->KTN_CS", "Fee Paid → KTN CS"],
  ["KTN_CS->KTN_LIVE", "KTN CS → KTN Live"],
];

function TransitionTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <div className="p-4 text-xs text-muted-foreground">No breaches in this window.</div>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
        <tr>
          <th className="p-2">Code</th><th className="p-2">Lead</th><th className="p-2">Executive</th>
          <th className="p-2 text-right">SLA (h)</th><th className="p-2 text-right">Actual (h)</th>
          <th className="p-2 text-right">Over (h)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b">
            <td className="p-2 font-mono text-xs">{r.lead}</td>
            <td className="p-2">{r.name}</td>
            <td className="p-2">{r.exec_name ?? "—"}</td>
            <td className="p-2 text-right">{r.slaHours}</td>
            <td className="p-2 text-right">{r.elapsedHours}</td>
            <td className="p-2 text-right text-red-600 font-medium">+{r.breach}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TATBreach() {
  const { data } = useQuery({ queryKey: ["tat-detail"], queryFn: () => apiClient.get<any>("/api/kob/tat-breach-detailed") });
  const [filter, setFilter] = useState("");

  const { first, trans, retarget, totalBreaches } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const match = (r: any) => !q || (r.name ?? "").toLowerCase().includes(q) || (r.exec_name ?? "").toLowerCase().includes(q);
    const first = (data?.first ?? []).filter(match);
    const transRaw: Record<string, any[]> = data?.transitions ?? {};
    const trans: Record<string, any[]> = {};
    for (const k of Object.keys(transRaw)) trans[k] = transRaw[k].filter(match);
    const retarget = (data?.retargeting ?? []).filter(match);
    const totalBreaches = first.length + Object.values(trans).reduce((s, arr) => s + arr.length, 0) + retarget.length;
    return { first, trans, retarget, totalBreaches };
  }, [data, filter]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">TAT Breach</h1>
        <p className="text-sm text-muted-foreground">{totalBreaches} SLA breaches across pipeline transitions.</p>
      </div>

      <Input
        placeholder="Filter by lead or executive name…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-sm"
      />

      <Card className="border-l-4 border-l-red-500 shadow-sm">
        <CardHeader><CardTitle className="text-base">{SECTIONS[0][1]} ({first.length})</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          {first.length === 0 ? <div className="p-4 text-xs text-muted-foreground">No first-contact breaches.</div> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
                <tr><th className="p-2">Code</th><th className="p-2">Lead</th><th className="p-2">Executive</th><th className="p-2 text-right">Elapsed (h)</th><th className="p-2">Status</th></tr>
              </thead>
              <tbody>
                {first.map((r: any, i: number) => (
                  <tr key={i} className="border-b">
                    <td className="p-2 font-mono text-xs">{r.lead}</td>
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.exec_name ?? "—"}</td>
                    <td className="p-2 text-right text-red-600 font-medium">{r.elapsedHours}</td>
                    <td className="p-2 text-xs">{r.contacted ? "Late contact" : "Never contacted"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {SECTIONS.slice(1).map(([key, label]) => (
        <Card key={key} className="border-l-4 border-l-amber-500 shadow-sm">
          <CardHeader><CardTitle className="text-base">{label} ({(trans[key] ?? []).length})</CardTitle></CardHeader>
          <CardContent className="overflow-auto p-0"><TransitionTable rows={trans[key] ?? []} /></CardContent>
        </Card>
      ))}

      <Card className="border-l-4 border-l-amber-500 shadow-sm">
        <CardHeader><CardTitle className="text-base">Retargeting Due Delay ({retarget.length})</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          {retarget.length === 0 ? <div className="p-4 text-xs text-muted-foreground">No overdue retargeting touches.</div> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
                <tr><th className="p-2">Code</th><th className="p-2">Lead</th><th className="p-2">Executive</th><th className="p-2">Bucket</th><th className="p-2 text-right">Attempts</th><th className="p-2 text-right">Overdue (h)</th></tr>
              </thead>
              <tbody>
                {retarget.map((r: any, i: number) => (
                  <tr key={i} className="border-b">
                    <td className="p-2 font-mono text-xs">{r.lead}</td>
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.exec_name ?? "—"}</td>
                    <td className="p-2 text-xs">{r.bucket}</td>
                    <td className="p-2 text-right">{r.attempts}</td>
                    <td className="p-2 text-right text-red-600 font-medium">{r.overdueHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
