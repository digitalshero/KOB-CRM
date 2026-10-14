import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SegToggle } from "./DashboardCard";
import { Skeleton } from "@/components/ui/skeleton";

export type ResponseSplitStage = "AUTO_FIRED" | "WEBINAR" | "EOI_2";

const CATEGORIES = [
  { key: "INTERESTED", label: "Interested", color: "#10b981", width: 100 },
  { key: "NO", label: "Not Interested", color: "#ef4444", width: 84 },
  { key: "NO_RESPONSE", label: "No Response", color: "#f59e0b", width: 70 },
  { key: "LATER", label: "Later", color: "#6366f1", width: 58 },
] as const;

export type ManualSplitStage = "EOI_1" | "WEBINAR" | "EOI_2";

export function ResponseSplitDialog({
  stageKey,
  stageLabel,
  open,
  onOpenChange,
  variant = "auto",
  titlePrefix = "Auto Conversion Funnel",
  range,
}: {
  stageKey: ResponseSplitStage | ManualSplitStage | null;
  stageLabel: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  variant?: "auto" | "manual" | "combined";
  titlePrefix?: string;
  range?: { from: string; to: string };
}) {
  const [view, setView] = useState("FUNNEL");
  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["kob-response-split", variant, stageKey, range?.from, range?.to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (stageKey) params.set("stageKey", stageKey);
      if (range?.from) params.set("from", range.from);
      if (range?.to) params.set("to", range.to);

      if (variant === "manual") {
        return apiClient.get<any>(`/api/dashboard/manual-stage-response-split?${params.toString()}`);
      }
      if (variant === "combined") {
        return apiClient.get<any>(`/api/dashboard/combined-stage-response-split?${params.toString()}`);
      }
      return apiClient.get<any>(`/api/dashboard/stage-response-split?${params.toString()}`);
    },
    enabled: open && !!stageKey,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  const tableQ = useQuery({
    queryKey: ["kob-response-split-table", variant, stageKey, range?.from, range?.to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (stageKey) params.set("stageKey", stageKey);
      if (range?.from) params.set("from", range.from);
      if (range?.to) params.set("to", range.to);

      if (variant === "combined") {
        return apiClient.get<any>(`/api/dashboard/combined-stage-response-split-table?${params.toString()}`);
      }
      params.set("variant", variant);
      return apiClient.get<any>(`/api/dashboard/variant-stage-response-split-table?${params.toString()}`);
    },
    enabled: open && !!stageKey && view === "TABLE",
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });


  const loading = isFetching || (!data && !isError);

  const cats =
    variant === "combined"
      ? [...CATEGORIES, { key: "PENDING", label: "Pending (no response yet)", color: "#94a3b8", width: 50 } as const]
      : CATEGORIES;
  const values = cats.map((c) => {
    const val = (data as any)?.[c.key] ?? { mtd: 0, lifetime: 0 };
    return { ...c, mtd: Number(val.mtd ?? 0), lifetime: Number(val.lifetime ?? 0) };
  });
  const totalLifetime = values.reduce((a, b) => a + b.lifetime, 0);
  const share = (n: number) =>
    totalLifetime > 0 ? `${((n / totalLifetime) * 100).toFixed(2)}%` : "0.00%";
  const maxLife = Math.max(...values.map((v) => v.lifetime), 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-y-auto rounded-xl p-0 sm:max-h-[88vh]">
        <DialogHeader className="space-y-2 border-b px-4 py-3 pr-12 text-left sm:flex-row sm:items-center sm:justify-between sm:space-y-0 sm:px-5">
          <DialogTitle className="text-sm font-semibold sm:text-base">
            {titlePrefix} — {stageLabel} · Response Split
          </DialogTitle>
          <SegToggle options={["FUNNEL", "TABLE"]} value={view} onChange={setView} />
        </DialogHeader>

        <div className="p-4 sm:p-5">
          {view !== "TABLE" && (
          <div className="grid grid-cols-[minmax(0,1fr)_44px_60px_56px] gap-2 border-b border-border/60 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[minmax(0,1fr)_58px_74px_66px] sm:gap-3">
            <div className="min-w-0">Response</div>
            <div className="text-right">MTD</div>
            <div className="text-right">Lifetime</div>
            <div className="text-right">Share</div>
          </div>
          )}

          {loading ? (
            <div className="mt-3 space-y-2">
              {CATEGORIES.map((c, i) => (
                <div
                  key={c.key}
                  className="grid grid-cols-[minmax(0,1fr)_44px_60px_56px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_58px_74px_66px] sm:gap-3"
                >
                  <Skeleton
                    className="h-8 rounded-md"
                    style={{ width: `${100 - i * 12}%`, minWidth: "42%" }}
                  />
                  <Skeleton className="h-4 justify-self-end w-8" />
                  <Skeleton className="h-4 justify-self-end w-10" />
                  <Skeleton className="h-4 justify-self-end w-10" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <p role="alert" className="py-6 text-sm text-destructive">
              {(error as Error)?.message ?? "Failed to load response split."}
            </p>
          ) : view === "FUNNEL" ? (
            <div className="mt-3 space-y-2">
              {values.map((r) => (
                <div
                  key={r.key}
                  className="grid grid-cols-[minmax(0,1fr)_44px_60px_56px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_58px_74px_66px] sm:gap-3"
                >
                  <div className="min-w-0">
                    <div
                      className="flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium text-white"
                      style={{
                        background: r.color,
                        width: `${Math.max(42, Math.round((r.lifetime / maxLife) * 100) || r.width)}%`,
                        minWidth: "42%",
                      }}
                    >
                      <span className="truncate">{r.label}</span>
                    </div>
                  </div>
                  <div className="text-right text-xs font-semibold tabular-nums">{r.mtd}</div>
                  <div className="text-right text-xs font-semibold tabular-nums">{r.lifetime}</div>
                  <div className="text-right text-xs tabular-nums text-muted-foreground">
                    {share(r.lifetime)}
                  </div>
                </div>
              ))}
            </div>
          ) : view === "TABLE" ? (
            <CombinedTable q={tableQ} />
          ) : (
            <div className="mt-1">
              {values.map((r) => (
                <div
                  key={r.key}
                  className="grid grid-cols-[minmax(0,1fr)_44px_60px_56px] items-center gap-2 border-b border-border/50 py-2.5 last:border-0 sm:grid-cols-[minmax(0,1fr)_58px_74px_66px] sm:gap-3"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: r.color }}
                    />
                    <span className="truncate text-sm font-medium">{r.label}</span>
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums">{r.mtd}</span>
                  <span className="text-right text-sm font-semibold tabular-nums">
                    {r.lifetime}
                  </span>
                  <span className="text-right text-[13px] tabular-nums text-muted-foreground">
                    {share(r.lifetime)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}

const LABELS: Record<string, string> = {
  INTERESTED: "Interested",
  NO: "Not Interested",
  NO_RESPONSE: "No Response",
  LATER: "Later",
  PENDING: "Pending (no response yet)",
};

function fmtDay(iso: string) {
  const [, m, d] = iso.split("-");
  const mon = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][Number(m) - 1];
  return `${d} ${mon}`;
}

function Cell({ n, total }: { n: number; total: number }) {
  return (
    <td className="px-2 py-2 text-right tabular-nums">
      <div className="text-sm font-semibold">{n}</div>
      <div className="text-[10px] text-muted-foreground">
        {total > 0 ? ((n / total) * 100).toFixed(2) : "0.00"}%
      </div>
    </td>
  );
}

function CombinedTable({ q }: { q: { data?: any; isFetching: boolean; isError: boolean; error: unknown } }) {
  if (q.isFetching || (!q.data && !q.isError)) {
    return (
      <div className="mt-3 space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-9 w-full rounded-md" />
        ))}
      </div>
    );
  }
  if (q.isError) {
    return (
      <p role="alert" className="py-6 text-sm text-destructive">
        {(q.error as Error)?.message ?? "Failed to load response split."}
      </p>
    );
  }
  const days: string[] = q.data.days;
  const rows: Array<{ key: string; daily: number[]; mtd: number; lifetime: number }> = q.data.rows;
  const dayTotals = days.map((_, i) => rows.reduce((a, r) => a + r.daily[i], 0));
  const mtdTotal = rows.reduce((a, r) => a + r.mtd, 0);
  const lifeTotal = rows.reduce((a, r) => a + r.lifetime, 0);

  return (
    <div className="mt-1 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-2 text-left">Response</th>
            {days.map((d) => (
              <th key={d} className="px-2 py-2 text-right">{fmtDay(d)}</th>
            ))}
            <th className="px-2 py-2 text-right">MTD</th>
            <th className="px-2 py-2 text-right">Total (Lifetime)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/50 last:border-0">
              <td className="px-2 py-2 text-sm font-medium">{LABELS[r.key] ?? r.key}</td>
              {r.daily.map((n, i) => (
                <Cell key={days[i]} n={n} total={dayTotals[i]} />
              ))}
              <Cell n={r.mtd} total={mtdTotal} />
              <Cell n={r.lifetime} total={lifeTotal} />
            </tr>
          ))}
          <tr className="border-t border-border font-semibold">
            <td className="px-2 py-2 text-sm">Total</td>
            {dayTotals.map((n, i) => (
              <td key={days[i]} className="px-2 py-2 text-right text-sm tabular-nums">{n}</td>
            ))}
            <td className="px-2 py-2 text-right text-sm tabular-nums">{mtdTotal}</td>
            <td className="px-2 py-2 text-right text-sm tabular-nums">{lifeTotal}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
