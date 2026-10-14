import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangeFilter, type DateRangeValue } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/_authenticated/executive-lead-summary")({
  head: () => ({
    meta: [
      { title: "Executive Lead Summary — Shero KOB" },
      { name: "description", content: "Stage-wise lead counts per executive." },
      { property: "og:title", content: "Executive Lead Summary — Shero KOB" },
      { property: "og:description", content: "Stage-wise lead counts per executive." },
    ],
  }),
  component: ExecutiveLeadSummaryPage,
});

const STAGE_LABELS: Record<string, string> = {
  LEAD_INBOX: "Lead Inbox",
  AUTO_FIRED: "Auto Fired",
  FAILED_FIRE: "Failed Fire",
  EOI_1: "EOI 1",
  WEBINAR: "Webinar",
  WEBINAR_ATTENDED: "Webinar Attended",
  EOI2_PENDING: "EOI2 Pending",
  EOI_2: "EOI 2",
  FORM_FILLED: "Form Filled",
  FEE_PAID: "Fee Paid",
  AGREEMENT_SIGNED: "Agreement Signed",
  KTN_CS: "KTN CS",
  KTN_LIVE: "KTN Live",
  NO: "No",
  LATER: "Later",
  NO_RESPONSE: "No Response",
  RETARGETING: "Retargeting",
  DEAD_LEAD: "Dead Lead",
  NON_SERVICEABLE: "Non Serviceable",
  NO_VACANCY: "No Vacancy",
  DUPLICATE_LEAD: "Duplicate Lead",
};

const DATE_PRESETS: DateRangeValue["preset"][] = [
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "last_month",
  "last_3_months",
  "last_6_months",
  "custom",
];

function ExecutiveLeadSummaryPage() {
  const [range, setRange] = useDateRange("this_month", "executive-lead-summary");
  const [selectedId, setSelectedId] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: [
      "executive-lead-summary",
      selectedId,
      range.from.toISOString(),
      range.to.toISOString(),
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedId !== "all") params.set("executiveId", selectedId);
      params.set("from", range.from.toISOString());
      params.set("to", range.to.toISOString());
      return apiClient.get<{ executives: any[]; stages: string[]; combined: any }>(
        `/api/kob/executive-stage-summary?${params.toString()}`,
      );
    },
  });

  const executives = data?.executives ?? [];
  const stages = data?.stages ?? [];
  const combined = data?.combined;

  const selected = useMemo(() => {
    if (selectedId === "all" || !selectedId) return combined ?? null;
    return executives.find((e: any) => e.id === selectedId) ?? null;
  }, [selectedId, executives, combined]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Executive Lead Summary</h1>

      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-full sm:w-[260px]">
            <SelectValue placeholder="Select executive" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Executives</SelectItem>
            {executives.map((e: any) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DateRangeFilter value={range} onChange={setRange} presets={DATE_PRESETS} />
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selected ? selected.name : "Select an executive"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selected ? (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {stages.map((stage) => (
                  <div key={stage} className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground uppercase">
                      {STAGE_LABELS[stage] ?? stage}
                    </div>
                    <div className="text-2xl font-bold mt-1">
                      {(selected.counts as Record<string, number>)[stage] ?? 0}
                    </div>
                  </div>
                ))}
                <div className="rounded-lg border p-3 bg-muted/30">
                  <div className="text-xs text-muted-foreground uppercase">Total Leads</div>
                  <div className="text-2xl font-bold mt-1">{selected.total}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Select an executive to view their stage-wise lead counts.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
