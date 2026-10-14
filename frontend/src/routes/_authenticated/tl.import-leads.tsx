import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import Papa from "papaparse";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { CSV_COLUMNS, type ImportRowResult } from "@/lib/import-leads.shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Download, Upload, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tl/import-leads")({
  head: () => ({
    meta: [
      { title: "Import Leads — Shero KOB" },
      { name: "description", content: "Bulk import website and app leads into the KOB lead inbox from a CSV file." },
      { property: "og:title", content: "Import Leads — Shero KOB" },
      { property: "og:description", content: "Bulk import website and app leads into the KOB lead inbox from a CSV file." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportLeadsPage,
});

const SAMPLE_ROWS = [
  ["Priya Raman", "9876543210", "TAMIL", "Support"],
  ["Arun Kumar", "9123456780", "MALAYALAM", "Website Form"],
];

function downloadSampleCsv() {
  const csv = Papa.unparse({ fields: [...CSV_COLUMNS], data: SAMPLE_ROWS });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lead-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

type ImportSummary = {
  total: number; imported: number; duplicates: number; invalid: number;
  defaultMode: string; results: ImportRowResult[];
};

function ImportLeadsPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [showRows, setShowRows] = useState(false);

  async function handleImport() {
    if (!file) return;
    setBusy(true);
    setSummary(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => {
        const k = h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");
        const alias: Record<string, string> = {
          name: "full_name", lead_name: "full_name", customer_name: "full_name", full_name: "full_name",
          mobile: "phone", mobile_number: "phone", phone_number: "phone", contact: "phone", contact_number: "phone",
          email_id: "email", mail: "email",
          source: "lead_source", lead_source: "lead_source", source_name: "lead_source",
          channel: "channel",
          brand: "brand_code", state: "state_name", city: "city_name", district: "city_name",
          lang: "language",
        };
        return alias[k] ?? k;
      },
      complete: async (parsed) => {
        try {
          const rows = (parsed.data ?? []).filter((r) =>
            Object.values(r).some((v) => String(v ?? "").trim() !== ""));
          if (!rows.length) { toast.error("No data rows found in the CSV"); return; }
          const res = await apiClient.post<ImportSummary>("/api/kob/leads/import", { rows });
          setSummary(res);
          qc.invalidateQueries();
          toast.success(`${res.imported} lead(s) imported`);
        } catch (e: any) {
          toast.error(e?.message ?? "Import failed");
        } finally {
          setBusy(false);
        }
      },
      error: (err) => { toast.error(err.message); setBusy(false); },
    });
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Import Leads</h1>
        <p className="text-sm text-muted-foreground">
          Bulk-upload website and mobile app leads. Imported leads enter the Lead Inbox and follow the
          current AUTO/MANUAL mode automatically.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">1. Download the template</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Columns: {CSV_COLUMNS.join(", ")}. Language can be TAMIL, TELUGU, MALAYALAM, HINDI, ENGLISH, etc.
            Lead source must match a CRM source name (e.g. Support, Website Form, Meta Ads).
          </p>
          <Button variant="outline" onClick={downloadSampleCsv}>
            <Download className="h-4 w-4 mr-2" /> Download sample CSV
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">2. Upload your file</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSummary(null); }}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground"
          />
          <Button onClick={handleImport} disabled={!file || busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            Import leads
          </Button>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Import results (mode: {summary.defaultMode})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Total rows" value={summary.total} />
              <Stat label="Imported" value={summary.imported} tone="text-emerald-600" />
              <Stat label="Duplicates skipped" value={summary.duplicates} tone="text-amber-600" />
              <Stat label="Invalid skipped" value={summary.invalid} tone="text-destructive" />
            </div>

            <Button variant="ghost" size="sm" onClick={() => setShowRows((v) => !v)}>
              {showRows ? "Hide" : "Show"} per-row detail
            </Button>

            {showRows && (
              <div className="overflow-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
                    <tr><th className="p-2">Row</th><th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2">Status</th><th className="p-2">Reason</th></tr>
                  </thead>
                  <tbody>
                    {summary.results.map((r) => (
                      <tr key={r.row} className="border-b">
                        <td className="p-2">{r.row}</td>
                        <td className="p-2">{r.name || "—"}</td>
                        <td className="p-2 font-mono text-xs">{r.phone || "—"}</td>
                        <td className="p-2">
                          <Badge variant={r.status === "IMPORTED" ? "default" : r.status === "DUPLICATE" ? "secondary" : "destructive"}>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">{r.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
