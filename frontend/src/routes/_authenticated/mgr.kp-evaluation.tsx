import { createFileRoute } from "@tanstack/react-router";
import { KpEvaluationPage } from "@/components/kp-evaluation-page";

export const Route = createFileRoute("/_authenticated/mgr/kp-evaluation")({
  head: () => ({ meta: [{ title: "KP Evaluation — Shero KOB" }] }),
  component: KpEvaluationPage,
});
