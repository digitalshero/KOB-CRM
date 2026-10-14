import type { ReactNode } from "react";

export function DashboardCard({
  title,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border border-border/60 bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)] ${className}`}
    >
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 pt-4 pb-3 sm:px-5 sm:gap-x-3">
          <div className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/80">
            {title}
          </div>
          {action}
        </div>
      )}
      <div className={`min-w-0 px-4 pb-5 sm:px-5 ${title ? "" : "pt-5"} ${bodyClassName}`}>{children}</div>
    </div>
  );
}

export function SegToggle({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
            value === o
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
