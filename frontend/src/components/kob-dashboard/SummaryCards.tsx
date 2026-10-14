import { Clock, FileText, PenLine, AlertCircle } from "lucide-react";
import { SUMMARY } from "./data";

const ICONS: Record<string, typeof Clock> = {
  clock: Clock,
  file: FileText,
  pen: PenLine,
  alert: AlertCircle,
};

export function SummaryCards() {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-4 xl:grid-cols-2 2xl:grid-cols-4">
      {SUMMARY.map((s) => {
        const Icon = ICONS[s.icon] ?? Clock;
        return (
          <div
            key={s.label}
            className={`flex min-h-[112px] min-w-0 flex-col justify-between rounded-2xl border ${s.ring} ${s.bg} p-4 shadow-sm`}
          >
            <div className="flex items-start justify-between">
              <Icon className={`h-4 w-4 ${s.tone}`} />
              <span className={`text-xl font-extrabold tabular-nums ${s.tone}`}>{s.value}</span>
            </div>
            <div className="mt-2 space-y-1.5">
              <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
                🚧 Coming Soon (Dummy Data)
              </span>
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {s.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
