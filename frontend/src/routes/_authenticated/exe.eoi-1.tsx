import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exe/eoi-1")({
  beforeLoad: () => { throw redirect({ to: "/exec/EOI_1" as any }); },
  component: () => null,
});
