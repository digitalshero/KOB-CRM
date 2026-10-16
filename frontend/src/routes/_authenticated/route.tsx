import { createFileRoute, Outlet, redirect, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { MyRoleResponse } from "@/lib/types";
import sheroBadge from "@/assets/shero-badge.png.asset.json";

import {
  LayoutDashboard, Users, Settings, RefreshCw, Trophy, LogOut, Building2,
  ClipboardList, UserCog, Tag, Languages, Filter, Clock, FileBarChart,
  Inbox, UserX, CheckSquare, Megaphone, Rocket, ShieldCheck, ScrollText,
  Kanban, Handshake, CreditCard, FileSignature, Zap, XCircle, FlaskConical,
  PanelLeftClose, PanelLeftOpen, Upload, Menu, CalendarClock, MessageCircle, SlidersHorizontal,
  Home, ShieldAlert,
} from "lucide-react";

interface MyPageAccessResponse { allowedPageKeys: string[] | null; unrestricted: boolean }

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedShell,
});

const CEO_NAV = [
  { to: "/ceo/dashboard", label: "CEO Overview", icon: LayoutDashboard },
  { to: "/kob-dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/ceo/lead-inbox", label: "Lead Inbox", icon: Inbox },
  { to: "/tl/allocation", label: "Lead Allocation", icon: ClipboardList },
  { to: "/executive-lead-summary", label: "Executive Lead Summary", icon: Users },
  { to: "/tl/webinar-history", label: "Webinar History", icon: CalendarClock },
  { to: "/ceo/brands", label: "Brand Management", icon: Building2 },
  { to: "/ceo/native-brand-mapping", label: "Native Brand Mapping", icon: Tag },
  { to: "/ceo/market-scope", label: "India Market Scope", icon: Filter },
  { to: "/ceo/geo-control", label: "State / District / City", icon: Languages },
  { to: "/ceo/kitchen-scope", label: "Kitchen Scope Calculator", icon: Rocket },
  { to: "/ceo/kpi-targets", label: "KPI Targets", icon: FileBarChart },
  { to: "/campaign-management", label: "Campaign Management", icon: SlidersHorizontal },
  { to: "/ceo/scv-rules", label: "SCV Rules", icon: Trophy },
  { to: "/ceo/incentive-rules", label: "Incentive Rules", icon: Trophy },
  { to: "/mgr/monthly-ratings", label: "Monthly Ratings", icon: Trophy },
  { to: "/ceo/retargeting-rules", label: "Retargeting Rules", icon: RefreshCw },
  { to: "/targeting-rules", label: "Targeting Rules", icon: RefreshCw },
  { to: "/ceo/mode-control", label: "Mode Control", icon: Zap },
  { to: "/ceo/gallabox-templates", label: "Gallabox Templates", icon: Megaphone },
  { to: "/ceo/users-roles", label: "User & Role Access", icon: ShieldCheck },
  { to: "/ceo/audit-logs", label: "Audit Logs", icon: ScrollText },
  { to: "/ceo/evaluation-questions", label: "Evaluation Questions", icon: ClipboardList },
  { to: "/ceo/qa", label: "QA Test Panel", icon: FlaskConical },
  { to: "/whatsapp-messages", label: "WhatsApp Messages", icon: MessageCircle },
];

