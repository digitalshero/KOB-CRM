# SCV Page — Complete Technical & Functional Documentation

> Documentation only. No code, database, API, UI, calculation, or workflow was changed while producing this file.
> "SCV" in this application means **Sales Composite Value** — a staff performance score. It is **not** service/serviceability coverage. Geographic serviceability lives in a separate Market Scope / Geo Control area and is documented as such in section 10.

---

## 1. SCV Page Overview

There are three SCV-related pages in the app. The one referred to as "the SCV page" (current route in use) is **`/tl/scv-incentives`**.

| Page | Route | File | Purpose |
|---|---|---|---|
| SCV & Incentives (main SCV page) | `/tl/scv-incentives` | `src/routes/_authenticated/tl.scv-incentives.tsx` | Per-executive live SCV breakdown + payout estimate |
| Incentives & SCV (summary) | `/incentives` | `src/routes/_authenticated/incentives.tsx` | Slab cards + SCV leaderboard |
| SCV & Incentive Rules (admin) | `/ceo/scv-rules` | `src/routes/_authenticated/ceo.scv-rules.tsx` | Edit SCV weights and incentive slabs |
| Manager redirect | `/mgr/scv-incentives` | `src/routes/_authenticated/mgr.scv-incentives.tsx` | Redirects to `/incentives` |

- **Purpose:** show, for every executive, how their sales performance scores on five weighted components, which incentive slab they fall into, and the estimated incentive amount.
- **Why it exists:** to make executive performance measurable and payouts rule-driven instead of subjective.
- **Who uses it:** Team Leaders (primary), KOB Managers and CEO/Super Admin (via `/incentives` and `/ceo/scv-rules`).
- **Business purpose:** conversion accountability, TAT/SLA discipline, funnel movement discipline, CRM hygiene, and incentive eligibility.

---

## 2. Complete User Flow

```
User opens /tl/scv-incentives
        ↓
Route is inside the _authenticated layout → session required, else redirect to /auth
        ↓
Component TLScv mounts; React Query key ["tl-scv"] calls server fn getTLScvIncentives()
        ↓
Server: fetch executive roster → fetch their leads → fetch stage history → fetch activities
        ↓
Server: computeScvForExecs() calculates the 5 component percentages per executive
        ↓
Server: weights applied (scv_rules) → final score → slab lookup (incentive_rules) → amount
        ↓
JSON array returned → rendered as one table row per executive
```

**Inputs required from the user:** none. The page is read-only and fully derived; there are no forms, filters, or date pickers on it. The only user-supplied values in the SCV system are entered on `/ceo/scv-rules` (weights and slabs) and on the monthly-ratings page (`scv_manual_ratings`).

**Validations:** none on this page. Validation exists only on the admin page (weights must be integers 0–100 and sum to exactly 100; `min_score ≤ max_score` for slabs).

---

## 3. SCV Page UI Documentation (`/tl/scv-incentives`)

| Element | Purpose | Data displayed | Source |
|---|---|---|---|
| Page title `SCV & Incentives` | Header | Static text | Component |
| Subtitle line | States the live weighting | "Conversion 35 · TAT 25 · EOI1→Webinar 15 · EOI2→Payment 15 · CRM 10" (static text) | Hardcoded string in the component |
| Head/meta title | Browser tab | "SCV & Incentives — Shero KOB" | Route `head()` |
| Card + scrollable table | Main body | One row per executive | `getTLScvIncentives()` |
| Column `Executive` | Identify person | `profiles.full_name` | `profiles` via `user_roles` |
| Column `SCV` | Final composite score 0–100 | `scvScore` | Computed |
| Column `Conversion %` | Conversion component | `conversionScore` | Computed |
| Column `TAT %` | SLA compliance component | `tatScore` | Computed |
| Column `EOI1→Web %` | Funnel movement component | `eoi1Score` | Computed |
| Column `EOI2→Pay %` | Payment movement component | `eoi2Score` | Computed |
| Column `CRM %` | CRM discipline component | `crmScore` | Computed |
| Column `KTN CS` | Count of leads currently in `KTN_CS` | `ktnCs` | `kob_leads.stage` |
| Column `KTN Live` (green) | Count of leads currently in `KTN_LIVE` | `ktnLive` | `kob_leads.stage` |
| Column `Slab` (colored badge) | Status indicator | Slab label; color by `slabColor()` — Platinum indigo, Gold yellow, Silver gray, Bronze orange, other muted | `incentive_rules.label` |
| Column `Payout %` | Slab payout percent | `incentivePct` | `incentive_rules.incentive_pct` |
| Column `Est. Incentive` | Money estimate | `₹amount` locale-formatted | Computed (see §4) |

