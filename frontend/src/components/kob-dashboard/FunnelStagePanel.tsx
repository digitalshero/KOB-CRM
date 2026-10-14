import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { apiClient } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";

export type FunnelDrill = {
  stageKey: string;
  label: string;
  mode: "auto" | "manual" | "all";
  from?: string;
  to?: string;
};

/** Inline expandable panel listing the leads behind a funnel stage. */
export function FunnelStagePanel({ drill }: { drill: FunnelDrill }) {
  const { data, isLoading } = useQuery({

    queryKey: ["funnel-stage-leads", drill.stageKey, drill.mode, drill.from, drill.to],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("stageKey", drill.stageKey);
      p.set("mode", drill.mode);
      if (drill.from) p.set("from", drill.from);
      if (drill.to) p.set("to", drill.to);
      return apiClient.get<any>(`/api/dashboard/funnel-stage-leads?${p.toString()}`);
    },
  });

  const isWebinarAttended = drill.stageKey === "WEBINAR_ATTENDED";
  const rows = isWebinarAttended ? ((data as any)?.webinarRows ?? []) : (data?.leads ?? []);

  return (
    <div className="mt-1 rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">
        {drill.label}
        {data ? ` — ${data.total} record${data.total === 1 ? "" : "s"}` : ""}
      </div>

      {isLoading ? (
        <div className="space-y-2 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : !data || rows.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          No webinar attendees in this period.
        </p>
      ) : (
        <div className="max-h-[46vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60">
              <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                {isWebinarAttended ? (
                  <>
                    <th className="py-2 pr-3">Batch</th>
                    <th className="py-2 pr-3">Scheduled</th>
                  </>
                ) : null}
                <th className="py-2 pr-3">Lead</th>
                <th className="py-2 pr-3">Phone</th>
                <th className="py-2 pr-3">Language</th>
                <th className="py-2 pr-3">{isWebinarAttended ? "Status" : "Current stage"}</th>
                <th className="py-2 pr-3">{isWebinarAttended ? "Marked" : "Created"}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l: any) => (
                <tr key={l.id} className="border-b last:border-0">
                  {isWebinarAttended ? (
                    <>
                      <td className="py-2 pr-3">{l.batch_name ?? "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {l.scheduled_at ? new Date(l.scheduled_at).toLocaleDateString() : "—"}
                      </td>
                    </>
                  ) : null}
                  <td className="py-2 pr-3 font-medium">{l.full_name ?? l.code ?? "—"}</td>
                  <td className="py-2 pr-3 tabular-nums">{l.phone ?? "—"}</td>
                  <td className="py-2 pr-3">{l.language ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {isWebinarAttended ? l.status : String(l.stage ?? "").replace(/_/g, " ")}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {(isWebinarAttended ? l.marked_at : l.created_at)
                      ? new Date(isWebinarAttended ? l.marked_at : l.created_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="py-2 text-right">
                    {l.lead_id || l.id ? (
                      <Link to="/leads/$id" params={{ id: l.lead_id ?? l.id }} className="text-primary hover:underline">
                        View →
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.total > rows.length && (
            <p className="pt-3 text-xs text-muted-foreground">
              Showing first {rows.length} of {data.total} records.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
