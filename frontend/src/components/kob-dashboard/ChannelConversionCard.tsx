import { useQuery } from "@tanstack/react-query";
import { DashboardCard } from "./DashboardCard";
import { CHANNELS } from "./data";
import type { ChannelConversionData } from "@/lib/types";
import type { DateRangeValue } from "@/components/date-range-filter";
import { apiClient } from "@/lib/api-client";

export function ChannelConversionCard({ range }: { range?: DateRangeValue }) {
  const arg = range ? { from: range.from.toISOString(), to: range.to.toISOString() } : {};
  const { data } = useQuery({
    queryKey: ["kob-channel-conv", (arg as any).from ?? "", (arg as any).to ?? ""],
    queryFn: () => {
      const p = new URLSearchParams();
      if ((arg as any).from) p.set("from", (arg as any).from);
      if ((arg as any).to) p.set("to", (arg as any).to);
      const q = p.toString();
      return apiClient.get<ChannelConversionData>(`/api/dashboard/channel-conversion${q ? `?${q}` : ""}`);
    },
  });


  const rows = [
    ...CHANNELS.map((c) => {
      if (c.channel === "Referral") {
        return { ...c, leads: 0, conv: "0.00%", cpl: "₹ 0" };
      }
      const live =
        c.channel === "Marketing"
          ? data?.marketing
          : c.channel === "Website"
            ? data?.website
            : c.channel === "Organic"
              ? data?.organic
              : null;
      if (!live) return c;
      return {
        ...c,
        leads: live.leads,
        conv: `${live.conv.toFixed(2)}%`,
        cpl: c.channel === "Marketing" || c.channel === "Organic" ? "₹ 0" : `₹ ${live.cpl.toLocaleString()}`,
      };
    }),
    {
      channel: "WhatsApp Broadcast",
      leads: data?.whatsapp?.leads ?? 0,
      conv: `${(data?.whatsapp?.conv ?? 0).toFixed(2)}%`,
      target: "—",
      cpl: `₹ ${(data?.whatsapp?.cpl ?? 0).toLocaleString()}`,
    },
    {
      channel: "Other",
      leads: data?.other?.leads ?? 0,
      conv: `${(data?.other?.conv ?? 0).toFixed(2)}%`,
      target: "—",
      cpl: "₹ 0",
    },
  ];
  const totalLeads = rows.reduce((s, r) => s + (r.leads ?? 0), 0);



  return (
    <DashboardCard title="Channel Conversion">
      <div className="-mx-1 min-w-0 overflow-x-auto px-1">
      <table className="w-full min-w-[340px] text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 text-left font-semibold">Channel</th>
            <th className="pb-2 text-right font-semibold">Leads</th>
            <th className="pb-2 text-right font-semibold">Conv %</th>
            <th className="pb-2 text-right font-semibold">Target</th>
            <th className="pb-2 text-right font-semibold">CPL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.channel} className="border-b border-border/40 last:border-0">
              <td className="py-2.5 font-medium">{c.channel}</td>
              <td className="py-2.5 text-right tabular-nums">{c.leads}</td>
              <td className="py-2.5 text-right font-semibold tabular-nums text-emerald-600">{c.conv}</td>
              <td className="py-2.5 text-right tabular-nums text-muted-foreground">{c.target}</td>
              <td className="py-2.5 text-right tabular-nums">{c.cpl}</td>
            </tr>
          ))}
          <tr className="border-t border-border/60">
            <td className="py-2.5 font-semibold">Total</td>
            <td className="py-2.5 text-right font-semibold tabular-nums">{totalLeads}</td>
            <td colSpan={3} />
          </tr>
        </tbody>

      </table>
      </div>
    </DashboardCard>
  );
}
