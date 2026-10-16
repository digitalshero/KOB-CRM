import { LayoutDashboard, RefreshCw, Download } from "lucide-react";
import { DateRangeFilter, type DateRangeValue } from "@/components/date-range-filter";

export function Header({ range, onRangeChange }: { range: DateRangeValue; onRangeChange: (v: DateRangeValue) => void }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-shero-navy text-white">
          <LayoutDashboard className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-extrabold tracking-tight sm:text-2xl">KOB — Kitchen Onboarding Dashboard</h1>
          <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
            Shero Operating System · Snapshot vs same day last month
          </p>
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">

        <DateRangeFilter value={range} onChange={onRangeChange} className="h-[42px] rounded-xl" />
        <button className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-sm font-medium shadow-sm">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          Refresh
        </button>
        <button className="inline-flex items-center gap-2 rounded-xl bg-foreground px-3.5 py-2.5 text-sm font-semibold text-background shadow-sm">
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>
    </div>
  );
}
