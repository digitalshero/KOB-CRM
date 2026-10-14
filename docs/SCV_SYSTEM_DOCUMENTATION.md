# SCV System — Complete Documentation

> **Documentation only.** Nothing in the app, database, APIs, UI or calculations was changed to produce this document.

> **Terminology note:** In this system **SCV = "Sales Composite Value"** — a weighted performance score for staff (executives, team leaders, managers). It is **not** a service-coverage / serviceability engine. Geographic serviceability is a separate concern handled by Market Scope (`india_states` / `india_districts` / `india_cities` / `india_pincodes`, `brand_state_availability`, `state_native_brand`) and the `NON_SERVICEABLE` lead stage. Section 4 documents the actual SCV rules and explains, where relevant, why coverage/distance/cuisine concepts do not exist in SCV.

---

## 1. SCV Overview

### What SCV means
SCV is a 0–100 score describing how well a staff member is performing on the Kitchen Onboarding funnel. It is computed **live on read** — it is never stored as a snapshot for the official pages.

### Purpose
- Rank executives on a leaderboard.
- Map performance to an incentive payout slab (%).
- Combine objective (system-measured) performance with subjective manager ratings into a role-weighted **Composite Score**.

### Where SCV is used
| Surface | Route |
| --- | --- |
| SCV Leaderboard + incentive slabs | `/incentives` |
| TL detailed SCV & incentive breakdown | `/tl/scv-incentives` |
| Manager monthly ratings + composite scores | `/mgr/monthly-ratings` |
| CEO rule configuration | `/ceo/scv-rules` |
| Manager "SCV & Incentives" nav item | redirects to `/incentives` |
| CEO "Incentive Rules" nav item | redirects to `/incentives` |

### Modules that depend on SCV
- Incentive computation (payout % and estimated amount).
- Monthly ratings / composite scoring.
- Manager and TL reports show a `teamScv` average, but that average reads the **legacy `kob_leads.scv_score` column**, not the live SCV engine (see §6).

---

## 2. SCV Data Flow

```text
Lead activity (kob_leads, lead_stage_history, lead_activities)
        |
        v
Staff selection (profiles + user_roles: which users are scored)
        |
        v
Rule load (scv_rules weights, incentive_rules slabs, scv_role_weights)
        |
        v
Component percentages (Conversion, TAT, EOI1->Webinar, EOI2->Payment, CRM)
        |
        v
Weighted sum -> Official SCV (0-100, rounded)
        |
        v
Slab lookup (incentive_rules) -> label + payout %
        |
        +--> Leaderboard / TL incentive table
        |
        v
Composite blend with manual ratings (scv_manual_ratings x scv_role_weights)
        |
        v
Composite Score -> /mgr/monthly-ratings
```

### Step-by-step
1. **Input gathering.** For each scored user, all leads currently assigned to them are read from `kob_leads`, plus their full `lead_stage_history` rows and `lead_activities` rows.
2. **Rule load.** `scv_rules` (row `id = 1`) supplies the five component weights. If the row is missing, the TypeScript engine falls back to hardcoded 35/25/15/15/10.
3. **Component calculation.** Five independent percentages are computed (§3).
4. **Validation.** Weights must sum to 100 (enforced both by the DB check constraint `scv_rules_weights_sum_100` and re-validated in the server function). Zero denominators are guarded.
5. **Final result.** Weighted sum, rounded to a whole number, then matched against `incentive_rules` slabs.
6. **Composite (optional layer).** If a manual rating exists for the user, `v_scv_composite` blends Official / Personal / Compliance using role weights.

---

## 3. SCV Calculation Logic

### Formula
```text
Official SCV =
    Conversion%      * weight_conversion     / 100
  + TAT%             * weight_tat            / 100
  + EOI1→Webinar%    * weight_eoi1_webinar   / 100
  + EOI2→Payment%    * weight_eoi2_payment   / 100
  + CRM Discipline%  * weight_crm_discipline / 100
  (rounded to nearest integer)
```

