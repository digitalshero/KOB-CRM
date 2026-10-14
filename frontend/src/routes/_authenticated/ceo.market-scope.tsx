import { Fragment } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Loader2, Settings2, ChevronRight, ChevronDown } from "lucide-react";


export const Route = createFileRoute("/_authenticated/ceo/market-scope")({
  head: () => ({ meta: [{ title: "India Market Scope — Shero KOB" }] }),
  component: CeoMarketScope,
});

function CeoMarketScope() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["scope"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-cities-with-scope"),
  });
  const { data: stateTotals = [] } = useQuery({
    queryKey: ["state-pincode-totals"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-state-pincode-totals"),
  });
  const grandTotal = (stateTotals as any[]).reduce((s, r) => s + Number(r.total_pincodes ?? 0), 0);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (state: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state); else next.add(state);
      return next;
    });
  };
  const citiesByState = new Map<string, any[]>();
  for (const c of (data as any[])) {
    const key = String(c.state_name ?? "").toUpperCase().trim();
    if (!key) continue;
    const arr = citiesByState.get(key) ?? [];
    arr.push(c);
    citiesByState.set(key, arr);
  }


  const recomputeAll = async () => {
    setSyncingAll(true);
    try {
      const r: any = await apiClient.post("/api/admin/pincodes/sync-india-post", {});
      toast.success(`Recomputed pincode counts: ${r.updated} matched, ${r.failed} empty (of ${r.total} cities)`);
      qc.invalidateQueries({ queryKey: ["scope"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Recompute failed");
    } finally {
      setSyncingAll(false);
    }
  };

  const recomputeOne = async (cityId: string, name: string) => {
    setSyncingId(cityId);
    try {
      const r: any = await apiClient.post("/api/admin/pincodes/sync-india-post", { cityId });
      const row = r.results?.[0];
      if (row?.matched) toast.success(`${name}: ${row.count} pincodes`);
      else toast.warning(`${name}: no matching pincodes — check aliases`);
      qc.invalidateQueries({ queryKey: ["scope"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Recompute failed");
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">India Market Scope</h1>
          <p className="text-sm text-muted-foreground">
            City-level pincode counts and computed Kitchen Scope (native + other).
            Counts are computed from the local pincode directory (19,097 pincodes loaded).
            Use per-row aliases to map cities to the directory's district/state names
            (e.g. Bengaluru → Bangalore, Trichy → Tiruchirappalli).
          </p>
        </div>
        <Button onClick={recomputeAll} disabled={syncingAll} size="sm">
          {syncingAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Recompute all pincode counts
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>India Market Scope by State</span>
            <span className="text-sm font-normal text-muted-foreground">
              {stateTotals.length} states · {grandTotal.toLocaleString()} total pincodes
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="p-2 w-8"></th>
                <th className="p-2">State</th>
                <th className="p-2 text-right">Total Pincodes</th>
                <th className="p-2 text-right">Cities Configured</th>
                <th className="p-2 text-right">Native Scope</th>
                <th className="p-2 text-right">Other Scope</th>
                <th className="p-2 text-right">Total Scope</th>
                <th className="p-2 text-right">Active</th>
              </tr>
            </thead>
            <tbody>
              {(stateTotals as any[]).map((s) => {
                const isOpen = expanded.has(s.state);
                const cities = citiesByState.get(String(s.state ?? "").toUpperCase().trim()) ?? [];
                return (
                <Fragment key={s.state}>
                <tr
                  key={s.state}
                  className="border-b hover:bg-muted/40 cursor-pointer"
                  onClick={() => toggleExpanded(s.state)}
                >
                  <td className="p-2 text-muted-foreground">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </td>
                  <td className="p-2 font-medium">{s.state}</td>
                  <td className="p-2 text-right font-semibold">{Number(s.total_pincodes).toLocaleString()}</td>
                  <td className="p-2 text-right">{s.cities_configured ?? 0}</td>
                  <td className="p-2 text-right text-primary font-medium">{Number(s.native_kitchen_scope ?? 0).toLocaleString()}</td>
                  <td className="p-2 text-right">{Number(s.other_kitchen_scope ?? 0).toLocaleString()}</td>
                  <td className="p-2 text-right font-semibold">
                    {(Number(s.native_kitchen_scope ?? 0) + Number(s.other_kitchen_scope ?? 0)).toLocaleString()}
                  </td>
                  <td className="p-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {s.state_id ? (
                      <Switch
                        checked={!!s.active}
                        onCheckedChange={async (v) => {
                          try {
                            await apiClient.patch(`/api/kob/entities/india_states/${s.state_id}/toggle`, { active: v });
                            qc.invalidateQueries({ queryKey: ["state-pincode-totals"] });
                            qc.invalidateQueries({ queryKey: ["scope"] });
                          } catch (e: any) {
                            toast.error(e?.message ?? "Toggle failed");
                          }
                        }}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${s.state}-cities`} className="bg-muted/20 border-b">
                    <td></td>
                    <td colSpan={7} className="p-3">
                      {cities.length === 0 ? (
                        <div className="text-xs text-muted-foreground py-2">
                          No cities configured for this state. Add cities via the Kitchen Scope page.
                        </div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead className="text-left text-[10px] uppercase text-muted-foreground border-b">
                            <tr>
                              <th className="p-1.5">City</th>
                              <th className="p-1.5 text-right">Pincodes</th>
                              <th className="p-1.5 text-right">Native Scope</th>
                              <th className="p-1.5 text-right">Other Scope</th>
                              <th className="p-1.5 text-right">Active</th>
                              <th className="p-1.5 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cities.map((c: any) => (
                              <tr key={c.city_id} className="border-b last:border-b-0 hover:bg-muted/40">
                                <td className="p-1.5 font-medium">{c.city_name}</td>
                                <td className="p-1.5 text-right">{Number(c.pincode_count ?? 0).toLocaleString()}</td>
                                <td className="p-1.5 text-right text-primary">{Number(c.native_kitchen_scope ?? 0).toLocaleString()}</td>
                                <td className="p-1.5 text-right">{Number(c.other_kitchen_scope ?? 0).toLocaleString()}</td>
                                <td className="p-1.5 text-right">
                                  <Switch
                                    checked={!!c.active}
                                    onCheckedChange={async (v) => {
                                      try {
                                        await apiClient.patch(`/api/kob/entities/india_cities/${c.city_id}/toggle`, { active: v });
                                        qc.invalidateQueries({ queryKey: ["scope"] });
                                      } catch (e: any) {
                                        toast.error(e?.message ?? "Toggle failed");
                                      }
                                    }}
                                  />
                                </td>
                                <td className="p-1.5 text-right whitespace-nowrap">
                                  <AliasEditor
                                    cityId={c.city_id}
                                    cityName={c.city_name}
                                    stateName={c.state_name}
                                    districtAliases={c.district_aliases ?? []}
                                    stateAliases={c.state_aliases ?? []}
                                    onSaved={() => {
                                      qc.invalidateQueries({ queryKey: ["scope"] });
                                      qc.invalidateQueries({ queryKey: ["state-pincode-totals"] });
                                    }}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={syncingId === c.city_id}
                                    onClick={() => recomputeOne(c.city_id, c.city_name)}
                                    title="Recompute pincode count"
                                  >
                                    {syncingId === c.city_id
                                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      : <RefreshCw className="w-3.5 h-3.5" />}
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}

            </tbody>
          </table>
        </CardContent>
      </Card>

    </div>
  );
}

function AliasEditor({
  cityId, cityName, stateName, districtAliases, stateAliases, onSaved,
}: {
  cityId: string; cityName: string; stateName: string;
  districtAliases: string[]; stateAliases: string[]; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dText, setDText] = useState(districtAliases.join(", "));
  const [sText, setSText] = useState(stateAliases.join(", "));
  const [saving, setSaving] = useState(false);
  const hasAlias = districtAliases.length > 0 || stateAliases.length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const r: any = await apiClient.patch("/api/admin/pincodes/aliases", {
        cityId,
        districtAliases: dText.split(",").map((s) => s.trim()).filter(Boolean),
        stateAliases: sText.split(",").map((s) => s.trim()).filter(Boolean),
      });
      const n = r?.updated?.pincode_count ?? 0;
      toast.success(`Saved — ${cityName}: ${n} pincodes`);
      onSaved();
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (v) { setDText(districtAliases.join(", ")); setSText(stateAliases.join(", ")); }
    }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="Edit district/state aliases">
          <Settings2 className={`w-3.5 h-3.5 ${hasAlias ? "text-primary" : ""}`} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aliases — {cityName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Comma-separated names as they appear in the loaded pincode directory.
            Leave blank to fall back to the city name (<code>{cityName}</code>) and
            state name (<code>{stateName}</code>).
          </p>
          <div className="space-y-1">
            <Label>District aliases</Label>
            <Input value={dText} onChange={(e) => setDText(e.target.value)}
              placeholder="e.g. Bangalore, Bangalore Rural" />
          </div>
          <div className="space-y-1">
            <Label>State aliases</Label>
            <Input value={sText} onChange={(e) => setSText(e.target.value)}
              placeholder="e.g. ANDHRA PRADESH, TELANGANA" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save & recompute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
