import { Router } from "express";
import { loginWithUsername } from "../controllers/userManagement.controller.js";

export const authRouter = Router();

// POST /api/auth/login-with-username - public (pre-auth); resolves username -> email
// server-side only, then performs the same Supabase Auth password sign-in the
// client used to do directly. Never returns the resolved email to the caller.
authRouter.post("/login-with-username", loginWithUsername);
