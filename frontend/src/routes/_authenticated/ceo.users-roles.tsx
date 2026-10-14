import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/ceo/users-roles")({
  beforeLoad: () => { throw redirect({ to: "/mgr/users" as any }); },
  component: () => null,
});
