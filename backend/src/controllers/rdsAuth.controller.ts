import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

// Argon2id was tried first per spec preference, but its native binding has
// no prebuilt binary for this EC2 instance and the box has no system build
// toolchain (make/g++) to compile it from source — installing one on a
// shared production host for a single dependency was judged too invasive.
// bcryptjs (pure JS, no native compilation, identical on every platform)
// is the explicitly-allowed fallback for exactly this situation.
const BCRYPT_ROUNDS = 12;
import { config } from "../config/index.js";
import { requireRoleOrDeny, type Role } from "../db/authz.js";
import { withTransaction } from "../db/transaction.js";
import * as userRepo from "../repositories/userManagement.repository.js";
import { normalizeUsername, isUsernameTaken } from "../repositories/userManagement.repository.js";
import * as rdsAuthRepo from "../repositories/rdsAuth.repository.js";
import { upsertAuthUserMirror } from "../repositories/admin.repository.js";
import { loginWithUsername as supabaseLoginWithUsername } from "./userManagement.controller.js";

const RDS_JWT_ISSUER = "kob-rds-auth";
const JWT_EXPIRY = "7d";
const VALID_ROLES: Role[] = ["super_admin", "kob_manager", "team_leader", "executive"];

function isValidRole(v: unknown): v is Role {
  return typeof v === "string" && (VALID_ROLES as string[]).includes(v);
}