No buttons, dropdowns, inputs, or filters exist on this page. There is no explicit empty state; when the array is empty the table renders headers with no rows.

**Related UI on `/incentives`:** slab cards (label, payout %, score band) plus an "SCV Leaderboard (live)" table with Rank, Executive, Leads, SCV, Fee Paid, KTN Live.

**Related UI on `/ceo/scv-rules`:** five numeric weight inputs with a live "Sum: n / 100" badge (green when 100, red otherwise), an editable slab table (Label, Min Score, Max Score, Incentive %, per-row Save), and a "Save SCV Weights" button disabled until the form is dirty and balanced.

---

## 4. SCV Calculation Logic

Implemented in `computeScvForExecs()` in `src/lib/kob.functions.ts`. Everything is computed **on read**; no SCV value is persisted (`profiles.scv_score` / `kob_leads.scv_score` are not used by this page).

Scope of leads per executive: **all** leads where `kob_leads.assigned_to = executive` (no date filter, lifetime).

### Component 1 — Conversion % (weight 35)
```
converted = leads whose current stage ∈ {FEE_PAID, KTN_CS, KTN_LIVE}
conversionPct = converted / total_leads * 100     (0 when total = 0)
```

### Component 2 — TAT Compliance % (weight 25)
SLA table (hours), keyed `from_stage->to_stage`:

| Transition | SLA |
|---|---|
| LEAD_INBOX→EOI_1 | 24 |
| EOI_1→WEBINAR | 72 |
| WEBINAR→EOI_2 | 48 |
| EOI_2→FEE_PAID | 96 |
| FEE_PAID→KTN_CS | 168 |
| KTN_CS→KTN_LIVE | 336 |

