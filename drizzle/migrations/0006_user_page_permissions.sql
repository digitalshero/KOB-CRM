-- Additive, RDS-only: CEO-controlled per-user page access.
-- A user with ZERO rows here is UNRESTRICTED (today's exact behavior,
-- preserved for backward compatibility) — restriction only begins once
-- a CEO explicitly saves a grant set for that user. super_admin (CEO)
-- is always unconditionally unrestricted regardless of rows, enforced
-- at the application layer (see pageAccess.repository.ts), not here.
CREATE TABLE IF NOT EXISTS public.user_page_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE(user_id, page_key)
);

CREATE INDEX IF NOT EXISTS idx_user_page_permissions_user_id ON public.user_page_permissions(user_id);