### Current weights (`scv_rules`, id = 1)
| Component | Weight |
| --- | --- |
| Conversion % | 35 |
| TAT Compliance | 25 |
| EOI 1 → Webinar | 15 |
| EOI 2 → Payment | 15 |
| CRM Discipline | 10 |
| **Total** | **100** (hard constraint) |

### Component definitions

**Conversion %** — leads whose reached stage is `FEE_PAID`, `KTN_CS` or `KTN_LIVE`, divided by the user's total leads.

**TAT % — two implementations exist in the system:**
- *TypeScript engine* (`computeScvForExecs`, used by `/incentives`, `/tl/scv-incentives`, self-score): per-transition SLA compliance measured from consecutive `lead_stage_history` entries against a fixed SLA table:

  | Transition | SLA |
  | --- | --- |
  | LEAD_INBOX → EOI_1 | 24 h |
  | EOI_1 → WEBINAR | 72 h |
  | WEBINAR → EOI_2 | 48 h |
  | EOI_2 → FEE_PAID | 96 h |
  | FEE_PAID → KTN_CS | 168 h |
  | KTN_CS → KTN_LIVE | 336 h |

  If a user has **zero measurable transitions**, TAT% defaults to **100**.
- *SQL view* (`v_scv_leaderboard`, feeds the composite): a flat rule — a lead is TAT-compliant if `now() - stage_entered_at <= 48 hours`.

**EOI 1 → Webinar %** — of leads that ever reached `EOI_1`, the share that ever reached `WEBINAR`. Denominator 0 → 0%.

**EOI 2 → Payment %** — of leads that ever reached `EOI_2`, the share that ever reached `FEE_PAID` / `AGREEMENT_SIGNED` / `KTN_CS` / `KTN_LIVE`. Denominator 0 → 0%.

**CRM Discipline % — two implementations exist:**
- *TypeScript engine*: share of the user's leads that have at least one row in `lead_activities`.
- *SQL view*: share of the user's leads where `brand_id`, `language`, `source_id` and `state_id` are all non-null.

### Incentive slab lookup (`incentive_rules`)
| Label | Score range | Payout % |
| --- | --- | --- |
| Platinum | 90–100 | 100 |
| Gold | 80–89 | 80 |
| Silver | 70–79 | 60 |
| Bronze | 60–69 | 40 |
| Below Threshold | 0–59 | 0 |

Matching is a linear scan by `sort_order`, first slab where `min_score <= score <= max_score` wins. No match → `Unrated`, 0 %.

### Estimated incentive amount (TL page only)
```text
amount = KTN_LIVE count  x  10,000  x  payout% / 100
```
The ₹10,000 per KTN Live base is hardcoded in the TL incentive function, not stored in configuration.

### Composite score
```text
Composite = ( Official      * official_weight
            + Personal      * personal_weight
            + Compliance    * compliance_weight ) / 100
```
Role weights (`scv_role_weights`):

| Role | Official | Personal | Compliance |
| --- | --- | --- | --- |
| kob_manager | 60 | 20 | 20 |
| team_leader | 60 | 20 | 20 |
| executive | 70 | 30 | 0 |

Constraint `scv_role_weights_sum_100` enforces the sum.

### Worked example
Executive with 100 leads: 12 converted, TAT compliance 80 %, 40 of 60 EOI 1 leads reached Webinar, 8 of 20 EOI 2 leads paid, 90 leads have activity.
```text
Conversion   12%  x 35/100 =  4.20
TAT          80%  x 25/100 = 20.00
EOI1→Web  66.67%  x 15/100 = 10.00
EOI2→Pay     40%  x 15/100 =  6.00
CRM          90%  x 10/100 =  9.00
Official SCV = 49  ->  Below Threshold, 0% payout
```
If the manager later rates them Personal 90 (executive role: 70/30/0):
```text
Composite = (49 x 70 + 90 x 30 + 0 x 0) / 100 = 61.30
```

---

## 4. SCV Rules

