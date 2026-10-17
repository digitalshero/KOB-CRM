import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LastMessageCell } from "@/components/last-message-cell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CuisineDialog } from "@/components/cuisine-dialog";
import { apiClient } from "@/lib/api-client";
import type { MyRoleResponse } from "@/lib/types";

import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useMemo, useRef, useState } from "react";
import { DateRangeFilter } from "@/components/date-range-filter";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useDateRange } from "@/hooks/use-date-range";
import { exportLeadsCsv } from "@/lib/export-csv";
import { Download } from "lucide-react";

import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/leads/")({
  head: () => ({ meta: [{ title: "Lead Inbox — Shero KOB" }] }),
  component: LeadsPage,
});

const KANBAN_STAGES = [
  "LEAD_INBOX","AUTO_FIRED","FAILED_FIRE","EOI_1","WEBINAR","WEBINAR_ATTENDED","EOI2_PENDING","EOI_2",
  "FORM_FILLED","FEE_PAID","KTN_CS","KTN_LIVE",
  "NO","LATER","NO_RESPONSE","RETARGETING","DEAD_LEAD","NON_SERVICEABLE","NO_VACANCY","DUPLICATE_LEAD",
];
const STAGE_LABEL: Record<string, string> = {
  LEAD_INBOX: "Lead Inbox", AUTO_FIRED: "Auto Fired", FAILED_FIRE: "Failed Fire",
  EOI_1: "EOI 1", WEBINAR: "Webinar", WEBINAR_ATTENDED: "Webinar Attended", EOI2_PENDING: "EOI2 Pending", EOI_2: "EOI 2",
  FORM_FILLED: "Form Filled", FEE_PAID: "Fee Paid", AGREEMENT_SIGNED: "Agreement Signed",
  KTN_CS: "KTN CS", KTN_LIVE: "KTN Live",
  NO: "No", LATER: "Later", NO_RESPONSE: "No-response",
  RETARGETING: "Retargeting", DEAD_LEAD: "Dead Lead",
  NON_SERVICEABLE: "Non Serviceable", NO_VACANCY: "No Vacancy", DUPLICATE_LEAD: "Duplicate Lead",
};
const STAGE_COLOR: Record<string, string> = {
  LEAD_INBOX: "bg-shero-mint text-shero-navy", AUTO_FIRED: "bg-shero-mint text-shero-navy", FAILED_FIRE: "bg-red-100 text-red-700",
  EOI_1: "bg-teal-100 text-teal-700", WEBINAR: "bg-teal-100 text-teal-800", WEBINAR_ATTENDED: "bg-teal-200 text-teal-900", EOI2_PENDING: "bg-lime-100 text-lime-700", EOI_2: "bg-emerald-100 text-emerald-700",
  FORM_FILLED: "bg-shero-mint text-shero-navy", FEE_PAID: "bg-green-100 text-green-700",
  AGREEMENT_SIGNED: "bg-green-200 text-green-800", KTN_CS: "bg-green-300 text-green-900", KTN_LIVE: "bg-green-500 text-white",
  NO: "bg-red-100 text-red-700", LATER: "bg-yellow-100 text-yellow-700", NO_RESPONSE: "bg-amber-100 text-amber-700",
  RETARGETING: "bg-amber-100 text-amber-700", DEAD_LEAD: "bg-gray-200 text-gray-700",
  NON_SERVICEABLE: "bg-muted text-muted-foreground", NO_VACANCY: "bg-stone-200 text-stone-700",
  DUPLICATE_LEAD: "bg-zinc-200 text-zinc-700",
};

function hasRnr(lead: any) {
  return Array.isArray(lead?.tags) && lead.tags.includes("RNR");
}

function RnrFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground uppercase">RNR</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL" className="text-xs">All</SelectItem>
          <SelectItem value="RNR" className="text-xs">RNR</SelectItem>
          <SelectItem value="NOT_RNR" className="text-xs">Not RNR</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function applyRnrFilter(leads: any[], mode: string) {
  if (mode === "RNR") return leads.filter(hasRnr);
  if (mode === "NOT_RNR") return leads.filter((l) => !hasRnr(l));
  return leads;
}

