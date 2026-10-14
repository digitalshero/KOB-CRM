import type React from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { TitleWithInfo, FUNNEL_INFO } from "./InfoButton";
import { DashboardCard } from "./DashboardCard";
import { apiClient } from "@/lib/api-client";

const todayIst = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Abandoned Split | Retargeting Split side by side, sharing one As-of date.
export function AbandonedSplitCard(_props: { range?: { from: Date; to: Date } }) {
  const [asOf, setAsOf] = useState(todayIst);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
      <AbandonedSplitInner asOf={asOf} setAsOf={setAsOf} />
      <RetargetingSplitCard asOf={asOf} />
    </div>
  );
}

function RetargetingSplitCard({ asOf }: { asOf: string }) {
  const { data } = useQuery({
    queryKey: ["kob-retargeting-split", asOf],
    queryFn: () => apiClient.get<any>(`/api/dashboard/retargeting-split?asOf=${encodeURIComponent(asOf)}`),
    staleTime: 0,
  });
  const slices = [
    { name: "Lead Inbox", value: data?.leadInbox ?? 0, color: "#0891b2" },
    { name: "EOI 1", value: data?.eoi1 ?? 0, color: "#8b5cf6" },
    { name: "Webinar", value: data?.webinar ?? 0, color: "#10b981" },
  ];
  return <SplitCard title={<TitleWithInfo title="Retargeting Split" lines={FUNNEL_INFO["Retargeting Split"]} />} slices={slices} empty="No retargeted leads" action={<span className="text-xs text-muted-foreground">As of: {asOf}</span>} />;
}

function SplitCard({ title, slices, empty, action }: { title: React.ReactNode; slices: { name: string; value: number; color: string }[]; empty: string; action?: React.ReactNode }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "0.0%");
  return (
    <DashboardCard title={title} action={action}>
      <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[220px_1fr]">
        <div className="h-[220px]">
          {total > 0 ? (
            <ResponsiveContainer>
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {slices.map((s) => <Cell key={s.name} fill={s.color} />)}
                </Pie>
                <Tooltip formatter={(v: any, n: any) => [`${v} (${pct(Number(v))})`, n]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{empty}</div>
          )}
        </div>
        <div className="space-y-2 text-sm">
          {slices.map((s) => (
            <div key={s.name} className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: s.color }} />{s.name}</span>
              <span className="tabular-nums"><b>{s.value}</b> <span className="text-muted-foreground">· {pct(s.value)}</span></span>
            </div>
          ))}
          <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{total}</span></div>
        </div>
      </div>
    </DashboardCard>
  );
}

function AbandonedSplitInner({ asOf, setAsOf }: { asOf: string; setAsOf: (v: string) => void }) {
  const { data } = useQuery({
    queryKey: ["kob-abandoned-split", asOf],
    queryFn: () => apiClient.get<any>(`/api/dashboard/abandoned-split?asOf=${encodeURIComponent(asOf)}`),
    staleTime: 0,
  });
  const slices = [
    { name: "No Response", value: data?.noResponse ?? 0, color: "#3b82f6" },
    { name: "No", value: data?.no ?? 0, color: "#ef4444" },
    { name: "Later", value: data?.later ?? 0, color: "#f59e0b" },
  ];
  const total = slices.reduce((s, x) => s + x.value, 0);
  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "0.0%");

  return (
    <DashboardCard
      title={<TitleWithInfo title="Abandoned Split" lines={FUNNEL_INFO["Abandoned Split"]} />}
      action={
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          As of:
          <input type="date" value={asOf} max={todayIst()} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs text-foreground" aria-label="Abandoned Split as of date" />
        </label>
      }
    >
      <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[220px_1fr]">
        <div className="h-[220px]">
          {total > 0 ? (
            <ResponsiveContainer>
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {slices.map((s) => <Cell key={s.name} fill={s.color} />)}
                </Pie>
                <Tooltip formatter={(v: any, n: any) => [`${v} (${pct(Number(v))})`, n]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No abandoned leads</div>
          )}
        </div>
        <div className="space-y-2 text-sm">
          {slices.map((s) => (
            <div key={s.name} className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: s.color }} />{s.name}</span>
              <span className="tabular-nums"><b>{s.value}</b> <span className="text-muted-foreground">· {pct(s.value)}</span></span>
            </div>
          ))}
          <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{total}</span></div>
        </div>
      </div>
    </DashboardCard>
  );
}
