import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import type { DateRangeValue } from "@/components/date-range-filter";
import { useState } from "react";
import { FUNNEL_INFO } from "./InfoButton";
import { FunnelCard, type FunnelRow } from "./FunnelCard";
import { ResponseSplitDialog, type ManualSplitStage } from "./ResponseSplitDialog";
import { MANUAL_FUNNEL } from "./data";

const STAGE_KEYS = ["LEAD_GENERATED", "EOI_1", "WEBINAR", "EOI_2", "FEE_PAID", "KTN_CS"];
const ORDER = ["leadGenerated", "eoi1", "webinar", "eoi2", "feePaid", "contractSigned"] as const;

const SPLIT_STAGES: Record<string, ManualSplitStage> = {
  "EOI 1": "EOI_1",
  Webinar: "WEBINAR",
  "EOI 2": "EOI_2",
};

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

export function ManualConversionFunnel({ range }: { range: DateRangeValue }) {
  const [split, setSplit] = useState<{ key: ManualSplitStage; label: string } | null>(null);
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };

  const { data } = useQuery({
    queryKey: ["kob-manual-funnel", range.preset, rangeArg.from, rangeArg.to],
    queryFn: () =>
      apiClient.get<any>(
        `/api/dashboard/manual-funnel?from=${encodeURIComponent(rangeArg.from)}&to=${encodeURIComponent(rangeArg.to)}`,
      ),
  });

  const spans = buildSpans();
  const { data: buckets } = useQuery({
    queryKey: ["kob-manual-funnel-buckets", spans[0].from, spans[spans.length - 1].from],
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
      >(`/api/dashboard/manual-funnel-buckets?spans=${encodeURIComponent(JSON.stringify(spans))}`),
  });

  const total = Number(data?.leadGenerated ?? 0);

  const rows: FunnelRow[] = MANUAL_FUNNEL.map((r, i) => {
    const clickable = Boolean(SPLIT_STAGES[r.stage]);
    let row: FunnelRow = {
      ...r,
      stageKey: clickable ? STAGE_KEYS[i] : undefined,
      link: clickable ? r.link : false,
    };
    if (data) {
      const fired = Number((data as any)[ORDER[i]] ?? 0);
      row = {
        ...row,
        fired,
        notFired: Math.max(total - fired, 0),
        pct: pct(fired, total),
      };
    }
    const key = ORDER[i];
    if (buckets) {
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



  const handleRowClick = (r: FunnelRow) => {
    const key = SPLIT_STAGES[r.stage];
    if (!key) return false;
    setSplit({ key, label: r.stage });
    return true;
  };

  return (
    <>
      <FunnelCard
        title="Manual Conversion Funnel"
        infoLines={FUNNEL_INFO["Manual Conversion Funnel"]}
        rows={rows}
        mode="manual"
        range={rangeArg}
        onRowClick={handleRowClick}
      />
      <ResponseSplitDialog
        open={split !== null}
        onOpenChange={(o: boolean) => !o && setSplit(null)}
        stageKey={split?.key ?? null}
        stageLabel={split?.label ?? ""}
        variant="manual"
        titlePrefix="Manual Conversion Funnel"
        range={rangeArg}
      />
    </>
  );
}
