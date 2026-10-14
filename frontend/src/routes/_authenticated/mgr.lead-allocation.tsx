import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/mgr/lead-allocation")({
  head: () => ({ meta: [{ title: "Lead Allocation — Shero KOB" }] }),
  component: MgrLeadAllocation,
});

function Stat({ label, value, tone = "" }: { label: string; value: any; tone?: string }) {
  return (
    <Card className="border-l-4 border-l-primary shadow-sm"><CardContent className="p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div>
    </CardContent></Card>
  );
}

type TLAllocationRow = {
  id: string;
  name: string;
  teamSize: number;
  received: number;
  allocated: number;
  unallocated: number;
};

type AllocationBreakdownResult = {
  rows: TLAllocationRow[];
  orgUnassignedToTL: number;
  orgUnallocatedWithinTeam: number;
};

function MgrLeadAllocation() {
  const { data } = useQuery({
    queryKey: ["mgr-alloc-breakdown"],
    queryFn: () => apiClient.get<AllocationBreakdownResult>("/api/kob/allocation-breakdown-by-tl"),
  });
  const rows = data?.rows ?? [];
  const totalReceived = rows.reduce((s, r) => s + r.received, 0);
  const totalAllocated = rows.reduce((s, r) => s + r.allocated, 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Lead Allocation</h1>
        <p className="text-sm text-muted-foreground">Org-wide monitoring. TLs distribute leads to executives — this view is read-only.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Unassigned to Any TL" value={data?.orgUnassignedToTL ?? "…"} tone="text-red-600" />
        <Stat label="With TL, Not Yet Distributed" value={data?.orgUnallocatedWithinTeam ?? "…"} tone="text-amber-600" />
        <Stat label="Total With Executives" value={totalAllocated} tone="text-green-600" />
        <Stat label="Total In Teams" value={totalReceived} />
      </div>

      <Card className="border-l-4 border-l-blue-500 shadow-sm">
        <CardHeader><CardTitle className="text-base">Per Team Leader ({rows.length})</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Team Leader</th>
                <th className="p-2 text-right">Team Size</th>
                <th className="p-2 text-right">Received</th>
                <th className="p-2 text-right">Allocated</th>
                <th className="p-2 text-right">Unallocated</th>
                <th className="p-2 text-right">Distribution %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.received > 0 ? Math.round((r.allocated / r.received) * 100) : 0;
                return (
                  <tr key={r.id} className="border-b hover:bg-muted/40">
                    <td className="p-2 font-medium">{r.name}</td>
                    <td className="p-2 text-right">{r.teamSize}</td>
                    <td className="p-2 text-right">{r.received}</td>
                    <td className="p-2 text-right text-green-700">{r.allocated}</td>
                    <td className="p-2 text-right text-amber-700">{r.unallocated}</td>
                    <td className="p-2 text-right">{pct}%</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No team leaders found.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
