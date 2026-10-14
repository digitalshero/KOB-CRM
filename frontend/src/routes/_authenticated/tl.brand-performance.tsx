import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";

const COLORS = ["#0891b2", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#6366f1"];


export const Route = createFileRoute("/_authenticated/tl/brand-performance")({
  head: () => ({ meta: [{ title: "Brand Performance — Shero KOB" }] }),
  component: BrandPerf,
});

function BrandPerf() {
  const { data = [] } = useQuery({
    queryKey: ["tl-brands"],
    queryFn: () => apiClient.get<any[]>("/api/kob/tl-brand-performance"),
  });
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Brand Performance (SHF)</h1>
      <Card><CardContent className="overflow-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
            <tr>
              <th className="p-2">Brand</th>
              <th className="p-2 text-right">Leads</th>
              <th className="p-2 text-right">EOI 1</th><th className="p-2 text-right">Webinar</th><th className="p-2 text-right">EOI 2</th>
              <th className="p-2 text-right">Fee Paid</th><th className="p-2 text-right">Agreement</th>
              <th className="p-2 text-right">KTN CS</th><th className="p-2 text-right">KTN Live</th>
              <th className="p-2 text-right">CAC</th><th className="p-2 text-right">KTN Live %</th>
            </tr>
          </thead>
          <tbody>
            {(data as any[]).map((b) => (
              <tr key={b.brand} className="border-b hover:bg-muted/40">
                <td className="p-2 font-medium">{b.brand}</td>
                <td className="p-2 text-right">{b.leads}</td>
                <td className="p-2 text-right">{b.eoi1}</td><td className="p-2 text-right">{b.webinar}</td><td className="p-2 text-right">{b.eoi2}</td>
                <td className="p-2 text-right">{b.feePaid}</td><td className="p-2 text-right">{b.agreement}</td>
                <td className="p-2 text-right">{b.ktnCs}</td><td className="p-2 text-right text-green-700 font-medium">{b.ktnLive}</td>
                <td className="p-2 text-right">₹{b.cac.toLocaleString()}</td>
                <td className="p-2 text-right">{b.conversion}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Funnel by Brand</CardTitle></CardHeader>
          <CardContent style={{ height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={data as any[]}>
                <XAxis dataKey="brand" fontSize={11} angle={-15} textAnchor="end" height={60} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="leads" fill="#0891b2" name="Leads" />
                <Bar dataKey="eoi1" fill="#8b5cf6" name="EOI 1" />
                <Bar dataKey="webinar" fill="#f59e0b" name="Webinar" />
                <Bar dataKey="eoi2" fill="#f97316" name="EOI 2" />
                <Bar dataKey="feePaid" fill="#22c55e" name="Fee Paid" />
                <Bar dataKey="ktnLive" fill="#166534" name="KTN Live" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Leads Share by Brand</CardTitle></CardHeader>
          <CardContent style={{ height: 320 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={data as any[]}
                  dataKey="leads"
                  nameKey="brand"
                  outerRadius={100}
                  label={(e: any) => `${e.brand} (${e.leads})`}
                >
                  {(data as any[]).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Conversion % by Brand</CardTitle></CardHeader>
          <CardContent style={{ height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={data as any[]}>
                <XAxis dataKey="brand" fontSize={11} angle={-15} textAnchor="end" height={60} />
                <YAxis fontSize={11} unit="%" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="conversion" stroke="#16a34a" strokeWidth={2} name="KTN Live %" dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">CAC by Brand</CardTitle></CardHeader>
          <CardContent style={{ height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={data as any[]}>
                <XAxis dataKey="brand" fontSize={11} angle={-15} textAnchor="end" height={60} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v: any) => `₹${Number(v).toLocaleString()}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="cac" fill="#ef4444" name="CAC (₹)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

