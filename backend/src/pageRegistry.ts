/**
 * Page Access Management — controlled registry of every reachable
 * authenticated page. page_key is always the exact route path used in
 * frontend/src/routes/_authenticated/route.tsx's CEO_NAV/MANAGER_NAV/
 * TL_NAV/EXEC_NAV arrays (the `to` field), so the frontend's nav filter
 * is a trivial `allowedPages.includes(n.to)` with no key-mapping layer.
 *
 * This mirrors frontend/src/lib/pageRegistry.ts exactly (same keys/module
 * groupings) — kept in two files because frontend/backend are separate
 * TS projects with no shared package today; do not let them drift.
 *
 * Existing routes are never renamed here — this is a read-only label/
 * grouping layer on top of routes that already exist.
 */
export interface PageRegistryEntry {
  key: string;
  label: string;
  module: string;
  description: string;
}

export const PAGE_REGISTRY: PageRegistryEntry[] = [
  // LEADS
  { key: "/ceo/lead-inbox", label: "Lead Inbox", module: "Leads", description: "View and manage the organisation-wide lead inbox." },
  { key: "/mgr/lead-inbox", label: "Lead Inbox", module: "Leads", description: "View and manage the manager lead inbox." },
  { key: "/leads", label: "Lead Inbox", module: "Leads", description: "View and manage the lead inbox." },
  { key: "/mgr/lead-allocation", label: "Lead Allocation", module: "Leads", description: "Allocate leads to executives." },
  { key: "/tl/allocation", label: "Lead Allocation", module: "Leads", description: "Allocate leads within your team." },
  { key: "/mgr/abandoned-leads", label: "Abandoned Leads", module: "Leads", description: "Review leads that went abandoned." },
  { key: "/tl/abandoned-leads", label: "Abandoned Leads", module: "Leads", description: "Review abandoned leads for your team." },
  { key: "/exe/abandoned-leads", label: "Abandoned Leads", module: "Leads", description: "Review your abandoned leads." },
  { key: "/exe/dead-leads", label: "Dead Leads", module: "Leads", description: "Review dead leads." },
  { key: "/exe/eoi-1", label: "EOI 1", module: "Leads", description: "Work leads in the EOI 1 stage." },
  { key: "/exe/eoi-2", label: "EOI 2", module: "Leads", description: "Work leads in the EOI 2 stage." },
  { key: "/exe/fee-pending", label: "Fee Pending", module: "Leads", description: "Follow up leads with fee pending." },
  { key: "/exe/form-pending", label: "Form Pending", module: "Leads", description: "Follow up leads with form pending." },
  { key: "/exe/ktn-cs", label: "KTN CS", module: "Leads", description: "Work leads in the KTN CS stage." },
  { key: "/exe/ktn-live", label: "KTN Live", module: "Leads", description: "Work leads in the KTN Live stage." },
  { key: "/exe/my-kanban", label: "My Kanban", module: "Leads", description: "Your personal lead kanban board." },
  { key: "/exe/overview", label: "Overview", module: "Leads", description: "Your lead overview." },
  { key: "/exe/agreement", label: "Agreement", module: "Leads", description: "Manage agreement-stage leads." },
  { key: "/exe/retargeting", label: "Retargeting", module: "Leads", description: "View your retargeting queue." },
  { key: "/mgr/retargeting", label: "Retargeting Queue", module: "Leads", description: "View the manager retargeting queue." },
  { key: "/tl/retargeting", label: "Retargeting Queue", module: "Leads", description: "View your team's retargeting queue." },
  { key: "/mgr/unallocated-leads", label: "Unallocated Leads", module: "Leads", description: "Review leads not yet allocated." },
  { key: "/tl/import-leads", label: "Import Leads", module: "Leads", description: "Bulk-import leads via CSV." },
  { key: "/tl/overview", label: "Overview", module: "Leads", description: "Team lead overview." },
  { key: "/tl/my-team", label: "My Team", module: "Leads", description: "View your team's leads." },
  { key: "/executive-lead-summary", label: "Executive Lead Summary", module: "Leads", description: "Summary of leads by executive." },

  // WEBINAR
  { key: "/webinar", label: "Webinar", module: "Webinar", description: "Create and manage webinar batches." },
  { key: "/exe/webinar", label: "Webinar", module: "Webinar", description: "View your webinar batches." },
  { key: "/tl/webinar-history", label: "Webinar History", module: "Webinar", description: "View past webinar batches and attendance." },

  // PERFORMANCE / REPORTS
  { key: "/kob-dashboard", label: "Dashboard", module: "Performance", description: "Main KOB dashboard and KPI cards." },
  { key: "/ceo/dashboard", label: "CEO Overview", module: "Performance", description: "Organisation-wide KPI overview." },
  { key: "/mgr/dashboard", label: "KOB Overview", module: "Performance", description: "Manager KPI overview." },
  { key: "/mgr/funnel", label: "Funnel Analytics", module: "Performance", description: "Lead funnel conversion analytics." },
  { key: "/tl/funnel", label: "Funnel", module: "Performance", description: "Team funnel conversion analytics." },
  { key: "/mgr/brand-performance", label: "Brand Performance", module: "Performance", description: "Performance breakdown by brand." },
  { key: "/tl/brand-performance", label: "Brand Performance", module: "Performance", description: "Team performance breakdown by brand." },
  { key: "/mgr/team-performance", label: "Team Performance", module: "Performance", description: "Performance breakdown by team." },
  { key: "/tl/executive-performance", label: "Executive Performance", module: "Performance", description: "Performance breakdown by executive." },
  { key: "/tl/language-performance", label: "Language Performance", module: "Performance", description: "Performance breakdown by language." },
  { key: "/tl/tat-breach", label: "TAT Breach", module: "Performance", description: "Leads breaching turnaround-time targets." },
  { key: "/mgr/reports", label: "Reports", module: "Performance", description: "Manager reporting suite." },
  { key: "/mgr/marketing", label: "Marketing Analytics", module: "Performance", description: "Marketing source performance." },
  { key: "/campaign-management", label: "Campaign Management", module: "Performance", description: "Meta Ads campaign management and CPL." },

  // SCV / INCENTIVES
  { key: "/mgr/scv-incentives", label: "SCV & Incentives", module: "SCV & Incentives", description: "Manage SCV scores and incentive payouts." },
  { key: "/tl/scv-incentives", label: "SCV & Incentives", module: "SCV & Incentives", description: "View SCV scores and incentives." },
  { key: "/mgr/monthly-ratings", label: "Monthly Ratings", module: "SCV & Incentives", description: "Manual monthly performance ratings." },
  { key: "/ceo/incentive-rules", label: "Incentive Rules", module: "SCV & Incentives", description: "Configure incentive slab rules." },
  { key: "/ceo/scv-rules", label: "SCV Rules", module: "SCV & Incentives", description: "Configure SCV weighting rules." },
  { key: "/mgr/kp-evaluation", label: "KP Evaluation", module: "SCV & Incentives", description: "Knowledge/performance evaluation." },
  { key: "/tl/kp-evaluation", label: "KP Evaluation", module: "SCV & Incentives", description: "Team knowledge/performance evaluation." },
  { key: "/exe/kp-evaluation", label: "KP Evaluation", module: "SCV & Incentives", description: "Your knowledge/performance evaluation." },

  // ADMINISTRATION
  { key: "/mgr/users", label: "Users & Roles", module: "Administration", description: "Manage users, roles, and page access." },
  { key: "/ceo/users-roles", label: "User & Role Access", module: "Administration", description: "Manage users, roles, and page access." },
  { key: "/ceo/audit-logs", label: "Audit Logs", module: "Administration", description: "View the system audit trail." },
  { key: "/mgr/audit", label: "Audit Logs", module: "Administration", description: "View the manager audit trail." },
  { key: "/ceo/brands", label: "Brand Management", module: "Administration", description: "Manage brand records." },
  { key: "/ceo/geo-control", label: "State / District / City", module: "Administration", description: "Manage geographic reference data." },
  { key: "/mgr/language-geo", label: "Language / Geo", module: "Administration", description: "Manage language and geo mapping." },
  { key: "/ceo/market-scope", label: "India Market Scope", module: "Administration", description: "Configure market scope." },
  { key: "/ceo/kitchen-scope", label: "Kitchen Scope Calculator", module: "Administration", description: "Calculate kitchen scope." },
  { key: "/ceo/native-brand-mapping", label: "Native Brand Mapping", module: "Administration", description: "Map native brands to states." },
  { key: "/ceo/mode-control", label: "Mode Control", module: "Administration", description: "Control AUTO/MANUAL system mode." },
  { key: "/ceo/gallabox-templates", label: "Gallabox Templates", module: "Administration", description: "Manage WhatsApp message templates." },
  { key: "/ceo/kpi-targets", label: "KPI Targets", module: "Administration", description: "Configure KPI targets." },
  { key: "/ceo/evaluation-questions", label: "Evaluation Questions", module: "Administration", description: "Configure evaluation question sets." },
  { key: "/ceo/retargeting-rules", label: "Retargeting Rules", module: "Administration", description: "Configure retargeting rules." },
  { key: "/targeting-rules", label: "Targeting Rules", module: "Administration", description: "Configure targeting rules." },
  { key: "/ceo/qa", label: "QA Test Panel", module: "Administration", description: "Internal QA testing panel." },
  { key: "/mgr/qa", label: "QA", module: "Administration", description: "Manager QA panel." },
  { key: "/mgr/approvals", label: "Approvals", module: "Administration", description: "Review pending approvals." },
  { key: "/mgr/executives", label: "Executive Management", module: "Administration", description: "Manage executive accounts." },
  { key: "/tl/executives", label: "Executive Management", module: "Administration", description: "Manage your team's executives." },
  { key: "/mgr/team-leads", label: "Team Lead Management", module: "Administration", description: "Manage team leads." },
  { key: "/mgr/ktn-activation", label: "KTN & Activation", module: "Administration", description: "KTN activation management." },
  { key: "/whatsapp-messages", label: "WhatsApp Messages", module: "Administration", description: "View inbound WhatsApp messages." },
];

export const PAGE_KEY_SET: ReadonlySet<string> = new Set(PAGE_REGISTRY.map((p) => p.key));
