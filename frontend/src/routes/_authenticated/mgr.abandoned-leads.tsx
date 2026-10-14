import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/mgr/abandoned-leads")({
  head: () => ({ meta: [{ title: "Abandoned Leads — Shero KOB" }] }),
  component: AbandonedLeadsPage,
});

const STAGE_LABEL: Record<string, string> = {
  LEAD_INBOX: "Lead Inbox", AUTO_FIRED: "Auto Fired", FAILED_FIRE: "Failed Fire",
  EOI_1: "EOI 1", WEBINAR: "Webinar", EOI_2: "EOI 2",
  FORM_FILLED: "Form Filled", FEE_PAID: "Fee Paid",
  AGREEMENT_SIGNED: "Agreement Signed", KTN_CS: "KTN CS",
};

type AbandonedLeadsResult = {
  rows: any[];
  summary: Record<string, number>;
  stages: string[];
};

function AbandonedLeadsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["abandoned-leads"],
    queryFn: () => apiClient.get<AbandonedLeadsResult>("/api/kob/abandoned-leads"),
  });
  const rows = data?.rows ?? [];
  const summary = data?.summary ?? {};
  const stages = data?.stages ?? [];

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Abandoned Leads</h1>
        <p className="text-sm text-muted-foreground">
          Leads sitting in the same stage for 7+ days (excludes terminal & retargeting stages).
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Per-Stage Breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {stages.map((s) => (
              <div key={s} className={`rounded-md border p-3 ${summary[s] ? "bg-amber-50 border-amber-200" : "bg-muted/30"}`}>
                <div className="text-xs text-muted-foreground">{STAGE_LABEL[s] ?? s}</div>
                <div className={`text-2xl font-bold ${summary[s] ? "text-amber-700" : "text-muted-foreground"}`}>{summary[s] ?? 0}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All Abandoned Leads ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No abandoned leads. 🎉</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2">Lead</th>
                    <th className="px-3 py-2">Stage</th>
                    <th className="px-3 py-2">Days</th>
                    <th className="px-3 py-2">Team Leader</th>
                    <th className="px-3 py-2">Executive</th>
                    <th className="px-3 py-2">Brand</th>
                    <th className="px-3 py-2">Lang</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.lead_id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Link to="/leads/$id" params={{ id: r.lead_id }} className="text-primary hover:underline">
                          {r.full_name}
                        </Link>
                        <div className="text-[10px] font-mono text-muted-foreground">{r.code}</div>
                      </td>
                      <td className="px-3 py-2">{STAGE_LABEL[r.stage] ?? r.stage}</td>
                      <td className="px-3 py-2">
                        <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                          {r.days_in_stage}d
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.team_leader_name ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.assigned_to_name ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.brand_name ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.language ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
