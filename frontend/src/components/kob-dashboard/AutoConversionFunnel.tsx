import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

import type { DateRangeValue } from "@/components/date-range-filter";
import { useState } from "react";
import { FUNNEL_INFO } from "./InfoButton";
import { FunnelCard, type FunnelRow } from "./FunnelCard";
import { ResponseSplitDialog, type ResponseSplitStage } from "./ResponseSplitDialog";
import { AUTO_FUNNEL } from "./data";

const ORDER = [
  "leadGenerated",
  "eoi1",
  "webinarSent",
  "webinarAccepted",
  "eoi2",
  "feePaid",
  "contractSigned",
] as const;

// Row index -> bucket key
const BUCKET_KEY: Record<number, "leadGenerated" | "eoi1" | "webinarSent" | "webinarAttended" | "eoi2" | "feePaid" | "contractSigned"> = {
  0: "leadGenerated",
  1: "eoi1",
  2: "webinarSent",
  3: "webinarAttended",
  4: "eoi2",
  5: "feePaid",
  6: "contractSigned",
};

const STAGE_KEYS = ["LEAD_GENERATED", "AUTO_FIRED", "WEBINAR", "WEBINAR_ATTENDED", "EOI_2", "FEE_PAID", "KTN_CS"];

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

const SPLIT_STAGES: Record<string, ResponseSplitStage> = {
  "EOI 1 Auto-Fired": "AUTO_FIRED",
  "Webinar Invite Sent": "WEBINAR",
  "EOI 2": "EOI_2",
};

type AutoBucket = {
  leadGenerated: number;
  eoi1: number;
  webinarSent: number;
  webinarAttended: number;
  eoi2: number;
  feePaid: number;
  contractSigned: number;
};

type AutoFunnelData = {
  leadGenerated: number;
  eoi1: number;
  webinarSent: number;
  webinarAccepted: number;
  eoi2: number;
  feePaid: number;
  contractSigned: number;
};

export function AutoConversionFunnel({ range }: { range: DateRangeValue }) {
  const [split, setSplit] = useState<{ key: ResponseSplitStage; label: string } | null>(null);
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };

  const { data } = useQuery({
    queryKey: ["kob-auto-funnel", range.preset, rangeArg.from, rangeArg.to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (rangeArg.from) params.set("from", rangeArg.from);
      if (rangeArg.to) params.set("to", rangeArg.to);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return apiClient.get<AutoFunnelData>(`/api/dashboard/auto-funnel${qs}`);
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const spans = buildSpans();
  const { data: buckets } = useQuery({
    queryKey: ["kob-auto-funnel-buckets", spans[0].from, spans[spans.length - 1].from],
    queryFn: () =>
      apiClient.get<AutoBucket[]>(
        `/api/dashboard/auto-funnel-buckets?spans=${encodeURIComponent(JSON.stringify(spans))}`,
      ),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const total = Number(data?.leadGenerated ?? 0);

  const rows: FunnelRow[] = AUTO_FUNNEL.map((r, i) => {
    const clickable = Boolean(SPLIT_STAGES[r.stage]) || r.stage === "Webinar Attendees";
    // Never fall back to the template's sample numbers — until live data
    // arrives the row shows zeros, so the UI only ever renders real counts.
    const fired = data ? Number((data as any)[ORDER[i]] ?? 0) : 0;
    let row: FunnelRow = {
      ...r,
      stageKey: clickable ? STAGE_KEYS[i] : undefined,
      link: clickable ? r.link : false,
      fired,
      notFired: Math.max(total - fired, 0),
      pct: total > 0 ? `${((fired / total) * 100).toFixed(2)}%` : "0.00%",
    };

    const key = BUCKET_KEY[i];
    if (buckets && key) {
      const daily: number[] = buckets.slice(0, 5).map((b) => Number(b[key] ?? 0));
      const mtdBucket = buckets[5];
      row = {
        ...row,
        daily,
        dailyPct: daily.map((v: number, di: number) =>
          pct(v, Number(buckets[di]?.leadGenerated ?? 0)),
        ),
        mtd: Number(mtdBucket?.[key] ?? 0),
        mtdPct: pct(Number(mtdBucket?.[key] ?? 0), Number(mtdBucket?.leadGenerated ?? 0)),
      };
    }
    return row;
  });

  const handleRowClick = (r: FunnelRow) => {
    const key = SPLIT_STAGES[r.stage];
    // Only EOI 1 Auto-Fired, Webinar Invite Sent and EOI 2 are clickable.
    // All other stages are handled here as a no-op (no drill-down panel).
    if (!key) return false;
    setSplit({ key, label: r.stage });
    return true;
  };

  return (
    <>
      <FunnelCard
        title="Auto Conversion Funnel"
        infoLines={FUNNEL_INFO["Auto Conversion Funnel"]}
        rows={rows}
        mode="auto"
        range={rangeArg}
        onRowClick={handleRowClick}
      />
      <ResponseSplitDialog
        open={split !== null}
        onOpenChange={(o: boolean) => !o && setSplit(null)}
        stageKey={split?.key ?? null}
        stageLabel={split?.label ?? ""}
        range={rangeArg}
      />
    </>
  );
}