const MANAGER_NAV = [
  { to: "/mgr/dashboard", label: "KOB Overview", icon: LayoutDashboard },
  { to: "/kob-dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/mgr/lead-inbox", label: "Lead Inbox", icon: Inbox },
  { to: "/mgr/unallocated-leads", label: "Unallocated Leads", icon: UserX },
  { to: "/mgr/team-leads", label: "Team Lead Management", icon: UserCog },
  { to: "/mgr/executives", label: "Executive Management", icon: Users },
  { to: "/executive-lead-summary", label: "Executive Lead Summary", icon: Users },
  { to: "/tl/executive-performance", label: "Executive Performance", icon: UserCog },
  { to: "/mgr/lead-allocation", label: "Lead Allocation", icon: ClipboardList },
  { to: "/webinar", label: "Webinar", icon: Megaphone },
  { to: "/mgr/marketing", label: "Marketing Analytics", icon: Megaphone },
  { to: "/campaign-management", label: "Campaign Management", icon: SlidersHorizontal },
  { to: "/mgr/funnel", label: "Funnel Analytics", icon: Filter },
  { to: "/mgr/team-performance", label: "Team Performance", icon: UserCog },
  { to: "/ceo/kpi-targets", label: "KPI Targets", icon: FileBarChart },
  { to: "/mgr/brand-performance", label: "Brand Performance", icon: Tag },
  { to: "/mgr/language-geo", label: "Language / Geo", icon: Languages },
  { to: "/mgr/ktn-activation", label: "KTN & Activation", icon: Rocket },
  { to: "/mgr/approvals", label: "Approvals", icon: CheckSquare },
  { to: "/mgr/retargeting", label: "Retargeting Queue", icon: RefreshCw },
  { to: "/targeting-rules", label: "Targeting Rules", icon: RefreshCw },
  { to: "/mgr/scv-incentives", label: "SCV & Incentives", icon: Trophy },
  { to: "/mgr/monthly-ratings", label: "Monthly Ratings", icon: Trophy },
  { to: "/mgr/audit", label: "Audit Logs", icon: ScrollText },
  { to: "/mgr/users", label: "Users & Roles", icon: ShieldCheck },
  { to: "/mgr/abandoned-leads", label: "Abandoned Leads", icon: Clock },
  { to: "/ceo/evaluation-questions", label: "Evaluation Questions", icon: ClipboardList },
  { to: "/mgr/kp-evaluation", label: "KP Evaluation", icon: ClipboardList },
  { to: "/mgr/reports", label: "Reports", icon: FileBarChart },
  { to: "/whatsapp-messages", label: "WhatsApp Messages", icon: MessageCircle },
];

const TL_NAV = [
  { to: "/tl/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/kob-dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Lead Inbox", icon: Inbox },
  { to: "/tl/import-leads", label: "Import Leads", icon: Upload },
  { to: "/tl/allocation", label: "Lead Allocation", icon: ClipboardList },
  { to: "/campaign-management", label: "Campaign Management", icon: SlidersHorizontal },
  { to: "/webinar", label: "Webinar", icon: Megaphone },
  { to: "/tl/webinar-history", label: "Webinar History", icon: CalendarClock },

  { to: "/tl/my-team", label: "My Team", icon: Users },
  { to: "/tl/executives", label: "Executive Management", icon: UserCog },
  { to: "/executive-lead-summary", label: "Executive Lead Summary", icon: Users },

  { to: "/tl/executive-performance", label: "Executive Performance", icon: UserCog },
  { to: "/tl/brand-performance", label: "Brand Performance", icon: Tag },
  { to: "/tl/language-performance", label: "Language Performance", icon: Languages },
  { to: "/tl/funnel", label: "Funnel", icon: Filter },
  { to: "/tl/retargeting", label: "Retargeting Queue", icon: RefreshCw },
  { to: "/targeting-rules", label: "Targeting Rules", icon: RefreshCw },
  { to: "/tl/tat-breach", label: "TAT Breach", icon: Clock },
  { to: "/tl/scv-incentives", label: "SCV & Incentives", icon: Trophy },
  { to: "/tl/abandoned-leads", label: "Abandoned Leads", icon: Clock },
  { to: "/tl/kp-evaluation", label: "KP Evaluation", icon: ClipboardList },
  { to: "/ceo/gallabox-templates", label: "Gallabox Templates", icon: Megaphone },
  { to: "/whatsapp-messages", label: "WhatsApp Messages", icon: MessageCircle },
];

const EXEC_NAV = [
  { to: "/exe/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/kob-dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/exe/my-kanban", label: "My Kanban", icon: Kanban },
  { to: "/exe/eoi-1", label: "EOI 1", icon: Handshake },
  { to: "/exe/webinar", label: "Webinar", icon: Megaphone },
  { to: "/exe/eoi-2", label: "EOI 2", icon: Handshake },
  { to: "/exe/form-pending", label: "Form Pending", icon: ClipboardList },
  { to: "/exe/fee-pending", label: "Fee Pending", icon: CreditCard },
  { to: "/exe/agreement", label: "Agreement", icon: FileSignature },
  { to: "/exe/ktn-cs", label: "KTN CS", icon: Rocket },
  { to: "/exe/ktn-live", label: "KTN Live", icon: Zap },
  { to: "/exe/retargeting", label: "Retargeting", icon: RefreshCw },
  { to: "/exe/abandoned-leads", label: "Abandoned Leads", icon: Clock },
  { to: "/exe/dead-leads", label: "Dead Leads", icon: XCircle },
  { to: "/exe/kp-evaluation", label: "KP Evaluation", icon: ClipboardList },
  { to: "/tl/scv-incentives", label: "SCV & Incentives", icon: Trophy },
  { to: "/whatsapp-messages", label: "WhatsApp Messages", icon: MessageCircle },
];

