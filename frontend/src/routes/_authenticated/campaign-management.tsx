import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { MetaCampaignsListResult, MyRoleResponse } from "@/lib/types";
import { useDateRange } from "@/hooks/use-date-range";
import { DateRangeFilter } from "@/components/date-range-filter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Search,
  IndianRupee,
  Users,
  Target,
  SlidersHorizontal,
  Info,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Building2,
  Calendar,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/campaign-management")({
  head: () => ({
    meta: [
      { title: "Campaign Management — Shero KOB" },
      {
        name: "description",
        content: "Meta Ads Campaign Management and dynamic CPL inclusion controls for KOB Dashboard.",
      },
      { property: "og:title", content: "Campaign Management — Shero KOB" },
      {
        property: "og:description",
        content: "Select Meta Ads campaigns to calculate Cost Per Lead (CPL) dynamically.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CampaignManagementPage,
});

function CampaignManagementPage() {
  const queryClient = useQueryClient();
  const [range, setRange] = useDateRange("this_month");
  const rangeArg = useMemo(
    () => ({ from: range.from.toISOString(), to: range.to.toISOString() }),
    [range],
  );

  const { data: roleData } = useQuery({
    queryKey: ["my-role"],
    queryFn: () => apiClient.get<MyRoleResponse>("/api/kob/my-role"),
  });
  const isManagerOrAdmin =
    roleData?.role === "super_admin" || roleData?.role === "kob_manager";

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["meta-campaigns-list", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => {
      const p = new URLSearchParams();
      if (rangeArg.from) p.set("from", rangeArg.from);
      if (rangeArg.to) p.set("to", rangeArg.to);
      const q = p.toString();
      return apiClient.get<MetaCampaignsListResult>(`/api/meta/campaigns${q ? `?${q}` : ""}`);
    },
    staleTime: 60 * 1000,
  });

  const toggleMutation = useMutation({
    mutationFn: (vars: { campaignId: string; isEnabled: boolean; campaignName?: string }) =>
      apiClient.patch(`/api/meta/campaigns/${vars.campaignId}/selection`, vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["meta-campaigns-list"] });
      const previousData = queryClient.getQueryData([
        "meta-campaigns-list",
        range.from.toISOString(),
        range.to.toISOString(),
      ]);

      queryClient.setQueryData(
        ["meta-campaigns-list", range.from.toISOString(), range.to.toISOString()],
        (old: any) => {
          if (!old?.campaigns) return old;
          const nextCampaigns = old.campaigns.map((c: any) =>
            c.id === vars.campaignId ? { ...c, is_enabled: vars.isEnabled } : c,
          );

          let combinedSpend = 0;
          let combinedLeads = 0;
          let enabledCount = 0;
          for (const c of nextCampaigns) {
            if (c.is_enabled) {
              enabledCount++;
              combinedSpend += c.spend;
              combinedLeads += c.leads;
            }
          }
          const combinedCpl =
            combinedLeads > 0 ? Math.round((combinedSpend / combinedLeads) * 100) / 100 : 0;

          return {
            ...old,
            campaigns: nextCampaigns,
            summary: {
              ...old.summary,
              enabledCount,
              combinedSpend: Math.round(combinedSpend * 100) / 100,
              combinedLeads,
              combinedCpl,
            },
          };
        },
      );

      return { previousData };
    },
    onError: (err: any, vars, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(
          ["meta-campaigns-list", range.from.toISOString(), range.to.toISOString()],
          context.previousData,
        );
      }
      toast.error(err?.message || "Failed to update campaign selection");
    },
    onSuccess: (res, vars) => {
      // Invalidate both campaign list and dashboard CPL card query
      queryClient.invalidateQueries({ queryKey: ["meta-cpl-enabled"] });
      toast.success(
        vars.isEnabled
          ? `Campaign enabled for KOB Dashboard CPL`
          : `Campaign removed from KOB Dashboard CPL`,
      );
    },
  });

  // Local table filters and pagination
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [inclusionFilter, setInclusionFilter] = useState<string>("ALL");
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const campaigns = data?.campaigns ?? [];

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      // Text search
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesName = c.name.toLowerCase().includes(q);
        const matchesId = c.id.includes(q);
        if (!matchesName && !matchesId) return false;
      }
      // Status filter
      if (statusFilter !== "ALL") {
        if (statusFilter === "ACTIVE" && c.status !== "ACTIVE") return false;
        if (statusFilter === "PAUSED" && c.status !== "PAUSED") return false;
        if (statusFilter === "ARCHIVED" && c.status !== "ARCHIVED") return false;
      }
      // Inclusion filter
      if (inclusionFilter === "INCLUDED" && !c.is_enabled) return false;
      if (inclusionFilter === "EXCLUDED" && c.is_enabled) return false;

      return true;
    });
  }, [campaigns, search, statusFilter, inclusionFilter]);

  const totalPages = Math.ceil(filteredCampaigns.length / pageSize) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedCampaigns = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredCampaigns.slice(start, start + pageSize);
  }, [filteredCampaigns, safeCurrentPage, pageSize]);

  const handleToggle = (campaignId: string, currentVal: boolean, campaignName: string) => {
    if (!isManagerOrAdmin) {
      toast.error("Only CEO Office and KOB Managers can change campaign inclusion.");
      return;
    }
    toggleMutation.mutate({
      campaignId,
      isEnabled: !currentVal,
      campaignName,
    });
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Campaign Management</h1>
            <Badge variant="outline" className="font-mono text-xs bg-muted/60">
              Meta Ads
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Dynamically select Meta Ads campaigns to calculate Cost Per Lead (CPL) in the KOB Dashboard using Meta-reported data.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter value={range} onChange={setRange} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin text-primary" : ""}`} />
            Refresh Campaigns
          </Button>
        </div>
      </div>

      {/* Connected Account & Safety Notice */}
      <div className="rounded-xl border border-shero-navy/15 bg-shero-mint p-4 text-xs text-shero-navy flex items-start gap-3">
        <Info className="h-5 w-5 text-shero-navy shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-shero-navy flex items-center gap-2">
            <span>Meta Ad Account:</span>
            <span className="font-mono bg-white/70 px-2 py-0.5 rounded text-[11px]">
              {data?.account?.name ?? "Barottas hospitality pvt ltd"} ({data?.account?.id ?? "act_278974773282719"})
            </span>
            <span className="text-muted-foreground">· Currency: {data?.account?.currency ?? "INR"}</span>
          </div>
          <p>
            <strong>Safety Guarantee:</strong> The ON/OFF toggle controls <em>only</em> whether a campaign is included in the KOB Dashboard CPL calculations. It does <strong>not</strong> activate, pause, edit, or modify your live Meta Ads campaigns.
          </p>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="shadow-xs border-border/70">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-medium uppercase tracking-wide">
              <span>Total Campaigns</span>
              <Layers className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold mt-2">
              {isLoading ? "—" : (data?.summary?.totalCampaigns ?? 0).toLocaleString()}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Available in ad account</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/70 border-l-4 border-l-shero-teal">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-medium uppercase tracking-wide">
              <span>Included in CPL</span>
              <Target className="h-4 w-4 text-shero-teal" />
            </div>
            <div className="text-2xl font-bold mt-2 text-shero-teal">
              {isLoading ? "—" : `${data?.summary?.enabledCount ?? 0} active`}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Enabled for KOB calculations</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/70">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-medium uppercase tracking-wide">
              <span>Selected Spend</span>
              <IndianRupee className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold mt-2">
              {isLoading ? "—" : `₹${(data?.summary?.combinedSpend ?? 0).toLocaleString()}`}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Total spend of enabled</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/70">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-medium uppercase tracking-wide">
              <span>Meta Leads</span>
              <Users className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-bold mt-2">
              {isLoading ? "—" : (data?.summary?.combinedLeads ?? 0).toLocaleString()}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Reported Meta lead count</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/70 bg-primary/5 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-primary uppercase tracking-wide">
              <span>Combined CPL</span>
              <SlidersHorizontal className="h-4 w-4 text-primary" />
            </div>
            <div className="text-2xl font-extrabold mt-2 text-primary">
              {isLoading
                ? "—"
                : (data?.summary?.enabledCount ?? 0) === 0
                ? "No campaigns"
                : `₹${(data?.summary?.combinedCpl ?? 0).toFixed(2)}`}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {(data?.summary?.enabledCount ?? 0) === 0
                ? "Enable at least 1 campaign"
                : "Total Spend ÷ Total Leads"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-4 text-rose-900 dark:text-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
            <div>
              <div className="font-semibold">Unable to fetch Meta campaigns</div>
              <div className="text-xs text-rose-700 dark:text-rose-300">
                {(error as Error)?.message || "Marketing API request failed. Please check credentials."}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-rose-300">
            Retry
          </Button>
        </div>
      )}

      {/* Controls & Table Card */}
      <Card className="shadow-xs border-border/70">
        <CardContent className="p-4 sm:p-6 space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search campaigns by name or ID..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-9"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Status Filter */}
              <Select
                value={statusFilter}
                onValueChange={(val) => {
                  setStatusFilter(val);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-[140px] text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active Only</SelectItem>
                  <SelectItem value="PAUSED">Paused Only</SelectItem>
                  <SelectItem value="ARCHIVED">Archived Only</SelectItem>
                </SelectContent>
              </Select>

              {/* Inclusion Filter */}
              <Select
                value={inclusionFilter}
                onValueChange={(val) => {
                  setInclusionFilter(val);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-[160px] text-xs">
                  <SelectValue placeholder="CPL Inclusion" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Campaigns</SelectItem>
                  <SelectItem value="INCLUDED">Included in CPL</SelectItem>
                  <SelectItem value="EXCLUDED">Excluded from CPL</SelectItem>
                </SelectContent>
              </Select>

              {/* Rows Per Page */}
              <Select
                value={String(pageSize)}
                onValueChange={(val) => {
                  setPageSize(Number(val));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-[110px] text-xs">
                  <SelectValue placeholder="Page Size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 / page</SelectItem>
                  <SelectItem value="25">25 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                  <SelectItem value="100">100 / page</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Campaigns Table */}
          <div className="rounded-lg border border-border/70 overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-[320px]">Campaign Name</TableHead>
                  <TableHead className="w-[200px]">Campaign ID</TableHead>
                  <TableHead className="w-[120px]">Campaign Status</TableHead>
                  <TableHead className="text-right w-[130px]">Spend</TableHead>
                  <TableHead className="text-right w-[110px]">Meta Leads</TableHead>
                  <TableHead className="text-right w-[120px]">Meta CPL</TableHead>
                  <TableHead className="text-center w-[170px]">Include in KOB CPL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i} className="animate-pulse">
                      <TableCell><div className="h-4 bg-muted rounded w-48" /></TableCell>
                      <TableCell><div className="h-4 bg-muted rounded w-28" /></TableCell>
                      <TableCell><div className="h-5 bg-muted rounded-full w-16" /></TableCell>
                      <TableCell className="text-right"><div className="h-4 bg-muted rounded w-16 ml-auto" /></TableCell>
                      <TableCell className="text-right"><div className="h-4 bg-muted rounded w-12 ml-auto" /></TableCell>
                      <TableCell className="text-right"><div className="h-4 bg-muted rounded w-16 ml-auto" /></TableCell>
                      <TableCell className="text-center"><div className="h-5 bg-muted rounded-full w-10 mx-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : paginatedCampaigns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <Search className="h-8 w-8 text-muted-foreground/50" />
                        <div className="text-sm font-medium">No campaigns match your filters</div>
                        <p className="text-xs text-muted-foreground">
                          Try searching for a different keyword or resetting status filters.
                        </p>
                        {(search || statusFilter !== "ALL" || inclusionFilter !== "ALL") && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSearch("");
                              setStatusFilter("ALL");
                              setInclusionFilter("ALL");
                            }}
                            className="mt-2 text-xs"
                          >
                            Clear Filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedCampaigns.map((c) => {
                    const status = (c.status || "UNKNOWN").toUpperCase();
                    const statusVariant =
                      status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800"
                        : status === "PAUSED"
                        ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800"
                        : "bg-muted text-muted-foreground border-border";

                    return (
                      <TableRow
                        key={c.id}
                        className={`transition-colors ${c.is_enabled ? "bg-shero-mint/40" : ""}`}
                      >
                        {/* Campaign Name */}
                        <TableCell className="font-medium">
                          <div className="space-y-1">
                            <div className="text-sm font-semibold text-foreground line-clamp-1" title={c.name}>
                              {c.name}
                            </div>
                            {c.objective && (
                              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                                {c.objective}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* Campaign ID */}
                        <TableCell>
                          <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                            <span>{c.id}</span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(c.id)}
                              className="text-muted-foreground hover:text-foreground transition-colors p-1"
                              title="Copy Campaign ID"
                            >
                              {copiedId === c.id ? (
                                <Check className="h-3 w-3 text-emerald-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                        </TableCell>

                        {/* Status */}
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] font-semibold border ${statusVariant}`}>
                            {status}
                          </Badge>
                        </TableCell>

                        {/* Spend */}
                        <TableCell className="text-right font-medium">
                          ₹{c.spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>

                        {/* Meta Leads */}
                        <TableCell className="text-right font-medium">
                          <span className={c.leads > 0 ? "font-bold text-foreground" : "text-muted-foreground"}>
                            {c.leads.toLocaleString()}
                          </span>
                        </TableCell>

                        {/* Meta CPL */}
                        <TableCell className="text-right font-medium">
                          {c.leads > 0 ? (
                            <span className="text-primary font-semibold">
                              ₹{c.cpl.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* Include in KOB CPL Toggle */}
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Switch
                              checked={c.is_enabled}
                              onCheckedChange={() => handleToggle(c.id, c.is_enabled, c.name)}
                              disabled={toggleMutation.isPending || !isManagerOrAdmin}
                              aria-label={`Include ${c.name} in KOB CPL`}
                            />
                            <span
                              className={`text-xs font-semibold select-none ${
                                c.is_enabled ? "text-shero-teal" : "text-muted-foreground"
                              }`}
                            >
                              {c.is_enabled ? "ON" : "OFF"}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground pt-2">
            <div>
              Showing{" "}
              <span className="font-medium text-foreground">
                {filteredCampaigns.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1}
              </span>{" "}
              to{" "}
              <span className="font-medium text-foreground">
                {Math.min(safeCurrentPage * pageSize, filteredCampaigns.length)}
              </span>{" "}
              of <span className="font-medium text-foreground">{filteredCampaigns.length}</span> campaigns
              {filteredCampaigns.length !== campaigns.length && (
                <span> (filtered from {campaigns.length} total)</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage <= 1 || isLoading}
                className="h-8 px-3 text-xs"
              >
                Previous
              </Button>
              <div className="text-xs px-2 font-medium">
                Page {safeCurrentPage} of {totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage >= totalPages || isLoading}
                className="h-8 px-3 text-xs"
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
