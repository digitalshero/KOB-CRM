import { useState } from "react";
import { Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Small ⓘ button that opens a compact explanation popup (information only).
export function InfoButton({ title, lines }: { title: string; lines: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`How ${title} is calculated`}
        onClick={() => setOpen(true)}
        className="rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4 text-primary" /> {title}
            </DialogTitle>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm leading-snug text-muted-foreground">
            {lines.map((l) => {
              const i = l.indexOf(": ");
              return (
                <li key={l} className="flex gap-2">
                  <span>•</span>
                  {i > 0 && i < 40 ? (
                    <span><b className="text-foreground">{l.slice(0, i)}:</b> {l.slice(i + 2)}</span>
                  ) : (
                    <span>{l}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TitleWithInfo({ title, lines }: { title: string; lines: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {title}
      <InfoButton title={title} lines={lines} />
    </span>
  );
}

export const FUNNEL_INFO: Record<string, string[]> = {
  "Manual Conversion Funnel": [
    "Lead Generated: leads with mode = Manual created in the selected dates. A lead is Manual when a team member adds it with the CRM Add Lead form (any source picked there, e.g. Manual, Meta Ads, Support, Website Form). Source alone does not decide it.",
    "EOI 1: manual moves into EOI 1 from Lead Inbox, Auto Fired or Failed Fire.",
    "Webinar: manual moves into Webinar from EOI 1 only.",
    "EOI 2: manual moves into EOI 2 from Webinar, Webinar Attended or EOI 2 Pending.",
    "Fee Paid: manual moves from EOI 2 only.",
    "Contract Signed: manual moves from Fee Paid to KTN CS only.",
    "Date range: Only leads created within the selected date range are included. Both Manual and Auto leads can count when moved manually to eligible stages, even if the movement happens before or after the selected dates. Leads created outside the selected range are excluded.",
    "Manual move: a stage change made by a logged-in CRM user.",
    "Unique: each lead counts once per stage.",
  ],
  "Auto Conversion Funnel": [
    "Lead Generated: leads with mode = Auto created in the selected dates. New leads arriving through integrations (Meta Ads, Website Form, Support, WhatsApp Broadcast, CSV import) default to Auto. Source alone does not decide it.",
    "EOI 1 Auto-Fired: automatic moves into EOI 1 from Lead Inbox, Auto Fired or Failed Fire.",
    "Webinar Invite Sent: automatic moves into Webinar from EOI 1 only.",
    "Webinar Attendees: attendance records marked Attended in Webinar History, for webinar batches scheduled in the selected dates. Exception: uses the batch date, not the lead's created date, and counts each attendance record.",
    "EOI 2: automatic moves into EOI 2 from Webinar, Webinar Attended or EOI 2 Pending.",
    "Fee Paid: automatic moves from EOI 2 only.",
    "Contract Signed: automatic moves from Fee Paid to KTN CS only.",
    "Date range: Only Auto leads created within the selected date range are included. Their eligible automatic stage movements are counted, even if they happen after the selected dates. Leads created outside the selected range are excluded. Webinar Attendees follows a separate rule based on the webinar's scheduled date.",
    "Automatic move: a stage change made by the system, with no CRM user recorded.",
    "Unique: each lead counts once per stage.",
  ],
  "Conversion Funnel": [
    "Lead Generated: both Auto and Manual leads created within the selected date range.",
    "EOI 1: Lead Inbox / Auto Fired / Failed Fire → EOI 1.",
    "Webinar: EOI 1 → Webinar.",
    "EOI 2: Webinar / Webinar Attended / EOI 2 Pending → EOI 2.",
    "Fee Paid: EOI 2 → Fee Paid.",
    "Contract Signed: Fee Paid → KTN CS.",
    "Date range: Lead Generated counts leads created within the selected date range. Other funnel stages count qualifying movements made within the selected date range, including leads created in previous months.",
    "Movements: both Auto and Manual movements are included.",
    "Unique: each lead counts only once per stage (its first qualifying move).",
    "Excluded: direct movements from NO, LATER or NO RESPONSE.",
  ],
  "Abandoned Split": [
    "Abandoned Split counts leads that moved from any of the following stages into NO, LATER, or NO RESPONSE: Lead Inbox, Auto Fired, EOI 1, Webinar, Webinar Attended, EOI 2 Pending, EOI 2.",
    "The data is calculated from the CRM's inception date up to the selected As-of Date.",
    "If a lead moves back from NO, LATER, or NO RESPONSE to any of the stages listed above, it will no longer be counted in Abandoned Split as of that date.",
    "Each lead is counted only once, based on its latest qualifying stage movement as of the selected date.",
  ],
  "Retargeting Split": [
    "Retargeting Split counts leads that moved from any of the following stages: NO, LATER, NO RESPONSE.",
    "Into: Lead Inbox, EOI 1, Webinar.",
    "The data is calculated from the CRM's inception date up to the selected As-of Date.",
    "Both automatic and manual stage movements are included.",
    "Each lead is counted only once within each destination stage.",
  ],
};
