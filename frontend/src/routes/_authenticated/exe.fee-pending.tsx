import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exe/fee-pending")({
  beforeLoad: () => { throw redirect({ to: "/exec/FEE_PAID" as any }); },
  component: () => null,
});
