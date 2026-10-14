import { Skeleton } from "@/components/ui/skeleton";

function CardBox({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={`min-w-0 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)] ${className}`}
    >
      {children}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <CardBox>
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-6 rounded-md" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-14 rounded-md" />
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-10" />
      </div>
    </CardBox>
  );
}

function RowsSkeleton({ rows = 6, height = "h-4" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <Skeleton className={`${height} w-1/3`} />
          <Skeleton className={`${height} w-16`} />
          <Skeleton className={`${height} w-16`} />
        </div>
      ))}
    </div>
  );
}

function PanelSkeleton({ rows = 6, chart = false }: { rows?: number; chart?: boolean }) {
  return (
    <CardBox>
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-16" />
      </div>
      {chart ? <Skeleton className="h-[240px] w-full rounded-xl" /> : <RowsSkeleton rows={rows} />}
    </CardBox>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-4" aria-busy="true" aria-live="polite">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3 w-72" />
        </div>
        <Skeleton className="h-9 w-48 rounded-md" />
      </div>

      {/* KPI cards */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: 10 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>

      {/* Funnels */}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <PanelSkeleton rows={8} />
        <PanelSkeleton rows={8} />
      </div>

      {/* Trend + executive performance */}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1.15fr_1fr]">
        <PanelSkeleton chart />
        <PanelSkeleton rows={7} />
      </div>

      {/* Untouched / State spread / Channel conversion */}
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PanelSkeleton rows={5} />
        <PanelSkeleton rows={5} />
        <PanelSkeleton rows={5} />
      </div>

      {/* Conversion funnel */}
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <PanelSkeleton rows={9} />
      </div>

      {/* Summary + action items */}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1fr_1.6fr]">
        <PanelSkeleton rows={4} />
        <PanelSkeleton rows={6} />
      </div>
    </div>
  );
}
