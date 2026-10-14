# Auto Conversion Funnel: strict stage-entry rules (automatic moves only)

Tighten how each row of the Auto Conversion Funnel is counted, so a lead is only credited when it arrived from the correct previous stage AND the move was automatic. Lead Generated stays exactly as it is today.

## New counting rules (Auto funnel only)

| Row | Counts a lead only when it moved |
| --- | --- |
| Lead Generated | unchanged |
| EOI 1 | Lead Inbox, Failed Fire, or Auto Fired → EOI 1 |
| Webinar Invite Sent | EOI 1 → Webinar |
| Webinar Attendees | unchanged (from Webinar History) |
| EOI 2 | Webinar → EOI 2 |
| Fee Paid | EOI 2 → Fee Paid |
| Contract Signed | Fee Paid → KTN CS (label unchanged) |

Every counted transition must also be automatic: only stage-history rows where `changed_by IS NULL` qualify. A manual move of the same transition is not counted (e.g. manual EOI 1 → Webinar does not count). Moves coming back from NO, LATER, NO Response, Retargeting, Dead Lead, or any other stage are not counted. Moves with no recorded previous stage are not counted. Each lead is still counted once per row per period.

## Scope

- Applies to the Auto Conversion Funnel calculation only: the range totals, the daily/MTD table columns, and the auto section of the public funnel endpoint (all read from the same calculation).
- The Manual funnel and the combined Conversion Funnel keep their current wider rules.
- No changes to stage-movement automation/workflow — this only changes which transitions the Auto funnel counts.
- No changes to Lead Generated, Webinar Attendees, Manual Funnel, Combined Funnel, Response Split, Retargeting Funnel, KPIs, templates, UI, filters, or any lead data.

## Technical detail

In `src/lib/kob-dashboard.server.ts`, the shared `PROGRESSIONS` table and `progressionKey()` currently serve both auto and manual buckets and allow a null `from_stage`. Introduce a separate strict progression map used only by `computeAutoBuckets`:

- `EOI_1` from `LEAD_INBOX | AUTO_FIRED | FAILED_FIRE`
- `WEBINAR` from `EOI_1`
- `EOI_2` from `WEBINAR`
- `FEE_PAID` from `EOI_2`
- `KTN_CS` from `FEE_PAID`
- rows with `from_stage IS NULL` are skipped
- only rows with `changed_by IS NULL` (automatic moves) are counted; manual transitions are excluded

`computeManualBuckets` and `computeCombinedBuckets` continue to use the existing `PROGRESSIONS`/`progressionKey` unchanged. `computeAutoBuckets` is also what `/api/public/kob/conversion-funnels` uses for its auto section, so that endpoint follows the same strict rules.

## Verification

Run the funnel calculation over a recent window and compare per-row counts before and after, confirming reductions come only from disallowed origin stages and manual transitions, and that Lead Generated and Webinar Attendees are unchanged.
