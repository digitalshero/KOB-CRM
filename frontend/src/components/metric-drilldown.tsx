import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const METRICS: Array<[string, string]> = [
  ["TOTAL_LEADS", "Total Leads"],
  ["EOI_1", "EOI 1"],
  ["WEBINAR", "Webinar"],
  ["EOI_2", "EOI 2"],
  ["FORM_FILLED", "Form Filled"],
  ["FEE_PAID", "Fee Paid"],
  
  ["KTN_CS", "KTN CS"],
  ["KTN_LIVE", "KTN Live"],
];

export function MetricDrilldown({ from, to }: { from?: string; to?: string }) {
  const [metric, setMetric] = useState("TOTAL_LEADS");
  const { data, isLoading } = useQuery({
    queryKey: ["metric-drilldown", metric, from ?? "", to ?? ""],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("metric", metric);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      return apiClient.get<{
        byCity: Array<{ name: string; count: number }>;
        byLanguage: Array<{ name: string; count: number }>;
      }>(`/api/kob/metric-drilldown?${p.toString()}`);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Metric Drill-down — by City & Language</CardTitle>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="border rounded-md text-sm px-2 py-1 bg-background"
          >
            {METRICS.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
        ) : (
          <Tabs defaultValue="city">
            <TabsList>
              <TabsTrigger value="city">By City ({data.byCity.length})</TabsTrigger>
              <TabsTrigger value="language">By Language ({data.byLanguage.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="city" className="mt-4">
              <DrillView rows={data.byCity} color="#0891b2" xKey="City" />
            </TabsContent>
            <TabsContent value="language" className="mt-4">
              <DrillView rows={data.byLanguage} color="#16a34a" xKey="Language" />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function DrillView({ rows, color, xKey }: { rows: Array<{ name: string; count: number }>; color: string; xKey: string }) {
  if (!rows.length) return <div className="text-sm text-muted-foreground py-6 text-center">No data for this metric.</div>;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div style={{ height: 320 }}>
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis type="number" fontSize={11} />
            <YAxis dataKey="name" type="category" fontSize={11} width={100} />
            <Tooltip />
            <Bar dataKey="count" fill={color} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-auto max-h-80 border rounded-md">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase border-b bg-muted/40 sticky top-0">
            <tr>
              <th className="p-2 text-left">{xKey}</th>
              <th className="p-2 text-right">Count</th>
              <th className="p-2 text-right">Share</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const total = rows.reduce((s, r) => s + r.count, 0) || 1;
              return rows.map((r) => (
                <tr key={r.name} className="border-b hover:bg-muted/30">
                  <td className="p-2">{r.name}</td>
                  <td className="p-2 text-right font-medium">{r.count}</td>
                  <td className="p-2 text-right text-muted-foreground">{((r.count / total) * 100).toFixed(1)}%</td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
