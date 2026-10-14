// Month filter for the SCV & Incentives pages. Lists every month that has
// lead data (from the server) plus the current month; defaults to current.
export function currentScvMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function scvMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ScvMonthSelect({
  months,
  value,
  onChange,
}: {
  months: string[];
  value: string;
  onChange: (month: string) => void;
}) {
  const options = months.includes(value) ? months : [value, ...months];
  return (
    <select
      className="h-9 rounded-md border bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="SCV month"
    >
      {options.map((m) => (
        <option key={m} value={m}>
          {scvMonthLabel(m)}
          {m === currentScvMonth() ? " (Current)" : ""}
        </option>
      ))}
    </select>
  );
}