/**
 * Single source of truth for the Lead Inbox filters (Stage, RNR, Executive,
 * Language, Lead Source). Both Table View and Kanban Board use this hook, so
 * the selected values persist and stay in sync when switching views.
 */
function useLeadInboxFilters(isExec?: boolean) {
  // Default is always "All" — Lead Inbox must never auto-select the
  // LEAD_INBOX stage on fresh entry, only when the user picks it manually.
  const [stageFilter, setStageFilter] = usePersistedState<string>("leads.table.stage", "ALL");
  const [rnrFilter, setRnrFilter] = usePersistedState<string>("leads.table.rnr", "ALL");
  const [execFilter, setExecFilter] = usePersistedState<string>("leads.table.exec", "ALL");
  const [langFilter, setLangFilter] = usePersistedState<string>("leads.table.lang", "ALL");
  const [sourceFilter, setSourceFilter] = usePersistedState<string>("leads.table.source", "ALL");
  return { stageFilter, setStageFilter, rnrFilter, setRnrFilter, execFilter, setExecFilter, langFilter, setLangFilter, sourceFilter, setSourceFilter };
}

type LeadFilters = ReturnType<typeof useLeadInboxFilters>;

function applyLeadFilters(leads: any[], f: LeadFilters) {
  return leads
    .filter((l) => (f.stageFilter === "ALL" ? true : l.stage === f.stageFilter))
    .filter((l) => (f.langFilter === "ALL" ? true : l.language === f.langFilter))
    .filter((l) => (f.sourceFilter === "ALL" ? true : (l.lead_sources?.name ?? "") === f.sourceFilter))
    .filter((l) => (f.rnrFilter === "ALL" ? true : f.rnrFilter === "RNR" ? hasRnr(l) : !hasRnr(l)))
    .filter((l) => (f.execFilter === "ALL" ? true : l.assigned_to === f.execFilter));
}

