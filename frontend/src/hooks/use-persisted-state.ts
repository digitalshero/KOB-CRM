import * as React from "react";

/**
 * State that survives component unmounts (tab switches, remounts, navigation)
 * by mirroring into sessionStorage. Used so table-view filters stick until the
 * user changes them.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = `kob:${key}`;
  // Start from `initial` on both server and client to avoid hydration
  // mismatches; restore the saved value after mount.
  const [value, setValue] = React.useState<T>(initial);
  const restored = React.useRef(false);

  React.useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
    restored.current = true;
  }, [storageKey]);

  React.useEffect(() => {
    if (!restored.current) return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* ignore quota/private-mode errors */
    }
  }, [storageKey, value]);

  return [value, setValue];
}
