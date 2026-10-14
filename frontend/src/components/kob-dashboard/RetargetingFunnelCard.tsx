import { useQuery } from "@tanstack/react-query";
import { FunnelCard, type FunnelRow } from "./FunnelCard";
import { apiClient } from "@/lib/api-client";

const pct = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(2)}%` : "0.00%";

export function RetargetingFunnelCard({ range }: { range?: { from: Date; to: Date } }) {
  const rangeArg = range
    ? { from: range.from.toISOString(), to: range.to.toISOString() }
    : {};
  const params = new URLSearchParams();
  if (rangeArg.from) params.set("from", rangeArg.from);
  if (rangeArg.to) params.set("to", rangeArg.to);
  const qStr = params.toString() ? `?${params.toString()}` : "";

  const { data } = useQuery({
    queryKey: ["kob-retargeting-funnel", (rangeArg as any).from ?? "", (rangeArg as any).to ?? ""],
    queryFn: () => apiClient.get<any>(`/api/dashboard/retargeting-funnel${qStr}`),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const leadInbox = data?.leadInbox ?? 0;
  const eoi1 = data?.eoi1 ?? 0;
  const webinar = data?.webinar ?? 0;
  const total = leadInbox + eoi1 + webinar;

  const table = (data as any)?.table ?? {};
  const dayTotals = (i: number) =>
    ["LEAD_INBOX", "EOI_1", "WEBINAR"].reduce(
      (a, k) => a + Number(table[k]?.daily?.[i] ?? 0),
      0,
    );
  const mtdTotal = ["LEAD_INBOX", "EOI_1", "WEBINAR"].reduce(
    (a, k) => a + Number(table[k]?.mtd ?? 0),
    0,
  );
  const build = (key: string) => {
    const daily: number[] = table[key]?.daily ?? [0, 0, 0, 0, 0];
    const mtd = Number(table[key]?.mtd ?? 0);
    return {
      daily,
      dailyPct: daily.map((v, i) => pct(v, dayTotals(i))),
      mtd,
      mtdPct: pct(mtd, mtdTotal),
    };
  };

  const rows: FunnelRow[] = [
    { stage: "Lead Inbox", fired: leadInbox, notFired: 0, pct: pct(leadInbox, total), color: "#7c3aed", width: 100, ...build("LEAD_INBOX") },
    { stage: "EOI 1", fired: eoi1, notFired: 0, pct: pct(eoi1, total), color: "#6366f1", width: 85, ...build("EOI_1") },
    { stage: "Webinar", fired: webinar, notFired: 0, pct: pct(webinar, total), color: "#3b82f6", width: 70, ...build("WEBINAR") },
  ];

  return (
    <FunnelCard
      title="Retargeting Funnel"
      titleInfo="Leads that come from No, Later, and No Response stages."
      rows={rows}
      compact
    />
  );
}
