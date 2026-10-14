import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exe/ktn-live")({
  beforeLoad: () => { throw redirect({ to: "/exec/KTN_LIVE" as any }); },
  component: () => null,
});
