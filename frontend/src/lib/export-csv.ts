export function toCsv(rows: Record<string, any>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}

export function downloadCsv(name: string, rows: Record<string, any>[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function leadsToCsvRows(leads: any[]) {
  return leads.map((l) => ({
    code: l.code ?? "",
    name: l.full_name ?? "",
    phone: l.phone ?? "",
    email: l.email ?? "",
    stage: l.stage ?? "",
    mode: l.mode ?? "",
    language: l.language ?? "",
    source: l.lead_sources?.name ?? "",
    brand: l.brands?.name ?? "",
    state: l.india_states?.name ?? "",
    city: l.india_cities?.name ?? "",
    scv_score: l.scv_score ?? "",
    next_action: l.next_action ?? "",
    last_message: l.last_message ?? "",
    last_message_at: l.last_message_at ?? "",
    stage_entered_at: l.stage_entered_at ?? "",
    created_at: l.created_at ?? "",
  }));
}

export function exportLeadsCsv(name: string, leads: any[]) {
  downloadCsv(name, leadsToCsvRows(leads));
}
