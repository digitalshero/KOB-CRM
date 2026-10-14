import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/mgr/retargeting")({
  beforeLoad: () => { throw redirect({ to: "/retargeting" as any }); },
  component: () => null,
});
