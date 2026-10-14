import { DashboardCard } from "./DashboardCard";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import type { DateRangeValue } from "@/components/date-range-filter";
import { Settings2 } from "lucide-react";

export function BrandPerformanceCard({ range }: { range?: DateRangeValue }) {
  const rangeArg = range ? { from: range.from.toISOString(), to: range.to.toISOString() } : {};
  const { data = [], isLoading } = useQuery({
    queryKey: ["kob-brand-perf", rangeArg.from ?? "all", rangeArg.to ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams();
      if (rangeArg.from) params.set("from", rangeArg.from);
      if (rangeArg.to) params.set("to", rangeArg.to);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return apiClient.get<any[]>(`/api/dashboard/brand-performance${qs}`);
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  return (
    <DashboardCard title="Brand Performance">
      <div className="-mx-1 min-w-0 overflow-x-auto px-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground border-b">
              <th className="py-1.5 pr-2 font-medium">Brand</th>
              <th className="py-1.5 pr-2 font-medium text-right">Contracts</th>
              <th className="py-1.5 pr-2 font-medium text-right">Conv %</th>
              <th className="py-1.5 pr-2 font-medium text-right">Target</th>
              <th className="py-1.5 font-medium text-right">Pending</th>
            </tr>
          </thead>
          <tbody>
            {(data as any[]).map((b) => (
              <tr key={b.code} className="border-b last:border-0 hover:bg-muted/40">
                <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{b.brand}</td>
                <td className="py-1.5 pr-2 text-right">{b.contracts}</td>
                <td className="py-1.5 pr-2 text-right">{b.conv}%</td>
                <td className="py-1.5 pr-2 text-right text-muted-foreground">—</td>
                <td className="py-1.5 text-right">{b.pending}</td>
              </tr>
            ))}
            {!isLoading && (data as any[]).length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  No active brands.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  );
}
