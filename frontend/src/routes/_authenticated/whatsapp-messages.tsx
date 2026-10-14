import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageCircle, RefreshCw } from "lucide-react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { apiClient } from "@/lib/api-client";


export const Route = createFileRoute("/_authenticated/whatsapp-messages")({
  head: () => ({
    meta: [
      { title: "WhatsApp Messages — KOB Sales" },
      { name: "description", content: "Incoming lead WhatsApp messages from the KOB Sales channel, newest first." },
      { property: "og:title", content: "WhatsApp Messages — KOB Sales" },
      { property: "og:description", content: "Incoming lead WhatsApp messages from the KOB Sales channel, newest first." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WhatsappMessagesPage,
});

function relTime(at?: string | null) {
  if (!at) return "—";
  const d = new Date(at);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function stamp(at?: string | null) {
  if (!at) return "—";
  return new Date(at).toLocaleString();
}

function WhatsappMessagesPage() {
  const [unreadOnly, setUnreadOnly] = usePersistedState<boolean>("wa.unreadOnly", false);
  const [search, setSearch] = usePersistedState<string>("wa.search", "");
  const [execId, setExecId] = usePersistedState<string>("wa.exec", "all");

  const { data: rows = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["whatsapp-messages"],
    queryFn: () => apiClient.get<any[]>("/api/kob/whatsapp-messages?limit=5000"),
    refetchInterval: 60000,
  });

  const { data: executives = [] } = useQuery({
    queryKey: ["whatsapp-executives"],
    queryFn: () => apiClient.get<any[]>("/api/kob/whatsapp-executives"),
    staleTime: 60000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return (rows as any[])
      .filter((l) => (execId === "all" ? true : l.assigned_to === execId))
      .filter((l) => (unreadOnly ? l.has_unread_messages : true))
      .filter((l) => {
        if (!q) return true;
        const phone = (l.phone ?? "").replace(/\D/g, "");
        if (digits && phone && phone.includes(digits)) return true;
        return (l.full_name ?? "").toLowerCase().includes(q) || (l.code ?? "").toLowerCase().includes(q);
      })
      .sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime());
  }, [rows, unreadOnly, search, execId]);

  const unreadTotal = useMemo(
    () => (rows as any[]).filter((l) => l.has_unread_messages).length,
    [rows],
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageCircle className="h-6 w-6 text-green-600" /> WhatsApp Messages
          </h1>
          <p className="text-sm text-muted-foreground">
            KOB Sales channel only · {isLoading ? "Loading…" : `${filtered.length} conversations · ${unreadTotal} unread`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={execId} onValueChange={setExecId}>
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue placeholder="Executive" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Executives</SelectItem>
              {(executives as any[]).map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="h-9 w-[220px] rounded-md border bg-background px-3 text-sm"
          />
          <Button variant={unreadOnly ? "default" : "outline"} size="sm" onClick={() => setUnreadOnly(!unreadOnly)}>
            Unread only
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {isError ? (
        <Card>
          <CardContent className="p-6 space-y-2">
            <div className="text-sm text-destructive font-medium">Failed to load messages</div>
            <div className="text-xs text-muted-foreground break-all">{(error as any)?.message ?? "Unknown error"}</div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-10 flex flex-col items-center gap-3 text-muted-foreground">
            <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <div className="text-sm">Fetching messages…</div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {filtered.map((l) => (
              <Link
                key={l.id}
                to="/leads/$id"
                params={{ id: l.id }}
                className={`flex items-start gap-3 p-3 hover:bg-muted/40 ${l.has_unread_messages ? "bg-green-50/60" : ""}`}
              >
                <div className="mt-0.5">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${l.has_unread_messages ? "bg-green-600" : "bg-muted-foreground/30"}`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm ${l.has_unread_messages ? "font-semibold" : "font-medium"}`}>{l.full_name}</span>
                    <span className="text-xs text-muted-foreground">{l.phone ?? "—"}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{l.code}</span>
                    {l.has_unread_messages && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white font-medium">
                        {l.unread_message_count > 0 ? `${l.unread_message_count} unread` : "Unread"}
                      </span>
                    )}
                  </div>
                  <div className={`text-sm truncate ${l.has_unread_messages ? "text-foreground" : "text-muted-foreground"}`}>
                    {l.last_message}
                  </div>
                </div>
                <div className="text-right whitespace-nowrap">
                  <div className="text-xs text-muted-foreground">{relTime(l.last_message_at)}</div>
                  <div className="text-[10px] text-muted-foreground/80">{stamp(l.last_message_at)}</div>
                </div>
              </Link>
            ))}
            {filtered.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">No WhatsApp messages yet</div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