- **Weights must sum to 100.** Enforced at DB level and re-validated server-side before saving; the CEO screen disables Save when the running total is not 100.
- **Slab validity.** Each slab requires `min_score <= max_score` and `incentive_pct` between 0 and 100. Full coverage and non-overlap are *not* enforced — a gap falls through to `Unrated / 0 %`, an overlap resolves to the lowest `sort_order`.
- **Manual rating bounds.** `personal_score` and `compliance_score` must be 0–100. `compliance_score` may be null.
- **Rating period normalisation.** Any chosen date is normalised to the first day of that month (`YYYY-MM-01`); unique per `(user_id, period)`, so re-rating the same month overwrites.
- **Compliance not applicable to executives.** Executive compliance weight is 0, and the rating screen marks the compliance field as not applicable for that role.
- **Who is scored.** The leaderboard scores users holding the `executive` role only (top 20). Rateable users are executives, team leaders and KOB managers.
- **Role resolution for composite.** Highest-priority role wins: super_admin > kob_manager > team_leader > other. A user with no role row does not appear in the composite view.
- **Serviceability / distance / radius / cuisine / kitchen capacity:** none of these participate in SCV. SCV has no geographic radius rule, no distance calculation, no cuisine input and no capacity input. State/district/city fields influence SCV only indirectly, and only through the SQL view's CRM-discipline definition, which checks that `state_id` (along with `brand_id`, `language`, `source_id`) is filled in on the lead record.

---

## 5. SCV Data Sources

| Source | Type | Data fetched | Why | Effect on SCV |
| --- | --- | --- | --- | --- |
| `kob_leads` | table | assignment, stage, brand/language/source/state | population of leads per user | denominators of every ratio |
| `lead_stage_history` | table | `from_stage`, `to_stage`, timestamps | milestone + timing evidence | Conversion, EOI ratios, TAT |
| `lead_activities` | table | activity rows per lead | evidence of CRM usage | CRM Discipline (TS engine) |
| `profiles` | table | user names | display + user list | none on maths |
| `user_roles` | table | role per user | who is scored, which weights | role weighting, eligibility |
| `scv_rules` | table | 5 component weights | configurable formula | direct multiplier |
| `incentive_rules` | table | slab bands | payout mapping | slab label + payout % |
| `scv_role_weights` | table | official/personal/compliance split | composite blending | composite only |
| `scv_manual_ratings` | table | personal + compliance scores | manager judgement | composite only |
| `incentives` | table | per-user/month payout ledger | historical record | stored output |
| `v_scv_leaderboard` | view | SQL implementation of the formula | official score feed | input to composite |
| `v_scv_composite` | view | blended score | manager screen | final composite |
| Server functions in `src/lib/kob.functions.ts` | backend | all of the above | computation + CRUD | the live engine |
| Frontend routes (§10) | UI | rendered results | display | none |

**External sources:** none. SCV uses no Google Sheet, no third-party API, no Gallabox / Meta / India-Post data.

---

## 6. SCV Database Structure

### `scv_rules` (singleton, `id = 1`)
| Column | Purpose |
| --- | --- |
| `weight_conversion` | weight of Conversion % |
| `weight_tat` | weight of TAT compliance |
| `weight_eoi1_webinar` | weight of EOI 1 → Webinar movement |
| `weight_eoi2_payment` | weight of EOI 2 → Payment movement |
| `weight_crm_discipline` | weight of CRM discipline |
| `updated_at` | last change timestamp |

Constraint: the five weights must sum to 100.

### `scv_role_weights` (PK `role`)
`role` (app_role), `official_weight`, `personal_weight`, `compliance_weight`, `updated_at`. Must sum to 100.

### `scv_manual_ratings`
`id`, `user_id` → `auth.users`, `period` (month start), `personal_score`, `compliance_score` (nullable), `rated_by`, `rated_at`, `notes`, timestamps. Unique `(user_id, period)`.

### `incentive_rules`
`id`, `label`, `min_score`, `max_score`, `incentive_pct`, `sort_order`, timestamps.

### `incentives`
`id`, `user_id`, `period_month`, `kitchens_converted`, `slab_pct`, `amount`, `created_at`. Unique `(user_id, period_month)`.

