import { DashboardCard } from "./DashboardCard";
import { ACTIONS } from "./data";

const STATUS: Record<string, string> = {
  Pending: "border-amber-200 bg-amber-50 text-amber-700",
  "In Review": "border-sky-200 bg-sky-50 text-sky-700",
  Blocked: "border-rose-200 bg-rose-50 text-rose-700",
};

export function ManagementActionItems() {
  return (
    <DashboardCard title="Management Action Items">
      <div className="mb-3">
        <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
          🚧 Coming Soon (Dummy Data)
        </span>
      </div>
      <div className="-mx-1 min-w-0 overflow-x-auto px-1">
      <table className="w-full min-w-[420px] text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 text-left font-semibold">Task</th>
            <th className="pb-2 text-right font-semibold">Owner</th>
            <th className="pb-2 text-right font-semibold">Due</th>
            <th className="pb-2 text-right font-semibold">Age</th>
            <th className="pb-2 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {ACTIONS.map((a) => (
            <tr key={a.task} className="border-b border-border/40 last:border-0">
              <td className="py-2.5 font-medium">{a.task}</td>
              <td className="py-2.5 text-right tabular-nums text-muted-foreground">{a.owner}</td>
              <td className="py-2.5 text-right tabular-nums text-muted-foreground">{a.due}</td>
              <td className="py-2.5 text-right tabular-nums text-muted-foreground">{a.age}</td>
              <td className="py-2.5 text-right">
                <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS[a.status]}`}>
                  {a.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </DashboardCard>
  );
}
