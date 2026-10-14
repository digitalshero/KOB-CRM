import { Fragment, useState } from "react";
import { TitleWithInfo } from "./InfoButton";
import { ChevronRight, ChevronDown, Maximize2, Info } from "lucide-react";
import { DashboardCard, SegToggle } from "./DashboardCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FunnelStagePanel, type FunnelDrill } from "./FunnelStagePanel";


function lastFiveCompletedDays() {
  const out: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 5; i++) {
    const day = new Date(d);
    day.setDate(d.getDate() - i);
    const dd = String(day.getDate()).padStart(2, "0");
    const mmm = day.toLocaleString("en-US", { month: "short" }).toUpperCase();
    out.push(`${dd} ${mmm}`);
  }
  return out;
}
const DOT_COLORS = ["#7C3AED", "#6366F1", "#0EA5E9", "#14B8A6", "#10B981", "#F59E0B", "#F59E0B"];

export type FunnelRow = {
  stage: string;
  fired: number;
  notFired: number;
  pct: string;
  color: string;
  width: number;
  link?: boolean;
  /** DB stage key used for the drill-down dialog. */
  stageKey?: string;
  /** Optional per-day values for the TABLE view (index 0 = yesterday). */
  daily?: number[];
  dailyPct?: string[];
  mtd?: number;
  mtdPct?: string;
};