### Legacy score columns
- `kob_leads.scv_score` — integer, not null, default 0.
- `profiles.scv_score` — integer, nullable.

Neither is written by the SCV engine (the code explicitly notes scores are computed on read). `kob_leads.scv_score` is still *read* by manager/TL report averages, which is why those "team SCV" figures can differ from the leaderboard.

### Views
- `v_scv_leaderboard` — per-user component percentages and `avg_scv`. Created with `security_invoker = true`, so the caller's row-level permissions apply.
- `v_scv_composite` — official score + latest manual rating + role weights → `composite_score`. Created **without** `security_invoker`, so it runs with the view owner's privileges and therefore does not re-apply the row restrictions that `scv_manual_ratings` would otherwise impose. (Reported as an observation only; no change made.)

### Relationships
```text
auth.users ─┬─ profiles.id
            ├─ user_roles.user_id ── scv_role_weights.role
            ├─ scv_manual_ratings.user_id
            ├─ incentives.user_id
            └─ kob_leads.assigned_to ── lead_stage_history.lead_id
                                     └─ lead_activities.lead_id
scv_rules (singleton) ── used by v_scv_leaderboard and the TS engine
incentive_rules ── slab lookup for any computed score
```

---

## 7. SCV User Flow

**Executive / general user**
```text
Open /incentives
        |
        v
Slab cards load from incentive_rules (label, payout %, score band)
        |
        v
Leaderboard loads: engine reads the user's leads, history and activities live
        |
        v
Table renders Rank, Executive, Leads, SCV, Fee Paid, KTN Live
```
No input is entered by the user; the score is derived entirely from their existing CRM work. A self-score lookup also exists for the signed-in user, returning nothing when they have no leads.

**Team Leader**
```text
Open /tl/scv-incentives
        |
        v
Per-executive rows: SCV, Conversion %, TAT %, EOI1→Web %, EOI2→Pay %, CRM %,
KTN CS, KTN Live, slab badge, payout %, estimated amount
```

**Manager**
```text
Open /mgr/monthly-ratings
        |
        v
Pick user + month -> enter Personal score (and Compliance where applicable) + notes
        |
        v
Live preview shows Official x weight / Personal x weight / Compliance x weight
        |
        v
Save -> rating upserted for that month (audit-logged)
        |
        v
Composite table and recent-ratings table refresh
```

---

## 8. SCV Admin Flow

**CEO / super admin — `/ceo/scv-rules`**
- Edit the five component weights; a running sum badge turns green at exactly 100 and Save is blocked otherwise.
- Edit incentive slabs inline (label, min, max, payout %); each row saves independently and only when modified.
- Both actions are audit-logged.

**Manager — `/mgr/monthly-ratings`**
- Enter and revise monthly Personal / Compliance ratings.
- View role weights, composite table and recent ratings history.

**Master data**
`scv_rules`, `scv_role_weights`, `incentive_rules` are the SCV master tables. Role weights have no dedicated editing screen; they are displayed read-only on the ratings page.

**Permissions**
| Object | Read | Write |
| --- | --- | --- |
| `scv_rules` | any authenticated | super_admin |
| `scv_role_weights` | any authenticated | super_admin |
| `incentive_rules` | any authenticated | super_admin |
| `scv_manual_ratings` | manager / super_admin (all) + own rows | manager / super_admin (no self-rating) |
| `incentives` | manager / super_admin (all) + own row | manager / super_admin |
| `v_scv_leaderboard` | any authenticated, caller's permissions applied | n/a |
| `v_scv_composite` | any authenticated, owner privileges | n/a |

---

## 9. SCV API Documentation

There are **no public REST endpoints for SCV** — nothing under the public API routes exposes SCV data. All access is through internal typed server functions called from the pages, each running under the caller's session and permissions.

