import { createFileRoute, Link } from "@tanstack/react-router";
import { LeadLink } from "@/components/lead-ref";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, Inbox, ClipboardList, CreditCard, Handshake, Users, CheckCircle2 } from "lucide-react";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";


export const Route = createFileRoute("/_authenticated/exe/overview")({
  head: () => ({ meta: [{ title: "My Overview — Shero KOB" }] }),
  component: ExecOverview,
});

const STAGE_LABEL: Record<string, string> = {
  LEAD_INBOX: "Lead Inbox", AUTO_FIRED: "Auto Fired", FAILED_FIRE: "Failed Fire",
  EOI_1: "EOI 1", WEBINAR: "Webinar", EOI_2: "EOI 2",
  FORM_FILLED: "Form Filled", FEE_PAID: "Fee Paid", AGREEMENT_SIGNED: "Agreement",
  KTN_CS: "KTN CS", KTN_LIVE: "KTN Live",
  NO: "No", LATER: "Later", NO_RESPONSE: "No-response",
  RETARGETING: "Retargeting", DEAD_LEAD: "Dead",
};

const QUICK_ACTIONS = [
  { key: "EOI_1", label: "EOI 1 Pending", to: "/exe/eoi-1", icon: Handshake },
  { key: "FORM_FILLED", label: "Form Pending", to: "/exe/form-pending", icon: ClipboardList },
  { key: "FEE_PAID", label: "Fee Pending", to: "/exe/fee-pending", icon: CreditCard },
  
];

interface ExecOverviewData {
  total: number;
  stageCounts: Record<string, number>;
  tatAlerts: Array<{
    id: string;
    code: string;
    full_name: string;
    stage: string;
    hours: number;
  }>;
  tatThreshold: number;
  dueToday: Array<{
    id: string;
    lead_id: string;
    bucket: string;
    next_touch_at: string;
    phase: string;
    kob_leads: { code: string; full_name: string } | null;
  }>;
  kpis: {
    webinarInvited: number;
    webinarAttended: number;
    eoi2: number;
    ktnCs: number;
  };
}

function ExecOverview() {
  const [range, setRange] = useDateRange("this_month");
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };
  const { data, isLoading } = useQuery<ExecOverviewData>({
    queryKey: ["my-exec-overview", range.preset, rangeArg.from, rangeArg.to],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<ExecOverviewData>(`/api/kob/my-exec-overview${q ? `?${q}` : ""}`);
    },
  });

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading your overview…</div>;
  }

  const stageEntries = Object.entries(data.stageCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Overview</h1>
          <p className="text-sm text-muted-foreground">
            {data.total} lead{data.total === 1 ? "" : "s"} assigned to you · action-first snapshot
          </p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Webinar Invited", value: (data as any).kpis?.webinarInvited ?? 0, icon: Handshake },
          { label: "Webinar Attended", value: (data as any).kpis?.webinarAttended ?? 0, icon: Users },
          { label: "EOI 2", value: (data as any).kpis?.eoi2 ?? 0, icon: ClipboardList },
          { label: "KTN CS", value: (data as any).kpis?.ktnCs ?? 0, icon: CheckCircle2 },
        ].map((c) => (
          <Card key={c.label} className="border-l-4 border-l-shero-teal">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</div>
                <div className="text-2xl font-bold">{c.value}</div>
              </div>
              <c.icon className="h-6 w-6 text-muted-foreground/60" />
            </CardContent>
          </Card>
        ))}
      </div>


      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {QUICK_ACTIONS.map((a) => {
          const count = data.stageCounts[a.key] ?? 0;
          return (
            <Link key={a.key} to={a.to as any} className="block">
              <Card className="border-l-4 border-l-primary hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{a.label}</div>
                    <div className="text-2xl font-bold">{count}</div>
                  </div>
                  <a.icon className="h-6 w-6 text-primary/70" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* My leads by stage */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Inbox className="h-4 w-4" /> My Leads by Stage</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {stageEntries.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No leads assigned yet.</div>
            ) : (
              <div className="divide-y">
                {stageEntries.map(([stage, count]) => {
                  const max = stageEntries[0][1];
                  return (
                    <div key={stage} className="p-3 flex items-center gap-3">
                      <div className="w-32 text-xs font-medium">{STAGE_LABEL[stage] ?? stage}</div>
                      <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${(count / max) * 100}%` }} />
                      </div>
                      <div className="w-8 text-right text-sm font-semibold">{count}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* TAT alerts */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> TAT Alerts
              <Badge variant="outline" className="ml-auto text-[10px]">&gt; {data.tatThreshold}h</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.tatAlerts.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">All leads on-track. 🎉</div>
            ) : (
              <div className="divide-y max-h-80 overflow-y-auto">
                {data.tatAlerts.slice(0, 20).map((a) => (
                  <div key={a.id} className="p-3 flex items-center gap-2">
                    <LeadLink id={a.id} className="flex-1 min-w-0 hover:underline">
                      <div className="font-medium text-sm truncate">{a.full_name}</div>
                      <div className="text-xs text-muted-foreground">{a.code} · {STAGE_LABEL[a.stage] ?? a.stage}</div>
                    </LeadLink>
                    <Badge className="bg-red-100 text-red-700 hover:bg-red-100">{a.hours}h</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Due today */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4 text-shero-navy" /> Due Today</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.dueToday.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Nothing scheduled for today.</div>
            ) : (
              <div className="divide-y max-h-80 overflow-y-auto">
                {data.dueToday.map((r: any) => (
                  <div key={r.id} className="p-3 flex items-center gap-2">
                    {r.lead_id ? (
                      <LeadLink id={r.lead_id} className="flex-1 min-w-0 hover:underline">
                        <div className="font-medium text-sm truncate">{r.kob_leads?.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.kob_leads?.code}</div>
                      </LeadLink>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{r.kob_leads?.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.kob_leads?.code}</div>
                      </div>
                    )}
                    <Badge variant="outline" className="text-[10px]">{STAGE_LABEL[r.bucket] ?? r.bucket}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
