import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  listWebinarBatches,
  createWebinarBatch,
  deleteWebinarBatch,
  listBatchAttendance,
  listWebinarEligibleLeads,
  getWebinarHistory,
  addLeadsToBatch,
  removeLeadFromBatch,
  markAttendance,
  rescheduleAttendance,
  markLeadEoi2,
} from "../controllers/webinar.controller.js";

export const webinarRouter = Router();

// GET /api/webinar/batches - Protected by auth middleware, uses req.supabase (RLS)
webinarRouter.get("/batches", requireAuth, listWebinarBatches);

// POST /api/webinar/batches - Protected by auth middleware, uses req.supabase (RLS)
webinarRouter.post("/batches", requireAuth, createWebinarBatch);

// DELETE /api/webinar/batches/:id - Protected by auth middleware, uses req.supabase (RLS)
webinarRouter.delete("/batches/:id", requireAuth, deleteWebinarBatch);

// POST /api/webinar/batches/:id/leads - Protected by auth middleware, uses req.supabase (RLS)
webinarRouter.post("/batches/:id/leads", requireAuth, addLeadsToBatch);

// DELETE /api/webinar/batches/:batchId/leads/:leadId - Protected by auth middleware, uses req.supabase (RLS)
webinarRouter.delete("/batches/:batchId/leads/:leadId", requireAuth, removeLeadFromBatch);

// DELETE /api/webinar/attendance/:id - Protected by auth middleware, uses req.supabase (RLS)
webinarRouter.delete("/attendance/:id", requireAuth, removeLeadFromBatch);

// PATCH /api/webinar/attendance/:id - Protected by auth middleware, uses req.supabase (RLS)
webinarRouter.patch("/attendance/:id", requireAuth, markAttendance);

// POST /api/webinar/attendance/:id/reschedule - Protected by auth middleware, uses req.supabase / admin
webinarRouter.post("/attendance/:id/reschedule", requireAuth, rescheduleAttendance);

// GET /api/webinar/batch-attendance - Protected by auth middleware, uses req.supabase (RLS)
webinarRouter.get("/batch-attendance", requireAuth, listBatchAttendance);

// GET /api/webinar/eligible-leads - Protected by auth middleware, uses req.supabase (RLS)
webinarRouter.get("/eligible-leads", requireAuth, listWebinarEligibleLeads);

// GET /api/webinar/history - Protected by auth middleware, uses supabaseAdmin
webinarRouter.get("/history", requireAuth, getWebinarHistory);

// POST /api/webinar/leads/:id/eoi2 - Protected by auth middleware, uses req.supabase (RLS)
webinarRouter.post("/leads/:id/eoi2", requireAuth, markLeadEoi2);
webinarRouter.post("/leads/eoi2", requireAuth, markLeadEoi2);
