import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/ceo/audit-logs")({
  beforeLoad: () => { throw redirect({ to: "/mgr/audit" as any }); },
  component: () => null,
});
