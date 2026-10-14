import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exe/agreement")({
  beforeLoad: () => { throw redirect({ to: "/exe/overview" as any }); },
  component: () => null,
});
