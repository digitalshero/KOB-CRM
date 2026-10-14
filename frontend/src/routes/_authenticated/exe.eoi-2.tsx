import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exe/eoi-2")({
  beforeLoad: () => { throw redirect({ to: "/exec/EOI_2" as any }); },
  component: () => null,
});
