import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/targeting-rules")({
  head: () => ({
    meta: [
      { title: "Targeting Rules — Shero KOB" },
      { name: "description", content: "Read-only view of the retargeting rules currently running in the CRM." },
      { property: "og:title", content: "Targeting Rules — Shero KOB" },
      { property: "og:description", content: "Read-only view of the retargeting rules currently running in the CRM." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TargetingRules,
});

type Rule = { stage: string; wait: string; trigger: string; template: string; language: string; status: string };

// Read-only mirror of the live backend automation (hourly scheduled jobs and
// stage-change triggers). Timings/templates hardcoded in the backend are shown as-is.
const STAGE_RULES: Rule[] = [
  { stage: "Lead Inbox", wait: "24 hours in stage", trigger: "Lead still in Lead Inbox, not yet sent for this stage entry", template: "lead_inbox_retargeting", language: "All languages", status: "Active" },
  { stage: "Lead Inbox", wait: "24 hours after that message", trigger: "Still in Lead Inbox → moved to NO_RESPONSE", template: "— (stage move only)", language: "All languages", status: "Active" },
  { stage: "EOI 1", wait: "24 hours in stage", trigger: "Lead still in EOI 1, not yet sent for this stage entry", template: "eoi_1_retarget", language: "All except Telugu / Malayalam", status: "Active" },
  { stage: "EOI 1", wait: "24 hours in stage", trigger: "Same as above", template: "eoi_1_retarget_telugu", language: "Telugu", status: "Active" },
  { stage: "EOI 1", wait: "24 hours in stage", trigger: "Same as above", template: "eoi_1_retarget_malayalam", language: "Malayalam", status: "Active" },
  { stage: "EOI 1", wait: "48 hours in stage", trigger: "Still in EOI 1 → moved to NO_RESPONSE", template: "— (stage move only)", language: "All languages", status: "Active" },
  { stage: "Webinar", wait: "24 hours in stage", trigger: "Lead still in Webinar, not yet sent for this stage entry", template: "webinar_retarget_clone_clone", language: "Tamil", status: "Active" },
  { stage: "Webinar", wait: "24 hours in stage", trigger: "Same as above", template: "webinar_retarget_telugu_clone", language: "Telugu", status: "Active" },
  { stage: "Webinar", wait: "24 hours in stage", trigger: "Same as above", template: "webinar_retarget_malayalam_clone", language: "Malayalam", status: "Active" },
  { stage: "Webinar", wait: "24 hours after that message", trigger: "Still in Webinar → moved to NO_RESPONSE", template: "— (stage move only)", language: "Tamil / Telugu / Malayalam", status: "Active" },
  { stage: "Webinar", wait: "Hourly check", trigger: "Lead marked as not attended in a webinar batch", template: "Active Gallabox template in category WEBINAR_DEFAULTER (WhatsApp + email)", language: "Matches lead language", status: "Active" },
  { stage: "Webinar Attended", wait: "—", trigger: "No automatic retargeting implemented", template: "—", language: "—", status: "None" },
  { stage: "EOI 2 Pending", wait: "—", trigger: "No automatic retargeting implemented", template: "—", language: "—", status: "None" },
  { stage: "EOI 2", wait: "—", trigger: "No automatic retargeting implemented", template: "—", language: "—", status: "None" },
  { stage: "Fee Paid", wait: "—", trigger: "No automatic retargeting implemented", template: "—", language: "—", status: "None" },
];

function buildBucketRules(c: any): Rule[] {
  const v = (k: string, d: number) => (c?.[k] ?? d);
  const abandoned = "eoi_1_abandoned_clone_clone (Telugu: eoi_1_abandoned_telugu_clone · Malayalam: eoi_1_abandoned_malayalam_clone)";
  return [
    { stage: "NO", wait: `${v("rt_no_days", 30)} days after entering NO`, trigger: "First message after entering NO", template: "no_retargeting_tamil_crm / no_retargeting_telugu_crm / no_retargeting_malayalam_crm", language: "Tamil / Telugu / Malayalam", status: "Active" },
    { stage: "NO", wait: `Every ${v("rt_no_days", 30)} days`, trigger: "Later attempts and other languages — the EOI 1 abandoned template is blocked for NO, so these are skipped and rechecked", template: "— (not sent)", language: "All", status: "Skipped" },
    { stage: "NO", wait: `After ${v("rt_no_attempts", 6)} attempts`, trigger: "Lead moved to DEAD_LEAD", template: "—", language: "All", status: "Active" },

    { stage: "LATER", wait: "7 days", trigger: "Entered LATER directly from Lead Inbox (first message)", template: "later_retargeting_clone_tamil_new_crm_clone / later_retargeting_telugu_new_crm / later_retargeting_malayalam_new_crm (others: leadinbox_stage_retargeting_clone)", language: "By lead language", status: "Active" },
    { stage: "LATER", wait: "7 days", trigger: "Entered LATER directly from EOI 1 (first message)", template: "later_retargeting_tamil_new_crm / later_retargeting_telugu_new_crm1 / later_retargeting_malayalam_new_crm1", language: "Tamil / Telugu / Malayalam (others: default below)", status: "Active" },
    { stage: "LATER", wait: "7 days", trigger: "Entered LATER directly from Webinar (first message)", template: "webinar_later_retargeting_new_crm_clone / webinar_later_telugu_retargeting_new_crm / webinar_later_malayalam_retargeting_new_crm", language: "Tamil / Telugu / Malayalam (others: default below)", status: "Active" },
    { stage: "LATER", wait: "24 hours", trigger: "Entered LATER from any other stage (first message)", template: abandoned, language: "By lead language", status: "Active" },
    { stage: "LATER", wait: `Every ${v("rt_later_first_days", 10)} days × ${v("rt_later_first_attempts", 3)}`, trigger: "Follow-up attempts, phase 1", template: abandoned, language: "By lead language", status: "Active" },
    { stage: "LATER", wait: `Then every ${v("rt_later_then_days", 30)} days`, trigger: "Follow-up attempts, phase 2", template: abandoned, language: "By lead language", status: "Active" },
    { stage: "LATER", wait: "180 days after first entry", trigger: "Lead moved to DEAD_LEAD", template: "—", language: "All", status: "Active" },

    { stage: "NO_RESPONSE", wait: "24 hours", trigger: "Came from Lead Inbox / Failed Fire (first message)", template: "leadinbox_stage_retargeting_clone", language: "All languages", status: "Active" },
    { stage: "NO_RESPONSE", wait: "24 hours", trigger: "Came from Webinar (first message)", template: "webinar_abandoned_clone / webinar_abandoned_telugu_clone / webinar_abandoned_malayalam_clone_clone", language: "Tamil / Telugu / Malayalam", status: "Active" },
    { stage: "NO_RESPONSE", wait: "24 hours", trigger: "Came from EOI 1 or any other stage (first message)", template: abandoned, language: "By lead language", status: "Active" },
    { stage: "NO_RESPONSE", wait: `Every ${v("rt_noresp_first_days", 3)} day(s) × ${v("rt_noresp_first_attempts", 3)}`, trigger: "Follow-up attempts, phase 1", template: abandoned, language: "By lead language", status: "Active" },
    { stage: "NO_RESPONSE", wait: `Every ${v("rt_noresp_second_days", 10)} days × ${v("rt_noresp_second_attempts", 3)}`, trigger: "Follow-up attempts, phase 2", template: abandoned, language: "By lead language", status: "Active" },
    { stage: "NO_RESPONSE", wait: `Then every ${v("rt_noresp_final_days", 30)} days`, trigger: "Follow-up attempts, phase 3", template: abandoned, language: "By lead language", status: "Active" },
    { stage: "NO_RESPONSE", wait: "180 days after first entry", trigger: "Lead moved to DEAD_LEAD", template: "—", language: "All", status: "Active" },
  ];
}

function StatusBadge({ s }: { s: string }) {
  const cls = s === "Active" ? "bg-primary/10 text-primary" : s === "Skipped" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{s}</span>;
}

function RulesTable({ rows }: { rows: Rule[] }) {
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>{["Stage", "Wait Time", "Trigger Condition", "Template", "Language", "Status"].map((h) => <th key={h} className="p-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const first = i === 0 || rows[i - 1].stage !== r.stage;
              return (
                <tr key={i} className={first ? "border-t" : ""}>
                  <td className="p-3 align-top font-medium">{first ? r.stage : <span className="text-muted-foreground">→</span>}</td>
                  <td className="p-3 align-top whitespace-nowrap">{r.wait}</td>
                  <td className="p-3 align-top">{r.trigger}</td>
                  <td className="p-3 align-top font-mono text-xs break-words">{r.template}</td>
                  <td className="p-3 align-top">{r.language}</td>
                  <td className="p-3 align-top"><StatusBadge s={r.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

type Step = { day: string; label: string; note?: string; muted?: boolean };
type Phase = { title: string; steps: Step[] };
type Seq = { name: string; entry: string; first: string[]; phases: Phase[]; final: string; notes: string[] };

// Mirrors process_retargeting_sends / auto_enroll_retargeting / send_retargeting_first_touch.
// Cadence and attempt counts come live from the same retargeting settings the automation reads.
function buildSequences(c: any): Seq[] {
  const v = (k: string, d: number) => Number(c?.[k] ?? d);
  const noDays = Math.max(v("rt_no_days", 30), 1), noAttempts = v("rt_no_attempts", 6);
  const lFirstD = Math.max(v("rt_later_first_days", 10), 1), lFirstN = v("rt_later_first_attempts", 3), lThen = Math.max(v("rt_later_then_days", 30), 1);
  const r1d = Math.max(v("rt_noresp_first_days", 3), 1), r1n = v("rt_noresp_first_attempts", 3);
  const r2d = Math.max(v("rt_noresp_second_days", 10), 1), r2n = v("rt_noresp_second_attempts", 3);
  const r3d = Math.max(v("rt_noresp_final_days", 30), 1);
  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

  const later1: Step[] = [{ day: "Day 1 or Day 7", label: "Attempt 1", note: "first message" }];
  for (let i = 2; i <= lFirstN; i++) later1.push({ day: `+${plural(lFirstD)}`, label: `Attempt ${i}` });
  const resp1: Step[] = [{ day: "Day 1", label: "Attempt 1", note: "first message" }];
  for (let i = 2; i <= r1n; i++) resp1.push({ day: `+${plural(r1d)}`, label: `Attempt ${i}` });
  const resp2: Step[] = [];
  for (let i = 1; i <= r2n; i++) resp2.push({ day: `+${plural(r2d)}`, label: `Attempt ${r1n + i}` });

  return [
    {
      name: "NO", entry: "Lead moved to NO",
      first: ["Tamil / Telugu / Malayalam: no_retargeting_<language>_crm", "Other languages: no message (blocked)"],
      phases: [{ title: `Every ${plural(noDays)}`, steps: [
        { day: `Day ${noDays}`, label: "Attempt 1", note: "Tamil / Telugu / Malayalam only" },
        { day: `+${plural(noDays)}`, label: "Rechecked", note: "no message sent", muted: true },
        { day: `+${plural(noDays)}`, label: "Rechecked", note: "repeats", muted: true },
      ] }],
      final: `Dead Lead after ${noAttempts} sent attempts`,
      notes: ["Only the first message is actually sent. Later attempts would use the EOI 1 abandoned template, which is blocked for NO, so they are skipped and rechecked without counting — in practice the Dead Lead limit is not reached."],
    },
    {
      name: "LATER", entry: "Lead moved to LATER",
      first: [
        "From Lead Inbox / EOI 1 / Webinar: Day 7, language-specific LATER template",
        "From any other stage: Day 1 (24 hours), EOI 1 abandoned template by language",
      ],
      phases: [
        { title: `Phase 1 — every ${plural(lFirstD)}`, steps: later1 },
        { title: `Phase 2 — every ${plural(lThen)}`, steps: [
          { day: `+${plural(lThen)}`, label: `Attempt ${lFirstN + 1}` },
          { day: `+${plural(lThen)}`, label: "Next attempt", note: "repeats" },
        ] },
      ],
      final: "Dead Lead 180 days after entering LATER",
      notes: ["Follow-ups use the EOI 1 abandoned template in the lead's language (Telugu and Malayalam have their own versions)."],
    },
    {
      name: "NO RESPONSE", entry: "Lead moved to NO_RESPONSE",
      first: [
        "From Lead Inbox / Failed Fire: leadinbox_stage_retargeting_clone",
        "From Webinar: webinar abandoned template (Tamil / Telugu / Malayalam)",
        "From EOI 1 or other stages: EOI 1 abandoned template by language",
      ],
      phases: [
        { title: `Phase 1 — every ${plural(r1d)}`, steps: resp1 },
        { title: `Phase 2 — every ${plural(r2d)}`, steps: resp2 },
        { title: `Final phase — every ${plural(r3d)}`, steps: [
          { day: `+${plural(r3d)}`, label: `Attempt ${r1n + r2n + 1}` },
          { day: `+${plural(r3d)}`, label: "Next attempt", note: "repeats" },
        ] },
      ],
      final: "Dead Lead 180 days after entering NO_RESPONSE",
      notes: ["Follow-ups after the first message use the EOI 1 abandoned template in the lead's language."],
    },
  ];
}

function SequenceView({ config }: { config: any }) {
  const seqs = buildSequences(config);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {seqs.map((s) => (
        <Card key={s.name}>
          <CardContent className="space-y-4 p-4">
            <div className="text-lg font-bold">{s.name}</div>
            <div className="rounded-md border bg-muted/40 p-2 text-sm"><span className="text-xs font-semibold uppercase text-muted-foreground">Entry</span><div className="font-medium">{s.entry}</div></div>
            <div className="text-xs">
              <div className="mb-1 font-semibold uppercase text-muted-foreground">First message</div>
              <ul className="space-y-0.5 text-muted-foreground">{s.first.map((f) => <li key={f}>• {f}</li>)}</ul>
            </div>
            {s.phases.map((p, pi) => (
              <div key={pi}>
                {pi > 0 && <div className="py-1 text-center text-muted-foreground">↓</div>}
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{p.title}</div>
                <ol className="space-y-1.5 border-l-2 border-primary/30 pl-3">
                  {p.steps.map((st, i) => (
                    <li key={i} className={`flex items-center gap-2 text-sm ${st.muted ? "text-muted-foreground" : ""}`}>
                      <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">{st.day}</span>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${st.muted ? "bg-muted" : "bg-primary/10 text-primary"}`}>{st.label}</span>
                      {st.note && <span className="text-xs text-muted-foreground">{st.note}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            <div className="py-1 text-center text-muted-foreground">↓</div>
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm font-medium text-destructive">{s.final}</div>
            {s.notes.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TargetingRules() {
  const { data } = useQuery({ queryKey: ["cfg"], queryFn: () => apiClient.get<any>("/api/kob/get-config") });
  const [view, setView] = useState<"rules" | "sequence">("rules");
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Targeting Rules</h1>
        <p className="text-sm text-muted-foreground">Read-only. Shows the retargeting rules currently running in the CRM automation. Automatic checks run every hour, so messages go out within about an hour of the wait time.</p>
      </div>
      <div className="inline-flex rounded-lg bg-muted p-1">
        {([["rules", "Targeting Rules"], ["sequence", "Retargeting Sequence"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
        ))}
      </div>
      {view === "sequence" ? (<>
        <SequenceView config={data} />
        <p className="text-xs text-muted-foreground">Cadence and attempt counts are read live from the current retargeting settings; message names and the 180-day limit are fixed in the automation.</p>
      </>) : (<>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">Stage Retargeting</h2>
        <RulesTable rows={STAGE_RULES} />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">NO / LATER / NO RESPONSE Retargeting</h2>
        <RulesTable rows={buildBucketRules(data)} />
        <p className="text-xs text-muted-foreground">Repeat intervals and attempt counts are read live from the current retargeting settings. Duplicate leads are excluded from all automated messages.</p>
      </section>
      </>)}
    </div>
  );
}
