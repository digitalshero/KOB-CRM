import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createStandardSupabaseClient, createRequestScopedClient } from "../integrations/supabase/client.js";
import { config } from "../config/index.js";

const RDS_JWT_ISSUER = "kob-rds-auth";

/**
 * Verifies a token as a backend-issued RDS/JWT (see rdsAuth.controller.ts),
 * never as a Supabase token. Returns the user_id on success, null otherwise.
 * Only ever called as a FALLBACK, and only when config.authBackend is not
 * "supabase" — see requireAuth below.
 */
function verifyRdsJwt(token: string): string | null {
  if (!config.jwtSecret) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { issuer: RDS_JWT_ISSUER }) as { user_id?: string };
    return typeof payload.user_id === "string" ? payload.user_id : null;
  } catch {
    return null;
  }
}

/**
 * Express authentication middleware.
 * Validates the caller's Supabase JWT Bearer token and attaches:
 *  - req.userId: string
 *  - req.claims: Record<string, any>
 *  - req.supabase: request-scoped Supabase client initialized with caller JWT (enforcing PostgreSQL RLS)
 *
 * PARALLEL RDS/JWT AUTH (additive): when Supabase's own getClaims rejects a
 * token AND AUTH_BACKEND is "hybrid" or "rds", this falls back to verifying
 * the token as a backend-issued RDS JWT instead. In the default
 * AUTH_BACKEND=supabase state this fallback branch is never reached, so
 * behavior for every existing Supabase-authenticated request is unchanged.
 * An RDS-JWT-authenticated request has no Supabase session, so req.supabase
 * is left undefined for it — callers on the RDS data path (DATA_BACKEND=rds)
 * never read req.supabase anyway.
 *
 * NOTE: supabaseAdmin is strictly NOT attached to the request object.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: "Unauthorized",
      message: "No authorization header provided",
    });
    return;
  }

  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Only Bearer tokens are supported",
    });
    return;
  }

  const token = authHeader.replace(/^Bearer\s+/, "").trim();

  if (!token) {
    res.status(401).json({
      error: "Unauthorized",
      message: "No token provided",
    });
    return;
  }

  // Basic JWT structural check: header.payload.signature
  if (token.split(".").length !== 3) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Invalid token structure",
    });
    return;
  }

  try {
    const supabaseStandard = createStandardSupabaseClient();
    const { data, error } = await supabaseStandard.auth.getClaims(token);

    if (error || !data?.claims) {
      if (config.authBackend !== "supabase") {
        const rdsUserId = verifyRdsJwt(token);
        if (rdsUserId) {
          req.userId = rdsUserId;
          req.claims = { sub: rdsUserId, iss: RDS_JWT_ISSUER };
          req.authBackend = "rds";
          next();
          return;
        }
      }
      res.status(401).json({
        error: "Unauthorized",
        message: "Invalid token or session expired",
      });
      return;
    }

    const userId = data.claims.sub;

    if (!userId || typeof userId !== "string") {
      res.status(401).json({
        error: "Unauthorized",
        message: "No user ID found in token claims",
      });
      return;
    }

    // Attach request-scoped context
    req.userId = userId;
    req.claims = data.claims;
    req.authBackend = "supabase";
    req.supabase = createRequestScopedClient(token);

    next();
  } catch (err: any) {
    res.status(401).json({
      error: "Unauthorized",
      message: err?.message || "Authentication failed",
    });
  }
}
