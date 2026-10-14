import { type Request, type Response, type NextFunction } from "express";
import { createStandardSupabaseClient, createRequestScopedClient } from "../integrations/supabase/client.js";

/**
 * Express authentication middleware.
 * Validates the caller's Supabase JWT Bearer token and attaches:
 *  - req.userId: string
 *  - req.claims: Record<string, any>
 *  - req.supabase: request-scoped Supabase client initialized with caller JWT (enforcing PostgreSQL RLS)
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
    req.supabase = createRequestScopedClient(token);

    next();
  } catch (err: any) {
    res.status(401).json({
      error: "Unauthorized",
      message: err?.message || "Authentication failed",
    });
  }
}
