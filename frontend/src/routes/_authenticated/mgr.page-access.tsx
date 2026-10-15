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
    <div className="p-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link to="/mgr/users" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Users & Roles
          </Link>
          <h1 className="text-xl font-bold mt-0.5">Page Access Management</h1>
        </div>
        {selected && (
          <div className="flex items-center gap-2 min-w-0 shrink text-right">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{selected.full_name}</div>
              <div className="text-[11px] text-muted-foreground truncate">{roleLabel(selected.roles)}</div>
            </div>
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs">{initials(selected.full_name)}</AvatarFallback>
            </Avatar>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
        <div className="border rounded-lg bg-background md:max-h-[calc(100vh-150px)] md:overflow-y-auto">
          <div className="p-2 border-b sticky top-0 bg-background z-10">
            <div className="relative">
              <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search user…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 text-xs" />
            </div>
          </div>
          <div className="divide-y">
            {filtered.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                <Users className="h-3.5 w-3.5" /> No users found
              </div>
            )}
            {filtered.map((p) => {
              const active = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors ${active ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/50 border-l-2 border-l-transparent"}`}
                >
                  <span className={`text-xs truncate ${active ? "font-semibold" : "font-medium"}`}>{p.full_name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{roleLabel(p.roles)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2 border rounded-lg py-16 text-muted-foreground">
              <Users className="h-7 w-7" />
              <p className="text-sm">Select a user to manage their page access.</p>
            </div>
          ) : (
            <PageAccessPanel key={selected.id} userId={selected.id} profiles={profiles} />
          )}
        </div>
      </div>
    </div>
  );
}
