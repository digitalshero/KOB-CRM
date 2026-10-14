import { type SupabaseClient } from "@supabase/supabase-js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      claims?: Record<string, any>;
      supabase?: SupabaseClient;
    }
  }
}
