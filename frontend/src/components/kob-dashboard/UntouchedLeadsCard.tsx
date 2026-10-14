import { DashboardCard } from "./DashboardCard";
import { UNTOUCHED } from "./data";

export function UntouchedLeadsCard() {
  const total = UNTOUCHED.reduce((s, u) => s + u.value, 0);
  return (
    <DashboardCard title="Untouched Leads">
      <div className="divide-y divide-border/40">
        {UNTOUCHED.map((u) => (
          <div key={u.label} className="flex items-center justify-between py-2.5 text-xs">
            <span className={`font-medium ${u.tone}`}>{u.label}</span>
            <span className="flex items-center gap-6">
              <span className="font-semibold tabular-nums">{u.value}</span>
              <span className={`tabular-nums ${u.tone}`}>{u.pct}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-sm">
        <span className="font-medium">Total Untouched</span>
        <span className="text-lg font-extrabold tabular-nums">{total}</span>
      </div>
    </DashboardCard>
  );
}
