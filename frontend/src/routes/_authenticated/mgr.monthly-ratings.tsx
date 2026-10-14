import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/mgr/monthly-ratings")({
  head: () => ({ meta: [{ title: "Monthly Ratings — Shero KOB" }] }),
  component: MonthlyRatingsPage,
});

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function MonthlyRatingsPage() {
  const qc = useQueryClient();

  const { data: users = [] } = useQuery({
    queryKey: ["rateable-users"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-rateable-users"),
  });
  const { data: ratings = [] } = useQuery({
    queryKey: ["manual-ratings"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-manual-ratings"),
  });
  const { data: composite = [] } = useQuery({
    queryKey: ["scv-composite"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-scv-composite"),
  });
  const { data: weights = [] } = useQuery({
    queryKey: ["role-weights"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-role-weights"),
  });

  const [userId, setUserId] = useState<string>("");
  const [period, setPeriod] = useState<string>(currentMonth().slice(0, 7));
  const [personal, setPersonal] = useState<string>("");
  const [compliance, setCompliance] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const selectedUser = useMemo(() => (users as any[]).find((u) => u.user_id === userId), [users, userId]);
  const showCompliance = selectedUser && selectedUser.role !== "executive";
  const roleWeight = useMemo(
    () => (weights as any[]).find((w) => w.role === selectedUser?.role),
    [weights, selectedUser],
  );

  const save = useMutation({
    mutationFn: (payload: any) => apiClient.post("/api/kob/manual-ratings", payload),
    onSuccess: () => {
      toast.success("Rating saved");
      setPersonal(""); setCompliance(""); setNotes("");
      qc.invalidateQueries({ queryKey: ["manual-ratings"] });
      qc.invalidateQueries({ queryKey: ["scv-composite"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const submit = () => {
    if (!userId) return toast.error("Pick a team member");
    const p = Number(personal);
    if (Number.isNaN(p) || p < 0 || p > 100) return toast.error("Personal score must be 0–100");
    let c: number | null = null;
    if (showCompliance) {
      if (compliance === "") return toast.error("Compliance score required for TL/Manager");
      c = Number(compliance);
      if (Number.isNaN(c) || c < 0 || c > 100) return toast.error("Compliance score must be 0–100");
    }
    save.mutate({
      user_id: userId,
      period: `${period}-01`,
      personal_score: p,
      compliance_score: c,
      notes: notes || null,
    });
  };

  const userNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users as any[]) m[u.user_id] = u.full_name;
    return m;
  }, [users]);

  // Live preview for currently-selected user
  const previewRow = useMemo(
    () => (composite as any[]).find((r) => r.user_id === userId),
    [composite, userId],
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Monthly Ratings</h1>
        <p className="text-sm text-muted-foreground">
          Manager / CEO enter monthly Personal and Compliance scores. Composite = Official × official-weight + Personal × personal-weight + Compliance × compliance-weight (per role).
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {(weights as any[]).map((w) => (
          <Card key={w.role}>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">{w.role}</div>
              <div className="mt-1 text-sm">Official <b>{w.official_weight}</b> · Personal <b>{w.personal_weight}</b> · Compliance <b>{w.compliance_weight}</b></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Enter a rating</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Team member</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger><SelectValue placeholder="Pick a user" /></SelectTrigger>
                <SelectContent>
                  {(users as any[]).map((u) => (
                    <SelectItem key={u.user_id} value={u.user_id}>
                      {u.full_name} <span className="text-xs text-muted-foreground">· {u.role}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Month</Label>
              <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Personal score (0–100)</Label>
              <Input type="number" min={0} max={100} value={personal} onChange={(e) => setPersonal(e.target.value)} />
            </div>
            {showCompliance && (
              <div className="space-y-2">
                <Label>Compliance score (0–100)</Label>
                <Input type="number" min={0} max={100} value={compliance} onChange={(e) => setCompliance(e.target.value)} />
              </div>
            )}
            {selectedUser && selectedUser.role === "executive" && (
              <div className="text-xs text-muted-foreground">Compliance not applicable for Executive role (weight 0).</div>
            )}
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <Button onClick={submit} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save rating"}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Live composite preview</CardTitle></CardHeader>
          <CardContent>
            {!previewRow && <div className="text-sm text-muted-foreground">Pick a team member to preview their composite score.</div>}
            {previewRow && (
              <div className="space-y-3 text-sm">
                <div className="font-medium">{previewRow.full_name} <span className="text-xs text-muted-foreground">· {previewRow.role}</span></div>
                <div className="grid grid-cols-2 gap-2">
                  <div>Official: <b>{Number(previewRow.official_score ?? 0).toFixed(2)}</b> <span className="text-xs text-muted-foreground">× {previewRow.official_weight}</span></div>
                  <div>Personal: <b>{previewRow.personal_score ?? "—"}</b> <span className="text-xs text-muted-foreground">× {previewRow.personal_weight}</span></div>
                  <div>Compliance: <b>{previewRow.compliance_score ?? "—"}</b> <span className="text-xs text-muted-foreground">× {previewRow.compliance_weight}</span></div>
                  <div>Composite: <b className="text-lg">{Number(previewRow.composite_score ?? 0).toFixed(2)}</b></div>
                </div>
                {roleWeight && (
                  <div className="text-xs text-muted-foreground">
                    Formula: (Official × {roleWeight.official_weight} + Personal × {roleWeight.personal_weight} + Compliance × {roleWeight.compliance_weight}) / 100
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Composite scores (all users)</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">User</th>
                <th className="p-2">Role</th>
                <th className="p-2 text-right">Official</th>
                <th className="p-2 text-right">Personal</th>
                <th className="p-2 text-right">Compliance</th>
                <th className="p-2 text-right">Weights (O/P/C)</th>
                <th className="p-2 text-right">Composite</th>
                <th className="p-2">Rated for</th>
              </tr>
            </thead>
            <tbody>
              {(composite as any[]).map((r) => (
                <tr key={r.user_id} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-medium">{r.full_name}</td>
                  <td className="p-2 text-xs">{r.role}</td>
                  <td className="p-2 text-right">{Number(r.official_score ?? 0).toFixed(2)}</td>
                  <td className="p-2 text-right">{r.personal_score ?? "—"}</td>
                  <td className="p-2 text-right">{r.compliance_score ?? "—"}</td>
                  <td className="p-2 text-right text-xs text-muted-foreground">{r.official_weight}/{r.personal_weight}/{r.compliance_weight}</td>
                  <td className="p-2 text-right font-semibold">{Number(r.composite_score ?? 0).toFixed(2)}</td>
                  <td className="p-2 text-xs">{r.rating_period ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent ratings</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2">User</th>
                <th className="p-2">Period</th>
                <th className="p-2 text-right">Personal</th>
                <th className="p-2 text-right">Compliance</th>
                <th className="p-2">Rated at</th>
                <th className="p-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {(ratings as any[]).map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-2">{userNames[r.user_id] ?? r.user_id.slice(0, 8)}</td>
                  <td className="p-2 text-xs">{r.period}</td>
                  <td className="p-2 text-right">{r.personal_score}</td>
                  <td className="p-2 text-right">{r.compliance_score ?? "—"}</td>
                  <td className="p-2 text-xs">{new Date(r.rated_at).toLocaleString()}</td>
                  <td className="p-2 text-xs text-muted-foreground">{r.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
