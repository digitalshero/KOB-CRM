import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/mgr/scv-incentives")({
  beforeLoad: () => { throw redirect({ to: "/tl/scv-incentives" as any }); },
  component: () => null,
});
