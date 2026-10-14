import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";
import { downloadCsv } from "@/lib/export-csv";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tl/webinar-history")({
  head: () => ({
    meta: [
      { title: "Webinar History — Shero KOB" },
      { name: "description", content: "History of webinar attendees and defaulters with date range filters and CSV export." },
      { property: "og:title", content: "Webinar History — Shero KOB" },
      { property: "og:description", content: "Track webinar attendance and defaulters across batches." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WebinarHistory,
});

const fmt = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";

function WebinarHistory() {
  const [range, setRange] = useDateRange("mtd", "tl-webinar-history");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "attended" | "defaulter">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["webinar-history", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("from", range.from.toISOString());
      p.set("to", range.to.toISOString());
      return apiClient.get<any>(`/api/webinar/history?${p.toString()}`);
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((r: any) => {
      if (status === "attended" && !r.attended) return false;
      if (status === "defaulter" && r.attended) return false;
      if (!q) return true;
      return (
        (r.full_name ?? "").toLowerCase().includes(q) ||
        (r.phone ?? "").toLowerCase().includes(q) ||
        (r.code ?? "").toLowerCase().includes(q) ||
        (r.batch_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search, status]);

  const totals = useMemo(
    () => ({
      total: rows.length,
      attended: rows.filter((r: any) => r.attended).length,
      defaulters: rows.filter((r: any) => !r.attended).length,
    }),
    [rows],
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Webinar History</h1>
          <p className="text-sm text-muted-foreground">Attendees and defaulters across webinar batches.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter value={range} onChange={setRange} />
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                "webinar-history",
                rows.map((r: any) => ({
                  batch: r.batch_name,
                  scheduled_at: r.scheduled_at ?? "",
                  batch_language: r.batch_language ?? "",
                  lead_code: r.code,
                  lead_name: r.full_name,
                  phone: r.phone,
                  language: r.language,
                  stage: r.stage,
                  executive: r.executive,
                  status: r.status,
                  marked_at: r.marked_at ?? "",
                  defaulter_marked_at: r.defaulter_marked_at ?? "",
                })),
              )
            }
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          ["Total Attendance Records", totals.total],
          ["Attended", totals.attended],
          ["Defaulters", totals.defaulters],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{value as number}</CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search name, phone, code or batch…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-1">
          {(["all", "attended", "defaulter"] as const).map((s) => (
            <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
              {s === "all" ? "All" : s === "attended" ? "Attended" : "Defaulters"}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : !rows.length ? (
            <div className="p-4 text-sm text-muted-foreground">No webinar records in this range.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
                <tr>
                  <th className="p-2">Batch</th>
                  <th className="p-2">Scheduled</th>
                  <th className="p-2">Lead</th>
                  <th className="p-2">Phone</th>
                  <th className="p-2">Language</th>
                  <th className="p-2">Executive</th>
                  <th className="p-2">Stage</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Marked At</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{r.batch_name}</td>
                    <td className="p-2 text-xs">{fmt(r.scheduled_at)}</td>
                    <td className="p-2">
                      <div className="font-medium">{r.full_name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{r.code}</div>
                    </td>
                    <td className="p-2">{r.phone || "—"}</td>
                    <td className="p-2 text-xs">{r.language || "—"}</td>
                    <td className="p-2 text-xs">{r.executive}</td>
                    <td className="p-2 text-xs">{r.stage || "—"}</td>
                    <td className="p-2">
                      <Badge variant={r.attended ? "default" : "destructive"}>{r.status}</Badge>
                    </td>
                    <td className="p-2 text-xs">{fmt(r.marked_at ?? r.defaulter_marked_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
