import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exe/form-pending")({
  beforeLoad: () => { throw redirect({ to: "/exec/FORM_FILLED" as any }); },
  component: () => null,
});
