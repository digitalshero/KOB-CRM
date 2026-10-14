import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  seedDemoUsers,
  updateCityPincodeAliases,
  syncCityPincodesFromIndiaPost,
} from "../controllers/admin.controller.js";

export const adminRouter = Router();

// POST /api/admin/demo-users/seed - Public endpoint (setup/testing)
adminRouter.post("/demo-users/seed", seedDemoUsers);

// PATCH /api/admin/pincodes/aliases, POST /api/admin/pincodes/aliases - Protected by auth middleware
adminRouter.patch("/pincodes/aliases", requireAuth, updateCityPincodeAliases);
adminRouter.post("/pincodes/aliases", requireAuth, updateCityPincodeAliases);
adminRouter.patch("/pincodes/aliases/:id", requireAuth, updateCityPincodeAliases);
adminRouter.post("/pincodes/aliases/:id", requireAuth, updateCityPincodeAliases);

// POST /api/admin/pincodes/sync-india-post - Recompute pincode counts
adminRouter.post("/pincodes/sync-india-post", requireAuth, syncCityPincodesFromIndiaPost);
adminRouter.post("/pincodes/recompute", requireAuth, syncCityPincodesFromIndiaPost);