function AuthedShell() {
  const { data } = useQuery({
    queryKey: ["my-role"],
    queryFn: () => apiClient.get<MyRoleResponse>("/api/kob/my-role"),
  });
  const { data: pageAccess, isLoading: pageAccessLoading } = useQuery({
    queryKey: ["my-page-access"],
    queryFn: () => apiClient.get<MyPageAccessResponse>("/api/kob/my-page-access"),
  });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const role = data?.role ?? "executive";
  const roleLabel = role === "super_admin" ? "CEO Office" : role === "kob_manager" ? "KOB Manager" : role === "team_leader" ? "Team Leader" : "Executive";

  const fullNav = role === "super_admin" ? CEO_NAV
    : role === "kob_manager" ? MANAGER_NAV
    : role === "team_leader" ? TL_NAV
    : EXEC_NAV;

  // Backward-compatible: allowedPageKeys === null means unrestricted (today's
  // exact behavior, either because no grants have been saved for this user
  // yet, or because they are super_admin/CEO).
  const allowedPageKeys = pageAccess?.allowedPageKeys ?? null;
  const nav = allowedPageKeys === null ? fullNav : fullNav.filter((n) => allowedPageKeys.includes(n.to));

  const pathIsPageControlled = fullNav.some((n) => n.to === pathname);
  const pathDenied = allowedPageKeys !== null && pathIsPageControlled && !allowedPageKeys.includes(pathname);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // close the mobile drawer whenever the route changes
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  return (
    <div className="min-h-screen flex w-full bg-background">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] transform transition-transform duration-200 md:static md:z-auto md:max-w-none md:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} ${collapsed ? "md:w-16" : "md:w-64"} md:transition-all bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border`}>
        <div className="px-4 py-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 shrink-0 rounded-full overflow-hidden ring-1 ring-sidebar-border bg-white">
              <img src={sheroBadge.url} alt="Shero" className="h-full w-full object-cover" />
            </div>
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="font-semibold text-sm truncate">Shero Home Food</div>
                <div className="text-[11px] text-sidebar-foreground/60 truncate">KOB CRM</div>
              </div>
            )}
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {pageAccessLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-9 rounded-md bg-sidebar-accent/30 animate-pulse" />
            ))
          ) : nav.length === 0 ? null : nav.map((n) => {
            const active = pathname === n.to || (n.to !== "/" && pathname.startsWith(n.to));
            return (
              <Link
                key={n.to}
                to={n.to}
                title={collapsed ? n.label : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors border-l-2 ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-sidebar-primary"
                    : "border-l-transparent text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground"
                }`}
              >
                <n.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{n.label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          {!collapsed && (
            <>
              <div className="px-3 py-2 text-xs opacity-70 truncate">{data?.profile?.full_name}</div>
              <div className="px-3 text-xs mb-2 flex items-center gap-1 opacity-80"><Building2 className="h-3 w-3"/>{roleLabel}</div>
            </>
          )}
          <button
            onClick={async () => { await supabase.auth.signOut(); window.location.href = "/auth"; }}
            title={collapsed ? "Sign out" : undefined}
            className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent/50"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && "Sign out"}
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <div className="sticky top-0 z-30 flex items-center h-12 px-3 border-b border-border bg-background/80 backdrop-blur">
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex md:hidden items-center justify-center h-8 w-8 rounded-md hover:bg-accent text-foreground"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="hidden md:inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent text-foreground"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        {pageAccessLoading ? null : pathDenied ? (
          <AccessDenied />
        ) : !pageAccessLoading && nav.length === 0 && allowedPageKeys !== null ? (
          <NoPagesAssigned />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 px-6 py-24">
      <ShieldAlert className="h-10 w-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">You don't have access to this page</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Contact your administrator if you believe you need access.
      </p>
      <Link
        to="/kob-dashboard"
        className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
      >
        <Home className="h-4 w-4" />
        Go to My Home
      </Link>
    </div>
  );
}

function NoPagesAssigned() {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 px-6 py-24">
      <ShieldAlert className="h-10 w-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">No pages have been assigned to your account</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Please contact your administrator.
      </p>
    </div>
  );
}
