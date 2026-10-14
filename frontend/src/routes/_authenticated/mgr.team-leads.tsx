import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/mgr/team-leads")({
  beforeLoad: () => { throw redirect({ to: "/mgr/team" as any }); },
  component: () => null,
});
