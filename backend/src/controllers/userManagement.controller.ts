import type { Request, Response, NextFunction } from "express";
import { requireRoleOrDeny, type Role } from "../db/authz.js";
import { withTransaction } from "../db/transaction.js";
import { createStandardSupabaseClient } from "../integrations/supabase/client.js";
import * as userRepo from "../repositories/userManagement.repository.js";
import { normalizeUsername, isUsernameTaken } from "../repositories/userManagement.repository.js";

const VALID_ROLES: Role[] = ["super_admin", "kob_manager", "team_leader", "executive"];

function isValidRole(v: unknown): v is Role {
  return typeof v === "string" && (VALID_ROLES as string[]).includes(v);
}

const ADMIN_API_UNAVAILABLE_MESSAGE = "User creation and password reset are temporarily unavailable.";

/**
 * Controller for createUser (CEO-only "Add User").
 *
 * TEMPORARILY DISABLED (Tier 1 scope only): creating a brand-new Supabase
 * Auth user requires the Supabase service-role key (supabaseAdmin), which
 * is not currently available in this environment's secret configuration.
 * Per explicit instruction, no workaround (public signUp, synthetic-email
 * account creation, or any custom auth system) is implemented — this
 * returns 501 without touching Supabase or RDS. Re-enable only once the
 * real service-role key is provisioned.
 */
export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) { res.status(401).json({ error: "Unauthenticated" }); return; }
    const actorRole = await requireRoleOrDeny(req.userId, ["super_admin"]);
    if (actorRole === null) { res.status(403).json({ error: "Forbidden" }); return; }

    res.status(501).json({ error: ADMIN_API_UNAVAILABLE_MESSAGE });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for updateUser (CEO-only): edit username, full name, and/or role.
 * Never touches the user's Auth id, Page Access rows, or password.
 */
export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) { res.status(401).json({ error: "Unauthenticated" }); return; }
    const actorRole = await requireRoleOrDeny(req.userId, ["super_admin"]);
    if (actorRole === null) { res.status(403).json({ error: "Forbidden" }); return; }

    const targetUserId = req.params["userId"];
    if (!targetUserId) { res.status(400).json({ error: "Missing userId" }); return; }

    const existing = await userRepo.getProfileById(targetUserId);
    if (!existing) { res.status(404).json({ error: "User not found" }); return; }

    const { username: rawUsername, full_name, role } = req.body ?? {};
    const patch: { username?: string; full_name?: string } = {};
    const auditMeta: Record<string, unknown> = { previous: { username: existing.username, full_name: existing.full_name } };

    if (rawUsername !== undefined) {
      const username = normalizeUsername(rawUsername);
      if (!username) {
        res.status(400).json({ error: "Username must be 3-32 characters: letters, numbers, dot or underscore only" });
        return;
      }
      if (await isUsernameTaken(username, targetUserId)) {
        res.status(409).json({ error: "Username is already taken" });
        return;
      }
      patch.username = username;
      auditMeta["new_username"] = username;
    }
    if (full_name !== undefined) {
      if (typeof full_name !== "string" || full_name.trim().length === 0) {
        res.status(400).json({ error: "full_name must be a non-empty string" });
        return;
      }
      patch.full_name = full_name.trim();
      auditMeta["new_full_name"] = patch.full_name;
    }
    if (role !== undefined && !isValidRole(role)) {
      res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
      return;
    }

    await withTransaction(req.userId, async (client) => {
      if (Object.keys(patch).length > 0) {
        await userRepo.updateProfileFields(client, targetUserId, patch);
      }
      if (role !== undefined) {
        await userRepo.replaceUserRole(client, targetUserId, role as Role);
        auditMeta["new_role"] = role;
      }
      await userRepo.auditUserChange(client, req.userId!, "user_updated", targetUserId, auditMeta);
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for resetUserPassword (CEO-only).
 *
 * TEMPORARILY DISABLED (Tier 1 scope only): directly setting another
 * user's password requires the Supabase service-role key, which is not
 * currently available. No recovery-email workaround or custom auth system
 * is implemented — returns 501 without touching Supabase or RDS.
 */
export async function resetUserPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) { res.status(401).json({ error: "Unauthenticated" }); return; }
    const actorRole = await requireRoleOrDeny(req.userId, ["super_admin"]);
    if (actorRole === null) { res.status(403).json({ error: "Forbidden" }); return; }

    res.status(501).json({ error: ADMIN_API_UNAVAILABLE_MESSAGE });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for loginWithUsername (public, pre-auth).
 * Looks up the username's internal email server-side ONLY, then performs
 * the exact same Supabase Auth password sign-in the client previously did
 * directly — Supabase Auth remains the sole authentication provider, this
 * just resolves username -> email first and never returns that email to
 * the caller. The resulting session (access/refresh tokens) is handed back
 * so the frontend can call supabase.auth.setSession() with it, exactly as
 * if the client had called signInWithPassword itself.
 */
export async function loginWithUsername(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username, password } = req.body ?? {};
    if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const match = await userRepo.findAuthEmailByUsername(username.trim());
    if (!match) {
      // Always generic: never reveal whether the username exists.
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const supabase = createStandardSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: match.email, password });

    if (error || !data?.session) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    res.status(200).json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      expires_at: data.session.expires_at,
      token_type: data.session.token_type,
    });
  } catch (err) {
    next(err);
  }
}
