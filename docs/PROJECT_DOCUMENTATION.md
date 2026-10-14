# Shero Home Food — Universal KOB Module

Complete technical and functional documentation of the Kitchen Onboarding (KOB) CRM.

---

## 1. What the product does

The app is an internal CRM that manages the full **Kitchen Partner onboarding lifecycle** — from raw lead capture (ads, website forms, referrals, imports, API) through WhatsApp automation, webinars, expression-of-interest steps, fee payment, agreement signing, and kitchen go-live (KTN Live).

It serves four roles with dedicated workspaces, tracks KPIs against targets, automates retargeting nudges, scores executives (SCV), and exposes read-only/ingest APIs for external systems.

---

## 2. Technology stack

| Layer | Technology |
| --- | --- |
| Framework | TanStack Start v1 (React 19, SSR + server functions) |
| Build | Vite 7 |
| Routing | TanStack Router (file-based, `src/routes/`) |
| Data fetching | TanStack Query |
| Styling | Tailwind CSS v4 (`src/styles.css`), shadcn/ui (new-york), lucide icons |
| Charts | Recharts |
| Backend | Lovable Cloud (Postgres, Auth, RLS, cron, pg_net) |
| CSV | papaparse |
| Runtime | Edge worker (Cloudflare workerd) |

---

## 3. Roles and navigation

Roles live in `user_roles` (never on `profiles`) and are read via the `has_role()` security-definer function.

| Role | Enum | Workspace |
| --- | --- | --- |
| CEO / Super Admin | `super_admin` | `/ceo/*` — configuration, market scope, rules, audit, QA |
| KOB Manager | `kob_manager` | `/mgr/*` — allocation, analytics, approvals, reports |
| Team Leader | `team_leader` | `/tl/*` — team, allocation, imports, performance (global lead visibility) |
| Executive | `executive` | `/exe/*` — kanban and per-stage worklists |

Shared routes: `/kob-dashboard`, `/webinar`, `/leads`, `/leads/$id`, `/retargeting`, `/incentives`.

The shell (`src/routes/_authenticated/route.tsx`) gates every authenticated route, resolves the role via `getMyRole()`, and renders the role-specific sidebar (collapsible on desktop, drawer on mobile).

---

## 4. Lead lifecycle

`lead_stage` enum:

```text
LEAD_INBOX → AUTO_FIRED → EOI_1 → WEBINAR → EOI_2 → FORM_FILLED
           → FEE_PAID → AGREEMENT_SIGNED → KTN_CS → KTN_LIVE
```

Terminal / parked stages: `NO`, `LATER`, `NO_RESPONSE`, `RETARGETING`, `DEAD_LEAD`, `NON_SERVICEABLE`, `NO_VACANCY`, `FAILED_FIRE`.

Other enums: `app_role`, `lead_mode` (`AUTO` | `MANUAL`), `auto_fire_status` (`NOT_FIRED` | `FIRED` | `FAILED`), `lead_language` (Tamil, Telugu, Malayalam, Hindi, Bengali, English, Kannada, Marathi, Gujarati, Others).

Every stage change is written to `lead_stage_history` (`from_stage`, `to_stage`, `changed_by`). A **null `changed_by` means the transition was automated**; a non-null value means it was manual — this distinction powers the Auto vs Manual conversion funnels.

---

## 5. Database

### Core
- `kob_leads` — the lead record (name, phone, language, source, brand, stage, mode, assignments, `next_action`, pincode/geo).
- `lead_stage_history` — every transition, the backbone of funnels and SCV.
- `lead_events`, `lead_activities` — event and activity trail.
- `profiles`, `user_roles` — users and role assignment.
- `audit_logs` — configuration and lead write audit trail (`src/lib/audit.ts`).

### Configuration
`kob_configuration`, `brands`, `brand_state_availability`, `state_native_brand`, `lead_sources`, `gallabox_templates`, `integration_settings`, `retargeting_rules`, `scv_rules`, `scv_role_weights`, `incentive_rules`, `kpi_targets`, `marketing_kpi_targets`, `evaluation_questions`.

Configuration tables are **super_admin write-only**; Managers have read access (enforced by RLS plus `trg_enforce_kob_configuration_manager_scope`).

### Geography
`india_states`, `india_districts`, `india_cities`, `india_pincodes` (~19k rows, India Post import) feeding the Market Scope drill-downs.

### Messaging & retargeting
`gallabox_fire_queue`, `email_fire_queue`, `retargeting_attempts`, `retargeting_schedule`, plus per-language send ledgers:
`lead_inbox_retarget_sends`, `lead_eoi1_retarget_sends` / `_telugu_sends` / `_malayalam_sends`, `lead_webinar_retarget_tamil_sends` / `_telugu_sends` / `_malayalam_sends`, `website_form_tamil_sends` / `_telugu_sends` / `_malayalam_sends`.

