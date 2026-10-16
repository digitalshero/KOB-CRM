import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ceo/mode-control")({
  head: () => ({ meta: [{ title: "Mode Control — Shero KOB" }] }),
  component: CeoModeControl,
});

function CeoModeControl() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({
    queryKey: ["kob-config"],
    queryFn: () => apiClient.get<any>("/api/kob/get-config"),
  });
  const { data: queue } = useQuery({
    queryKey: ["gbx-fire-queue"],
    queryFn: () => apiClient.get<any[]>("/api/kob/gallabox-fire-queue"),
    refetchInterval: 15000,
  });
  const rows = (queue as any[]) ?? [];
  const defaultMode = (cfg as any)?.default_mode ?? "AUTO";

  const save = async (patch: Record<string, any>) => {
    await apiClient.patch("/api/kob/config", patch);
    await qc.invalidateQueries({ queryKey: ["kob-config"] });
    toast.success("Mode control updated");
  };

  const badge = (s: string) => {
    const c = s === "FIRED" ? "bg-green-100 text-green-800"
      : s === "FAILED" ? "bg-red-100 text-red-800"
      : "bg-amber-100 text-amber-800";
    return <span className={`text-xs px-2 py-0.5 rounded font-medium ${c}`}>{s}</span>;
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Mode Control</h1>
        <p className="text-sm text-muted-foreground">Org-wide default mode for new leads. All changes are audit-logged.</p>
      </div>

      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-base">Mode Control Settings</CardTitle></CardHeader>
        <CardContent className="p-6 pt-2 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Default Mode for new leads</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Applied at intake when the caller doesn't specify a mode.</p>
            </div>
            <div className="flex gap-2">
              {(["AUTO","MANUAL"] as const).map((m) => (
                <Button key={m} size="sm" variant={defaultMode === m ? "default" : "outline"}
                  onClick={() => save({ default_mode: m })}>{m}</Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Gallabox Fire Queue</CardTitle>
          <span className="text-xs text-muted-foreground">{rows.length} recent · auto-refresh 15s</span>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No queued fires yet. New AUTO-mode leads in Lead Inbox will appear here.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Lead</th>
                  <th className="text-left p-2">Channel</th>
                  <th className="text-left p-2">Language</th>
                  <th className="text-left p-2">Template</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Created</th>
                  <th className="text-left p-2">Fired</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => {
                  const isEmail = r.channel === "EMAIL";
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">
                        <div className="font-medium">{r.lead?.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground font-mono">{r.lead?.code}</div>
                      </td>
                      <td className="p-2">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium ${isEmail ? "bg-shero-mint text-shero-navy" : "bg-emerald-100 text-emerald-800"}`}>
                          <span aria-hidden>{isEmail ? "✉️" : "💬"}</span>
                          {isEmail ? "Email" : "WhatsApp"}
                        </span>
                      </td>
                      <td className="p-2 text-xs">{r.lead?.language}</td>
                      <td className="p-2">
                        {r.template?.name ? (
                          <div>
                            <div>{r.template.name}</div>
                            <div className="text-xs text-muted-foreground">{r.template.language}</div>
                          </div>
                        ) : <span className="text-xs text-red-600">no template</span>}
                      </td>
                      <td className="p-2">{badge(r.status)}</td>
                      <td className="p-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="p-2 text-xs text-muted-foreground">{r.fired_at ? new Date(r.fired_at).toLocaleString() : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
