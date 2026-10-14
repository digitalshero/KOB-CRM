import * as React from "react";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, subDays } from "date-fns";
import { CalendarIcon, ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "last_month"
  | "mtd"
  | "last_3_months"
  | "last_6_months"
  | "all_time"
  | "custom";

export type DateRangeValue = {
  preset: DateRangePreset;
  from: Date;
  to: Date;
};

const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "mtd", label: "MTD" },
  { key: "last_3_months", label: "Last 3 Months" },
  { key: "last_6_months", label: "Last 6 Months" },
  { key: "all_time", label: "All Time" },
  { key: "custom", label: "Custom Range" },
];

// "All Time" is opt-in: pages must request it via the `presets` prop so existing
// screens keep their current option list.
const DEFAULT_PRESETS = PRESETS.filter((p) => p.key !== "all_time");


export function computeRange(preset: Exclude<DateRangePreset, "custom">, ref = new Date()): { from: Date; to: Date } {
  const to = endOfDay(ref);
  switch (preset) {
    case "today":
      return { from: startOfDay(ref), to };
    case "yesterday": {
      const y = subDays(ref, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "this_week":
      return { from: startOfWeek(ref, { weekStartsOn: 1 }), to: endOfWeek(ref, { weekStartsOn: 1 }) };
    case "this_month":
      return { from: startOfMonth(ref), to: endOfMonth(ref) };
    case "last_month": {
      const m = subMonths(ref, 1);
      return { from: startOfMonth(m), to: endOfMonth(m) };
    }
    case "mtd":
      return { from: startOfMonth(ref), to: endOfDay(subDays(ref, 1)) };
    case "last_3_months":
      return { from: startOfDay(subMonths(ref, 3)), to };
    case "last_6_months":
      return { from: startOfDay(subMonths(ref, 6)), to };
    case "all_time":
      return { from: new Date(2000, 0, 1), to };
  }

}

export function defaultRange(): DateRangeValue {
  const { from, to } = computeRange("yesterday");
  return { preset: "yesterday", from, to };
}

export function DateRangeFilter({
  value,
  onChange,
  className,
  presets,
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  className?: string;
  /** Optional subset of presets to show (in this order). */
  presets?: DateRangePreset[];
}) {
  const visiblePresets = React.useMemo(
    () => (presets ? presets.map((k) => PRESETS.find((p) => p.key === k)!).filter(Boolean) : DEFAULT_PRESETS),
    [presets],
  );

  const [open, setOpen] = React.useState(false);
  const [showCalendar, setShowCalendar] = React.useState(value.preset === "custom");
  const [custom, setCustom] = React.useState<DateRange | undefined>(
    value.preset === "custom" ? { from: value.from, to: value.to } : undefined,
  );

  const label = React.useMemo(() => {
    const presetLabel = PRESETS.find((p) => p.key === value.preset)?.label ?? "Date Range";
    if (value.preset === "custom") {
      return `${format(value.from, "dd MMM yyyy")} – ${format(value.to, "dd MMM yyyy")}`;
    }
    return presetLabel;
  }, [value]);

  const handlePreset = (preset: DateRangePreset) => {
    if (preset === "custom") {
      setShowCalendar(true);
      return;
    }
    const r = computeRange(preset);
    onChange({ preset, from: r.from, to: r.to });
    setShowCalendar(false);
    setOpen(false);
  };

  const applyCustom = () => {
    if (custom?.from && custom?.to) {
      onChange({ preset: "custom", from: startOfDay(custom.from), to: endOfDay(custom.to) });
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-9 gap-2 font-normal", className)}>
          <CalendarIcon className="h-4 w-4" />
          <span>{label}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 pointer-events-auto" align="end">
        <div className="flex">
          <div className="flex flex-col p-2 border-r min-w-[160px]">
            {visiblePresets.map((p) => (
              <button
                key={p.key}
                onClick={() => handlePreset(p.key)}
                className={cn(
                  "text-left px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors",
                  value.preset === p.key && "bg-accent font-medium",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {showCalendar && (
            <div className="p-3">
              <Calendar
                mode="range"
                selected={custom}
                onSelect={setCustom}
                numberOfMonths={2}
                initialFocus
                className={cn("p-0 pointer-events-auto")}
              />
              <div className="flex justify-end gap-2 mt-3">
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={applyCustom} disabled={!custom?.from || !custom?.to}>Apply</Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
