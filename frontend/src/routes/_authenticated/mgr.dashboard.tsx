import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/mgr/dashboard")({
  beforeLoad: () => { throw redirect({ to: "/dashboard" as any }); },
  component: () => null,
});
