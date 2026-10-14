import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/kob-dashboard/Header";
import { KPICards } from "@/components/kob-dashboard/KPICards";
import { ManualConversionFunnel } from "@/components/kob-dashboard/ManualConversionFunnel";
import { AutoConversionFunnel } from "@/components/kob-dashboard/AutoConversionFunnel";
import { LeadsTrendChart } from "@/components/kob-dashboard/LeadsTrendChart";
import { BrandPerformanceCard } from "@/components/kob-dashboard/BrandPerformanceCard";
import { ExecutivePerformance } from "@/components/kob-dashboard/ExecutivePerformance";
import { UntouchedLeadsCard } from "@/components/kob-dashboard/UntouchedLeadsCard";
import { StateSpreadCard } from "@/components/kob-dashboard/StateSpreadCard";
import { ConversionFunnelCard } from "@/components/kob-dashboard/ConversionFunnelCard";
import { RetargetingFunnelCard } from "@/components/kob-dashboard/RetargetingFunnelCard";
import { AbandonedFunnelCard } from "@/components/kob-dashboard/AbandonedFunnelCard";
import { AbandonedSplitCard } from "@/components/kob-dashboard/AbandonedSplitCard";
import { ChannelConversionCard } from "@/components/kob-dashboard/ChannelConversionCard";
import { ManagementActionItems } from "@/components/kob-dashboard/ManagementActionItems";
import { SummaryCards } from "@/components/kob-dashboard/SummaryCards";
import { useDateRange } from "@/hooks/use-date-range";
import { DashboardSkeleton } from "@/components/kob-dashboard/DashboardSkeleton";
import { useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/kob-dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Kitchen Onboarding Overview" },
      { name: "description", content: "Kitchen onboarding snapshot: leads, contracts, funnels, executive performance and action items." },
      { property: "og:title", content: "Dashboard — Kitchen Onboarding Overview" },
      { property: "og:description", content: "Kitchen onboarding snapshot: leads, contracts, funnels and executive performance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: KobDashboard,
});

function KobDashboard() {
  const [range, setRange] = useDateRange("this_month");
  const rangeKey = `${range.preset}|${range.from.toISOString()}|${range.to.toISOString()}`;

  const fetching = useIsFetching();
  const [ready, setReady] = useState(false);
  const startedRef = useRef(false);

  // Reset the skeleton whenever the requested range changes.
  useEffect(() => {
    setReady(false);
    startedRef.current = false;
  }, [rangeKey]);

  useEffect(() => {
    if (fetching > 0) startedRef.current = true;
    else if (startedRef.current) setReady(true);
  }, [fetching]);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-muted/30 p-3 sm:p-4 md:p-6">
      {!ready && <DashboardSkeleton />}
      <div
        className={
          ready
            ? "mx-auto w-full min-w-0 max-w-[1600px] space-y-4"
            : "pointer-events-none invisible absolute h-0 w-full overflow-hidden opacity-0"
        }
        aria-hidden={!ready}
      >
        <Header range={range} onRangeChange={setRange} />
        <KPICards range={range} />

        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          <ManualConversionFunnel range={range} />
          <AutoConversionFunnel range={range} />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1.15fr_1fr]">
          <LeadsTrendChart range={range} />
          <div className="flex min-w-0 flex-col gap-4">
            <ExecutivePerformance range={range} />
            <BrandPerformanceCard range={range} />
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <UntouchedLeadsCard />
          <StateSpreadCard />
          <ChannelConversionCard range={range} />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4">
          <ConversionFunnelCard range={range} />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4">
          <RetargetingFunnelCard range={range} />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4">
          <AbandonedFunnelCard range={range} />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4">
          <AbandonedSplitCard range={range} />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1fr_1.6fr]">
          <SummaryCards />
          <ManagementActionItems />
        </div>
      </div>
    </div>
  );
}

