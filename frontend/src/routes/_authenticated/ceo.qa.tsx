import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/ceo/qa")({
  beforeLoad: () => { throw redirect({ to: "/mgr/qa" as any }); },
  component: () => null,
});
