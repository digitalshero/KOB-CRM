import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ceo/brands")({
  head: () => ({ meta: [{ title: "Brand Management — Shero KOB" }] }),
  component: CeoBrands,
});

function CeoBrands() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({

    queryKey: ["brands"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-brands"),
  });
  const rows = data as any[];
  const shero = rows.filter((r) => r.is_shero).length;
  const other = rows.length - shero;
  const active = rows.filter((r) => r.active).length;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Brand Management</h1>
        <p className="text-sm text-muted-foreground">CEO Office master list. Activate / deactivate brands; every change is audit-logged.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="border-l-4 border-l-primary shadow-sm"><CardContent className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Total Brands</div>
          <div className="text-2xl font-bold">{rows.length}</div>
        </CardContent></Card>
        <Card className="border-l-4 border-l-emerald-500 shadow-sm"><CardContent className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Shero (SHF)</div>
          <div className="text-2xl font-bold">{shero}</div>
        </CardContent></Card>
        <Card className="border-l-4 border-l-shero-navy/40 shadow-sm"><CardContent className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Active</div>
          <div className="text-2xl font-bold">{active} <span className="text-sm text-muted-foreground">/ {rows.length}</span></div>
        </CardContent></Card>
      </div>

      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Brand Ledger</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Code</th>
                <th className="p-2">Name</th>
                <th className="p-2">Type</th>
                <th className="p-2">Other ({other})</th>
                <th className="p-2 text-right">Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-mono text-xs">{b.code}</td>
                  <td className="p-2 font-medium">{b.name}</td>
                  <td className="p-2">{b.is_shero ? <span className="text-primary font-medium">Shero (SHF)</span> : "External"}</td>
                  <td className="p-2 text-xs text-muted-foreground">{b.is_shero ? "—" : "counted in Other Kitchen Scope"}</td>
                  <td className="p-2 text-right">
                    <Switch
                      checked={b.active}
                      onCheckedChange={async (v) => {
                        await apiClient.patch(`/api/kob/entities/brands/${b.id}/toggle`, { active: v });
                        qc.invalidateQueries();
                        toast.success(`${b.name} ${v ? "activated" : "deactivated"}`);
                      }}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No brands configured yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
