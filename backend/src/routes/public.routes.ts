import { Router } from "express";
import {
  getConversionFunnels,
  getLeadStageCounts,
  getMetrics,
  postFailedFire,
  postLeadStage,
  postLeads,
  postLeadEvents,
  postTemplateStage,
  postWhatsappMessage,
} from "../controllers/public.controller.js";

export const publicRouter = Router();

publicRouter.get("/kob/conversion-funnels", getConversionFunnels);
publicRouter.get("/kob/lead-stage-counts", getLeadStageCounts);
publicRouter.get("/metrics", getMetrics);

publicRouter.post("/failed-fire", postFailedFire);
publicRouter.post("/lead-stage", postLeadStage);
publicRouter.post("/leads", postLeads);
publicRouter.post("/lead-events", postLeadEvents);
publicRouter.post("/template-stage", postTemplateStage);
publicRouter.post("/whatsapp-message", postWhatsappMessage);
