import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/mgr/brand")({
  head: () => ({ meta: [{ title: "Brand Performance — Shero KOB" }] }),
  component: MgrBrand,
});

function MgrBrand() {
  const { data = [] } = useQuery({
    queryKey: ["mgr-brand"],
    queryFn: () => apiClient.get<any[]>("/api/kob/get-funnel-by-brand"),
  });
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Brand Performance</h1>
      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Brand</th><th className="p-2 text-right">Leads</th>
                <th className="p-2 text-right">Fee Paid</th><th className="p-2 text-right">Agreement</th>
                <th className="p-2 text-right">KTN CS</th><th className="p-2 text-right">KTN Live</th>
              </tr>
            </thead>
            <tbody>
              {(data as any[]).map((b) => (
                <tr key={b.brand_name} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-medium">{b.brand_name}</td>
                  <td className="p-2 text-right">{b.total_leads}</td>
                  <td className="p-2 text-right">{b.fee_paid}</td>
                  <td className="p-2 text-right">{b.agreement}</td>
                  <td className="p-2 text-right">{b.ktn_cs}</td>
                  <td className="p-2 text-right text-green-700 font-medium">{b.ktn_live}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
