import { Router } from "express";
import { loginWithUsername } from "../controllers/userManagement.controller.js";
import { login, changeOwnPassword, getAuthStatus } from "../controllers/rdsAuth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const authRouter = Router();

// POST /api/auth/login-with-username - public (pre-auth); resolves username -> email
// server-side only, then performs the same Supabase Auth password sign-in the
// client used to do directly. Never returns the resolved email to the caller.
// Left in place, untouched, as the existing Supabase-backed login path.
authRouter.post("/login-with-username", loginWithUsername);

// POST /api/auth/login - public (pre-auth); AUTH_BACKEND-aware unified login.
// In the default "supabase" state this delegates verbatim to the handler
// above (byte-for-byte identical behavior). Only "hybrid"/"rds" engage the
// new RDS/JWT path. See rdsAuth.controller.ts.
authRouter.post("/login", login);

// POST /api/auth/change-password - authenticated (Supabase session OR RDS JWT,
// requireAuth resolves either). Self-service password change; disabled in
// "supabase" mode (no app_users row exists for anyone yet).
authRouter.post("/change-password", requireAuth, changeOwnPassword);

// GET /api/auth/status - authenticated; tells the frontend whether this
// identity must change its password before normal access (inert/false for
// every Supabase-only user, i.e. everyone not yet migrated to RDS auth).
authRouter.get("/status", requireAuth, getAuthStatus);
