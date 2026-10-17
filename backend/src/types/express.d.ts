import { type SupabaseClient } from "@supabase/supabase-js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      claims?: Record<string, any>;
      supabase?: SupabaseClient;
      /**
       * Which provider actually authenticated THIS request's token — "supabase"
       * for a real Supabase session, "rds" for a backend-issued RDS/JWT. This is
       * about the session, not the user: a migrated user can still present a
       * valid Supabase session (their old email+password still works), and that
       * must never be treated as an RDS session.
       */
      authBackend?: "supabase" | "rds";
    }
  }
}