function LeadFilterControls({
  filters,
  leads,
  execs,
  isExec,
  onChange,
}: {
  filters: LeadFilters;
  leads: any[];
  execs: any[];
  isExec?: boolean;
  onChange?: () => void;
}) {
  const languages = useMemo(() => {
    const s = new Set<string>();
    leads.forEach((l) => l.language && s.add(l.language));
    return [...s].sort();
  }, [leads]);
  const stages = useMemo(() => {
    const s = new Set<string>();
    leads.forEach((l) => l.stage && s.add(l.stage));
    return [...s].sort();
  }, [leads]);
  const sources = useMemo(() => {
    const s = new Set<string>();
    leads.forEach((l) => l.lead_sources?.name && s.add(l.lead_sources.name));
    return [...s].sort();
  }, [leads]);

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground uppercase">Stage</span>
        <Select value={filters.stageFilter} onValueChange={(v) => { filters.setStageFilter(v); onChange?.(); }}>
          <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL" className="text-xs">All stages</SelectItem>
            {stages.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">{STAGE_LABEL[s] ?? s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <RnrFilter value={filters.rnrFilter} onChange={(v) => { filters.setRnrFilter(v); onChange?.(); }} />
      {!isExec && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase">Executive</span>
          <Select value={filters.execFilter} onValueChange={(v) => { filters.setExecFilter(v); onChange?.(); }}>
            <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All Executives</SelectItem>
              {execs.map((e: any) => (
                <SelectItem key={e.id} value={e.id} className="text-xs">
                  {e.full_name}{e.primary_language ? ` · ${e.primary_language}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground uppercase">Language</span>
        <Select value={filters.langFilter} onValueChange={(v) => { filters.setLangFilter(v); onChange?.(); }}>
          <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL" className="text-xs">All languages</SelectItem>
            {languages.map((lg) => (
              <SelectItem key={lg} value={lg} className="text-xs">{lg}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground uppercase">Lead Source</span>
        <Select value={filters.sourceFilter} onValueChange={(v) => { filters.setSourceFilter(v); onChange?.(); }}>
          <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL" className="text-xs">All Sources</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}


function tatStatus(lead: any) {
  // Flat 48h SLA measured from stage entry (spec §14)
  const anchor = new Date(lead.stage_entered_at ?? lead.last_activity_at ?? lead.updated_at ?? lead.created_at).getTime();
  const hours = (Date.now() - anchor) / 3600000;
  const rounded = Math.round(hours);
  if (hours <= 48) return { label: `On Time · ${rounded}h`, cls: "bg-green-100 text-green-700", breached: false };
  return { label: `Breached · ${rounded}h`, cls: "bg-red-100 text-red-700", breached: true };
}

const NON_ABANDONED_STAGES = new Set(["KTN_LIVE","DEAD_LEAD","NO","LATER","NO_RESPONSE","RETARGETING"]);
function abandonedStatus(lead: any): { days: number; abandoned: boolean } | null {
  if (NON_ABANDONED_STAGES.has(lead.stage)) return null;
  const anchor = new Date(lead.stage_entered_at ?? lead.created_at).getTime();
  const days = Math.floor((Date.now() - anchor) / 86400000);
  return { days, abandoned: days >= 7 };
}

function LeadsPage() {
  const { data: roleData } = useQuery({
    queryKey: ["my-role"],
    queryFn: () => apiClient.get<MyRoleResponse>("/api/kob/my-role"),
  });
  const isExec = (roleData as any)?.role === "executive" || !roleData;
  const qc = useQueryClient();

  // Lead Inbox must start fresh on every visit: no restored search text, no
  // restored stage filter. These keys are still sessionStorage-backed (via
  // usePersistedState) so the value stays in sync when switching between
  // the Kanban and Table tabs WITHIN a single visit — only the across-visit
  // persistence is removed, by clearing them synchronously on first render
  // of this page, before any child's restore-on-mount effect runs.
  const clearedStaleStateRef = useRef(false);
  if (!clearedStaleStateRef.current) {
    try {
      window.sessionStorage.removeItem("kob:leads.table.stage");
      window.sessionStorage.removeItem("kob:leads.global.search");
      window.sessionStorage.removeItem("kob:leads.table.search");
    } catch { /* ignore */ }
    clearedStaleStateRef.current = true;
  }

  const [tab, setTab] = usePersistedState<string>("leads.tab", "kanban");
  const [range, setRange] = useDateRange("all_time", "leads.index.v2");
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };
  const { data: leads = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["leads-all", rangeArg.from, rangeArg.to],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("limit", "50000");
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      return apiClient.get<any[]>(`/api/kob/leads?${p.toString()}`);
    },
    // Safety net so unread badges still surface if the realtime socket drops.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });


  // Unread-badge refresh (incl. WhatsApp webhook bumping unread_message_count)
  // is handled by the refetchInterval above. A Supabase postgres_changes
  // subscription used to also drive this, but it listened to Supabase's own
  // Postgres replication stream, which no longer receives writes now that
  // kob_leads lives on RDS — it was already a non-functional no-op in
  // production. The 60s poll was always the mechanism actually keeping this
  // board current; removing the dead subscription changes no user-facing
  // behavior.

  const [search, setSearch] = usePersistedState<string>("leads.global.search", "");
  const visibleLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads as any[];
    const digits = q.replace(/\D/g, "");
    return (leads as any[]).filter((l) => {
      const phone = (l.phone ?? "").replace(/\D/g, "");
      if (digits && phone && phone.includes(digits)) return true;
      return (l.full_name ?? "").toLowerCase().includes(q) || (l.code ?? "").toLowerCase().includes(q);
    });
  }, [leads, search]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Lead Inbox · Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading leads…" : `${visibleLeads.length} leads · drag cards to change stage`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="h-9 w-[240px] rounded-md border bg-background px-3 text-sm"
          />
          <DateRangeFilter
            value={range}
            onChange={setRange}
            presets={["all_time", "today", "yesterday", "this_week", "this_month", "mtd", "last_3_months", "last_6_months", "custom"]}
          />
        </div>
      </div>

      {isError ? (
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="text-sm text-destructive font-medium">Failed to load leads</div>
            <div className="text-xs text-muted-foreground break-all">{(error as any)?.message ?? "Unknown error"}</div>
            <button onClick={() => refetch()} className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground">Retry</button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-10 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <div className="text-sm">Fetching leads…</div>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="kanban">Kanban Board</TabsTrigger>
            <TabsTrigger value="table">Table View</TabsTrigger>
          </TabsList>
          <TabsContent value="kanban"><Kanban leads={visibleLeads} isExec={isExec} /></TabsContent>
          <TabsContent value="table"><LeadsTable leads={visibleLeads} isExec={isExec} /></TabsContent>

        </Tabs>
      )}
    </div>
  );
}

function Kanban({ leads, isExec }: { leads: any[]; isExec?: boolean }) {
  const qc = useQueryClient();
  const [cuisineLead, setCuisineLead] = useState<string | null>(null);
  const { data: cfg } = useQuery({ queryKey: ["kob-config"], queryFn: () => apiClient.get<any>("/api/kob/get-config") });
  const autoMode = (cfg as any)?.default_mode === "AUTO";
  const { data: execs = [] } = useQuery({
    queryKey: ["all-execs"],
    queryFn: () => apiClient.get<any[]>("/api/kob/all-executives"),
    enabled: !isExec,
  });
  const filters = useLeadInboxFilters(isExec);
  const boardLeads = useMemo(() => applyLeadFilters(leads, filters), [leads, filters]);


  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over) return;
    const leadId = String(e.active.id);
    const stage = String(e.over.id);
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === stage) return;

    // Optimistic move so the card lands in the new column instantly.
    const prevStage = lead.stage;
    const patch = (target: string) =>
      qc.setQueriesData({ queryKey: ["leads-all"] }, (old: any) =>
        Array.isArray(old) ? old.map((l: any) => (l.id === leadId ? { ...l, stage: target } : l)) : old,
      );
    patch(stage);

    try {
      await apiClient.patch(`/api/kob/leads/${leadId}/stage`, { stage });
      toast.success(`Moved to ${STAGE_LABEL[stage] ?? stage}`);
      qc.invalidateQueries();
      if (stage === "KTN_CS") setCuisineLead(leadId);
    } catch (err: any) {
      patch(prevStage);
      toast.error(err.message ?? "Failed");
    }
  };


  return (
    <DndContext onDragEnd={onDragEnd}>
      <CuisineDialog leadId={cuisineLead} onClose={() => setCuisineLead(null)} />
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <LeadFilterControls filters={filters} leads={leads} execs={execs as any[]} isExec={isExec} />
        <span className="text-xs text-muted-foreground">{boardLeads.length} leads</span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {KANBAN_STAGES.map((stage) => (
          <Column
            key={stage}
            stage={stage}
            leads={boardLeads.filter((l) => l.stage === stage)}
            disabled={false}
            isExec={isExec}
          />
        ))}

      </div>
    </DndContext>
  );
}

function Column({ stage, leads, disabled, isExec }: { stage: string; leads: any[]; disabled?: boolean; isExec?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled });
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? leads : leads.slice(0, 40);
  return (
    <div
      ref={setNodeRef}
      className={`min-w-[300px] flex-1 rounded-lg border bg-muted/30 relative ${isOver && !disabled ? "ring-2 ring-primary" : ""} ${disabled ? "opacity-50 pointer-events-none blur-[1px] grayscale" : ""}`}
      aria-disabled={disabled}
      title={disabled ? "Disabled — AUTO mode skips Lead Inbox" : undefined}
    >
      <div className="p-3 border-b bg-background rounded-t-lg flex items-center justify-between">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLOR[stage]}`}>{STAGE_LABEL[stage] ?? stage}</span>
        <span className="text-xs text-muted-foreground">{leads.length}</span>
      </div>
      {disabled && (
        <div className="absolute inset-x-0 top-12 text-center text-[10px] font-medium text-muted-foreground px-2">
          AUTO mode · skipped
        </div>
      )}
      <div className="p-2 space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto">
        {visible.map((l) => <KanbanCard key={l.id} lead={l} isExec={isExec} />)}
        {leads.length > 40 && (
          <div className="text-center py-2">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
            >
              {showAll ? "Show less" : `+${leads.length - 40} more`}
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

function KanbanCard({ lead }: { lead: any; isExec?: boolean }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.5 : 1 } : undefined;
  const tat = tatStatus(lead);
  const ab = abandonedStatus(lead);
  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => { if (!isDragging) navigate({ to: "/leads/$id", params: { id: lead.id } }); }}
      className="cursor-pointer active:cursor-grabbing border-l-4 border-l-primary/60 shadow-sm"
    >
      <CardContent className="p-3 space-y-1.5">
        <div className="flex justify-between items-start gap-2">
          <div className="font-semibold text-sm leading-tight flex items-center gap-1.5">
            {lead.full_name}
            {lead.has_unread_messages && (
              <span
                title={lead.last_message ?? "Unread WhatsApp message"}
                className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold"
              >
                {lead.unread_message_count ?? 1}
              </span>
            )}
          </div>
          <Link to="/leads/$id" params={{ id: lead.id }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} className="text-[10px] text-primary hover:underline shrink-0">View →</Link>

        </div>

        <div className="text-[10px] font-mono text-muted-foreground">{lead.code}</div>
        <div className="text-xs font-medium text-foreground">{lead.phone ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{lead.brands?.name ?? "—"}</div>

        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{lead.language ?? "—"}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${lead.mode === "AUTO" ? "bg-teal-100 text-teal-700" : "bg-shero-mint text-shero-navy"}`}>{lead.mode ?? "—"}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${tat.cls}`}>TAT · {tat.label}</span>
          {ab?.abandoned && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">Abandoned · {ab.days}d</span>
          )}
          {hasRnr(lead) && (
            <span title="Ring No Response" className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-semibold">RNR</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{lead.india_states?.code ?? ""} · {lead.india_cities?.name ?? ""}</div>
        <div className="text-[11px] text-muted-foreground truncate">Source: {lead.lead_sources?.name ?? "—"}</div>
        <div className={`text-[11px] font-medium border-t pt-1 mt-1 ${lead.next_action ? "text-primary" : "text-muted-foreground italic"}`}>
          → {lead.next_action ?? "No action set"}
        </div>
      </CardContent>
    </Card>
  );
}

function LeadsTable({ leads, isExec }: { leads: any[]; isExec?: boolean }) {
  const qc = useQueryClient();
  const { data: execs = [] } = useQuery({
    queryKey: ["all-execs"],
    queryFn: () => apiClient.get<any[]>("/api/kob/all-executives"),
    enabled: !isExec,
  });

  const filters = useLeadInboxFilters(isExec);
  const langFilter = filters.langFilter;
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkExec, setBulkExec] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = usePersistedState<string>("leads.table.search", "");

  const matchedLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return applyLeadFilters(leads, filters)
      .filter((l) => {
        if (!q) return true;
        const phone = (l.phone ?? "").replace(/\D/g, "");
        if (digits && phone && phone.includes(digits)) return true;
        return (
          (l.full_name ?? "").toLowerCase().includes(q) ||
          (l.code ?? "").toLowerCase().includes(q)
        );
      });
  }, [leads, filters, search]);


  const filtered = useMemo(() => matchedLeads.slice(0, 2000), [matchedLeads]);



  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const allChecked = filtered.length > 0 && filtered.every((l) => selected[l.id]);
  const toggleAll = () => {
    const next = { ...selected };
    if (allChecked) filtered.forEach((l) => (next[l.id] = false));
    else filtered.forEach((l) => (next[l.id] = true));
    setSelected(next);
  };

  const matchedExecs = (lang: string | null) =>
    (execs as any[]).filter((e) => lang && e.primary_language === lang);
  const bulkExecs = langFilter === "ALL" ? (execs as any[]) : matchedExecs(langFilter);

  const assign = async (leadId: string, executiveId: string) => {
    try {
      await apiClient.patch(`/api/kob/leads/${leadId}/assignee`, { executiveId });
      toast.success("Lead allocated");
      qc.invalidateQueries();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to allocate");
    }
  };

  const bulkAssign = async () => {
    if (!bulkExec || selectedIds.length === 0) return;
    setBusy(true);
    let ok = 0, fail = 0;
    for (const id of selectedIds) {
      try { await apiClient.patch(`/api/kob/leads/${id}/assignee`, { executiveId: bulkExec }); ok++; }
      catch { fail++; }
    }
    setBusy(false);
    setSelected({});
    setBulkExec("");
    qc.invalidateQueries();
    toast[fail ? "warning" : "success"](`Assigned ${ok}${fail ? ` · ${fail} failed` : ""}`);
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <LeadFilterControls
            filters={filters}
            leads={leads}
            execs={execs as any[]}
            isExec={isExec}
            onChange={() => { setSelected({}); setBulkExec(""); }}
          />

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search phone, name or code…"
            className="h-8 w-[240px] rounded-md border bg-background px-2 text-xs"
          />
          <div className="text-xs text-muted-foreground">{matchedLeads.length} leads{!isExec ? ` · ${selectedIds.length} selected` : ""}</div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={matchedLeads.length === 0}
            onClick={() => exportLeadsCsv("leads", matchedLeads)}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
          </Button>
          {!isExec && (
            <div className="ml-auto flex items-center gap-2">
              <Select value={bulkExec} onValueChange={setBulkExec} disabled={selectedIds.length === 0}>
                <SelectTrigger className="h-8 w-[240px] text-xs">
                  <SelectValue placeholder={selectedIds.length === 0 ? "Select leads first" : "Assign to executive…"} />
                </SelectTrigger>
                <SelectContent>
                  {langFilter !== "ALL" && (
                    <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">Language match · {langFilter}</div>
                  )}
                  {bulkExecs.map((e: any) => (
                    <SelectItem key={e.id} value={e.id} className="text-xs">
                      {e.full_name}{e.primary_language ? ` · ${e.primary_language}` : ""}
                    </SelectItem>
                  ))}
                  {bulkExecs.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">No executives</div>}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={bulkAssign} disabled={!bulkExec || selectedIds.length === 0 || busy}>
                {busy ? "Assigning…" : `Assign ${selectedIds.length || ""}`}
              </Button>
            </div>
          )}

        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                {!isExec && <th className="p-2 w-8"><Checkbox checked={allChecked} onCheckedChange={toggleAll} /></th>}
                <th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Phone</th>
                <th className="p-2 min-w-[200px]">Last WhatsApp Message</th>
                <th className="p-2">Language</th><th className="p-2">Mode</th>
                <th className="p-2">Source</th>
                <th className="p-2">Stage</th>
                {!isExec && <th className="p-2 min-w-[180px]">Assign To</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const matched = matchedExecs(l.language);
                const others = (execs as any[]).filter((e) => !matched.includes(e));
                return (
                  <tr key={l.id} className="border-b hover:bg-muted/40">
                    {!isExec && <td className="p-2"><Checkbox checked={!!selected[l.id]} onCheckedChange={(v) => setSelected((s) => ({ ...s, [l.id]: !!v }))} /></td>}
                    <td className="p-2 font-mono text-xs"><Link to="/leads/$id" params={{ id: l.id }} className="text-primary hover:underline">{l.code}</Link></td>
                    <td className="p-2 font-medium"><Link to="/leads/$id" params={{ id: l.id }} className="hover:underline">{l.full_name}</Link></td>
                    <td className="p-2 text-xs">{l.phone ?? "—"}</td>
                    <td className="p-2"><LastMessageCell message={l.last_message} at={l.last_message_at} unread={l.has_unread_messages} /></td>
                    <td className="p-2">{l.language}</td>
                    <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-[10px] ${l.mode === "AUTO" ? "bg-teal-100 text-teal-700" : "bg-muted text-muted-foreground"}`}>{l.mode}</span></td>
                    <td className="p-2">{l.lead_sources?.name}</td>
                    <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${STAGE_COLOR[l.stage]}`}>{STAGE_LABEL[l.stage] ?? l.stage}</span></td>
                    {!isExec && (
                    <td className="p-2">
                      <Select value={l.assigned_to ?? undefined} onValueChange={(v) => assign(l.id, v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                        <SelectContent>
                          {matched.length > 0 && (
                            <>
                              <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">Language match{l.language ? ` · ${l.language}` : ""}</div>
                              {matched.map((e: any) => (
                                <SelectItem key={e.id} value={e.id} className="text-xs">
                                  {e.full_name}{e.primary_language ? ` · ${e.primary_language}` : ""}
                                </SelectItem>
                              ))}
                            </>
                          )}
                          {others.length > 0 && (
                            <>
                              <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground border-t mt-1">Other executives</div>
                              {others.map((e: any) => (
                                <SelectItem key={e.id} value={e.id} className="text-xs">
                                  {e.full_name}{e.primary_language ? ` · ${e.primary_language}` : ""}
                                </SelectItem>
                              ))}
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </td>
                    )}

                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
