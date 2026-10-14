import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/mgr/lead-inbox")({
  beforeLoad: () => { throw redirect({ to: "/leads" as any }); },
  component: () => null,
});
