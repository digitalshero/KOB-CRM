import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ceo/kitchen-scope")({
  head: () => ({ meta: [{ title: "Kitchen Scope Calculator — Shero KOB" }] }),
  component: CeoKitchenScope,
});

function Field({ label, val, onChange }: { label: string; val: any; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 items-center">
      <Label className="text-sm">{label}</Label>
      <Input type="number" step="any" value={val ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function CeoKitchenScope() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["cfg"], queryFn: () => apiClient.get<any>("/api/kob/get-config") });
  const [form, setForm] = useState<any>(null);
  const cfg = form ?? (data as any);
  const [preview, setPreview] = useState({ pincodes: 100, otherActiveBrands: 5 });
  const nativeMul = Number(cfg?.native_brand_multiplier ?? 4);
  const otherMul = Number(cfg?.other_brand_multiplier ?? 2);
  const nativeScope = preview.pincodes * nativeMul;
  const otherScope = preview.pincodes * preview.otherActiveBrands * otherMul;

  const save = async () => {
    if (!form) return;
    try {
      await apiClient.patch("/api/kob/config", {
        native_brand_multiplier: parseInt(String(form.native_brand_multiplier)),
        other_brand_multiplier: parseInt(String(form.other_brand_multiplier)),
      });
      toast.success("Multipliers saved"); qc.invalidateQueries();
    } catch (e: any) { toast.error(e.message); }
  };

  if (!cfg) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Kitchen Scope Calculator</h1>
        <p className="text-sm text-muted-foreground">CEO Office master. Multipliers drive city-level Kitchen Scope across the app.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Multipliers (integers only)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Native Brand Multiplier" val={cfg.native_brand_multiplier}
              onChange={(v) => setForm({ ...cfg, native_brand_multiplier: v })} />
            <Field label="Other Brand Multiplier" val={cfg.other_brand_multiplier}
              onChange={(v) => setForm({ ...cfg, other_brand_multiplier: v })} />
            <p className="text-xs text-muted-foreground">
              Native Scope = Pincode Count × Native Multiplier<br />
              Other Scope = Pincode Count × Other Active Brands × Other Multiplier<br />
              Total Kitchen Scope = Native Scope + Other Scope
            </p>
            <Button onClick={save} disabled={!form}>Save</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Live Calculator</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Pincode Count" val={preview.pincodes}
              onChange={(v) => setPreview({ ...preview, pincodes: parseInt(v) || 0 })} />
            <Field label="Other Active Brands" val={preview.otherActiveBrands}
              onChange={(v) => setPreview({ ...preview, otherActiveBrands: parseInt(v) || 0 })} />
            <div className="rounded-lg bg-muted p-3 space-y-1 text-sm">
              <div>Native Scope: <span className="font-semibold">{preview.pincodes} × {nativeMul} = {nativeScope.toLocaleString()}</span></div>
              <div>Other Scope: <span className="font-semibold">{preview.pincodes} × {preview.otherActiveBrands} × {otherMul} = {otherScope.toLocaleString()}</span></div>
              <div className="border-t pt-1 mt-1 text-primary font-bold">Total: {(nativeScope + otherScope).toLocaleString()}</div>
            </div>
            <p className="text-xs text-muted-foreground">
              Example — Chennai: 100 × 4 + 100 × 5 × 2 = 1,400.<br />
              Example — Pune: 50 × 4 + 50 × 5 × 2 = 700.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
