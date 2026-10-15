import { createFileRoute, Link, useParams, useBlocker } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { PAGE_MODULES } from "@/lib/pageRegistry";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Search, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mgr/users/$userId/page-access")({
  head: () => ({ meta: [{ title: "Page Access — Shero KOB" }] }),
  component: PageAccessScreen,
});

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
interface ProfileRow { id: string; full_name: string; email: string; roles?: string[] }

function initials(name: string | undefined) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

function PageAccessScreen() {
  const { userId } = useParams({ from: "/_authenticated/mgr/users/$userId/page-access" });
  const queryClient = useQueryClient();

  const { data: profiles = [] } = useQuery({
    queryKey: ["mgr-users"],
    queryFn: () => apiClient.get<ProfileRow[]>("/api/kob/list-all-profiles"),
  });
  const user = profiles.find((p) => p.id === userId);

  const { data, isLoading } = useQuery({
    queryKey: ["user-page-access", userId],
    queryFn: () => apiClient.get<UserPageAccessResponse>(`/api/kob/users/${userId}/page-access`),
  });

  // Staged local edits: key -> allowed. Populated once data loads.
  const [staged, setStaged] = useState<Record<string, boolean> | null>(null);
  const [search, setSearch] = useState("");
  const [confirmDisableAll, setConfirmDisableAll] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");

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

  if (!data || !current) {
    return <div className="p-6 text-sm text-muted-foreground">{isLoading ? "Loading…" : "Unable to load page access."}</div>;
  }

  const pages = data.pages.filter((p) => p.label.toLowerCase().includes(search.toLowerCase()) || p.module.toLowerCase().includes(search.toLowerCase()));
  const grouped = PAGE_MODULES.map((mod) => ({ module: mod, pages: pages.filter((p) => p.module === mod) })).filter((g) => g.pages.length > 0);
  const enabledCount = Object.values(current).filter(Boolean).length;
  const totalCount = data.pages.length;

  function setOne(key: string, allowed: boolean) {
    setStaged({ ...(current as Record<string, boolean>), [key]: allowed });
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

  const isCeoTarget = data.targetRole === "super_admin";

  return (
    <div className="p-6 space-y-5 pb-24">
      <div className="flex items-center gap-3">
        <Link to="/mgr/users" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Users & Roles
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Avatar className="h-12 w-12">
          <AvatarFallback>{initials(user?.full_name)}</AvatarFallback>
        </Avatar>
        <div>
          <div className="text-lg font-semibold">{user?.full_name ?? "User"}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span>{user?.email}</span>
            {user?.roles?.map((r) => (
              <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{r}</span>
            ))}
          </div>
        </div>
        <div className="ml-auto text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {enabledCount} of {totalCount} pages enabled
        </div>
      </div>

      {isCeoTarget ? (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          This user is a CEO (super_admin) and always has full page access. Page access cannot be restricted for this role.
        </CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search pages…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
            <Button variant="outline" size="sm" onClick={() => setMany(data.pages.map((p) => p.key), true)}>Enable All</Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmDisableAll(true)}>Disable All</Button>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
            >
              <option value="">Copy access from…</option>
              {profiles.filter((p) => p.id !== userId).map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
            <Button variant="outline" size="sm" disabled={!copyFrom || !copySource} onClick={applyCopy}>Load copy</Button>
          </div>

          <div className="space-y-4">
            {grouped.map((group) => {
              const groupKeys = group.pages.map((p) => p.key);
              const allOn = groupKeys.every((k) => current[k]);
              return (
                <Card key={group.module}>
                  <CardContent className="p-0">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
                      <span className="text-sm font-semibold">{group.module}</span>
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => setMany(groupKeys, !allOn)}
                      >
                        {allOn ? "Turn off all" : "Turn on all"}
                      </button>
                    </div>
                    <div className="divide-y">
                      {group.pages.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => setOne(p.key, !current[p.key])}
                          className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{p.label}</div>
                            <div className="text-xs text-muted-foreground truncate">{p.description}</div>
                          </div>
                          <span
                            className={`shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors ${current[p.key] ? "bg-primary" : "bg-muted-foreground/30"}`}
                            aria-checked={!!current[p.key]}
                            role="switch"
                          >
                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${current[p.key] ? "translate-x-5" : "translate-x-0.5"}`} />
                          </span>
                        </button>
                      ))}
                    </div>
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
            <AlertDialogAction onClick={() => { setMany(data.pages.map((p) => p.key), false); setConfirmDisableAll(false); }}>
              Disable All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
