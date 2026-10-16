import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Clock, User, Phone, PhoneOff, MapPin, Tag, Zap, MessageSquare, MessageCircle, TrendingUp, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CuisineDialog } from "@/components/cuisine-dialog";

export const Route = createFileRoute("/_authenticated/leads/$id")({
  head: () => ({ meta: [{ title: "Lead Journey — Shero KOB" }] }),
  component: LeadDetailPage,
});

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
  LEAD_INBOX: "bg-shero-mint text-shero-navy border-shero-navy/25",
  AUTO_FIRED: "bg-shero-mint text-shero-navy border-shero-navy/25",
  FAILED_FIRE: "bg-red-100 text-red-700 border-red-300",
  EOI_1: "bg-teal-100 text-teal-700 border-teal-300",
  WEBINAR: "bg-teal-100 text-teal-800 border-teal-300",
  WEBINAR_ATTENDED: "bg-teal-200 text-teal-900 border-teal-400",
  EOI2_PENDING: "bg-lime-100 text-lime-700 border-lime-300",
  EOI_2: "bg-emerald-100 text-emerald-700 border-emerald-300",
  FORM_FILLED: "bg-shero-mint text-shero-navy border-shero-navy/30",
  FEE_PAID: "bg-green-100 text-green-700 border-green-300",
  AGREEMENT_SIGNED: "bg-green-200 text-green-800 border-green-400",
  KTN_CS: "bg-green-300 text-green-900 border-green-500",
  KTN_LIVE: "bg-green-500 text-white border-green-600",
  NO: "bg-red-100 text-red-700 border-red-300",
  LATER: "bg-yellow-100 text-yellow-700 border-yellow-300",
  NO_RESPONSE: "bg-amber-100 text-amber-700 border-amber-300",
  RETARGETING: "bg-amber-100 text-amber-700 border-amber-300",
  DEAD_LEAD: "bg-gray-300 text-gray-800 border-gray-400",
};

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}
function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function LeadDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["lead-detail", id],
    queryFn: async () => {
      try {
        return await apiClient.get<any>(`/api/kob/lead-detail?leadId=${encodeURIComponent(id)}`);
      } catch (err: any) {
        return { errorMessage: err?.message ?? "Failed to load lead journey" };
      }
    },
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading lead journey…</div>;
  if (!data || (data as any).errorMessage) {
    return (
      <div className="p-6 max-w-2xl">
        <Button asChild variant="ghost" size="sm" className="mb-3">
          <Link to="/leads"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Lead Inbox</Link>
        </Button>
        <Card>
          <CardContent className="p-6 space-y-2">
            <h1 className="text-lg font-semibold">Lead journey unavailable</h1>
            <p className="text-sm text-muted-foreground">{(data as any)?.errorMessage ?? "Failed to load lead journey."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { lead, history, activities, actors, people } = data as any;

  // Merge timeline: creation + stage changes + activities
  const timeline: Array<{ ts: string; type: "created" | "stage" | "activity"; payload: any }> = [];
  timeline.push({ ts: lead.created_at, type: "created", payload: {} });
  for (const h of history) timeline.push({ ts: h.created_at, type: "stage", payload: h });
  for (const a of activities) timeline.push({ ts: a.created_at, type: "activity", payload: a });
  timeline.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const assigned = lead.assigned_to ? people?.[lead.assigned_to] : null;
  const tl = lead.team_leader_id ? people?.[lead.team_leader_id] : null;
  const isDead = lead.stage === "DEAD_LEAD";
  const isLive = lead.stage === "KTN_LIVE";

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/leads"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Lead Inbox</Link>
        </Button>
      </div>

      {/* Header card */}
      <Card className="border-l-4 border-l-primary shadow-sm">
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">{lead.full_name}</h1>
                <Badge variant="outline" className="font-mono">{lead.code}</Badge>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5"/>{lead.phone ?? "—"}
                  {lead.phone && (
                    <a
                      href={`https://conversation-widget.gallabox.com/conversations/phone/${String(lead.phone).replace(/\D/g, "")}?name=${encodeURIComponent(lead.full_name ?? "")}&channelId=660bdabd3a96237ad64ff6d6`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Chat on WhatsApp"
                      aria-label="Chat on WhatsApp"
                      className="ml-1 inline-flex items-center justify-center h-6 w-6 rounded-full bg-green-500 text-white hover:bg-green-600 transition-colors"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                    </a>
                  )}
                </span>
                <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5"/>{lead.india_cities?.name ?? "—"}, {lead.india_states?.name ?? "—"}</span>
                <span className="flex items-center gap-1"><Tag className="h-3.5 w-3.5"/>{lead.brands?.name ?? "—"}</span>
              </div>
            </div>
            <div className="text-right space-y-1">
              <span className={`inline-block px-3 py-1 rounded-md text-sm font-semibold border ${STAGE_COLOR[lead.stage] ?? "bg-gray-100 text-gray-700 border-gray-300"}`}>
                {STAGE_LABEL[lead.stage] ?? lead.stage}
              </span>
              {(lead.tags ?? []).length > 0 && (
                <div className="flex items-center justify-end gap-1 flex-wrap">
                  {(lead.tags as string[]).map((t) => (
                    <span
                      key={t}
                      title={t === "RNR" ? "Ring No Response" : t}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold ${t === "RNR" ? "bg-rose-100 text-rose-700" : "bg-muted text-muted-foreground"}`}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-xs text-muted-foreground">SCV Score: <span className="font-semibold text-foreground">{lead.scv_score ?? 0}</span></div>
              <div className="flex items-center justify-end gap-2 flex-wrap">
                <RnrTagButton leadId={lead.id} tags={lead.tags ?? []} />
                <MoveToRetargetingDialog leadId={lead.id} currentStage={lead.stage} />
              </div>
            </div>

          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm pt-2 border-t">
            <Info label="Language" value={lead.language} />
            <Info label="Mode" value={lead.mode} />
            <Info label="Source" value={lead.lead_sources?.name} />
            
            <Info label="Assigned To" value={assigned?.full_name ?? "Unassigned"} icon={<User className="h-3 w-3"/>} />
            <Info label="Team Leader" value={tl?.full_name ?? "—"} />
            <Info label="Created" value={fmt(lead.created_at)} />
            <Info label="Last Activity" value={fmt(lead.last_activity_at ?? lead.updated_at)} />
          </div>
        </CardContent>
      </Card>

      <UnreadMessagesCard
        leadId={lead.id}
        unread={lead.unread_message_count ?? 0}
        hasUnread={Boolean(lead.has_unread_messages)}
        lastMessage={lead.last_message}
        lastMessageAt={lead.last_message_at}
      />

      {lead.stage === "KTN_CS" && <CuisineCard leadId={lead.id} cuisine={lead.cuisine ?? null} />}

      <NextActionCard leadId={lead.id} initial={lead.next_action ?? ""} stageAnchor={lead.stage_entered_at ?? lead.last_activity_at ?? lead.created_at} />

      <EvaluationScoreCard leadId={lead.id} />

      {/* Journey summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryTile
          icon={<Clock className="h-4 w-4"/>}
          label="Lifecycle duration"
          value={ago(lead.created_at).replace(" ago", "")}
          hint={`From ${new Date(lead.created_at).toLocaleDateString()}`}
        />
        <SummaryTile
          icon={<TrendingUp className="h-4 w-4"/>}
          label="Stage changes"
          value={String(history.length)}
          hint={history.length ? `Latest: ${STAGE_LABEL[history[history.length-1].to_stage] ?? history[history.length-1].to_stage}` : "No transitions yet"}
        />
        <SummaryTile
          icon={<Zap className="h-4 w-4"/>}
          label="Total activities"
          value={String(activities.length)}
          hint={isLive ? "🎉 Converted to KTN Live" : isDead ? "☠ Marked as Dead Lead" : "In active pipeline"}
        />
      </div>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" /> Lead Journey · Full Lifecycle
          </CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <div className="text-sm text-muted-foreground">No journey events yet.</div>
          ) : (
            <ol className="relative border-l-2 border-muted ml-2 space-y-4">
              {timeline.map((ev, idx) => {
                const isLast = idx === timeline.length - 1;
                let dotClass = "bg-muted-foreground";
                let icon: React.ReactNode = <Clock className="h-3 w-3 text-white"/>;
                let title: React.ReactNode = null;
                let body: React.ReactNode = null;
                let actor: string | null = null;

                if (ev.type === "created") {
                  dotClass = "bg-shero-navy";
                  title = <span className="font-semibold">Lead created</span>;
                  body = <span className="text-muted-foreground">Entered pipeline as <b>{STAGE_LABEL.LEAD_INBOX}</b> from source <b>{lead.lead_sources?.name ?? "—"}</b></span>;
                } else if (ev.type === "stage") {
                  const p = ev.payload;
                  const toIsTerminal = p.to_stage === "KTN_LIVE" || p.to_stage === "DEAD_LEAD";
                  dotClass = p.to_stage === "KTN_LIVE" ? "bg-green-500" : p.to_stage === "DEAD_LEAD" ? "bg-gray-500" : "bg-primary";
                  icon = <TrendingUp className="h-3 w-3 text-white"/>;
                  title = (
                    <span className="font-semibold">
                      Stage moved:{" "}
                      <span className={`px-1.5 py-0.5 rounded text-xs border ${STAGE_COLOR[p.from_stage ?? ""] ?? "bg-gray-100 text-gray-700 border-gray-300"}`}>{STAGE_LABEL[p.from_stage] ?? p.from_stage ?? "—"}</span>
                      {" → "}
                      <span className={`px-1.5 py-0.5 rounded text-xs border ${STAGE_COLOR[p.to_stage] ?? "bg-gray-100 text-gray-700 border-gray-300"}`}>{STAGE_LABEL[p.to_stage] ?? p.to_stage}</span>
                      {toIsTerminal && <span className="ml-2 text-xs">{p.to_stage === "KTN_LIVE" ? "🎉 Terminal · Won" : "☠ Terminal · Dead"}</span>}
                    </span>
                  );
                  if (p.note) body = <span className="text-muted-foreground">Note: {p.note}</span>;
                  actor = p.changed_by ? actors?.[p.changed_by] ?? "System" : "System";
                } else {
                  const p = ev.payload;
                  dotClass = "bg-shero-navy/70";
                  icon = <MessageSquare className="h-3 w-3 text-white"/>;
                  title = <span className="font-semibold">{p.activity_type.replace(/_/g, " ")}</span>;
                  if (p.detail) body = <span className="text-muted-foreground">{p.detail}</span>;
                  actor = p.actor_id ? actors?.[p.actor_id] ?? "System" : "System";
                }

                return (
                  <li key={idx} className="ml-6">
                    <span className={`absolute -left-[9px] flex items-center justify-center h-4 w-4 rounded-full ${dotClass} ring-2 ring-background`}>{icon}</span>
                    <div className="space-y-0.5">
                      <div className="text-sm">{title}</div>
                      {body && <div className="text-xs">{body}</div>}
                      <div className="text-[11px] text-muted-foreground">
                        {fmt(ev.ts)} · {ago(ev.ts)}
                        {actor && <> · by <span className="text-foreground">{actor}</span></>}
                      </div>
                    </div>
                    {isLast && <div className="text-[11px] text-primary mt-1 font-medium">↑ Current position in journey</div>}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Tag-only control. Does not touch stage, mode, assignment or automation.
function RnrTagButton({ leadId, tags }: { leadId: string; tags: string[] }) {
  const qc = useQueryClient();
  const [active, setActive] = useState(tags.includes("RNR"));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setActive(tags.includes("RNR")); }, [tags.join(",")]);

  const toggle = async () => {
    const next = !active;
    setSaving(true);
    try {
      await apiClient.patch(`/api/kob/leads/${leadId}/rnr-tag`, { rnr: next });
      setActive(next);
      toast.success(next ? "Tagged RNR (Ring No Response)" : "RNR tag removed");
      qc.invalidateQueries({ queryKey: ["lead-detail", leadId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update RNR tag");
    } finally { setSaving(false); }
  };

  return (
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={toggle}
      disabled={saving}
      title="Ring No Response — tag only, stage is unchanged"
    >
      <PhoneOff className="h-4 w-4 mr-1" /> {active ? "RNR ✓" : "RNR"}
    </Button>
  );
}


const RETARGET_OPTIONS = [
  { value: "NO", label: "No", hint: "Customer said no" },
  { value: "LATER", label: "Later", hint: "Customer asked to be contacted later" },
  { value: "NO_RESPONSE", label: "No Response", hint: "Customer never responded" },
  { value: "NON_SERVICEABLE", label: "Non Serviceable", hint: "Location / requirement not serviceable" },
  { value: "NO_VACANCY", label: "No Vacancy", hint: "No kitchen vacancy available in this area" },
] as const;

function MoveToRetargetingDialog({ leadId, currentStage }: { leadId: string; currentStage: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const isTerminal = ["NO", "LATER", "NO_RESPONSE", "RETARGETING", "DEAD_LEAD", "KTN_LIVE", "NON_SERVICEABLE", "NO_VACANCY"].includes(currentStage);
  if (isTerminal) return null;

  const confirm = async () => {
    if (!reason) return;
    setSaving(true);
    try {
      await apiClient.patch(`/api/kob/leads/${leadId}/stage`, { stage: reason });
      toast.success(`Lead moved to ${STAGE_LABEL[reason] ?? reason}`);
      setOpen(false);
      setReason("");
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to move lead");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="mt-1">Move to Retargeting</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to Retargeting</DialogTitle>
          <DialogDescription>
            Select a reason. The lead leaves <b>{STAGE_LABEL[currentStage] ?? currentStage}</b> and enters the chosen retargeting stage.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={reason} onValueChange={setReason} className="space-y-2 text-left">
          {RETARGET_OPTIONS.map((o) => (
            <div key={o.value} className="flex items-start gap-3 rounded-md border p-3">
              <RadioGroupItem value={o.value} id={`rt-${o.value}`} className="mt-1" />
              <Label htmlFor={`rt-${o.value}`} className="cursor-pointer">
                <div className="font-medium">{o.label}</div>
                <div className="text-xs text-muted-foreground">{o.hint}</div>
              </Label>
            </div>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={confirm} disabled={!reason || saving}>{saving ? "Moving…" : "Confirm"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function Info({ label, value, icon }: { label: string; value: any; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className="font-medium truncate">{value ?? "—"}</div>
    </div>
  );
}

function SummaryTile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{hint}</div>
      </CardContent>
    </Card>
  );
}

function NextActionCard({ leadId, initial, stageAnchor }: { leadId: string; initial: string; stageAnchor: string }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  useEffect(() => { setValue(initial); }, [initial]);

  const hours = (Date.now() - new Date(stageAnchor).getTime()) / 3600000;
  const breached = hours > 48;
  const rounded = Math.round(hours);

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.patch(`/api/kob/leads/${leadId}/next-action`, { nextAction: value });
      toast.success("Next action saved");
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally { setSaving(false); }
  };

  return (
    <Card className={`border-l-4 shadow-sm ${breached ? "border-l-red-500" : "border-l-green-500"}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-semibold">Next Action</div>
          <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${breached ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
            TAT · {breached ? `Breached · ${rounded}h` : `On Time · ${rounded}h`}
          </span>
        </div>
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Call at 5pm, Send agreement copy"
            maxLength={500}
          />
          <Button onClick={save} disabled={saving || value === initial} size="sm">
            <Save className="h-4 w-4 mr-1" /> Save
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground">Free-text note set manually by the Executive or TL. 48h SLA measured from stage entry.</div>
      </CardContent>
    </Card>
  );
}

function EvaluationScoreCard({ leadId }: { leadId: string }) {
  const { data } = useQuery({
    queryKey: ["lead-eval", leadId],
    queryFn: () => apiClient.get<any>(`/api/evaluation/lead?lead_id=${encodeURIComponent(leadId)}`),
  });
  const score = (data as any)?.score;
  if (!score || (score.answered_count ?? 0) === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" /> KP Evaluation</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-2xl font-bold">{score.total_score ?? "—"}<span className="text-sm text-muted-foreground">/100</span></div>
          <div className="text-xs text-muted-foreground">Weighted average score</div>
        </div>
        <div>
          <div className="text-lg font-semibold">{score.answered_count}<span className="text-sm text-muted-foreground"> / {score.total_active_questions}</span></div>
          <div className="text-xs text-muted-foreground">Questions answered</div>
        </div>
      </CardContent>
    </Card>
  );
}
function UnreadMessagesCard({
  leadId, unread, hasUnread, lastMessage, lastMessageAt,
}: { leadId: string; unread: number; hasUnread: boolean; lastMessage?: string | null; lastMessageAt?: string | null }) {
  const qc = useQueryClient();
  const [read, setRead] = useState(!hasUnread);

  const markRead = async () => {
    try {
      await apiClient.post(`/api/kob/leads/${leadId}/messages/read`);
      setRead(true);
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to mark as read");
    }
  };

  // Opening the conversation view clears the unread badge automatically.
  useEffect(() => { if (hasUnread) { markRead(); } /* eslint-disable-next-line */ }, [leadId, hasUnread]);

  if (!lastMessage && !hasUnread) return null;

  return (
    <Card className={`border-l-4 shadow-sm ${hasUnread && !read ? "border-l-red-500" : "border-l-green-500"}`}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-semibold flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-green-600" /> WhatsApp Messages
            {hasUnread && !read && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold">
                {unread || 1}
              </span>
            )}
          </div>
          {hasUnread && !read && (
            <Button size="sm" variant="outline" onClick={markRead}>Mark as Read</Button>
          )}
        </div>
        {lastMessage && (
          <div className="text-sm">
            <span className="text-muted-foreground">Last message:</span> {lastMessage}
          </div>
        )}
        <div className="text-[11px] text-muted-foreground">{lastMessageAt ? fmt(lastMessageAt) : "—"}</div>
      </CardContent>
    </Card>
  );
}

function CuisineCard({ leadId, cuisine }: { leadId: string; cuisine: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <span className="font-semibold">Cuisine:</span>{" "}
          <span className={cuisine ? "" : "text-muted-foreground"}>{cuisine ?? "Not Selected"}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {cuisine ? "Change Cuisine" : "Select Cuisine"}
        </Button>
      </CardContent>
      <CuisineDialog leadId={open ? leadId : null} current={cuisine} onClose={() => setOpen(false)} />
    </Card>
  );
}
