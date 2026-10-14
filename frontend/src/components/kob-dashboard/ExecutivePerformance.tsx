import { DashboardCard } from "./DashboardCard";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { DateRangeValue } from "@/components/date-range-filter";

export function ExecutivePerformance({ range }: { range?: DateRangeValue }) {
  const rangeArg = range ? { from: range.from.toISOString(), to: range.to.toISOString() } : {};

  const { data = [] } = useQuery({
    queryKey: ["kob-exec-perf-live", rangeArg.from ?? "all", rangeArg.to ?? "all"],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<any[]>(`/api/dashboard/executive-performance-summary${q ? `?${q}` : ""}`);
    },
    staleTime: 0,
  });

  const rows = (data as any[]).map((e) => ({
    name: e.name,
    leads: e.leads ?? 0,
    contracts: e.contracts ?? 0,
    target: e.target ?? 0,
    conv: `${e.conversion ?? 0}%`,
    pending: e.pending ?? 0,
  }));

  return (
    <DashboardCard title="Executive Performance">
      <div className="-mx-1 min-w-0 overflow-x-auto px-1">
      <table className="w-full min-w-[340px] text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 text-left font-semibold">Executive</th>
            <th className="pb-2 text-right font-semibold">Leads</th>
            <th className="pb-2 text-right font-semibold">Contracts</th>
            <th className="pb-2 text-right font-semibold">Target</th>
            <th className="pb-2 text-right font-semibold">Conv %</th>
            <th className="pb-2 text-right font-semibold">Pending</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-muted-foreground">No executives found</td>
            </tr>
          )}
          {rows.map((e) => (
            <tr key={e.name} className="border-b border-border/40 last:border-0">
              <td className="py-2.5 font-medium">{e.name}</td>
              <td className="py-2.5 text-right tabular-nums">{e.leads}</td>
              <td className="py-2.5 text-right font-semibold tabular-nums">{e.contracts}</td>
              <td className="py-2.5 text-right tabular-nums text-muted-foreground">{e.target}</td>
              <td className="py-2.5 text-right font-semibold tabular-nums text-emerald-600">{e.conv}</td>
              <td className="py-2.5 text-right">
                <span className="inline-flex min-w-6 justify-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  {e.pending}
                </span>
              </td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="border-t border-border/60">
              <td className="py-2.5 font-semibold">Total</td>
              <td className="py-2.5 text-right font-semibold tabular-nums">
                {rows.reduce((s, e) => s + e.leads, 0)}
              </td>
              <td className="py-2.5 text-right font-semibold tabular-nums">
                {rows.reduce((s, e) => s + e.contracts, 0)}
              </td>
              <td />
              <td className="py-2.5 text-right font-semibold tabular-nums text-emerald-600">
                {(() => {
                  const tl = rows.reduce((s, e) => s + e.leads, 0);
                  const tc = rows.reduce((s, e) => s + e.contracts, 0);
                  return `${tl > 0 ? Math.round((tc / tl) * 10000) / 100 : 0}%`;
                })()}
              </td>
              <td className="py-2.5 text-right font-semibold tabular-nums">
                {rows.reduce((s, e) => s + e.pending, 0)}
              </td>
            </tr>
          )}
        </tbody>

      </table>
      </div>
    </DashboardCard>
  );
}
