import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/mgr/unallocated-leads")({
  beforeLoad: () => { throw redirect({ to: "/mgr/unallocated" as any }); },
  component: () => null,
});
