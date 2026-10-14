import { Link } from "@tanstack/react-router";

export function LeadLink({
  id,
  children,
  className,
  stop,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  stop?: boolean;
}) {
  return (
    <Link
      to="/leads/$id"
      params={{ id }}
      onPointerDown={stop ? (e) => e.stopPropagation() : undefined}
      onClick={stop ? (e) => e.stopPropagation() : undefined}
      className={className ?? "text-primary hover:underline"}
    >
      {children}
    </Link>
  );
}
