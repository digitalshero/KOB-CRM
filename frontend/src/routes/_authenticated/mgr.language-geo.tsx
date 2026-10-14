import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/mgr/language-geo")({
  beforeLoad: () => { throw redirect({ to: "/mgr/geo" as any }); },
  component: () => null,
});
