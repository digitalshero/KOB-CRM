# Audit only: Response Split in the main Conversion Funnel

Nothing in the app, data or logic will be changed. I'll only read the code and run read-only queries on the current data.

## What I'll check
For each clickable stage in the main Conversion Funnel (EOI 1, Webinar, EOI 2):
1. Which leads can appear in the Response Split, and what counts as the stage they leave from.
2. Which stages count as Interested, Not Interested, No Response and Later.
3. Whether moves by the system and by hand both count, and whether stage history is used.
4. What sets the MTD, Lifetime and Share numbers.
5. Whether a lead can count more than once, or in more than one response.
6. Whether the lead's created date, its current stage, returns from No / Later / No Response / Retargeting, or duplicate leads change the count.
7. Whether the split follows the same rules as the funnel stage count.

## Reconciliation for each stage (current month, as shown now)
- Funnel stage count
- Interested, Not Interested, No Response and Later counts, the total, and the number of unique leads
- Leads that appear in more than one response, with IDs
- Leads in the split that aren't in the funnel stage, with the reason
- Leads in the funnel stage that have no response yet
- Leads that returned to the stage later
- Anything else that explains the difference

## What you'll get
- The breakdown for each stage, with lead IDs where the counts differ
- A short summary of how the numbers are counted now
- A list of mismatches or problems I find, with no fixes made

## Technical details
- Code: the combined response-split and table functions called by the Conversion Funnel's split popup, and the combined funnel counts.
- Data: read-only SELECT queries on the stage history and leads for the current month.
