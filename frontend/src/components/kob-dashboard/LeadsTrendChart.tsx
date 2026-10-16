import { useState } from "react";
import { TrendingUp } from "lucide-react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { DashboardCard } from "./DashboardCard";
import { apiClient } from "@/lib/api-client";
import type { DateRangeValue } from "@/components/date-range-filter";


const RANGES = ["7D", "20D", "30D", "60D", "90D"];

export function LeadsTrendChart({ range: dateRange }: { range: DateRangeValue }) {
  const [range, setRange] = useState("30D");
  // The chart always plots a multi-day window: the selected filter's end date
  // (a single-day filter has no trend to draw) back N days from the toggle.
  const days = Number(range.replace("D", ""));
  const end = new Date(dateRange.to ?? new Date());
  const start = new Date(end.getTime() - (days - 1) * 864e5);
  start.setHours(0, 0, 0, 0);
  const from = start.toISOString();
  const to = end.toISOString();

  const { data } = useQuery({
    queryKey: ["kob-leads-trend", from, to],
    queryFn: () =>
      apiClient.get<any[]>(
        `/api/dashboard/leads-trend?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  });
  const trend = data ?? [];

  return (
    <DashboardCard
      title={
        <span className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-shero-navy" />
          Leads &amp; Contracts Trend
        </span>
      }
      action={
        <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                range === r ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      }
    >
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              domain={[0, (max: number) => Math.max(60, Math.ceil(max / 15) * 15)]}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v) => `${v}%`}
              domain={[0, (max: number) => Math.max(20, Math.ceil(max / 5) * 5)]}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: "1px solid hsl(var(--border))",
                fontSize: 12,
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={24}
              iconType="circle"
              wrapperStyle={{ fontSize: 11 }}
            />
            <Line yAxisId="left" type="monotone" dataKey="leads" name="Leads" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            <Line yAxisId="left" type="monotone" dataKey="contracts" name="Contracts" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
            <Line yAxisId="right" type="monotone" dataKey="conv" name="Conv %" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  );
}
