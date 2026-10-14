import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LastMessageCell } from "@/components/last-message-cell";
import { apiClient } from "@/lib/api-client";

import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useDateRange } from "@/hooks/use-date-range";
import { exportLeadsCsv } from "@/lib/export-csv";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ceo/lead-inbox")({
  head: () => ({ meta: [{ title: "Lead Inbox (View) — CEO Office" }] }),
  component: CeoLeadInbox,
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
  LEAD_INBOX: "bg-cyan-100 text-cyan-700", AUTO_FIRED: "bg-sky-100 text-sky-700", FAILED_FIRE: "bg-red-100 text-red-700",
  EOI_1: "bg-teal-100 text-teal-700", WEBINAR: "bg-teal-100 text-teal-800", WEBINAR_ATTENDED: "bg-teal-200 text-teal-900", EOI2_PENDING: "bg-lime-100 text-lime-700", EOI_2: "bg-emerald-100 text-emerald-700",
  FORM_FILLED: "bg-violet-100 text-violet-700", FEE_PAID: "bg-green-100 text-green-700",
  AGREEMENT_SIGNED: "bg-green-200 text-green-800", KTN_CS: "bg-green-300 text-green-900", KTN_LIVE: "bg-green-500 text-white",
  NO: "bg-red-100 text-red-700", LATER: "bg-yellow-100 text-yellow-700", NO_RESPONSE: "bg-orange-100 text-orange-700",
  RETARGETING: "bg-amber-100 text-amber-700", DEAD_LEAD: "bg-gray-200 text-gray-700",
  NON_SERVICEABLE: "bg-slate-200 text-slate-700", NO_VACANCY: "bg-stone-200 text-stone-700",
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

function tatStatus(lead: any) {
  const anchor = new Date(lead.stage_entered_at ?? lead.last_activity_at ?? lead.updated_at ?? lead.created_at).getTime();
  const hours = (Date.now() - anchor) / 3600000;
  const rounded = Math.round(hours);
  if (hours <= 48) return { label: `On Time · ${rounded}h`, cls: "bg-green-100 text-green-700" };
  return { label: `Breached · ${rounded}h`, cls: "bg-red-100 text-red-700" };
}

const NON_ABANDONED_STAGES = new Set(["KTN_LIVE","DEAD_LEAD","NO","LATER","NO_RESPONSE","RETARGETING"]);
function abandonedStatus(lead: any) {
  if (NON_ABANDONED_STAGES.has(lead.stage)) return null;
  const anchor = new Date(lead.stage_entered_at ?? lead.created_at).getTime();
  const days = Math.floor((Date.now() - anchor) / 86400000);
  return { days, abandoned: days >= 7 };
}

function CeoLeadInbox() {
  const [tab, setTab] = usePersistedState<string>("ceo.inbox.tab", "kanban");
  const [range, setRange] = useDateRange("all_time", "ceo.lead-inbox.v2");
  const rangeArg = { from: range.from.toISOString(), to: range.to.toISOString() };
  const { data: leads = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["ceo-leads-all", rangeArg.from, rangeArg.to],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("limit", "50000");
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      return apiClient.get<any[]>(`/api/kob/leads?${p.toString()}`);
    },
  });


  const [search, setSearch] = usePersistedState<string>("ceo.inbox.global.search", "");
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
          <h1 className="text-2xl font-bold">Lead Inbox · View Only</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading leads…" : `${visibleLeads.length} leads · read-only observer view`}
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
          <TabsContent value="kanban"><ReadOnlyKanban leads={visibleLeads} /></TabsContent>
          <TabsContent value="table"><ReadOnlyTable leads={visibleLeads} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function ReadOnlyKanban({ leads }: { leads: any[] }) {
  const [rnrFilter, setRnrFilter] = usePersistedState<string>("ceo.inbox.kanban.rnr", "ALL");
  const boardLeads = useMemo(() => applyRnrFilter(leads, rnrFilter), [leads, rnrFilter]);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <RnrFilter value={rnrFilter} onChange={setRnrFilter} />
        <span className="text-xs text-muted-foreground">{boardLeads.length} leads</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {KANBAN_STAGES.map((stage) => (
          <StageColumn key={stage} stage={stage} stageLeads={boardLeads.filter((l) => l.stage === stage)} />
        ))}
      </div>
    </div>
  );
}

