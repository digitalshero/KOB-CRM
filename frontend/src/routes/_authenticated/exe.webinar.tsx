import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exe/webinar")({
  beforeLoad: () => { throw redirect({ to: "/webinar" as any }); },
  component: () => null,
});
