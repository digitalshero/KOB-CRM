import { DashboardCard } from "./DashboardCard";
import { STATES } from "./data";

export function StateSpreadCard() {
  const states = STATES;

  return (
    <DashboardCard
      title="State-wise Spread"
      action={
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
          🚧 Coming Soon (Dummy Data)
        </span>
      }
    >
      <div className="-mx-1 min-w-0 overflow-x-auto px-1">
      <table className="w-full min-w-[340px] text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 text-left font-semibold">State</th>
            <th className="pb-2 text-right font-semibold">Leads</th>
            <th className="pb-2 text-right font-semibold">Conv %</th>
            <th className="pb-2 text-right font-semibold">Coverage %</th>
          </tr>
        </thead>
        <tbody>
          {states.map((s) => (
            <tr key={s.state} className="border-b border-border/40 last:border-0">
              <td className="py-2.5 font-medium">{s.state}</td>
              <td className="py-2.5 text-right tabular-nums">{s.leads}</td>
              <td className="py-2.5 text-right tabular-nums text-emerald-600">{s.conv}</td>
              <td className="py-2.5 text-right tabular-nums text-shero-teal">{s.coverage}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </DashboardCard>
  );
}