function StageColumn({ stage, stageLeads }: { stage: string; stageLeads: any[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? stageLeads : stageLeads.slice(0, 40);
  return (
        <div className="min-w-[300px] flex-1 rounded-lg border bg-muted/30">
            <div className="p-3 border-b bg-background rounded-t-lg flex items-center justify-between">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLOR[stage]}`}>{STAGE_LABEL[stage] ?? stage}</span>
              <span className="text-xs text-muted-foreground">{stageLeads.length}</span>
            </div>
            <div className="p-2 space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto">
              {visible.map((l) => {


                const tat = tatStatus(l);
                const ab = abandonedStatus(l);
                return (
                  <Link key={l.id} to="/leads/$id" params={{ id: l.id }} className="block">
                    <Card className="border-l-4 border-l-primary/60 shadow-sm cursor-pointer hover:shadow-md hover:border-l-primary transition-shadow">
                      <CardContent className="p-3 space-y-1.5">
                        <div className="font-semibold text-sm leading-tight">{l.full_name}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">{l.code}</div>
                        <div className="text-xs font-medium text-foreground">{l.phone ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{l.brands?.name ?? "—"}</div>
                        <div className="flex flex-wrap gap-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{l.language ?? "—"}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${l.mode === "AUTO" ? "bg-sky-100 text-sky-700" : "bg-purple-100 text-purple-700"}`}>{l.mode ?? "—"}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${tat.cls}`}>TAT · {tat.label}</span>
                          {ab?.abandoned && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">Abandoned · {ab.days}d</span>
                          )}
                          {hasRnr(l) && (
                            <span title="Ring No Response" className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-semibold">RNR</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{l.india_states?.code ?? ""} · {l.india_cities?.name ?? ""}</div>
                        <div className="text-[11px] text-muted-foreground truncate">Source: {l.lead_sources?.name ?? "—"}</div>
                        <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                          <NextActionEditor lead={l} />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>


                );
              })}
              {stageLeads.length > 40 && (
                <div className="text-center py-2">
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
                  >
                    {showAll ? "Show less" : `+${stageLeads.length - 40} more`}
                  </button>
                </div>
              )}
            </div>
          </div>
  );
}


function NextActionEditor({ lead }: { lead: any }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(lead.next_action ?? "");
  const [current, setCurrent] = useState<string | null>(lead.next_action ?? null);
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const next = value.trim() ? value.trim() : null;
    setEditing(false);
    if (next === current) return;
    setSaving(true);
    try {
      await apiClient.patch(`/api/kob/leads/${lead.id}/next-action`, { nextAction: next });
      setCurrent(next);
      toast.success("Next action updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save next action");
      setValue(current ?? "");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        maxLength={500}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setValue(current ?? ""); setEditing(false); }
        }}
        placeholder="Type next action…"
        className="w-full text-[11px] border rounded px-1.5 py-1 mt-1 bg-background"
      />
    );
  }

  return (
    <div className="mt-1 border-t pt-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Next action</div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to type the next action"
        className={`w-full text-left text-[11px] border border-input rounded-md px-2 py-1.5 bg-background shadow-sm hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${current ? "text-foreground" : "text-muted-foreground"}`}
      >
        {saving ? "Saving…" : (current ?? "Type next action…")}
      </button>
    </div>
  );
}


function ReadOnlyTable({ leads }: { leads: any[] }) {
  const [stageFilter, setStageFilter] = usePersistedState<string>("ceo.inbox.stage", "ALL");
  const [langFilter, setLangFilter] = usePersistedState<string>("ceo.inbox.lang", "ALL");
  const [sourceFilter, setSourceFilter] = usePersistedState<string>("ceo.inbox.source", "ALL");
  const [rnrFilter, setRnrFilter] = usePersistedState<string>("ceo.inbox.rnr", "ALL");
  const [search, setSearch] = usePersistedState<string>("ceo.inbox.search", "");

  const languages = useMemo(() => {
    const s = new Set<string>();
    leads.forEach((l) => l.language && s.add(l.language));
    return [...s].sort();
  }, [leads]);

  const sources = useMemo(() => {
    const s = new Set<string>();
    leads.forEach((l) => l.lead_sources?.name && s.add(l.lead_sources.name));
    return [...s].sort();
  }, [leads]);

  const matchedLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return leads
      .filter((l) => stageFilter === "ALL" || l.stage === stageFilter)
      .filter((l) => langFilter === "ALL" || l.language === langFilter)
      .filter((l) => sourceFilter === "ALL" || (l.lead_sources?.name ?? "") === sourceFilter)
      .filter((l) => (rnrFilter === "ALL" ? true : rnrFilter === "RNR" ? hasRnr(l) : !hasRnr(l)))
      .filter((l) => {
        if (!q) return true;
        const phone = (l.phone ?? "").replace(/\D/g, "");
        if (digits && phone && phone.includes(digits)) return true;
        return (
          (l.full_name ?? "").toLowerCase().includes(q) ||
          (l.code ?? "").toLowerCase().includes(q)
        );
      });
  }, [leads, stageFilter, langFilter, sourceFilter, rnrFilter, search]);

  const filtered = useMemo(() => matchedLeads.slice(0, 2000), [matchedLeads]);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground uppercase">Stage</span>
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL" className="text-xs">All stages</SelectItem>
                {KANBAN_STAGES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{STAGE_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground uppercase">Language</span>
            <Select value={langFilter} onValueChange={setLangFilter}>
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
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL" className="text-xs">All Sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <RnrFilter value={rnrFilter} onChange={setRnrFilter} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search phone, name or code…"
            className="h-8 w-[240px] rounded-md border bg-background px-2 text-xs"
          />
          <div className="text-xs text-muted-foreground">{matchedLeads.length} leads</div>
          <button
            type="button"
            onClick={() => exportLeadsCsv("lead-inbox", matchedLeads)}
            disabled={matchedLeads.length === 0}
            className="ml-auto inline-flex items-center gap-1.5 h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Phone</th>
                <th className="p-2 min-w-[200px]">Last WhatsApp Message</th>
                <th className="p-2">Language</th><th className="p-2">Mode</th>
                <th className="p-2">Source</th>
                <th className="p-2">Stage</th><th className="p-2">Assigned</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-mono text-xs"><Link to="/leads/$id" params={{ id: l.id }} className="text-primary hover:underline">{l.code}</Link></td>
                  <td className="p-2 font-medium"><Link to="/leads/$id" params={{ id: l.id }} className="hover:underline">{l.full_name}</Link></td>
                  <td className="p-2 text-xs">{l.phone ?? "—"}</td>
                  <td className="p-2"><LastMessageCell message={l.last_message} at={l.last_message_at} unread={l.has_unread_messages} /></td>
                  <td className="p-2">{l.language}</td>
                  <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-[10px] ${l.mode === "AUTO" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-700"}`}>{l.mode}</span></td>
                  <td className="p-2">{l.lead_sources?.name}</td>

                  <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${STAGE_COLOR[l.stage]}`}>{STAGE_LABEL[l.stage] ?? l.stage}</span></td>
                  <td className="p-2 text-xs text-muted-foreground">{l.assigned_profile?.full_name ?? "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="p-6 text-center text-muted-foreground text-sm">No leads match</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