function issueJwt(userId: string): string {
  if (!config.jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign({ user_id: userId }, config.jwtSecret, { issuer: RDS_JWT_ISSUER, expiresIn: JWT_EXPIRY });
}

/**
 * Unified login endpoint, AUTH_BACKEND-aware:
 *  - "supabase" (default/production-safe): behaves EXACTLY like the
 *    existing Supabase username login — delegates verbatim, no new code
 *    path is reachable.
 *  - "hybrid": tries the new RDS/app_users credential first; if that
 *    username has no app_users row yet, falls back to the exact same
 *    Supabase path, so unmigrated usernames keep working unchanged.
 *  - "rds": RDS/app_users only, no Supabase fallback (for later, once
 *    hybrid has been fully validated).
 * Never reveals whether a username exists: every failure path returns the
 * same generic "Invalid username or password" message.
 */
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (config.authBackend === "supabase") {
      await supabaseLoginWithUsername(req, res, next);
      return;
    }

    const { username, password } = req.body ?? {};
    if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const appUser = await rdsAuthRepo.findAppUserByUsername(username.trim());

    if (!appUser) {
      if (config.authBackend === "hybrid") {
        await supabaseLoginWithUsername(req, res, next);
        return;
      }
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    if (!appUser.is_active) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const passwordOk = await bcrypt.compare(password, appUser.password_hash);
    if (!passwordOk) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const token = issueJwt(appUser.user_id);
    res.status(200).json({
      token,
      must_change_password: appUser.must_change_password,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * CEO-only "Add User" in RDS-auth mode. Creates profiles + user_roles +
 * app_users in one transaction, reusing a brand-new UUID for a genuinely
 * new identity (never reassigns an existing user's ID). Disabled outside
 * hybrid/rds mode, mirroring the existing Tier-1 disabled state in
 * userManagement.controller.ts for the Supabase-backed Add User.
 */
export async function createUserRds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) { res.status(401).json({ error: "Unauthenticated" }); return; }
    const actorRole = await requireRoleOrDeny(req.userId, ["super_admin"]);
    if (actorRole === null) { res.status(403).json({ error: "Forbidden" }); return; }

    if (config.authBackend === "supabase") {
      res.status(501).json({ error: "User creation and password reset are temporarily unavailable." });
      return;
    }

    const { username: rawUsername, full_name, role, password } = req.body ?? {};
    const username = normalizeUsername(rawUsername);
    if (!username) {
      res.status(400).json({ error: "Username must be 3-32 characters: letters, numbers, dot or underscore only" });
      return;
    }
    if (!full_name || typeof full_name !== "string" || full_name.trim().length === 0) {
      res.status(400).json({ error: "full_name is required" });
      return;
    }
    if (!isValidRole(role)) {
      res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
      return;
    }
    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }
    if ((await isUsernameTaken(username)) || (await rdsAuthRepo.isAppUsernameTaken(username))) {
      res.status(409).json({ error: "Username is already taken" });
      return;
    }

    const newUserId = randomUUID();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    // profiles.id has an FK to RDS's local auth.users mirror table (a
    // compatibility shim, not Supabase Auth itself — see Stage 9 notes).
    // An RDS-only user has no real Supabase Auth account, so this mirror
    // row is satisfied with an internal, never-shown placeholder email,
    // unique per user, purely to keep the existing FK intact.
    const mirrorEmail = `rds-only+${newUserId}@users.shero.internal`;

    await withTransaction(req.userId, async (client) => {
      await upsertAuthUserMirror(client, newUserId, mirrorEmail);
      await userRepo.insertUserProfile(client, { id: newUserId, username, full_name: full_name.trim(), email: null });
      await userRepo.replaceUserRole(client, newUserId, role);
      await rdsAuthRepo.insertAppUser(client, { user_id: newUserId, username, password_hash: passwordHash, must_change_password: true });
      await userRepo.auditUserChange(client, req.userId!, "user_created", newUserId, { username, full_name: full_name.trim(), role, auth_backend: "rds" });
    });

    res.status(200).json({ ok: true, id: newUserId, username, full_name: full_name.trim(), role });
  } catch (err) {
    next(err);
  }
}

/**
 * CEO-only password reset in RDS-auth mode: hashes the new temporary
 * password with Argon2id, stores only the hash, and marks
 * must_change_password=true. Never returns or logs the password/hash.
 * Disabled outside hybrid/rds mode.
 */
export async function resetPasswordRds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) { res.status(401).json({ error: "Unauthenticated" }); return; }
    const actorRole = await requireRoleOrDeny(req.userId, ["super_admin"]);
    if (actorRole === null) { res.status(403).json({ error: "Forbidden" }); return; }

    if (config.authBackend === "supabase") {
      res.status(501).json({ error: "User creation and password reset are temporarily unavailable." });
      return;
    }

    const targetUserId = req.params["userId"];
    if (!targetUserId) { res.status(400).json({ error: "Missing userId" }); return; }

    const { password } = req.body ?? {};
    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const existing = await rdsAuthRepo.findAppUserById(targetUserId);
    if (!existing) { res.status(404).json({ error: "User has no RDS-auth credential to reset" }); return; }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await withTransaction(req.userId, async (client) => {
      await rdsAuthRepo.updateAppUserPassword(client, targetUserId, passwordHash, true);
      await userRepo.auditUserChange(client, req.userId!, "password_reset", targetUserId, { username: existing.username, auth_backend: "rds" });
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Self-service: the signed-in user (RDS-JWT or Supabase session, either
 * way requireAuth has already resolved req.userId) sets their own new
 * password, clearing must_change_password. Used for the post-first-login
 * forced change flow and ordinary voluntary password changes.
 */
export async function changeOwnPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) { res.status(401).json({ error: "Unauthenticated" }); return; }

    if (config.authBackend === "supabase") {
      res.status(501).json({ error: "User creation and password reset are temporarily unavailable." });
      return;
    }

    const { new_password } = req.body ?? {};
    if (typeof new_password !== "string" || new_password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const existing = await rdsAuthRepo.findAppUserById(req.userId);
    if (!existing) { res.status(404).json({ error: "No RDS-auth credential found for this account" }); return; }

    const passwordHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
    await withTransaction(req.userId, async (client) => {
      await rdsAuthRepo.updateAppUserPassword(client, req.userId!, passwordHash, false);
      await userRepo.auditUserChange(client, req.userId!, "password_changed", req.userId!, { username: existing.username, auth_backend: "rds", self_service: true });
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/** CEO-only: activate/deactivate an RDS-auth user (audited). Disabled outside hybrid/rds mode. */
export async function setUserActive(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) { res.status(401).json({ error: "Unauthenticated" }); return; }
    const actorRole = await requireRoleOrDeny(req.userId, ["super_admin"]);
    if (actorRole === null) { res.status(403).json({ error: "Forbidden" }); return; }

    if (config.authBackend === "supabase") {
      res.status(501).json({ error: "User creation and password reset are temporarily unavailable." });
      return;
    }

    const targetUserId = req.params["userId"];
    const { is_active } = req.body ?? {};
    if (!targetUserId || typeof is_active !== "boolean") {
      res.status(400).json({ error: "userId and boolean is_active are required" });
      return;
    }

    const existing = await rdsAuthRepo.findAppUserById(targetUserId);
    if (!existing) { res.status(404).json({ error: "User has no RDS-auth credential" }); return; }

    await withTransaction(req.userId, async (client) => {
      await rdsAuthRepo.setAppUserActive(client, targetUserId, is_active);
      await userRepo.auditUserChange(client, req.userId!, is_active ? "user_activated" : "user_deactivated", targetUserId, { username: existing.username, auth_backend: "rds" });
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}
