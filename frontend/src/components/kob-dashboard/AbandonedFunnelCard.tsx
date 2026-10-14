import { useQuery } from "@tanstack/react-query";
import { FunnelCard, type FunnelRow } from "./FunnelCard";
import { apiClient } from "@/lib/api-client";

const pct = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(2)}%` : "0.00%";

export function AbandonedFunnelCard({ range }: { range?: { from: Date; to: Date } }) {
  const rangeArg = range
    ? { from: range.from.toISOString(), to: range.to.toISOString() }
    : {};
  const { data } = useQuery({
    queryKey: ["kob-abandoned-funnel", (rangeArg as any).from ?? "", (rangeArg as any).to ?? ""],
    queryFn: () => {
      const params = new URLSearchParams();
      if ((rangeArg as any).from) params.set("from", (rangeArg as any).from);
      if ((rangeArg as any).to) params.set("to", (rangeArg as any).to);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return apiClient.get<any>(`/api/dashboard/abandoned-funnel${qs}`);
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const no = data?.no ?? 0;
  const later = data?.later ?? 0;
  const noResponse = data?.noResponse ?? 0;
  const total = no + later + noResponse;

  const table = (data as any)?.table ?? {};
  const dayTotals = (i: number) =>
    ["NO", "LATER", "NO_RESPONSE"].reduce(
      (a, k) => a + Number(table[k]?.daily?.[i] ?? 0),
      0,
    );
  const mtdTotal = ["NO", "LATER", "NO_RESPONSE"].reduce(
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
    { stage: "No", fired: no, notFired: 0, pct: pct(no, total), color: "#ef4444", width: 100, ...build("NO") },
    { stage: "Later", fired: later, notFired: 0, pct: pct(later, total), color: "#f59e0b", width: 85, ...build("LATER") },
    { stage: "No Response", fired: noResponse, notFired: 0, pct: pct(noResponse, total), color: "#64748b", width: 70, ...build("NO_RESPONSE") },
  ];

  return (
    <FunnelCard
      title="Abandoned Funnel"
      titleInfo="Leads that moved from Lead Inbox, EOI 1, and Webinar stages."
      rows={rows}
      compact
    />
  );
}
