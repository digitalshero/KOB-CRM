import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getMetaCampaignsList,
  getMetaSpendKpis,
  getMetaCplForKpiCard,
  toggleMetaCampaignSelection,
} from "../controllers/meta.controller.js";

export const metaRouter = Router();

// 1. GET/POST /api/meta/campaigns - List campaigns with insights & selection state
metaRouter.get("/campaigns", requireAuth, getMetaCampaignsList);
metaRouter.post("/campaigns", requireAuth, getMetaCampaignsList);

// 2. GET/POST /api/meta/spend-kpis - Total spend & account average CPL
metaRouter.get("/spend-kpis", requireAuth, getMetaSpendKpis);
metaRouter.post("/spend-kpis", requireAuth, getMetaSpendKpis);

// 3. GET/POST /api/meta/cpl - Dynamic CPL card calculation for enabled campaigns
metaRouter.get("/cpl", requireAuth, getMetaCplForKpiCard);
metaRouter.post("/cpl", requireAuth, getMetaCplForKpiCard);

// 4. PATCH/POST /api/meta/campaigns/:id/selection - Toggle campaign selection (CEO / KOB Manager only)
metaRouter.patch("/campaigns/:id/selection", requireAuth, toggleMetaCampaignSelection);
metaRouter.post("/campaigns/:id/selection", requireAuth, toggleMetaCampaignSelection);
metaRouter.patch("/campaigns/selection", requireAuth, toggleMetaCampaignSelection);
metaRouter.post("/campaigns/selection", requireAuth, toggleMetaCampaignSelection);
