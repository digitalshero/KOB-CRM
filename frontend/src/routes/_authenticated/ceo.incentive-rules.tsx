import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/ceo/incentive-rules")({
  beforeLoad: () => { throw redirect({ to: "/tl/scv-incentives" as any }); },
  component: () => null,
});
