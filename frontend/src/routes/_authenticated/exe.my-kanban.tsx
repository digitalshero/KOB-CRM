import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exe/my-kanban")({
  beforeLoad: () => { throw redirect({ to: "/leads" as any }); },
  component: () => null,
});
