import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/ceo/native-brand-mapping")({
  head: () => ({ meta: [{ title: "Native Brand Mapping — Shero KOB" }] }),
  component: CeoNativeBrandMapping,
});

function CeoNativeBrandMapping() {
  const qc = useQueryClient();
  const { data: states = [] } = useQuery({ queryKey: ["states"], queryFn: () => apiClient.get<any[]>("/api/kob/list-states") });
  const { data: brands = [] } = useQuery({ queryKey: ["brands"], queryFn: () => apiClient.get<any[]>("/api/kob/list-brands") });
  const { data: mapping = [] } = useQuery({
    queryKey: ["snb"],
    queryFn: () => apiClient.get<any[]>("/api/kob/list-state-native-brands"),
  });
  const map = new Map((mapping as any[]).map((m: any) => [m.state_id, m.brand_id]));

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isShero, setIsShero] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!code.trim() || !name.trim()) { toast.error("Code and name required"); return; }
    if (!isShero) {
      toast.error("Only Shero (SHF) brands can be mapped as native. Toggle Shero on, or add External brands from Brand Management.");
      return;
    }
    setSaving(true);
    try {
      await apiClient.post("/api/kob/brands", { code: code.trim(), name: name.trim(), is_shero: isShero, active: true });
      await qc.invalidateQueries({ queryKey: ["brands"] });
      await qc.refetchQueries({ queryKey: ["brands"] });
      toast.success(`Brand ${name} created — now selectable in the native-brand dropdowns below.`);
      setCode(""); setName(""); setIsShero(true); setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create brand");
    } finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Native Brand Mapping</h1>
          <p className="text-sm text-muted-foreground">Assign each state its Native SHF brand. Native brand receives the higher multiplier in Kitchen Scope.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> Add Brand</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Brand</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Code</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. SHF7" maxLength={16} />
              </div>
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Brand name" />
              </div>
              <div className="flex items-center justify-between border rounded p-2">
                <div>
                  <div className="text-sm font-medium">Shero (SHF) brand</div>
                  <div className="text-xs text-muted-foreground">Off = External brand (counted in Other Kitchen Scope)</div>
                </div>
                <Switch checked={isShero} onCheckedChange={setIsShero} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card><CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(states as any[]).map((s: any) => (
            <div key={s.id} className="flex items-center gap-3 border-b py-2">
              <div className="w-40 font-medium">{s.name} <span className="text-xs text-muted-foreground">({s.code})</span></div>
              <select
                className="flex-1 border rounded px-2 py-1 text-sm"
                value={map.get(s.id) ?? ""}
                onChange={async (e) => {
                  await apiClient.post("/api/kob/state-native-brand", { state_id: s.id, brand_id: e.target.value });
                  toast.success("Mapping saved"); qc.invalidateQueries();
                }}
              >
                <option value="">— select native brand —</option>
                {(brands as any[]).filter((b: any) => b.is_shero).map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </CardContent></Card>
    </div>
  );
}