| Function | Input | Output | Logic | Errors |
| --- | --- | --- | --- | --- |
| `getScvLeaderboard` | none | top 20 executives: `user_id`, `full_name`, `lead_count`, `avg_scv`, `fee_paid`, `conversions` | loads executive role users, runs the live engine, sorts by SCV then conversions | permission errors surface from the DB; empty list when no executives |
| `getScvRules` | none | current weight row | reads `scv_rules` id 1 | falls back to defaults when missing |
| `updateScvRules` | five weights | updated row | re-validates sum = 100, writes, audit-logs | rejects non-100 sums; write denied for non-super-admin |
| `getIncentiveRules` | none | slabs ordered by `sort_order` | plain read | none |
| `updateIncentiveRule` | id, label, min, max, pct | updated slab | validates `min <= max`, writes, audit-logs | rejects inverted ranges; write denied for non-super-admin |
| `listRateableUsers` | none | executives, TLs, managers | role-filtered profile list | none |
| `listRoleWeights` | none | role weight rows | plain read | none |
| `listScvComposite` | none | composite rows sorted desc | reads `v_scv_composite` | none |
| `listManualRatings` | none | latest 500 ratings | reads `scv_manual_ratings` | none |
| `upsertManualRating` | user, period, personal, compliance, notes | saved rating | bounds-checks 0–100, normalises period to month start, upserts, stamps rater, audit-logs | rejects out-of-range scores; denied for non-managers |
| `getTLScvIncentives` | none | per-executive breakdown incl. slab + amount | runs the engine, applies slab, multiplies by hardcoded ₹10,000 per KTN Live | none |
| `getMyScvScore` | none | own score or nothing | engine for the signed-in user | returns nothing when no data |

---

## 10. SCV UI Components

| Page | Elements |
| --- | --- |
| `/ceo/scv-rules` | Header, "SCV Component Weights" card (5 numeric fields, live sum badge coloured green/red, left border reflects balance), "Incentive Eligibility Slabs" card (editable table: Label, Min Score, Max Score, Incentive %, per-row Save button enabled only when dirty), footer "Save SCV Weights" button (disabled unless edited and balanced), toast notifications |
| `/incentives` | Header with formula summary, grid of slab cards (label, payout %, score band, purple left border), "SCV Leaderboard (live)" card with table: Rank, Executive, Leads, SCV, Fee Paid, KTN Live (KTN Live shown in green) |
| `/tl/scv-incentives` | Table: SCV, Conversion %, TAT %, EOI1→Web %, EOI2→Pay %, CRM %, KTN CS, KTN Live, coloured slab badge (Platinum indigo, Gold yellow, Silver grey, Bronze orange), Payout %, estimated amount |
| `/mgr/monthly-ratings` | Role-weight summary cards, rating form (user select, month picker, Personal score, Compliance score — disabled with a note for executives, notes field, Save), live composite preview panel showing each weighted term and the final figure, composite scores table, recent ratings table (nulls rendered as "—") |
| `/mgr/scv-incentives`, `/ceo/incentive-rules` | Redirect-only routes pointing at `/incentives` |
| Navigation | CEO: "SCV Rules", "Incentive Rules". Manager: "SCV & Incentives". Team Leader: "SCV & Incentives". |

---

## 11. SCV Edge Cases

- **User with zero leads.** All ratios are 0 and no divide-by-zero occurs. In the TypeScript engine, TAT defaults to 100 % when there are no measurable transitions, so a zero-lead executive still earns the full TAT contribution; the SQL view gives 0 instead.
- **Denominator of 0 on milestone ratios.** A user whose leads never reached EOI 1 gets 0 % for EOI1→Webinar rather than being excluded, which lowers the score for early-funnel-heavy portfolios.
- **Missing `scv_rules` row.** The TypeScript engine falls back to 35/25/15/15/10. The SQL view cross-joins the singleton, so a deleted row would return no leaderboard rows at all.
- **Never-rated user.** The composite view treats a missing rating as 0 for Personal and Compliance, so 20–30 % of the composite silently drops to zero. The ratings table itself displays "—" for missing values.
- **User with no role row.** Excluded from the composite view entirely, even with leads and an official score.
- **Slab gaps / overlaps.** A gap resolves to `Unrated / 0 %`; an overlap resolves to the lowest `sort_order`. Neither is prevented at DB level.
- **Duplicate rating for the same month.** Prevented by the unique `(user_id, period)` key; a second save overwrites the first and re-stamps the rater.
- **Out-of-range rating input.** Rejected before write with a validation error.
- **Weights not summing to 100.** Rejected at three layers: Save button disabled, server validation, DB constraint.
- **Two divergent SCV values for the same person.** Because the SQL view and the TypeScript engine define TAT and CRM discipline differently, the composite screen's "official" score can differ from the leaderboard score. Reports pages add a third figure by averaging the legacy `kob_leads.scv_score` column, which the SCV engine never writes.
- **Composite view permissions.** The composite view runs with owner privileges, so personal and compliance scores are readable through it by any authenticated user even though direct reads of the ratings table are restricted.

