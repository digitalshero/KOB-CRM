-- Additive, RDS-only: parallel RDS/JWT auth table, used only when
-- AUTH_BACKEND is "hybrid" or "rds" (default remains "supabase", which
-- never reads this table). user_id is always an EXISTING profiles.id —
-- this table never mints a new identity for an existing user, it only
-- adds a password credential alongside the identity that already exists.
CREATE TABLE IF NOT EXISTS public.app_users (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  username text NOT NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_lower
  ON public.app_users (lower(username));