For each lead, history rows are sorted ascending by `created_at`. For each row matching an SLA key, elapsed = this row's `created_at` minus the previous history row's `created_at` (or the lead's `created_at` for the first row). Transitions not in the table are ignored.
```
tatPct = slaOk / slaTotal * 100     (100 when no measurable transitions)
```

### Component 3 — EOI 1 → Webinar Movement % (weight 15)
Uses `everReached()` against the ordered stage ladder
`LEAD_INBOX, AUTO_FIRED, EOI_1, WEBINAR, EOI_2, FORM_FILLED, FEE_PAID, KTN_CS, KTN_LIVE`,
where "reached" = max index across the current stage and every `from_stage`/`to_stage` in history ≥ index of the target.
```
eoi1Pct = (leads that reached WEBINAR) / (leads that reached EOI_1) * 100   (0 if denominator 0)
```

### Component 4 — EOI 2 → Payment Movement % (weight 15)
```
eoi2Pct = (leads that reached FEE_PAID) / (leads that reached EOI_2) * 100   (0 if denominator 0)
```

### Component 5 — CRM Discipline % (weight 10)
```
crmPct = (leads having ≥1 row in lead_activities) / total_leads * 100   (0 when total = 0)
```

### Final score
```
finalScore = round(
  (conversionPct*W_conv + tatPct*W_tat + eoi1Pct*W_eoi1 + eoi2Pct*W_eoi2 + crmPct*W_crm) / 100
)
```
Weights come from `scv_rules` id = 1; fallback defaults if the row is missing are 35/25/15/15/10. Each component is also rounded for display.

### Slab lookup and payout
First slab (ordered by `sort_order`) where `min_score ≤ finalScore ≤ max_score`; otherwise `{ label: "Unrated", pct: 0 }`.

Current live slabs: Platinum (90+) 90–100 → 100%; Gold (80–89) → 80%; Silver (70–79) → 60%; Bronze (60–69) → 40%; Below Threshold 0–59 → 0%.

### Estimated incentive
```
BASE_PER_KTN_LIVE = 10000 (hardcoded in getTLScvIncentives)
amount = round(ktnLive * 10000 * incentivePct / 100)
```

### Worked example
Executive with 50 leads, 5 in FEE_PAID/KTN_CS/KTN_LIVE, 40 of 50 SLA transitions met, 20 reached EOI_1 of which 12 reached WEBINAR, 8 reached EOI_2 of which 5 reached FEE_PAID, 45 leads have activities, 2 leads currently KTN_LIVE:
- conversion 10%, TAT 80%, EOI1 60%, EOI2 62.5%, CRM 90%
- final = (10·35 + 80·25 + 60·15 + 62.5·15 + 90·10)/100 = (350+2000+900+937.5+900)/100 = 50.875 → **51**
- slab Below Threshold, payout 0% → estimated incentive ₹0.

---

## 5. SCV Input Data

| Input | Origin | Effect on SCV |
|---|---|---|
| `kob_leads.assigned_to` | Lead assignment (auto allocation or manual reassign) | Defines each executive's lead pool — the denominator of Conversion and CRM |
| `kob_leads.stage` | Stage workflow / drag-drop / automation | Conversion count, KTN CS / KTN Live counts, and "ever reached" ceiling |
| `kob_leads.created_at` | Lead creation | Start clock for the first TAT measurement |
| `lead_stage_history.from_stage / to_stage / created_at` | Written on every stage transition | TAT compliance and stage-reached tests |
| `lead_activities.lead_id` | Activity logging | CRM discipline numerator |
| `scv_rules` weights | CEO admin page | Multipliers on each component |
| `incentive_rules` slabs | CEO admin page | Slab label and payout % |
| `user_roles.role = 'executive'` + `profiles.full_name` | User administration | Which people appear and their display name |

State, district, city, pincode, cuisine, kitchen capacity and similar geographic/kitchen attributes are **not** inputs to SCV in this codebase.

---

## 6. Backend Logic

All in `src/lib/kob.functions.ts`, all `createServerFn` with `.middleware([requireSupabaseAuth])` (RLS applies as the calling user).

| Function | Type | Input | Output | Logic |
|---|---|---|---|---|
| `SCV_SLA_HOURS`, `STAGE_ORDER`, `CONVERSION_STAGES` | constants | — | — | SLA map, stage ladder, conversion stage set |
| `maxStageIdx(current, hist)` | helper | current stage, history rows | max ladder index | Highest ladder position seen |
| `everReached(current, hist, target)` | helper | as above + target stage | boolean | `maxStageIdx ≥ index(target)` |
| `loadScvRules(supabase)` | helper | — | weights row | `scv_rules` id=1 with defaults fallback |
| `loadIncentiveRules(supabase)` | helper | — | slab rows | `incentive_rules` ordered by `sort_order` |
| `lookupIncentive(rules, score)` | helper | slabs, score | `{label, pct}` | First band containing the score, else Unrated |
| `computeScvForExecs(supabase, execIds)` | core | executive ids | `{weights, incentiveRules, byExec}` | Bulk-loads leads, history and activities, groups per executive, computes 5 components, final score, slab, stage counts |
| `getTLScvIncentives` | GET server fn | none | array of per-executive rows incl. `amount` | Roster via `fetchExecRoster(orgRead(context))` → `computeScvForExecs` → payout estimate |
| `getScvLeaderboard` | GET server fn | none | top 20 rows sorted by score then KTN Live | Same computation, leaner projection |
| `getScvRules` | GET server fn | none | weights row | `loadScvRules` |
| `updateScvRules` | POST server fn | five integer weights | `{ok:true}` | Zod 0–100 validation, sum must equal 100, update `scv_rules` id=1, audit log `scv_rules_update` |
| `getIncentiveRules` | GET server fn | none | slabs | `loadIncentiveRules` |
| `updateIncentiveRule` | POST server fn | id, label, min, max, pct | `{ok:true}` | Zod validation, `min ≤ max`, update row, audit log `incentive_rule_update` |
| `listRoleWeights` | GET server fn | none | `scv_role_weights` rows | Role blend weights |
| `listScvComposite` | GET server fn | none | `v_scv_composite` rows | Blended official/personal/compliance score, ordered desc |
| `listManualRatings` / `upsertManualRating` | GET / POST | period + scores | rating rows | Monthly personal/compliance ratings, upsert on `(user_id, period)`, audit logged |
| `fetchExecRoster` | helper | — | executive profiles | `user_roles.role='executive'` → `profiles` |
| `orgRead(context)` | helper | context | read client | Org-wide read scope for the roster |

---

## 7. Database Documentation

| Table / View | Purpose | Key columns | Relationships | Use in SCV |
|---|---|---|---|---|
| `scv_rules` | Singleton weights | `id=1`, `weight_conversion`, `weight_tat`, `weight_eoi1_webinar`, `weight_eoi2_payment`, `weight_crm_discipline`, `updated_at` | — | Component multipliers (live: 35/25/15/15/10) |
| `incentive_rules` | Payout slabs | `label`, `min_score`, `max_score`, `incentive_pct`, `sort_order` | — | Slab label and payout % |
| `kob_leads` | Leads | `assigned_to`, `stage`, `created_at` | → `auth.users`, geo/brand/source tables | Lead pool, conversion, stage counts |
| `lead_stage_history` | Stage transitions | `lead_id`, `from_stage`, `to_stage`, `changed_by`, `created_at` | → `kob_leads` | TAT and stage-reached logic |
| `lead_activities` | Activity log | `lead_id`, `activity_type`, `created_at` | → `kob_leads` | CRM discipline |
| `user_roles` | Role assignment | `user_id`, `role` (`app_role`) | → `auth.users` | Selects executives |
| `profiles` | User profile | `id`, `full_name`, `email`, `scv_score` | → `auth.users` | Display name (`scv_score` column exists but is not used by this page) |
| `scv_role_weights` | Role blend weights | `role`, `official_weight`, `personal_weight`, `compliance_weight` | — | Composite layer (executive 70/30/0; TL and manager 60/20/20) |
| `scv_manual_ratings` | Monthly manual scores | `user_id`, `period`, `personal_score`, `compliance_score`, `rated_by`, `notes` | → `auth.users` | Composite layer inputs |
| `v_scv_composite` | View | `composite_score` + components | Derived | Blended composite listing |
| `incentives` | Recorded monthly payouts | `user_id`, `period_month`, `kitchens_converted`, `slab_pct`, `amount` | → `auth.users` | Historical record; **not** read by `/tl/scv-incentives` |
| `audit_logs` | Change trail | `actor_id`, `action`, `entity`, `entity_id`, `meta` | → `auth.users` | Records weight/slab/rating edits |

No records were modified during this documentation.

---

## 8. API Documentation

SCV is exposed only as **TanStack Start server functions** (typed RPC over HTTP, auth-required). There is **no public REST endpoint** for SCV under `src/routes/api/public/*`.

| Server function | Method | Request payload | Response |
|---|---|---|---|
| `getTLScvIncentives` | GET | none | `[{ id, name, scvScore, conversionScore, tatScore, eoi1Score, eoi2Score, crmScore, ktnCs, ktnLive, slab, incentivePct, amount }]` |
| `getScvLeaderboard` | GET | none | `[{ user_id, full_name, lead_count, avg_scv, conversions, fee_paid }]` (top 20) |
| `getScvRules` | GET | none | weights row |
| `updateScvRules` | POST | `{ weight_conversion, weight_tat, weight_eoi1_webinar, weight_eoi2_payment, weight_crm_discipline }` | `{ ok: true }`; throws when the sum ≠ 100 or values fall outside 0–100 |
| `getIncentiveRules` | GET | none | slab rows |
| `updateIncentiveRule` | POST | `{ id, label, min_score, max_score, incentive_pct }` | `{ ok: true }`; throws when `min_score > max_score` |
| `listRoleWeights` / `listScvComposite` / `listManualRatings` | GET | none | rows |
| `upsertManualRating` | POST | `{ user_id, period, personal_score, compliance_score?, notes? }` | saved row |

Errors: unauthenticated calls return HTTP 401 from `requireSupabaseAuth`; validation and rule errors throw and surface in the UI as `toast.error(e.message)` on the admin page.

---

## 9. Frontend Documentation

**`src/routes/_authenticated/tl.scv-incentives.tsx`**
- Route: `createFileRoute("/_authenticated/tl/scv-incentives")` with `head()` meta title; component `TLScv`.
- Local helper `slabColor(slab)` maps slab label prefix to badge classes.
- Hooks: `useServerFn(getTLScvIncentives)` and `useQuery({ queryKey: ["tl-scv"] })` with default `[]`.
- State: none local; server state only via React Query.
- Child components: shadcn `Card` / `CardContent`; the table is plain markup.

**`src/routes/_authenticated/incentives.tsx`** — `useServerFn` + `useQuery` for `["scv-lb"]` and `["incentive-rules"]`; renders slab cards and leaderboard table.

**`src/routes/_authenticated/ceo.scv-rules.tsx`** — queries `["scv-rules"]` and `["incentive-rules"]`; local `useState` drafts `wForm` (weights) and `incForm` (per-slab, keyed by id); `sum`/`balanced` derived; saves through `updateScvRules` / `updateIncentiveRule`, toasts, then `qc.invalidateQueries`. Shows `Loading…` until the weights row arrives.

**`src/routes/_authenticated/mgr.scv-incentives.tsx`** — `beforeLoad` redirect to `/incentives`.

Authentication and layout come from `src/routes/_authenticated/route.tsx`; the bearer token is attached to server-function calls by the middleware registered in `src/start.ts`.

---

## 10. SCV Decision Logic

Statuses produced by the SCV page are **slab statuses**, not serviceability statuses:

| Condition on final score | Result | Payout |
|---|---|---|
| 90–100 | Platinum (90+) | 100% |
| 80–89 | Gold (80–89) | 80% |
| 70–79 | Silver (70–79) | 60% |
| 60–69 | Bronze (60–69) | 40% |
| 0–59 | Below Threshold | 0% |
| No matching band | Unrated | 0% |
| Executive with no computed entry | Falls back to all-zero row, slab "Unrated" | 0% |

A separate "Eligible / Not eligible" flag exists elsewhere (executive performance listing in `kob.functions.ts`): `scv >= 70 && ktnLive >= 1` → Eligible. That flag uses the stored `kob_leads.scv_score` average, not the computed score shown on the SCV page.

Serviceable / Non-serviceable are **geographic lead stages** (`NON_SERVICEABLE`, `NO_VACANCY` in the `lead_stage` enum) decided by Market Scope / Geo Control data (`india_states`, `india_districts`, `india_cities`, `india_pincodes`, `brand_state_availability`, `state_native_brand`). They have no bearing on the SCV calculation.

---

## 11. Data Flow Diagram

```text
/tl/scv-incentives (TLScv component)
        ↓ useServerFn + useQuery ["tl-scv"]
getTLScvIncentives  (server fn, requireSupabaseAuth)
        ↓
fetchExecRoster ──► user_roles (role='executive') ──► profiles
        ↓
computeScvForExecs
        ├─► kob_leads (assigned_to IN execIds)
        ├─► lead_stage_history (lead_id IN leads)
        ├─► lead_activities (lead_id IN leads)
        ├─► scv_rules (weights)
        └─► incentive_rules (slabs)
        ↓
Component %s → weighted final score → slab → amount = ktnLive × 10000 × pct/100
        ↓
JSON array → table rows, colored slab badge, ₹ formatted amount
```

---

## 12. Edge Cases (as currently handled)

- **No executives / empty roster:** `computeScvForExecs` returns early with an empty map; the table renders headers only.
- **Executive with zero leads:** conversion, EOI1, EOI2 and CRM are 0; TAT defaults to **100** (no measurable transitions), so the final score is `0.25 × W_tat` — 25 with current weights.
- **Executive missing from the computed map:** `getTLScvIncentives` substitutes an all-zero object with slab "Unrated".
- **Missing `scv_rules` row:** hardcoded 35/25/15/15/10 defaults are used.
- **Missing / empty `incentive_rules`:** every score maps to "Unrated" with 0% payout and ₹0.
- **Score outside every band:** "Unrated", 0%.
- **Transitions not in the SLA map:** skipped, neither pass nor fail.
- **First history row of a lead:** measured from the lead's `created_at`.
- **Duplicate / repeated transitions:** every matching history row counts separately for TAT; stage-reached tests are boolean per lead, so no double counting there.
- **Weights not summing to 100:** blocked on save both client-side (toast, disabled button) and server-side (thrown error).
- **`min_score > max_score`:** rejected server-side.
- **Unauthenticated access:** the `_authenticated` gate redirects to `/auth`; server functions return 401.
- **Query failure:** React Query keeps the `[]` default, so the table renders empty rather than crashing; there is no explicit error banner on this page.
- **No date filtering:** all figures are lifetime; there is no "no results for period" case.

---

## 13. Final SCV System Summary

- SCV = Sales Composite Value, a 0–100 performance score computed live per executive on every page load. Nothing is cached or stored.
- Triggered purely by opening `/tl/scv-incentives` (or `/incentives` for the leaderboard); no cron, webhook, or write path recomputes it.
- Lifecycle: leads assigned → stage movements recorded in `lead_stage_history` → activities recorded in `lead_activities` → five components derived → weighted by `scv_rules` → rounded to the final score → mapped to an `incentive_rules` slab → estimated payout `KTN Live × ₹10,000 × payout%`.
- Connected systems: lead assignment, stage workflow and automation, activity logging, role/profile administration, the CEO rules admin screen with audit logging, and the optional role-weighted composite layer (`scv_role_weights`, `scv_manual_ratings`, `v_scv_composite`).
- Current rules in the database: weights 35 / 25 / 15 / 15 / 10; slabs Platinum 100%, Gold 80%, Silver 60%, Bronze 40%, Below Threshold 0%; role blends executive 70/30/0 and team leader / manager 60/20/20.
