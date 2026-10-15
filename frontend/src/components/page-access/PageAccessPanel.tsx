import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { PAGE_MODULES, groupPageRegistry, type GroupedPage } from "@/lib/pageRegistry";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, ShieldCheck, ChevronDown } from "lucide-react";

interface PageAccessPage {
  key: string;
  label: string;
  module: string;
  description: string;
  allowed: boolean;
}
interface UserPageAccessResponse {
  pages: PageAccessPage[];
  unrestricted: boolean;
  targetRole: string | null;
}
export interface ProfileRow { id: string; full_name: string; email: string; roles?: string[] }

/**
 * The permission-management surface for a single user. Sidebar pages that
 * exist as multiple role-specific routes (e.g. "Lead Inbox" under CEO/
 * Manager/TL nav) are shown as ONE row via groupPageRegistry — a user only
 * ever has one such route in their own nav, so the CEO managing someone
 * else's access should see one toggle per sidebar page, not one per route
 * variant. Reused by the /mgr/page-access management screen. Business
 * logic (staging, save mutation, audit) is unchanged.
 */
export function PageAccessPanel({ userId, profiles }: { userId: string; profiles: ProfileRow[] }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["user-page-access", userId],
    queryFn: () => apiClient.get<UserPageAccessResponse>(`/api/kob/users/${userId}/page-access`),
  });

  const [staged, setStaged] = useState<Record<string, boolean> | null>(null);
  const [search, setSearch] = useState("");
  const [confirmDisableAll, setConfirmDisableAll] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const baseline = useMemo(() => {
    if (!data) return null;
    const map: Record<string, boolean> = {};
    for (const p of data.pages) map[p.key] = p.allowed;
    return map;
  }, [data]);

  const current = staged ?? baseline;

  const dirtyCount = useMemo(() => {
    if (!staged || !baseline) return 0;
    let n = 0;
    for (const key of Object.keys(staged)) if (staged[key] !== baseline[key]) n++;
    return n;
  }, [staged, baseline]);

  useBlocker({
    shouldBlockFn: () => dirtyCount > 0 && !window.confirm("You have unsaved page access changes. Leave without saving?"),
    disabled: dirtyCount === 0,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!staged) return;
      const grants = Object.entries(staged).map(([page_key, allowed]) => ({ page_key, allowed }));
      await apiClient.put(`/api/kob/users/${userId}/page-access`, { grants });
    },
    onSuccess: () => {
      toast.success("Page access updated successfully");
      queryClient.invalidateQueries({ queryKey: ["user-page-access", userId] });
      queryClient.invalidateQueries({ queryKey: ["my-page-access"] });
      setStaged(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update page access. Your changes have been kept — try saving again.");
      // Intentionally do NOT clear `staged` here — unsaved selections are retained on failure.
    },
  });

  const { data: copySource } = useQuery({
    queryKey: ["user-page-access", copyFrom],
    queryFn: () => apiClient.get<UserPageAccessResponse>(`/api/kob/users/${copyFrom}/page-access`),
    enabled: !!copyFrom,
  });

  const allGroups = useMemo(() => groupPageRegistry(), []);

  if (!data || !current) {
    return <div className="text-sm text-muted-foreground p-6">{isLoading ? "Loading…" : "Unable to load page access."}</div>;
  }

  // One row per sidebar page (not per underlying role-route key).
  const q = search.toLowerCase();
  const visibleGroups = allGroups.filter((g) => !q || g.label.toLowerCase().includes(q) || g.module.toLowerCase().includes(q));
  const byModule = PAGE_MODULES
    .map((mod) => ({ module: mod, groups: visibleGroups.filter((g) => g.module === mod) }))
    .filter((m) => m.groups.length > 0);

  const allKeys = allGroups.flatMap((g) => g.keys);
  const enabledGroupCount = allGroups.filter((g) => g.keys.some((k) => current[k])).length;
  const totalGroupCount = allGroups.length;

  function isGroupOn(g: GroupedPage) {
    return g.keys.some((k) => (current as Record<string, boolean>)[k]);
  }
  function setGroup(g: GroupedPage, allowed: boolean) {
    const next = { ...(current as Record<string, boolean>) };
    for (const k of g.keys) next[k] = allowed;
    setStaged(next);
  }
  function setMany(keys: string[], allowed: boolean) {
    const next = { ...(current as Record<string, boolean>) };
    for (const k of keys) next[k] = allowed;
    setStaged(next);
  }
  function applyCopy() {
    if (!copySource) return;
    const next: Record<string, boolean> = {};
    for (const p of copySource.pages) next[p.key] = p.allowed;
    setStaged(next);
    toast.info("Copied selection loaded — review and Save to apply.");
  }
  function toggleCollapsed(mod: string) {
    setCollapsed((c) => ({ ...c, [mod]: !c[mod] }));
  }

  const isCeoTarget = data.targetRole === "super_admin";

  return (
    <div className="space-y-3 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {enabledGroupCount} of {totalGroupCount} pages enabled
        </div>
      </div>

      {isCeoTarget ? (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          This user is a CEO (super_admin) and always has full page access. Page access cannot be restricted for this role.
        </CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search pages…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-1 text-xs ml-auto">
              <button type="button" className="px-2 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted" onClick={() => setMany(allKeys, true)}>
                Enable All
              </button>
              <span className="text-border">|</span>
              <button type="button" className="px-2 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted" onClick={() => setConfirmDisableAll(true)}>
                Disable All
              </button>
              <span className="text-border">|</span>
              <select
                className="h-7 rounded-md border bg-background px-1.5 text-xs text-muted-foreground"
                value={copyFrom}
                onChange={(e) => setCopyFrom(e.target.value)}
              >
                <option value="">Copy from…</option>
                {profiles.filter((p) => p.id !== userId).map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
              <button
                type="button"
                className="px-2 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                disabled={!copyFrom || !copySource}
                onClick={applyCopy}
              >
                Load
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            {byModule.map(({ module, groups }) => {
              const isCollapsed = collapsed[module] ?? false;
              const allOn = groups.every((g) => isGroupOn(g));
              return (
                <Card key={module} className="overflow-hidden">
                  <CardContent className="p-0">
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(module)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30 text-left"
                    >
                      <span className="flex items-center gap-1.5 text-xs font-semibold">
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                        {module}
                        <span className="font-normal text-muted-foreground">({groups.length})</span>
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setMany(groups.flatMap((g) => g.keys), !allOn); }}
                        className="text-[11px] text-primary hover:underline"
                      >
                        {allOn ? "Turn off all" : "Turn on all"}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="divide-y">
                        {groups.map((g) => {
                          const on = isGroupOn(g);
                          return (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => setGroup(g, !on)}
                              className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted/40 transition-colors"
                            >
                              <span className="text-xs font-medium truncate">{g.label}</span>
                              <span
                                className={`shrink-0 inline-flex h-4.5 w-8 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"}`}
                                style={{ height: "1.125rem", width: "2rem" }}
                                aria-checked={on}
                                role="switch"
                              >
                                <span
                                  className={`inline-block rounded-full bg-white shadow transform transition-transform ${on ? "translate-x-[1.1rem]" : "translate-x-0.5"}`}
                                  style={{ height: "0.85rem", width: "0.85rem" }}
                                />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {dirtyCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 md:left-64 border-t bg-background/95 backdrop-blur px-6 py-3 flex items-center gap-3 z-40">
          <span className="text-sm font-medium">{dirtyCount} unsaved change{dirtyCount !== 1 ? "s" : ""}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setStaged(null)} disabled={saveMutation.isPending}>Cancel</Button>
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save Access"}
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmDisableAll} onOpenChange={setConfirmDisableAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable all pages?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove this user's access to every page. They will see "No pages have been assigned to your account" until access is restored. This only takes effect after you click Save Access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setMany(allKeys, false); setConfirmDisableAll(false); }}>
              Disable All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
