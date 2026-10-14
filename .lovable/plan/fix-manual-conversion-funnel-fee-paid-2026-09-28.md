# Fix Manual Conversion Funnel → Fee Paid

## What changes
Fee Paid on the Manual Conversion Funnel will count every lead created in the selected dates that a team member moved into Fee Paid by hand, whatever stage it came from (EOI 2, KTN CS, Webinar, EOI 1 or any other). Each lead counts once. Leads created before the selected dates still don't count.

Example: IND-03017 Vanitha Sakthi (created in September, moved by hand from KTN CS back to Fee Paid) will now be counted in September.

## What stays the same
Lead Generated, EOI 1, Webinar, EOI 2, Contract Signed, Auto funnel, Response Split, date filter, Executive Performance, Contracts card, SCV & Incentives, and everything else.

## Technical details
- File: `src/lib/kob-dashboard.server.ts`, function `manualProgressionKey` only.
- Add: `if (to === "FEE_PAID") return "feePaid";` next to the existing KTN_CS rule (before the `!from` check). Only transitions with `changed_by IS NOT NULL` are fetched, and the cohort/unique-lead counter is unchanged, so the rule applies to daily, MTD and range columns alike.
- `MANUAL_PROGRESSIONS` entry for FEE_PAID becomes unused but stays in place; the auto/combined tables are not touched.
