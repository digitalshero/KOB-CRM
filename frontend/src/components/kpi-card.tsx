import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@tanstack/react-router";
import { TrendingUp, TrendingDown, Minus, LineChart } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { KpiTrendDialog } from "@/components/kpi-trend-dialog";

export type KpiCardProps = {
  title: string;
  icon?: LucideIcon;
  target?: number | null;
  achieved: number;
  runRate?: number | null;
  /** Value from the immediately previous period; used to compute trend %. */
  prevPeriod?: number | null;
  /** Optional explicit override: "up" | "down" | "flat". Otherwise derived from prevPeriod. */
  trendDirection?: "up" | "down" | "flat";
  variant?: "neutral" | "good" | "risk" | "attention" | "mgmt";
  format?: (n: number) => string;
  /** If provided, the whole card becomes a link to this route. */
  to?: string;
  params?: Record<string, string>;
  /** When set, shows a "View Details" button that opens a trend dialog for this metric. */
  detailsMetric?: string;
};


const BORDER: Record<string, string> = {
  good: "border-l-shero-teal",
  risk: "border-l-shero-danger",
  attention: "border-l-amber-500",
  neutral: "border-l-shero-navy/40",
  mgmt: "border-l-shero-navy",
};

export function KpiCard({
  title, icon: Icon, target, achieved, runRate, prevPeriod, trendDirection,
  variant = "neutral", format, to, params, detailsMetric,
}: KpiCardProps) {
  const [trendOpen, setTrendOpen] = useState(false);

  const border = BORDER[variant] ?? BORDER.neutral;
  const fmt = format ?? ((n: number) => n.toLocaleString());

  const achievedPct = target != null && target > 0
    ? Math.round((achieved / target) * 1000) / 10
    : null;


  // Trend %: (achieved - prev) / prev * 100. If prev is 0 and achieved > 0, treat as +100%.
  let trendPct: number | null = null;
  if (prevPeriod === 0) trendPct = achieved > 0 ? 100 : 0;
  else if (prevPeriod != null) trendPct = Math.round(((achieved - prevPeriod) / prevPeriod) * 1000) / 10;
  const dir: "up" | "down" | "flat" =
    trendDirection ??
    (trendPct == null ? "flat" : trendPct > 0 ? "up" : trendPct < 0 ? "down" : "flat");
  const TrendIcon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const trendTone =
    dir === "up" ? "text-emerald-600" : dir === "down" ? "text-rose-600" : "text-muted-foreground";

  const pctTone =
    achievedPct == null ? "text-muted-foreground"
    : achievedPct >= 80 ? "text-emerald-600"
    : achievedPct >= 50 ? "text-amber-600" : "text-rose-600";

  const card = (
    <Card
      className={`border-l-4 ${border} shadow-sm h-full ${to ? "cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5" : ""}`}
    >
      <CardContent className="p-4 h-full flex flex-col">
        <div className="flex items-start justify-between mb-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">{title}</div>
          {Icon && <Icon className="h-5 w-5 text-muted-foreground opacity-60" />}
        </div>
        <div className="text-3xl font-bold leading-tight">{fmt(achieved)}</div>

        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t">
          <MiniStat label="Target" value={target != null && target > 0 ? fmt(target) : "—"} />
          <MiniStat label="Run Rate" value={runRate != null ? fmt(Math.round(runRate)) : "—"} />
          <MiniStat label="Achieved %" value={achievedPct != null ? `${achievedPct}%` : "—"} tone={pctTone} />
        </div>


        <div className={`mt-3 flex items-center gap-1.5 text-xs ${trendTone}`}>
          <TrendIcon className="h-3.5 w-3.5" />
          <span className="font-medium">Trend</span>
          <span>
            {trendPct == null
              ? "—"
              : `${trendPct > 0 ? "+" : ""}${trendPct}% vs previous period`}
          </span>
        </div>

        {detailsMetric && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTrendOpen(true); }}
            className="mt-auto pt-2 w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-primary hover:underline border-t"
          >
            <LineChart className="h-3.5 w-3.5" />
            View Details
          </button>
        )}
      </CardContent>
    </Card>
  );

  const wrapped = to ? (
    <Link to={to as any} params={params as any} className="block h-full">{card}</Link>
  ) : card;

  return (
    <>
      {wrapped}
      {detailsMetric && (
        <KpiTrendDialog open={trendOpen} onOpenChange={setTrendOpen} metric={detailsMetric} title={title} />
      )}
    </>
  );
}


function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
