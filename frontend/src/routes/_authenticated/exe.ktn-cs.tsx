import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exe/ktn-cs")({
  beforeLoad: () => { throw redirect({ to: "/exec/KTN_CS" as any }); },
  component: () => null,
});
