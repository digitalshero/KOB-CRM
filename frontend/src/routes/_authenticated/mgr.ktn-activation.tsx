import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/mgr/ktn-activation")({
  beforeLoad: () => { throw redirect({ to: "/mgr/ktn" as any }); },
  component: () => null,
});
