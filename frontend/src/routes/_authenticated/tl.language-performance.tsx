import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/tl/language-performance")({
  head: () => ({ meta: [{ title: "Language Performance — Shero KOB" }] }),
  component: LangPerf,
});

function LangPerf() {
  const { data = [] } = useQuery({
    queryKey: ["tl-langs"],
    queryFn: () => apiClient.get<any[]>("/api/kob/tl-language-performance"),
  });
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Language Performance</h1>
      <Card><CardContent className="overflow-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
            <tr>
              <th className="p-2">Language</th>
              <th className="p-2 text-right">Leads</th>
              <th className="p-2">Assigned Executives</th>
              <th className="p-2 text-right">EOI 1</th><th className="p-2 text-right">Webinar</th><th className="p-2 text-right">EOI 2</th>
              <th className="p-2 text-right">KTN CS</th><th className="p-2 text-right">KTN Live</th>
              <th className="p-2 text-right">TAT (h)</th><th className="p-2 text-right">KTN Live %</th>
            </tr>
          </thead>
          <tbody>
            {(data as any[]).map((l) => (
              <tr key={l.language} className="border-b hover:bg-muted/40">
                <td className="p-2 font-medium">{l.language}</td>
                <td className="p-2 text-right">{l.leads}</td>
                <td className="p-2 text-xs">{l.executives || "—"} <span className="text-muted-foreground">({l.execCount})</span></td>
                <td className="p-2 text-right">{l.eoi1}</td><td className="p-2 text-right">{l.webinar}</td><td className="p-2 text-right">{l.eoi2}</td>
                <td className="p-2 text-right">{l.ktnCs}</td><td className="p-2 text-right text-green-700 font-medium">{l.ktnLive}</td>
                <td className="p-2 text-right">{l.tatHours}</td>
                <td className="p-2 text-right">{l.conversion}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
