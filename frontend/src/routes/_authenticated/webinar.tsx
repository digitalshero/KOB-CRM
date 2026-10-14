import { createFileRoute } from "@tanstack/react-router";
import { LeadLink } from "@/components/lead-ref";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";
import { Plus, Trash2, UserPlus, CheckCircle2, ArrowRight, CalendarClock, Eye } from "lucide-react";

export const Route = createFileRoute("/_authenticated/webinar")({
  head: () => ({ meta: [{ title: "Webinar — Shero KOB" }] }),
  component: WebinarPage,
});

const LANGUAGES = ["Hindi", "English", "Tamil", "Telugu", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati", "Punjabi"];

function WebinarPage() {
  const qc = useQueryClient();
  const [range, setRange] = useDateRange("last_3_months", "webinar");
  const [langFilter, setLangFilter] = useState<string>("");
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [rescheduleFor, setRescheduleFor] = useState<any | null>(null);
  const [search, setSearch] = useState("");

  const rangeParams = { from: range.from.toISOString(), to: range.to.toISOString() };

  const { data: batches = [] } = useQuery({
    queryKey: ["webinar-batches", rangeParams, langFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeParams.from) p.set("from", rangeParams.from);
      if (rangeParams.to) p.set("to", rangeParams.to);
      const q = p.toString();
      return apiClient.get<any[]>(`/api/webinar/batches${q ? `?${q}` : ""}`);
    },
    select: (rows: any[]) => langFilter ? rows.filter((b) => b.language === langFilter) : rows,
  });

  useEffect(() => {
    if (!selectedBatch && batches.length > 0) {
      setSelectedBatch(batches[0].id);
    }
    if (selectedBatch && batches.length > 0 && !batches.some((b: any) => b.id === selectedBatch)) {
      setSelectedBatch(batches[0].id);
    }
  }, [batches, selectedBatch]);

  const selectedBatchObj = useMemo(
    () => (batches as any[]).find((b) => b.id === selectedBatch) ?? null,
    [batches, selectedBatch]
  );

  const { data: attendance = [] } = useQuery({
    queryKey: ["webinar-attendance", selectedBatch],
    queryFn: () => apiClient.get<any[]>(`/api/webinar/batch-attendance?batchId=${encodeURIComponent(selectedBatch!)}`),
    enabled: !!selectedBatch,
  });

  const createMut = useMutation({
    mutationFn: (v: any) => apiClient.post("/api/webinar/batches", v),
    onSuccess: () => { toast.success("Batch created"); qc.invalidateQueries({ queryKey: ["webinar-batches"] }); setCreateOpen(false); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
  const deleteMut = useMutation({
    mutationFn: (batchId: string) => apiClient.delete(`/api/webinar/batches/${batchId}`),
    onSuccess: () => { toast.success("Batch deleted"); qc.invalidateQueries({ queryKey: ["webinar-batches"] }); setSelectedBatch(null); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
  const markMut = useMutation({
    mutationFn: (v: { attendanceId: string; attended: boolean }) =>
      apiClient.patch(`/api/webinar/attendance/${v.attendanceId}`, { attended: v.attended }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webinar-attendance"] }); qc.invalidateQueries({ queryKey: ["webinar-batches"] }); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
  const removeMut = useMutation({
    mutationFn: (attendanceId: string) => apiClient.delete(`/api/webinar/attendance/${attendanceId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webinar-attendance"] }); qc.invalidateQueries({ queryKey: ["webinar-batches"] }); },
  });
  const eoi2Mut = useMutation({
    mutationFn: (leadId: string) => apiClient.post(`/api/webinar/leads/${leadId}/eoi2`),
    onSuccess: () => { toast.success("Moved to EOI 2"); qc.invalidateQueries({ queryKey: ["webinar-attendance"] }); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const rescheduleMut = useMutation({
    mutationFn: (v: { attendanceId: string; newBatchId: string }) =>
      apiClient.post(`/api/webinar/attendance/${v.attendanceId}/reschedule`, { newBatchId: v.newBatchId }),
    onSuccess: () => {
      toast.success("Lead rescheduled");
      setRescheduleFor(null);
      qc.invalidateQueries({ queryKey: ["webinar-attendance"] });
      qc.invalidateQueries({ queryKey: ["webinar-batches"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const filteredAttendance = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return attendance as any[];
    const digits = q.replace(/\D/g, "");
    return (attendance as any[]).filter((a) => {
      const l = a.kob_leads ?? {};
      const phone = (l.phone ?? "").replace(/\D/g, "");
      if (digits && phone && phone.includes(digits)) return true;
      return (
        (l.full_name ?? "").toLowerCase().includes(q) ||
        (l.code ?? "").toLowerCase().includes(q)
      );
    });
  }, [attendance, search]);

  const futureBatches = useMemo(
    () => (batches as any[]).filter((b) => new Date(b.scheduled_at) > new Date() && b.id !== selectedBatch),
    [batches, selectedBatch]
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Webinar</h1>
          <p className="text-sm text-muted-foreground">Create batches, mark attendance, and promote attendees to EOI 2. Date filter applies to when the batch was created — upcoming webinars always show.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="h-9 border rounded-md px-2 text-sm bg-background"
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
          >
            <option value="">All Languages</option>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <DateRangeFilter value={range} onChange={setRange} />
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> New Batch</Button>
            </DialogTrigger>
            <CreateBatchDialog onSubmit={(v) => createMut.mutate(v)} pending={createMut.isPending} />
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-l-4 border-l-primary shadow-sm lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Batches ({batches.length})</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[70vh] overflow-auto">
            {batches.length === 0 && <div className="p-6 text-sm text-muted-foreground text-center">No batches in this range.</div>}
            {batches.map((b: any) => {
              const active = selectedBatch === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedBatch(b.id)}
                  className={`w-full text-left border-b p-3 transition-colors ${active ? "bg-accent" : "hover:bg-muted/40"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium truncate">{b.name}</div>
                    {b.language && <Badge variant="secondary" className="text-xs">{b.language}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {format(new Date(b.scheduled_at), "dd MMM yyyy · HH:mm")}
                  </div>
                  <div className="text-xs mt-1">
                    <span className="text-green-700 font-medium">{b.attended}</span>
                    <span className="text-muted-foreground"> / {b.total} attended</span>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 shadow-sm lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">
              {selectedBatch ? "Attendance" : "Select a batch"}
            </CardTitle>
            {selectedBatch && (
              <div className="flex items-center gap-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search phone, name or code…"
                  className="h-8 w-[220px] text-xs"
                />
                <Dialog open={addOpen} onOpenChange={setAddOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1"><UserPlus className="h-4 w-4" /> Add Leads</Button>
                  </DialogTrigger>
                  <AddLeadsDialog
                    batchLanguage={selectedBatchObj?.language ?? null}
                    existing={new Set((attendance as any[]).map((a) => a.lead_id))}
                    onSubmit={async (ids) => {
                      await apiClient.post(`/api/webinar/batches/${selectedBatch}/leads`, { leadIds: ids });
                      toast.success(`Added ${ids.length} lead(s)`);
                      qc.invalidateQueries({ queryKey: ["webinar-attendance"] });
                      qc.invalidateQueries({ queryKey: ["webinar-batches"] });
                      setAddOpen(false);
                    }}
                  />
                </Dialog>
                <Button size="sm" variant="ghost" className="text-destructive gap-1"
                  onClick={() => { if (confirm("Delete this batch and all attendance?")) deleteMut.mutate(selectedBatch); }}>
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="overflow-auto p-0">
            {!selectedBatch && <div className="p-6 text-sm text-muted-foreground text-center">Pick a batch on the left to see attendees.</div>}
            {selectedBatch && (attendance as any[]).length === 0 && (
              <div className="p-6 text-sm text-muted-foreground text-center">No leads added to this batch yet.</div>
            )}
            {selectedBatch && (attendance as any[]).length > 0 && filteredAttendance.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground text-center">No leads match “{search}”.</div>
            )}
            {selectedBatch && filteredAttendance.length > 0 && (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
                  <tr>
                    <th className="p-2 w-10">Att.</th>
                    <th className="p-2">Code</th>
                    <th className="p-2">Name</th>
                    <th className="p-2">Phone</th>
                    <th className="p-2">Language</th>
                    <th className="p-2">Stage</th>
                    <th className="p-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAttendance.map((a) => {
                    const l = a.kob_leads ?? {};
                    const inWebinar = l.stage === "WEBINAR";
                    return (
                      <tr key={a.id} className="border-b hover:bg-muted/40">
                        <td className="p-2">
                          <input type="checkbox" checked={a.attended}
                            onChange={(e) => markMut.mutate({ attendanceId: a.id, attended: e.target.checked })} />
                        </td>
                        <td className="p-2 font-mono text-xs">{a.lead_id ? <LeadLink id={a.lead_id}>{l.code}</LeadLink> : l.code}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            {a.lead_id ? <LeadLink id={a.lead_id} className="hover:underline">{l.full_name}</LeadLink> : <span>{l.full_name}</span>}
                            {a.defaulter_marked_at && !a.attended && (
                              <>
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Defaulter</Badge>
                                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] gap-1"
                                  onClick={() => setRescheduleFor(a)}>
                                  <CalendarClock className="h-3 w-3" /> Reschedule
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="p-2 text-xs">{l.phone}</td>
                        <td className="p-2 text-xs">{l.language}</td>
                        <td className="p-2 text-xs">
                          <Badge variant={l.stage === "EOI_2" ? "default" : "secondary"}>{l.stage}</Badge>
                        </td>
                        <td className="p-2 text-right">
                          <div className="inline-flex gap-1">
                            {a.lead_id && (
                              <LeadLink id={a.lead_id} className="inline-flex items-center gap-1 h-7 px-2 rounded-md border text-xs text-primary hover:bg-muted">
                                <Eye className="h-3.5 w-3.5" /> View
                              </LeadLink>
                            )}
                            <Button size="sm" variant="outline" className="h-7 gap-1"
                              disabled={!a.attended || !inWebinar || eoi2Mut.isPending}
                              onClick={() => eoi2Mut.mutate(l.id)}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> EOI 2 <ArrowRight className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-destructive"
                              onClick={() => removeMut.mutate(a.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!rescheduleFor} onOpenChange={(o) => !o && setRescheduleFor(null)}>
        <RescheduleDialog
          lead={rescheduleFor?.kob_leads}
          batches={futureBatches}
          pending={rescheduleMut.isPending}
          onConfirm={(newBatchId) => rescheduleMut.mutate({ attendanceId: rescheduleFor.id, newBatchId })}
        />
      </Dialog>
    </div>
  );
}

function RescheduleDialog({ lead, batches, pending, onConfirm }: { lead: any; batches: any[]; pending: boolean; onConfirm: (batchId: string) => void }) {
  const [batchId, setBatchId] = useState<string>("");
  useEffect(() => { setBatchId(batches[0]?.id ?? ""); }, [batches]);
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Reschedule {lead?.full_name ?? "lead"}</DialogTitle></DialogHeader>
      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming batches — create one first</p>
      ) : (
        <div className="space-y-2">
          <Label>Move to batch</Label>
          <select className="h-9 w-full border rounded-md px-2 text-sm bg-background"
            value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {format(new Date(b.scheduled_at), "dd MMM yyyy, HH:mm")}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Attendance resets and the Defaulter flag clears.</p>
        </div>
      )}
      <DialogFooter>
        <Button disabled={!batchId || pending} onClick={() => onConfirm(batchId)}>
          {pending ? "Rescheduling…" : "Confirm"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function CreateBatchDialog({ onSubmit, pending }: { onSubmit: (v: any) => void; pending: boolean }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState<string>(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [language, setLanguage] = useState<string>("");
  const [notes, setNotes] = useState("");
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Create Webinar Batch</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hindi Webinar - 20 Jul 6PM" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Scheduled At</Label>
            <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Language</Label>
            <select className="w-full h-10 border rounded-md px-3 text-sm bg-background"
              value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">— Any —</option>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button disabled={!name || !date || pending}
          onClick={() => onSubmit({ name, scheduled_at: new Date(date).toISOString(), language: language || null, notes: notes || null })}>
          {pending ? "Creating…" : "Create Batch"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AddLeadsDialog({
  existing, onSubmit, batchLanguage,
}: {
  existing: Set<string>;
  onSubmit: (ids: string[]) => Promise<void>;
  batchLanguage: string | null;
}) {
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const effectiveLanguage = batchLanguage ?? (language || undefined);
  const { data: leads = [] } = useQuery({
    queryKey: ["webinar-eligible", search, effectiveLanguage ?? ""],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      if (effectiveLanguage) p.set("language", effectiveLanguage);
      const q = p.toString();
      return apiClient.get<any[]>(`/api/webinar/eligible-leads${q ? `?${q}` : ""}`);
    },
  });
  const available = useMemo(() => (leads as any[]).filter((l) => !existing.has(l.id)), [leads, existing]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>Add Leads (stage: WEBINAR)</DialogTitle></DialogHeader>
      <div className="flex gap-2 mb-2 items-center">
        <Input placeholder="Search name / code / phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        {batchLanguage ? (
          <Badge variant="secondary" className="whitespace-nowrap">Language: {batchLanguage} (from batch)</Badge>
        ) : (
          <select className="h-10 border rounded-md px-2 text-sm bg-background"
            value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">All Languages</option>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
      </div>
      <div className="max-h-[50vh] overflow-auto border rounded-md">
        {available.length === 0 && <div className="p-4 text-sm text-muted-foreground text-center">No eligible leads.</div>}
        {available.map((l: any) => (
          <label key={l.id} className={`flex items-center gap-3 p-2 border-b cursor-pointer hover:bg-muted/40 ${picked.has(l.id) ? "bg-primary/5" : ""}`}>
            <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
            <span className="font-mono text-xs w-20">{l.code}</span>
            <span className="flex-1 truncate">{l.full_name}</span>
            <span className="text-xs text-muted-foreground">{l.language}</span>
            <span className="text-xs">{l.phone}</span>
          </label>
        ))}
      </div>
      <DialogFooter>
        <div className="text-xs text-muted-foreground mr-auto self-center">{picked.size} selected</div>
        <Button disabled={picked.size === 0} onClick={() => onSubmit(Array.from(picked))}>Add {picked.size} Lead(s)</Button>
      </DialogFooter>
    </DialogContent>
  );
}
