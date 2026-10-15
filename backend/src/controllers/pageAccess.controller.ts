import type { Request, Response, NextFunction } from "express";
import { resolveActorRole, requireRoleOrDeny } from "../db/authz.js";
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { getAllowedPageKeys, getUserPageAccessRows, setUserPageAccess } from "../repositories/pageAccess.repository.js";
import { PAGE_REGISTRY, PAGE_KEY_SET } from "../pageRegistry.js";

/**
 * CEO-controlled per-user Page Access Management — additive feature.
 * This is a new capability, not a migration of an existing Supabase
 * function, so it is RDS-only from the start (the backing table only
 * exists on RDS — see drizzle/migrations/0006_user_page_permissions.sql).
 */

/** GET /api/kob/my-page-access — current user's own allowed page keys. */
export async function getMyPageAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) { res.status(401).json({ error: "Unauthenticated" }); return; }
    const role = await resolveActorRole(getPool(), req.userId);
    const allowed = await getAllowedPageKeys(req.userId, role);
    res.json({ allowedPageKeys: allowed, unrestricted: allowed === null });
  } catch (err) {
    next(err);
  }
}

/** GET /api/kob/users/:userId/page-access — CEO-only: a target user's full grant state. */
export async function getUserPageAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) { res.status(401).json({ error: "Unauthenticated" }); return; }
    const actorRole = await requireRoleOrDeny(req.userId, ["super_admin"]);
    if (actorRole === null) { res.status(403).json({ error: "Forbidden" }); return; }

    const targetUserId = req.params["userId"];
    if (!targetUserId) { res.status(400).json({ error: "Missing userId" }); return; }

    const targetRole = await resolveActorRole(getPool(), targetUserId);
    const rows = await getUserPageAccessRows(targetUserId);
    const grantedByKey = new Map(rows.map((r) => [r.page_key, r.allowed]));
    const hasAnyRecord = rows.length > 0;

    const pages = PAGE_REGISTRY.map((p) => ({
      ...p,
      allowed: targetRole === "super_admin" ? true : hasAnyRecord ? (grantedByKey.get(p.key) ?? false) : true,
    }));

    res.json({ pages, unrestricted: targetRole === "super_admin" || !hasAnyRecord, targetRole });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/kob/users/:userId/page-access — CEO-only: transactional full grant-set save. */
export async function putUserPageAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) { res.status(401).json({ error: "Unauthenticated" }); return; }
    const actorRole = await requireRoleOrDeny(req.userId, ["super_admin"]);
    if (actorRole === null) { res.status(403).json({ error: "Forbidden" }); return; }

    const targetUserId = req.params["userId"];
    if (!targetUserId) { res.status(400).json({ error: "Missing userId" }); return; }

    const targetRole = await resolveActorRole(getPool(), targetUserId);
    if (targetRole === "super_admin") {
      // Never allow the CEO role to be locked out of pages via this screen.
      res.status(400).json({ error: "Page access for a CEO/super_admin user cannot be restricted." });
      return;
    }

    const body = req.body as { grants?: { page_key: string; allowed: boolean }[] };
    const grants = Array.isArray(body?.grants) ? body.grants : null;
    if (!grants) { res.status(400).json({ error: "Missing grants array" }); return; }
    for (const g of grants) {
      if (typeof g?.page_key !== "string" || !PAGE_KEY_SET.has(g.page_key) || typeof g.allowed !== "boolean") {
        res.status(400).json({ error: `Invalid grant entry: ${JSON.stringify(g)}` });
        return;
      }
    }

    await withTransaction(req.userId, async (client) => {
      await setUserPageAccess(client, targetUserId, req.userId!, grants);
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