### Webinar & evaluation
`webinar_batches`, `webinar_attendance`, `evaluation_responses`, `incentives`, `scv_manual_ratings`.

### Views
`v_kpi_snapshot`, `v_funnel_by_source`, `v_funnel_by_language`, `v_funnel_by_brand`, `v_retargeting_queue`, `v_abandoned_leads`, `v_scv_leaderboard`, `v_scv_composite`, `v_lead_evaluation_score`, `v_lead_evaluation_history`, `v_city_scope`, `v_state_pincode_totals`.

All public tables have RLS enabled with explicit GRANTs; policies scope Executives to their own leads, Team Leaders globally to leads/executives, Managers to operations, and Super Admin to everything.

---

## 6. Automations (scheduled jobs)

| Job | Schedule | Action |
| --- | --- | --- |
| `lead-inbox-7day-retargeting` | `15 * * * *` | WhatsApp nudge for leads 7+ days in `LEAD_INBOX` |
| `eoi1-7day-retargeting` (+ `-telugu`, `-malayalam`) | `15/20/35 * * * *` | Language-specific EOI 1 nudges |
| `webinar-7day-retargeting-tamil` (+ `-telugu`, `-malayalam`) | `15/25 * * * *` | Language-specific webinar nudges |
| `process-retargeting-sends-hourly` | `30 * * * *` | Executes queued retargeting cadence sends |
| `mark-webinar-defaulters-hourly` | `15 * * * *` | Marks non-attendees as defaulters |
| `mark-failed-fire-hourly` | `45 * * * *` | Moves leads sitting 2+ h in `LEAD_INBOX`/`AUTO_FIRED` with zero message evidence into `FAILED_FIRE` |

### Trigger-based automations
- `auto_enroll_retargeting` — enrolls leads moved to `NO` / `LATER` / `NO_RESPONSE` into the cadence, with an immediate first touch.
- `trg_coerce_auto_initial_stage` — AUTO-mode leads start at `AUTO_FIRED`, skipping `LEAD_INBOX`.
- `trg_auto_assign_lead_inbox` — assigns inbox leads to executives by language.
- Website Form + Tamil/Telugu/Malayalam — sends the language template immediately on creation.

`lead_has_any_message()` is the single source of truth for "did this lead ever receive a message", checking all send ledgers, queues, `lead_events`, `retargeting_attempts`, and delivered `audit_logs`.

---

## 7. KPI definitions

