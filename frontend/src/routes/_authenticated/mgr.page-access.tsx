import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageAccessPanel, type ProfileRow } from "@/components/page-access/PageAccessPanel";
import { ArrowLeft, Search, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mgr/page-access")({
  head: () => ({ meta: [{ title: "Page Access Management — Shero KOB" }] }),
  component: PageAccessManagement,
});

function initials(name: string | undefined) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

function roleLabel(roles: string[] | undefined) {
  if (!roles || roles.length === 0) return "—";
  if (roles.includes("super_admin")) return "Super Admin";
  if (roles.includes("kob_manager")) return "Manager";
  if (roles.includes("team_leader")) return "Team Leader";
  return "Executive";
}

function PageAccessManagement() {
  const { data: profiles = [] } = useQuery({
    queryKey: ["mgr-users"],
    queryFn: () => apiClient.get<ProfileRow[]>("/api/kob/list-all-profiles"),
  });
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = profiles.filter(
    (p) => p.full_name?.toLowerCase().includes(search.toLowerCase()) || p.email?.toLowerCase().includes(search.toLowerCase()),
  );
  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="p-6 space-y-5">
      <div>
        <Link to="/mgr/users" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Users & Roles
        </Link>
        <h1 className="text-2xl font-bold mt-2">Page Access Management</h1>
        <p className="text-sm text-muted-foreground">Control which pages each user can access.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-5">
        <div className="border rounded-lg bg-background md:max-h-[calc(100vh-220px)] md:overflow-y-auto">
          <div className="p-3 border-b sticky top-0 bg-background">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search user…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
            </div>
          </div>
          <div className="divide-y">
            {filtered.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4" /> No users found
              </div>
            )}
            {filtered.map((p) => {
              const active = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${active ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/50 border-l-2 border-l-transparent"}`}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-xs">{initials(p.full_name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className={`text-sm truncate ${active ? "font-semibold" : "font-medium"}`}>{p.full_name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{roleLabel(p.roles)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2 border rounded-lg py-20 text-muted-foreground">
              <Users className="h-8 w-8" />
              <p className="text-sm">Select a user to manage their page access.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 border-b pb-4">
                <Avatar className="h-11 w-11">
                  <AvatarFallback>{initials(selected.full_name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="text-base font-semibold truncate">{selected.full_name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="truncate">{selected.email}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">{roleLabel(selected.roles)}</span>
                  </div>
                </div>
              </div>
              <PageAccessPanel key={selected.id} userId={selected.id} profiles={profiles} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
