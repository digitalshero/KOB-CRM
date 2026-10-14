type Props = {
  message?: string | null;
  at?: string | null;
  unread?: boolean;
};

function formatWhen(at: string) {
  const d = new Date(at);
  const date = d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  let rel = "";
  if (mins < 1) rel = "just now";
  else if (mins < 60) rel = `${mins}m ago`;
  else if (mins < 1440) rel = `${Math.floor(mins / 60)}h ago`;
  else rel = `${Math.floor(mins / 1440)}d ago`;
  return { stamp: `${date}, ${time}`, rel, full: d.toLocaleString() };
}

/** Shows the most recent WhatsApp message for a lead in table views. */
export function LastMessageCell({ message, at, unread }: Props) {
  if (!message) return <span className="text-xs text-muted-foreground">—</span>;
  const when = at ? formatWhen(at) : null;
  return (
    <div className="max-w-[260px]" title={when ? `${message}\n${when.full}` : message}>
      <div className={`truncate text-xs ${unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {message}
      </div>
      {when && (
        <div className="text-[10px] text-muted-foreground/80 whitespace-nowrap">
          {when.stamp} · {when.rel}
        </div>
      )}
    </div>
  );
}
