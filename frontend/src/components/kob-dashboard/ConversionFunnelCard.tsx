import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FUNNEL_INFO } from "./InfoButton";
import { FunnelCard, type FunnelRow } from "./FunnelCard";
import { ResponseSplitDialog, type ManualSplitStage } from "./ResponseSplitDialog";
import { SIMPLE_FUNNEL } from "./data";
import { apiClient } from "@/lib/api-client";


const ORDER = ["leadGenerated", "eoi1", "webinar", "eoi2", "feePaid", "contractSigned"] as const;

/** Last 5 completed days + MTD (month start → yesterday), matching the other funnels. */
function buildSpans() {
  const spans: { from: string; to: string }[] = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 5; i++) {
    const start = new Date(base);
    start.setDate(base.getDate() - i);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    spans.push({ from: start.toISOString(), to: end.toISOString() });
  }
  const monthStart = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
  const yesterdayEnd = new Date(base);
  yesterdayEnd.setDate(base.getDate() - 1);
  yesterdayEnd.setHours(23, 59, 59, 999);
  spans.push({ from: monthStart.toISOString(), to: yesterdayEnd.toISOString() });
  return spans;
}

const pct = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(2)}%` : "0.00%";

const SPLIT_STAGES: Record<string, ManualSplitStage> = {
  "EOI 1": "EOI_1",
  Webinar: "WEBINAR",
  "EOI 2": "EOI_2",
};

export function ConversionFunnelCard({ range }: { range?: { from: Date; to: Date } }) {
  const [split, setSplit] = useState<{ key: ManualSplitStage; label: string } | null>(null);
  const rangeArg = range
    ? { from: range.from.toISOString(), to: range.to.toISOString() }
    : {};
  const { data } = useQuery({
    queryKey: ["kob-combined-funnel", (rangeArg as any).from ?? "", (rangeArg as any).to ?? ""],
    queryFn: () => {
      const params = new URLSearchParams();
      if ((rangeArg as any).from) params.set("from", (rangeArg as any).from);
      if ((rangeArg as any).to) params.set("to", (rangeArg as any).to);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return apiClient.get<any>(`/api/dashboard/combined-funnel${qs}`);
    },
  });

  const spans = buildSpans();
  const { data: buckets } = useQuery({
    queryKey: ["kob-combined-funnel-buckets", spans[0].from, spans[spans.length - 1].from],
    queryFn: () =>
      apiClient.get<
        Array<{
          leadGenerated: number;
          eoi1: number;
          webinar: number;
          eoi2: number;
          feePaid: number;
          contractSigned: number;
        }>
      >(`/api/dashboard/combined-funnel-buckets?spans=${encodeURIComponent(JSON.stringify(spans))}`),
  });

  const rows: FunnelRow[] = (() => {
    const total = data?.leads ?? 0;
    const seq = [
      { stage: "Leads", value: total, notMoved: data?.leadsNotMoved ?? 0, key: "LEAD_GENERATED" },
      { stage: "EOI 1", value: data?.eoi1 ?? 0, notMoved: data?.eoi1NotMoved ?? 0, key: "EOI_1" },
      { stage: "Webinar", value: data?.webinar ?? 0, notMoved: data?.webinarNotMoved ?? 0, key: "WEBINAR" },
      { stage: "EOI 2", value: data?.eoi2 ?? 0, notMoved: data?.eoi2NotMoved ?? 0, key: "EOI_2" },
      { stage: "Fee Paid", value: data?.feePaid ?? 0, notMoved: data?.feePaidNotMoved ?? 0, key: "FEE_PAID" },
      { stage: "Contract Signed", value: data?.contractSigned ?? 0, notMoved: data?.contractSignedNotMoved ?? 0, key: "KTN_CS" },
    ];
    return seq.map((s, i) => {
      const clickable = s.stage in SPLIT_STAGES;
      let row: FunnelRow = {
        ...(SIMPLE_FUNNEL[i] as FunnelRow),
        stage: s.stage,
        stageKey: clickable ? s.key : undefined,
        link: clickable ? (SIMPLE_FUNNEL[i] as FunnelRow).link : undefined,
      };

      if (data) {
        row = {
          ...row,
          fired: s.value,
          notFired: s.notMoved,
          pct: pct(s.value, total),
        };
      }
      if (buckets) {
        const key = ORDER[i];
        const daily = buckets.slice(0, 5).map((b: any) => Number(b[key] ?? 0));
        const mtdBucket: any = buckets[5];
        row = {
          ...row,
          daily,
          dailyPct: daily.map((v, di) =>
            pct(v, Number((buckets[di] as any).leadGenerated ?? 0)),
          ),
          mtd: Number(mtdBucket?.[key] ?? 0),
          mtdPct: pct(Number(mtdBucket?.[key] ?? 0), Number(mtdBucket?.leadGenerated ?? 0)),
        };
      }
      return row;
    });
  })();

  const handleRowClick = (r: FunnelRow) => {
    const key = SPLIT_STAGES[r.stage];
    if (!key) return false;
    setSplit({ key, label: r.stage });
    return true;
  };

  return (
    <>
      <FunnelCard
        title="Conversion Funnel"
        infoLines={FUNNEL_INFO["Conversion Funnel"]}
        rows={rows}
        compact
        expandable
        onRowClick={handleRowClick}
      />
      <ResponseSplitDialog
        open={split !== null}
        onOpenChange={(o: boolean) => !o && setSplit(null)}
        stageKey={split?.key ?? null}
        stageLabel={split?.label ?? ""}
        variant="combined"
        titlePrefix="Conversion Funnel"
        range={range ? { from: range.from.toISOString(), to: range.to.toISOString() } : undefined}
      />
    </>
  );
}