export function FunnelCard({
  title,
  titleInfo,
  rows,
  compact = false,
  mode = "all",
  range,
  expandable = false,
  initialView = "FUNNEL",
  onRowClick,
  infoLines,
}: {
  title: string;
  /** Optional info text shown in a tooltip beside the title. */
  titleInfo?: string;
  rows: FunnelRow[];
  compact?: boolean;
  mode?: "auto" | "manual" | "all";
  range?: { from?: string; to?: string };
  expandable?: boolean;
  initialView?: string;
  /** Return true to handle the row click yourself (skips the inline drill-down). */
  onRowClick?: (r: FunnelRow) => boolean;
  /** Optional ⓘ popup lines explaining the calculation. */
  infoLines?: string[];
}) {
  const [view, setView] = useState(initialView);
  const [infoOpen, setInfoOpen] = useState(false);
  const [expandedView, setExpandedView] = useState<string | null>(null);
  const [openStage, setOpenStage] = useState<string | null>(null);
  const toggleDrill = (r: FunnelRow) => {
    if (onRowClick?.(r)) return;
    if (!r.stageKey) return;
    setOpenStage((cur) => (cur === r.stage ? null : r.stage));
  };
  const drillFor = (r: FunnelRow): FunnelDrill => ({
    stageKey: r.stageKey!,
    label: `${title} — ${r.stage}`,
    mode,
    from: range?.from,
    to: range?.to,
  });
  const DAY_COLS = lastFiveCompletedDays();
  const onViewChange = (v: string) => {
    if (expandable) {
      setExpandedView(v);
      return;
    }
    setView(v);
  };

  return (
    <>
    {expandable && (
      <Dialog open={expandedView !== null} onOpenChange={(o) => !o && setExpandedView(null)}>
        <DialogContent className="max-w-5xl overflow-y-auto p-0 sm:max-h-[88vh]">
          <DialogHeader className="sr-only">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="p-1">
            <FunnelCard
              title={title}
              rows={rows}
              mode={mode}
              range={range}
              onRowClick={onRowClick}
              initialView={expandedView ?? "FUNNEL"}
            />
          </div>
        </DialogContent>
      </Dialog>
    )}
    <DashboardCard
      title={
        titleInfo ? (
          <span className="inline-flex items-center gap-1">
            {title}
            <span
              className="group relative inline-flex"
              onMouseLeave={() => setInfoOpen(false)}
            >
              <button
                type="button"
                aria-label={`About ${title}`}
                onClick={() => setInfoOpen((o) => !o)}
                className="rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:text-foreground"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              <span
                role="tooltip"
                className={`pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-56 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-[11px] font-medium normal-case leading-snug tracking-normal text-popover-foreground shadow-md transition-opacity ${
                  infoOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                {titleInfo}
              </span>
            </span>
          </span>
        ) : infoLines ? (
          <TitleWithInfo title={title} lines={infoLines} />
        ) : (
          title
        )
      }
      action={
        <div className="flex items-center gap-1.5">
          <SegToggle options={["FUNNEL", "TABLE"]} value={view} onChange={onViewChange} />
          {expandable && (
            <button
              type="button"
              aria-label="Expand funnel"
              onClick={() => setExpandedView(view)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      }
    >

      {view === "FUNNEL" && (
        <div className={`grid ${compact ? "grid-cols-[1fr_54px_64px_60px]" : "grid-cols-[1fr_60px_78px_66px]"} gap-2 border-b border-border/60 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}>
          <div>Stage</div>
          <div className="text-right">Fired</div>
          <div className="text-right">Abandoned</div>
          <div className="text-right leading-tight">% of Leads</div>
        </div>
      )}

      {view === "FUNNEL" ? (
        <div className="mt-3 space-y-2">
          {rows.map((r) => (
            <div key={r.stage}>
            <div
              role={r.stageKey ? "button" : undefined}
              tabIndex={r.stageKey ? 0 : undefined}
              onClick={() => toggleDrill(r)}
              onKeyDown={(e) => { if (e.key === "Enter") toggleDrill(r); }}
              className={`grid ${compact ? "grid-cols-[1fr_54px_64px_60px]" : "grid-cols-[1fr_60px_78px_66px]"} items-center gap-2 rounded-md ${r.stageKey ? "cursor-pointer hover:bg-muted/50" : ""}`}
            >
              <div>
                <div
                  className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-white"
                  style={{ background: r.color, width: `${r.width}%`, minWidth: "42%" }}
                >
                  <span className="truncate">{r.stage}</span>
                  {r.stageKey ? (
                    openStage === r.stage ? (
                      <ChevronDown className="h-3 w-3 shrink-0 opacity-90" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0 opacity-90" />
                    )
                  ) : (
                    r.link && <ChevronRight className="h-3 w-3 shrink-0 opacity-90" />
                  )}
                </div>
              </div>
              <div className="text-right text-xs font-semibold tabular-nums">{r.fired}</div>
              <div
                className={`text-right text-xs font-semibold tabular-nums ${
                  r.notFired > 0 ? "text-rose-600" : "text-muted-foreground"
                }`}
              >
                {r.notFired}
              </div>
              <div className="text-right text-xs tabular-nums text-muted-foreground">{r.pct}</div>
            </div>
            {openStage === r.stage && r.stageKey && <FunnelStagePanel drill={drillFor(r)} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-x-0 border-spacing-y-4">
            <thead>
              <tr>
                <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Stage
                </th>
                {[...DAY_COLS, "MTD"].map((d) => (
                  <th
                    key={d}
                    className="w-[13%] pb-2 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400"
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Fragment key={r.stage}>
                <tr
                  onClick={() => toggleDrill(r)}
                  className={r.stageKey ? "cursor-pointer hover:bg-muted/50" : undefined}
                >
                  <td className="pr-4 align-middle">
                    <span className="flex items-center gap-2.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: DOT_COLORS[i % DOT_COLORS.length] }}
                      />
                      <span className="whitespace-nowrap text-sm font-medium text-slate-900">
                        {r.stage}
                      </span>
                    </span>
                  </td>
                  {DAY_COLS.map((d, di) => (
                    <td key={d} className="pl-4 text-right align-middle">
                      <div className="text-[15px] font-semibold leading-tight tabular-nums text-slate-900">
                        {r.daily?.[di] ?? r.fired}
                      </div>
                      <div className="text-[11px] leading-tight tabular-nums text-slate-400">
                        {r.dailyPct?.[di] ?? r.pct}
                      </div>
                    </td>
                  ))}
                  <td className="pl-4 text-right align-middle">
                    <div className="text-[15px] font-bold leading-tight tabular-nums text-slate-900">
                      {r.mtd ?? r.fired}
                    </div>
                    <div className="text-[11px] font-medium leading-tight tabular-nums text-emerald-600">
                      {r.mtdPct ?? r.pct}
                    </div>
                  </td>
                </tr>
                {openStage === r.stage && r.stageKey && (
                  <tr>
                    <td colSpan={DAY_COLS.length + 2} className="pb-2">
                      <FunnelStagePanel drill={drillFor(r)} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardCard>
    </>
  );
}

