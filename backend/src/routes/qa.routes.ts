import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  qaListStaff,
  qaCreateSampleLead,
  qaAssignTL,
  qaAssignExec,
  qaRecalcScv,
  qaComputeScvScores,
  qaMoveStage,
  qaVerify,
  qaAdvanceRetargeting,
  qaTriggerRetargeting,
  qaCleanup,
  qaRunLifecycle,
} from "../controllers/qa.controller.js";

export const qaRouter = Router();

// GET /api/qa/staff - Protected by auth middleware, checks manager/super_admin role
qaRouter.get("/staff", requireAuth, qaListStaff);

// POST /api/qa/sample-lead - Protected by auth middleware, checks manager/super_admin role
qaRouter.post("/sample-lead", requireAuth, qaCreateSampleLead);

// PATCH /api/qa/leads/:id/team-leader - Protected by auth middleware, checks manager/super_admin role
qaRouter.patch("/leads/:id/team-leader", requireAuth, qaAssignTL);

// PATCH /api/qa/leads/:id/executive - Protected by auth middleware, checks manager/super_admin role
qaRouter.patch("/leads/:id/executive", requireAuth, qaAssignExec);

// POST /api/qa/recalc-scv - Protected by auth middleware, checks manager/super_admin role
qaRouter.post("/recalc-scv", requireAuth, qaRecalcScv);
qaRouter.post("/leads/:id/recalc-scv", requireAuth, qaRecalcScv);

// POST /api/qa/compute-scv-scores - Protected by auth middleware, checks manager/super_admin role
qaRouter.post("/compute-scv-scores", requireAuth, qaComputeScvScores);

// POST /api/qa/leads/:id/stage, /api/qa/move-stage - Move lead through stages in QA
qaRouter.post("/leads/:id/stage", requireAuth, qaMoveStage);
qaRouter.post("/leads/stage", requireAuth, qaMoveStage);
qaRouter.post("/move-stage", requireAuth, qaMoveStage);

// POST /api/qa/verify - Verify system state, counts, history, and audits for a lead
qaRouter.post("/verify", requireAuth, qaVerify);

// POST /api/qa/retargeting/advance - Advance retargeting scheduler
qaRouter.post("/retargeting/advance", requireAuth, qaAdvanceRetargeting);
qaRouter.post("/advance-retargeting", requireAuth, qaAdvanceRetargeting);

// POST /api/qa/retargeting/trigger, /api/qa/leads/:id/retargeting/trigger - Trigger retargeting bucket
qaRouter.post("/retargeting/trigger", requireAuth, qaTriggerRetargeting);
qaRouter.post("/leads/:id/retargeting/trigger", requireAuth, qaTriggerRetargeting);

// POST /api/qa/cleanup - Cleanup QA test leads
qaRouter.post("/cleanup", requireAuth, qaCleanup);

// POST /api/qa/lifecycle/run, /api/qa/run-lifecycle - Run full lifecycle test
qaRouter.post("/lifecycle/run", requireAuth, qaRunLifecycle);
qaRouter.post("/run-lifecycle", requireAuth, qaRunLifecycle);
