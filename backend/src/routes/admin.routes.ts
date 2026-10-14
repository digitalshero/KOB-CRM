import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { config } from "../config/index.js";
import {
  seedDemoUsers,
  updateCityPincodeAliases,
  syncCityPincodesFromIndiaPost,
} from "../controllers/admin.controller.js";

export const adminRouter = Router();

/**
 * STAGE 10I-F security fix: seedDemoUsers previously had NO auth middleware
 * at all (truly public) and seeds users with a hardcoded default password.
 * It must never be reachable outside local development.
 */
function devOnly(_req: Request, res: Response, next: NextFunction): void {
  if (config.nodeEnv !== "development") {
    res.status(404).json({ error: "Not Found" });
    return;
  }
  next();
}

// POST /api/admin/demo-users/seed - development-only (setup/testing)
adminRouter.post("/demo-users/seed", devOnly, seedDemoUsers);

// PATCH /api/admin/pincodes/aliases, POST /api/admin/pincodes/aliases - Protected by auth middleware
adminRouter.patch("/pincodes/aliases", requireAuth, updateCityPincodeAliases);
adminRouter.post("/pincodes/aliases", requireAuth, updateCityPincodeAliases);
adminRouter.patch("/pincodes/aliases/:id", requireAuth, updateCityPincodeAliases);
adminRouter.post("/pincodes/aliases/:id", requireAuth, updateCityPincodeAliases);

// POST /api/admin/pincodes/sync-india-post - Recompute pincode counts
adminRouter.post("/pincodes/sync-india-post", requireAuth, syncCityPincodesFromIndiaPost);
adminRouter.post("/pincodes/recompute", requireAuth, syncCityPincodesFromIndiaPost);