---

## 12. SCV Examples

**Example 1 — high performer**
200 leads, 100 converted (50 %), TAT 92 %, EOI1→Web 80 %, EOI2→Pay 75 %, CRM 100 %.
```text
50 x .35 = 17.50
92 x .25 = 23.00
80 x .15 = 12.00
75 x .15 = 11.25
100 x .10 = 10.00
SCV = 74  ->  Silver, 60% payout
With 100 KTN Live: 100 x 10,000 x 0.60 = ₹600,000 estimated
```

**Example 2 — below threshold**
50 leads, 2 converted (4 %), TAT 60 %, EOI1→Web 20 %, EOI2→Pay 0 %, CRM 40 %.
```text
4 x .35 = 1.40 | 60 x .25 = 15.00 | 20 x .15 = 3.00 | 0 | 40 x .10 = 4.00
SCV = 23  ->  Below Threshold, 0% payout, ₹0
```

**Example 3 — multiple conditions interacting**
A team leader scores Official 70. Manager rates Personal 85, Compliance 60. Team-leader weights are 60/20/20.
```text
Composite = (70 x 60 + 85 x 20 + 60 x 20) / 100 = 71.00
```
If the manager had not yet rated them, the composite would instead be `(70 x 60 + 0 + 0)/100 = 42.00`, since unrated is treated as zero.

**Example 4 — new joiner edge**
Executive with 0 leads: Conversion 0, EOI ratios 0, CRM 0, but TAT defaults to 100 in the engine used by the leaderboard.
```text
SCV = 0 + (100 x .25) + 0 + 0 + 0 = 25  ->  Below Threshold, 0% payout
```

---

## 13. Current SCV Logic Summary

**How it works today.** SCV is a live, computed-on-read 0–100 performance score. Five components — Conversion, TAT compliance, EOI 1 → Webinar movement, EOI 2 → Payment movement and CRM discipline — are each expressed as a percentage of the user's own leads, multiplied by configurable weights that must total 100, and summed. The result is matched to an incentive slab that yields a label and payout percentage. On the manager screen the score is blended with manager-entered Personal and Compliance ratings using per-role weights to produce a Composite Score.

**What triggers SCV.** Nothing schedules it. There is no cron job, no trigger and no stored snapshot. The score is recalculated every time a user opens the leaderboard, the TL incentive page, their own score, or the composite table.

**How the result is calculated.** Weighted sum of five percentages, rounded; then a linear slab lookup; then, for the composite, a second weighted blend against manual ratings.

**Connected systems.** Leads, stage history and activity logs supply the inputs; three configuration tables supply the rules; two views and one TypeScript engine implement the maths; five screens display it. There are no external services, no public API surface and no scheduled jobs.

**Notable observations (recorded, not changed).**
- Two independent implementations of the formula exist and define TAT and CRM discipline differently, so the same person can show different scores on different screens.
- `kob_leads.scv_score` and `profiles.scv_score` are legacy columns the engine never writes, yet reports still average the lead column.
- The ₹10,000 per KTN Live incentive base is hardcoded rather than configurable.
- The composite view runs with owner privileges and so is not restricted the way the underlying ratings table is.
