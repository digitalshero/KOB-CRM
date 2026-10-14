import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  listEvaluationQuestions,
  getLeadEvaluation,
  listLeadEvaluationHistory,
  listLeadsForEvaluation,
  upsertEvaluationQuestion,
  deleteEvaluationQuestion,
  saveEvaluationResponses,
} from "../controllers/evaluation.controller.js";

export const evaluationRouter = Router();

// GET /api/evaluation/questions - Protected by auth middleware, uses req.supabase (RLS)
evaluationRouter.get("/questions", requireAuth, listEvaluationQuestions);

// POST /api/evaluation/questions - Protected by auth middleware, uses req.supabase (RLS)
evaluationRouter.post("/questions", requireAuth, upsertEvaluationQuestion);

// DELETE /api/evaluation/questions/:id - Protected by auth middleware, uses req.supabase (RLS)
evaluationRouter.delete("/questions/:id", requireAuth, deleteEvaluationQuestion);
evaluationRouter.delete("/questions", requireAuth, deleteEvaluationQuestion);

// GET /api/evaluation/lead - Protected by auth middleware, uses req.supabase (RLS)
evaluationRouter.get("/lead", requireAuth, getLeadEvaluation);

// GET /api/evaluation/history - Protected by auth middleware, uses req.supabase (RLS)
evaluationRouter.get("/history", requireAuth, listLeadEvaluationHistory);

// GET /api/evaluation/leads - Protected by auth middleware, uses req.supabase (RLS/role)
evaluationRouter.get("/leads", requireAuth, listLeadsForEvaluation);

// POST /api/evaluation/responses - Protected by auth middleware, uses req.supabase (RLS)
evaluationRouter.post("/responses", requireAuth, saveEvaluationResponses);


