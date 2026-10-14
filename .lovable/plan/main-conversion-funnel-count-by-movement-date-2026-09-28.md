# Main Conversion Funnel — count by movement date

Only the main Conversion Funnel card on the KOB Dashboard changes (summary view and table view). The Auto and Manual funnels, Response Splits and everything else stay the same.

## New counting rules

- **Leads**: every lead created within the chosen dates (Auto and Manual). No change.
- **Other stages**: count each lead once if it moved into the stage within the chosen dates. The lead's created date no longer matters. Moves by the system and by hand both count.
  - **EOI 1**: moves in from Lead Inbox, Auto Fired or Failed Fire.
  - **Webinar**: moves in from EOI 1.
  - **EOI 2**: moves in from Webinar, Webinar Attended, EOI 1 or EOI 2 Pending.
  - **Fee Paid**: moves in from any stage except No, Later or No Response.
  - **Contract Signed** (KTN CS): moves in from any stage except No, Later or No Response.

Example: a lead created on 30 Aug that reaches KTN CS on 15 Sep counts in every stage after Leads when you pick September, but not in Leads.

## Other columns

- **Abandoned** still means "entered this stage in the chosen dates and is still sitting in it now". The current stage is now looked up for every counted lead, not only the ones created in the chosen dates.
- **% of Leads** keeps the same formula. Leads created earlier can now count in later stages, so a stage can go over 100%.

## Technical details

- `getCombinedFunnel` (src/lib/kob-dashboard.functions.ts): drop the `pop.has(lead_id)` cohort filter. Filter `lead_stage_history` by `created_at` within the range. Replace the stage rules with the new ones: EOI_2 from WEBINAR / WEBINAR_ATTENDED / EOI_1 / EOI2_PENDING, and FEE_PAID / KTN_CS from any non-null from_stage except NO / LATER / NO_RESPONSE. Fetch the current `stage` for counted lead IDs in chunks of 200, used to calculate Abandoned.
- `computeCombinedBuckets` (src/lib/kob-dashboard.server.ts, used by the table view daily/MTD columns): it already counts by movement date. Update `COMBINED_PROGRESSIONS` / `combinedProgressionKey` to the same stage rules.
- No changes to the database, the UI, or the Auto/Manual funnel code.
