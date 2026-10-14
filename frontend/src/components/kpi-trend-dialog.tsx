import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function KpiTrendDialog({
  open, onOpenChange, metric, title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  metric: string;
  title: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["kpi-trend", metric],
    queryFn: () => apiClient.get<any>(`/api/kob/kpi-trend?metric=${encodeURIComponent(metric)}`),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title} — Trend</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading trend…</div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Last 6 Months</CardTitle></CardHeader>
              <CardContent style={{ height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={data.monthly}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="period" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="value" stroke="#0891b2" strokeWidth={2} name="Actual" dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="trend" stroke="#dc2626" strokeDasharray="5 5" strokeWidth={2} name="Trendline" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Last 24 Weeks</CardTitle></CardHeader>
              <CardContent style={{ height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={data.weekly}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="period" fontSize={10} angle={-30} textAnchor="end" height={60} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="value" stroke="#0891b2" strokeWidth={2} name="Actual" dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="trend" stroke="#dc2626" strokeDasharray="5 5" strokeWidth={2} name="Trendline" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
