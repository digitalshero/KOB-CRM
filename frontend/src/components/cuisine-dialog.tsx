import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function CuisineDialog({
  leadId,
  current,
  onClose,
}: {
  leadId: string | null;
  current?: string | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState<string>(current ?? "");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  // Options = ACTIVE brands from Brand Management (single source of truth).
  const { data: brands = [], isLoading } = useQuery({
    queryKey: ["active-brands-cuisine"],
    enabled: !!leadId,
    staleTime: 0,
    queryFn: async () => {
      const allBrands = await apiClient.get<Array<{ id: string; name: string; active?: boolean }>>("/api/kob/list-brands");
      return (allBrands ?? []).filter((b) => b.active !== false);
    },
  });

  useEffect(() => setValue(current ?? ""), [leadId, current]);

  const confirm = async () => {
    if (!leadId || !value) return;
    setSaving(true);
    try {
      await apiClient.patch(`/api/kob/leads/${leadId}/cuisine`, { cuisine: value });
      toast.success(`Cuisine saved: ${value}`);
      qc.invalidateQueries();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save cuisine");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Select Cuisine</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active brands in Brand Management.</p>
        ) : (
          <RadioGroup value={value} onValueChange={setValue} className="space-y-2">
            {brands.map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-md border p-3">
                <RadioGroupItem value={b.name} id={`cuisine-${b.id}`} />
                <Label htmlFor={`cuisine-${b.id}`} className="cursor-pointer">{b.name}</Label>
              </div>
            ))}
          </RadioGroup>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Select Later</Button>
          <Button onClick={confirm} disabled={!value || saving || !brands.some((b) => b.name === value)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
