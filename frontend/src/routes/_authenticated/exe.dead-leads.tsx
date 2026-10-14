import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exe/dead-leads")({
  beforeLoad: () => { throw redirect({ to: "/exec/DEAD_LEAD" as any }); },
  component: () => null,
});