| KPI | Definition |
| --- | --- |
| Leads Generated | Distinct leads created in range (paginated beyond PostgREST's 1000-row cap via `pageAll`) |
| Contracts Signed | Leads that reached `AGREEMENT_SIGNED` |
| Conversion % | Contracts ÷ Leads |
| CPL | Meta ad spend ÷ leads (live from Meta Marketing API) |
| CAC | Spend ÷ contracts |
| Auto Fired | Leads with a history entry into `AUTO_FIRED` |
| Abandoned Leads | Total leads − Auto Fired |
| Failed Fire | Leads with zero message evidence anywhere |
| Parked / Retargeting | Leads in `NO`, `LATER`, `NO_RESPONSE`, `RETARGETING` |
| TAT Breach | Leads exceeding stage turnaround thresholds |

KPI cards are clickable: `KpiTrendDialog` shows a 6-month trend and a 24-week line chart with a linear-regression trendline (`getKpiTrend`), and `getMetricDrilldown` lists underlying leads.

---

## 8. SCV scoring & incentives

Score out of 100:

| Factor | Weight |
| --- | --- |
| Conversion % | 35 |
| TAT Compliance | 25 |
| EOI 1 → Webinar movement | 15 |
| EOI 2 → Payment movement | 15 |
| CRM Discipline | 10 |

`v_scv_leaderboard` computes raw scores; `scv_role_weights` + `v_scv_composite` produce role-weighted composites shown on `/mgr/monthly-ratings`. Incentive slabs live in `incentive_rules` and surface on `/incentives`, `/tl/scv-incentives`, `/mgr/scv-incentives`.

---

## 9. KOB Dashboard (`/kob-dashboard`)

Components in `src/components/kob-dashboard/`:

- **KPICards** — the KPI grid with Coming Soon badges on not-yet-live metrics.
- **ManualConversionFunnel** / **AutoConversionFunnel** — built from `lead_stage_history`, distinguishing manual (`changed_by` set) from automatic (`changed_by` null) transitions. Drill-down is enabled only on EOI 1, Webinar/Webinar Invite Sent and EOI 2; Lead Generated, Webinar Attendees, Fee Paid and Contract Signed render as plain non-clickable bars.
- **ResponseSplitDialog** — Interested / Not Interested / No Response / Later split for a clicked stage.
- **FunnelCard / FunnelStagePanel** — expandable full-screen funnel and table views with inline lead lists.
- **LeadsTrendChart**, **ExecutivePerformance**, **StateSpreadCard**, **ChannelConversionCard**, **UntouchedLeadsCard**, **ConversionFunnelCard**, **ManagementActionItems**, **SummaryCards**.

Server logic: `src/lib/kob-dashboard.functions.ts` (RPC) and `kob-dashboard.server.ts` (bucket computation). Dates are normalized to IST day boundaries.

---

## 10. Public API

All endpoints live under `src/routes/api/public/` and authenticate with the `x-api-key` header.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/public/leads` | Create a lead (name, phone, source, pincode, language) |
| POST | `/api/public/lead-events` | Record a lifecycle event and walk the funnel |
| POST | `/api/public/lead-stage` | Set a lead's stage directly |
| POST | `/api/public/template-stage` | Map a delivered WhatsApp template to a stage move (e.g. `no_retargeting` → `NO`, `later_retargeting` → `LATER` when in `LEAD_INBOX`) |
| POST | `/api/public/whatsapp-message` | Log inbound/outbound messages and unread state |
| GET | `/api/public/metrics` | Leads, contracts, conversion %, CPL for a date range |
| GET | `/api/public/kob/conversion-funnels` | Auto + Manual conversion funnel data |

Base URL (stable): `https://kob-unity-spark.lovable.app`

Example:

```bash
curl -X POST https://kob-unity-spark.lovable.app/api/public/leads \
  -H "Content-Type: application/json" \
  -H "x-api-key: $LEAD_INTAKE_API_KEY" \
  -d '{"name":"Test","phone":"9876543210","source":"Website Form","pincode":"600001","language":"TAMIL"}'
```

Secrets used: `LEAD_INTAKE_API_KEY`, Gallabox credentials, Meta Marketing API token.

---

## 11. Integrations

- **Gallabox (WhatsApp)** — template sends for auto-fire, webinar invites, and all retargeting cadences; delivery status flows back through `/api/public/template-stage` and `whatsapp-message`. A WhatsApp icon on lead rows opens the Gallabox widget; unread counts render via `LastMessageCell`.
- **Email fallback** — `email_fire_queue` covers auto-fire nudges when WhatsApp is unavailable.
- **Meta Marketing API** — live Spend / CPL / CAC (`src/lib/meta-ads.*`), account `act_278974773282719`, timezone Asia/Kolkata.
- **Shero.us CRM** — `/api/crm/dashboard-summary` supplies First Order, Loyal, Dormant, Lost order statuses.
- **India Post** — pincode dataset for market scope and serviceability.

---

## 12. Server function map (`src/lib/`)

| File | Responsibility |
| --- | --- |
| `kob.functions.ts` | Core CRM: role, KPIs, leads, config, brands, geo, targets, retargeting queue, SCV, TL/Exec views, executives, marketing, trends |
| `kob-dashboard.functions.ts` / `.server.ts` | KOB Dashboard funnels, splits, trends, state spread |
| `webinar.functions.ts` | Batches, attendance, EOI 2 marking, rescheduling |
| `evaluation.functions.ts` | Kitchen Partner Evaluation questions, responses, history |
| `import-leads.functions.ts` / `.shared.ts` | CSV import (Name, Mobile, Language, Lead source) |
| `meta-ads.functions.ts` / `.server.ts` | Meta spend KPIs |
| `qa.functions.ts` | QA Test Panel — scripted end-to-end lifecycle test, verification, cleanup |
| `seed-users.functions.ts` | Demo/staff seeding |
| `audit.ts`, `export-csv.ts`, `error-capture.ts` | Audit logging, CSV export, error reporting |

Convention: `*.functions.ts` hold `createServerFn` declarations only; runtime helpers live in `*.server.ts`.

---

## 13. Shared UI conventions

- `DateRangeFilter` with presets (Today, Yesterday, MTD, custom) used across every list and dashboard.
- `use-date-range.ts` persists the selection in `sessionStorage` (restored after mount, hydration-safe) so filters survive Leads → Lead Details → back.
- `use-persisted-state.ts` persists stage, language, search and tab filters per view.
- Every table view exposes **Export CSV** and a global phone/name search.
- `LeadRef`, `LastMessageCell`, `KpiCard`, `MetricDrilldown`, `KpiTrendDialog` are the reusable building blocks.

---

## 14. Local development

```bash
bun install
bun run dev      # http://localhost:8080
bun run build
bun run lint
```

Environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (client), server secrets injected at runtime and read inside handlers only.

QA: `/mgr/qa` and `/ceo/qa` run the scripted lifecycle test (create → assign → advance stages → retarget → SCV recompute → verify → cleanup).
