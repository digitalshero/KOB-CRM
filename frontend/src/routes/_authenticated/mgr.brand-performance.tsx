import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/mgr/brand-performance")({
  beforeLoad: () => { throw redirect({ to: "/mgr/brand" as any }); },
  component: () => null,
});
