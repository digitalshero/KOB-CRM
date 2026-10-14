# Auto Conversion Funnel: Response Split cohort fix

Only the Auto funnel's Response Split popup (funnel view and table view) changes.

## What changes

Today the Auto Response Split ignores the date filter and looks at every lead ever. It also counts a response no matter who made the move.

New rule:
1. **Cohort first.** Take the exact leads created within the selected date filter. Both Auto and Manual leads count.
2. **Automatic responses only.** For those same leads, count moves out of the clicked stage into Interested, NO, Later or No Response, but only when the system made the move (no user recorded). Manual moves are ignored.
3. **Unique leads.** Each lead counts once per response category.
4. **Older leads left out.** A lead created before the selected dates is not counted, even if it moved during them.

Stage mapping stays as it is today:
- EOI 1 row: from Auto Fired / EOI 1 → Interested = Webinar
- Webinar row: from Webinar → Interested = EOI 2
- EOI 2 row: from EOI 2 → Interested = Form Filled / Fee Paid

The column layout stays the same, but each column now uses its own lead cohort:
- **Lifetime** = leads created in the selected date filter
- **MTD** = leads created this month
- **Table daily columns** = leads created on that day

## Not changed

Auto funnel stage numbers, Manual funnel and Manual Response Split, Combined funnel, lead mode, stage movement, retargeting, Abandoned Funnel, templates, SCV, and the design.

## Technical details

- `AutoConversionFunnel.tsx`: pass `range` to `ResponseSplitDialog`.
- `ResponseSplitDialog.tsx`: send `from`/`to` to the auto split functions only, and include them in the query keys. Manual and Combined calls stay the same.
- `getStageResponseSplit`: take an optional `from`/`to`. Load `kob_leads` ids created in that range (paged), plus this month's ids for MTD. Fetch history rows for those ids in chunks of 200, filtered by `changed_by IS NULL`, `from_stage IN sources` and `to_stage IN targets`. Drop the old "entered automatically" pre-filter.
- `getVariantStageResponseSplitTable` (auto branch only): same cohort and `changed_by IS NULL` filter. Daily buckets are keyed by the lead's created day (IST), MTD uses this month's cohort, and lifetime uses the selected range. The manual branch stays the same.
