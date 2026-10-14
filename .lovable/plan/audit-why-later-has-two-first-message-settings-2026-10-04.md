# Audit: Why LATER has two "First message" settings

Audit only. No changes to sequence logic, settings, templates or the page.

## Finding
LATER has two first-message delays because the live automation picks the first nudge's timing based on **which stage the lead came from** when it moved into LATER.

| Lead moved to LATER from | First message after | Setting used |
|---|---|---|
| Lead Inbox | 7 days (currently) | First message — from Lead Inbox / EOI 1 / Webinar |
| EOI 1 | 7 days (currently) | same |
| Webinar | 7 days (currently) | same |
| Any other stage | 1 day (currently) | First message — standard |

Only one first message is ever sent per lead. The two settings are alternatives, not two messages.

## How it works (live)
1. When a lead enters LATER, it is enrolled and its first nudge is scheduled using the **standard** delay (1 day).
2. Straight after, a second automatic step checks the previous stage. If it was Lead Inbox, EOI 1 or Webinar, it **re-schedules** that same first nudge to the **source** delay (7 days) and tags the source (e.g. LEAD_INBOX_LATER_7D, EOI1_LATER_7D, WEBINAR_LATER_7D) so the matching template is used.
3. After the first nudge, both paths follow the same Phase 1 / Final phase / Dead Lead sequence.

## Why it was built this way
These leads were already contacted recently in their earlier stage (welcome / EOI / webinar messages), so the CRM waits longer (7 days) before nudging again. Leads from other stages get a quick next-day nudge.

## Technical details
- Standard delay: `auto_enroll_retargeting` uses `rt_later_first_msg_days`.
- Source override: `send_retargeting_first_touch` replaces it with `rt_later_source_first_msg_days` when OLD.stage is LEAD_INBOX, EOI_1 or WEBINAR, only if no attempt has been sent yet.

## Changes
None.
