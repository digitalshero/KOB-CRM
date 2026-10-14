import * as XLSX from "xlsx";

export function downloadXlsx(name: string, rows: Record<string, any>[], sheetName = "Sheet1") {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${name}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function unallocatedToRows(leads: any[]) {
  return leads.map((l) => ({
    "Lead Code": l.code ?? "",
    Name: l.full_name ?? "",
    Phone: l.phone ?? "",
    Stage: l.stage ?? "",
    Language: l.language ?? "",
    Mode: l.mode ?? "",
    Source: l.lead_sources?.name ?? "",
    "Created Date": l.created_at ? new Date(l.created_at).toISOString().slice(0, 10) : "",
    "Assigned To": "",
  }));
}
