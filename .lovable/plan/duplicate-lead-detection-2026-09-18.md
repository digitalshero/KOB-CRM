# Duplicate Lead Detection

When a new lead arrives with a phone number that already exists in the CRM, the newer lead is parked in a new `DUPLICATE_LEAD` stage and kept out of every automated flow. The first (oldest) lead is never touched.

## Rule

- Phone is compared using the same normalisation already used elsewhere: digits only, drop the country code, compare the last 10 digits.
- Oldest lead with that phone stays exactly as it is — same stage, source, owner, templates, timers.
- Every later lead with the same phone is created directly in `DUPLICATE_LEAD`.
- No initial template, no retargeting, no automatic stage movement, no executive assignment for duplicate leads.
- Leads with no phone, or a phone shorter than 10 digits, follow existing behaviour unchanged.

## How it works (technical)

1. Add `DUPLICATE_LEAD` to the `lead_stage` enum.
2. New BEFORE INSERT trigger on `kob_leads`, named so it runs before the existing insert triggers: if another lead already exists with the same 10-digit phone tail, set `NEW.stage := 'DUPLICATE_LEAD'`. Because the classification happens at insert time it is inherently idempotent — a lead is judged once, when created.
3. Keep the automation out without editing any existing function body: re-create the existing AFTER INSERT template triggers (`meta_ads`, `support`, `whatsapp_broadcast`, the four `website_form` ones) with an added `WHEN (new.stage <> 'DUPLICATE_LEAD')` clause. Function bodies, template names, source rules and provider flow stay byte-identical.
4. Assignment already self-excludes: `auto_assign_lead_inbox` only runs for `LEAD_INBOX`, and auto-fire only for `AUTO_FIRED`, so duplicates get no owner and no fire. Retargeting only enrols on stage *updates*, so duplicates never enrol.
5. `validate_stage_transition`: allow a manual move *out* of `DUPLICATE_LEAD` (so a mistake can be corrected), and do not allow moving a lead *into* `DUPLICATE_LEAD` by update — the stage is set only at creation.

## UI

- Add `DUPLICATE_LEAD` (label "Duplicate Lead") to the shared stage list and stage-label maps so it appears in stage filters, the lead detail stage display, and funnel/stage tables that iterate the shared list.
- No layout, dashboard-metric, or funnel-calculation changes.

## Explicitly unchanged

Original-lead logic, all template names and sending logic, retargeting cadences, stage automation for non-duplicate leads, assignment for originals, APIs, webhooks, and all other schema and UI.
