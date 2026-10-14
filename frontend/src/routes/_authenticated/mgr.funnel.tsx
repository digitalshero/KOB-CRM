import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { MetricDrilldown } from "@/components/metric-drilldown";
import { DateRangeFilter, type DateRangePreset } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";

const FUNNEL_PRESETS: DateRangePreset[] = [
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "last_3_months",
  "last_6_months",
  "all_time",
  "custom",
];

export const Route = createFileRoute("/_authenticated/mgr/funnel")({
  head: () => ({ meta: [{ title: "Funnel Analytics — Shero KOB" }] }),
  component: MgrFunnel,
});


const STAGES: Array<[string, string]> = [
  ["LEAD_INBOX", "Lead Inbox"], ["AUTO_FIRED", "Auto Fired"], ["FAILED_FIRE", "Failed Fire"],
  ["EOI_1", "EOI 1"], ["WEBINAR", "Webinar"], ["WEBINAR_ATTENDED", "Webinar Attended"], ["EOI2_PENDING", "EOI2 Pending"], ["EOI_2", "EOI 2"],
  ["FORM_FILLED", "Form Filled"], ["FEE_PAID", "Fee Paid"], ["AGREEMENT_SIGNED", "Agreement Signed"],
  ["KTN_CS", "KTN CS"], ["KTN_LIVE", "KTN Live"],
  ["NO", "No"], ["LATER", "Later"], ["NO_RESPONSE", "No-response"],
  ["RETARGETING", "Retargeting"], ["DEAD_LEAD", "Dead Lead"],
  ["NON_SERVICEABLE", "Non Serviceable"], ["NO_VACANCY", "No Vacancy"],
];

function MgrFunnel() {
  const [range, setRange] = useDateRange("all_time", "mgr-funnel");
  const rangeArg =
    range.preset === "all_time"
      ? {}
      : { from: range.from.toISOString(), to: range.to.toISOString() };
  const { data = [] } = useQuery({
    queryKey: ["mgr-funnel", range.preset, (rangeArg as any).from ?? "", (rangeArg as any).to ?? ""],
    queryFn: () => {
      const p = new URLSearchParams();
      if ((rangeArg as any).from) p.set("from", (rangeArg as any).from);
      if ((rangeArg as any).to) p.set("to", (rangeArg as any).to);
      const q = p.toString();
      return apiClient.get<any[]>(`/api/kob/get-stage-distribution${q ? `?${q}` : ""}`);
    },
  });
  const map: Record<string, number> = {};
  for (const r of data as any[]) map[r.stage] = r.count;
  const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(...Object.values(map), 1);
  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Funnel Analytics · Org-wide</h1>
        <DateRangeFilter value={range} onChange={setRange} presets={FUNNEL_PRESETS} />
      </div>
      <Card className="border-l-4 border-l-primary shadow-sm"><CardContent className="p-6 space-y-2">

        {STAGES.map(([k, label]) => {
          const c = map[k] ?? 0;
          const pct = Math.round((c / max) * 100);
          const share = Math.round((c / total) * 100);
          return (
            <div key={k} className="flex items-center gap-3">
              <div className="w-40 text-sm">{label}</div>
              <div className="flex-1 bg-muted rounded h-6 relative overflow-hidden">
                <div className="bg-primary h-full transition-all" style={{ width: `${pct}%` }} />
                <div className="absolute inset-0 flex items-center px-2 text-xs font-medium">
                  {c} <span className="text-muted-foreground ml-2">({share}%)</span>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent></Card>
      <MetricDrilldown from={(rangeArg as any).from} to={(rangeArg as any).to} />
    </div>
  );
}
