import { createFileRoute } from "@tanstack/react-router";
import { LastMessageCell } from "@/components/last-message-cell";
import { LeadLink } from "@/components/lead-ref";
import { useMemo, useState } from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import { CuisineDialog } from "@/components/cuisine-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { exportLeadsCsv } from "@/lib/export-csv";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/exec/$stage")({
  head: () => ({ meta: [{ title: "Stage — Shero KOB" }] }),
  component: ExecStage,
});

const LABEL: Record<string, string> = {
  LEAD_INBOX: "Lead Inbox", AUTO_FIRED: "Auto Fired", FAILED_FIRE: "Failed Fire",
  EOI_1: "EOI 1", WEBINAR: "Webinar", WEBINAR_ATTENDED: "Webinar Attended", EOI_2: "EOI 2",
  FORM_FILLED: "Form Filled", FEE_PAID: "Fee Paid",
  AGREEMENT_SIGNED: "Agreement Signed", KTN_CS: "KTN CS", KTN_LIVE: "KTN Live",
  RETARGETING: "Retargeting", DEAD_LEAD: "Dead Leads",
};

const NEXT_STAGE: Record<string, string> = {
  LEAD_INBOX: "AUTO_FIRED",
  AUTO_FIRED: "EOI_1",
  EOI_1: "WEBINAR",
  WEBINAR: "EOI_2",
  EOI_2: "FORM_FILLED",
  FORM_FILLED: "FEE_PAID",
  FEE_PAID: "KTN_CS",
  KTN_CS: "KTN_LIVE",
};

function ExecStage() {
  const { stage } = Route.useParams();
  const qc = useQueryClient();
  const [cuisineLead, setCuisineLead] = useState<string | null>(null);
  const { data = [] } = useQuery({
    queryKey: ["exec-stage", stage],
    queryFn: () => apiClient.get<any[]>(`/api/kob/leads?stage=${encodeURIComponent(stage)}&limit=300`),
  });
  const advance = useMutation({
    mutationFn: (leadId: string) => apiClient.patch(`/api/kob/leads/${leadId}/stage`, { stage: NEXT_STAGE[stage] }),
    onSuccess: (_r, leadId) => {
      if (NEXT_STAGE[stage] === "KTN_CS") setCuisineLead(leadId);
      toast.success(`Advanced to ${LABEL[NEXT_STAGE[stage]] ?? NEXT_STAGE[stage]}`);
      qc.invalidateQueries({ queryKey: ["exec-stage", stage] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to advance stage"),
  });
  const label = LABEL[stage] ?? stage;
  const next = NEXT_STAGE[stage];
  const [search, setSearch] = usePersistedState<string>(`exec.${stage}.search`, "");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data as any[];
    const digits = q.replace(/\D/g, "");
    return (data as any[]).filter((l) => {
      const phone = (l.phone ?? "").replace(/\D/g, "");
      if (digits && phone && phone.includes(digits)) return true;
      return (
        (l.full_name ?? "").toLowerCase().includes(q) ||
        (l.code ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search]);

  return (
    <div className="p-6 space-y-4">
      <CuisineDialog leadId={cuisineLead} onClose={() => setCuisineLead(null)} />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{label}</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} leads in this stage · assigned to you.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search phone, name or code…"
            className="h-9 w-[240px] text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            disabled={filtered.length === 0}
            onClick={() => exportLeadsCsv(`leads-${stage.toLowerCase()}`, filtered)}
          >
            <Download className="h-4 w-4 mr-1.5" /> Export CSV
          </Button>
        </div>
      </div>
      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardContent className="overflow-auto p-0">
          {filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No leads {search ? `matching “${search}”` : `in ${label}`}.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
                <tr>
                  <th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Phone</th>
                  <th className="p-2 min-w-[200px]">Last WhatsApp Message</th>
                  <th className="p-2">Language</th><th className="p-2">Mode</th>
                  <th className="p-2">Source</th><th className="p-2 text-right">SCV</th>
                  <th className="p-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-b hover:bg-muted/40">
                    <td className="p-2 font-mono text-xs"><LeadLink id={l.id}>{l.code}</LeadLink></td>
                    <td className="p-2 font-medium"><LeadLink id={l.id} className="hover:underline">{l.full_name}</LeadLink></td>
                    <td className="p-2 text-xs">{l.phone ?? "—"}</td>
                    <td className="p-2"><LastMessageCell message={l.last_message} at={l.last_message_at} unread={l.has_unread_messages} /></td>
                    <td className="p-2 text-xs">{l.language}</td>
                    <td className="p-2 text-xs">{l.mode}</td>
                    <td className="p-2 text-xs">{l.lead_sources?.name}</td>
                    <td className="p-2 text-right">{l.scv_score}</td>
                    <td className="p-2 text-right">
                      <LeadLink id={l.id} className="inline-flex items-center gap-1 h-7 px-2 mr-2 rounded-md border text-xs text-primary hover:bg-muted align-middle">View</LeadLink>
                      {next ? (

                        <Button
                          size="sm"
                          variant="outline"
                          disabled={advance.isPending}
                          onClick={() => advance.mutate(l.id)}
                        >
                          → {LABEL[next] ?? next}
                        </Button>
                      ) : stage === "KTN_LIVE" ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">✓ Activated</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">System-managed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
