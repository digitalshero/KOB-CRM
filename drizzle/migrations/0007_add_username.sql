-- Additive, RDS-only: username as an application identity mapped onto the
-- existing Supabase Auth user (profiles.id / auth.users.id unchanged).
-- Existing users get a NULL username until the CEO explicitly sets one via
-- the Users & Roles screen — nothing is silently backfilled here, since a
-- derived username could collide or be ambiguous. The unique index only
-- applies to non-null values, so existing rows are unaffected.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;
