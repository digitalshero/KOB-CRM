import * as React from "react";
import { computeRange, defaultRange, type DateRangePreset, type DateRangeValue } from "@/components/date-range-filter";

function buildInitial(initialPreset: DateRangePreset): DateRangeValue {
  if (initialPreset === "custom") return defaultRange();
  const r = computeRange(initialPreset);
  return { preset: initialPreset, from: r.from, to: r.to };
}

/**
 * Date-range state hook. Default preset: "yesterday".
 * When `persistKey` is given, the selection is mirrored into sessionStorage so
 * it survives navigation (e.g. lead list -> lead details -> back).
 */
export function useDateRange(
  initialPreset: DateRangePreset = "yesterday",
  persistKey?: string,
): [DateRangeValue, (v: DateRangeValue) => void] {
  const storageKey = persistKey ? `kob:range:${persistKey}` : null;

  const [value, setValue] = React.useState<DateRangeValue>(() => buildInitial(initialPreset));

  // Restore after mount (sessionStorage is unavailable during SSR, and reading
  // it in the state initializer causes a hydration mismatch).
  const restored = React.useRef(false);
  React.useEffect(() => {
    if (restored.current || !storageKey) return;
    restored.current = true;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { preset: DateRangePreset; from: string; to: string };
      if (parsed?.preset === "custom") {
        const from = new Date(parsed.from);
        const to = new Date(parsed.to);
        if (!isNaN(from.getTime()) && !isNaN(to.getTime())) setValue({ preset: "custom", from, to });
      } else if (parsed?.preset) {
        // recompute concrete dates so relative presets stay current
        setValue(buildInitial(parsed.preset));
      }
    } catch {
      /* ignore */
    }
  }, [storageKey]);


  const update = React.useCallback(
    (v: DateRangeValue) => {
      setValue(v);
      if (storageKey) {
        try {
          window.sessionStorage.setItem(
            storageKey,
            JSON.stringify({ preset: v.preset, from: v.from.toISOString(), to: v.to.toISOString() }),
          );
        } catch {
          /* ignore */
        }
      }
    },
    [storageKey],
  );

  return [value, update];
}
