import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Mode = "AUTO" | "MANUAL";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">{children}</div>;
}

// Read-only explanation of the existing SCV & Incentive calculations.
export function ScvCalculationGuide({ mode, components, slabs }: { mode: Mode; components: any[]; slabs: any[] }) {
  const [open, setOpen] = useState(false);
  const { data: cfg } = useQuery({ queryKey: ["scv-mode-config", mode], queryFn: () => apiClient.get<any>(`/api/kob/scv-mode-config?mode=${mode}`), enabled: open });

  const modeLabel = mode === "AUTO" ? "Auto" : "Manual";
  void components; void slabs;
  const amount = Number((cfg as any)?.incentiveAmount ?? 10000);

  return (
    <>
      <button
        type="button"
        aria-label="SCV & Incentives — Calculation Guide"
        title="SCV & Incentives — Calculation Guide"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Info className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Info className="h-4 w-4 text-primary" /> SCV & Incentives — Calculation Guide</DialogTitle>
            <DialogDescription>Showing {modeLabel} mode (the mode currently selected). All values are for the selected month only.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <Section title="A. SCV">
              <p>SCV is the total weighted score from Performance, TAT Compliance and Discipline, out of 100. Auto and Manual modes use separate settings and Monthly Inputs.</p>
              <Formula>SCV = Sum of (Component % × Weightage ÷ 100)</Formula>
            </Section>
            <Section title="B. OVERALL %">
              <p>The simple average of all applicable component percentages, without weightage.</p>
              <Formula>Overall % = Sum of Component Percentages ÷ Number of Components</Formula>
            </Section>
            <Section title="C. PERFORMANCE %">
              <p>Measures KTN CS contracts achieved against the monthly target.</p>
              <Formula>Performance % = (KTN CS ÷ Monthly Target) × 100, maximum 100%</Formula>
            </Section>
            <Section title="D. TAT COMPLIANCE %">
              <p>Measures how quickly leads complete enabled stage movements against their target days.</p>
              <Formula>TAT Compliance % = Average Achievement % of Enabled Movements</Formula>
            </Section>
            <Section title="E. DISCIPLINE %">
              <p>The discipline score entered by the manager or TL in Monthly Inputs.</p>
              <Formula>Discipline % = Entered Discipline Mark (0–100)</Formula>
            </Section>
            <Section title="F. KTN CS">
              <p>Number of unique leads assigned to the executive that entered KTN CS during the selected month and are still in KTN CS. Each qualifying lead is counted once.</p>
            </Section>
            <Section title="G. SLAB">
              <p>The executive's slab is determined by the final SCV score.</p>
              <Formula>A ≥90 | B ≥80 | C ≥70 | D ≥60 | E &lt;60</Formula>
            </Section>
            <Section title="H. PAYOUT %">
              <p>Payout percentage is based on the executive's SCV slab and is displayed for reference.</p>
              <Formula>A = 100% | B = 80% | C = 60% | D = 40% | E = 0%</Formula>
            </Section>
            <Section title="I. INCENTIVE">
              <p>Calculated across four weekly periods. A week earns an incentive only when its KTN CS count meets the weekly target.</p>
              <Formula>Monthly Incentive = Sum of Eligible Weekly KTN CS × ₹{amount.toLocaleString()}</Formula>
            </Section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
