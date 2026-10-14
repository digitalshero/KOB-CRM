
-- 1. Role weights table
CREATE TABLE public.scv_role_weights (
  role app_role PRIMARY KEY,
  official_weight numeric NOT NULL,
  personal_weight numeric NOT NULL,
  compliance_weight numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scv_role_weights_sum_100 CHECK (official_weight + personal_weight + compliance_weight = 100)
);
GRANT SELECT ON public.scv_role_weights TO authenticated;
GRANT ALL ON public.scv_role_weights TO service_role;
ALTER TABLE public.scv_role_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scv_role_weights read all authenticated"
  ON public.scv_role_weights FOR SELECT TO authenticated USING (true);
CREATE POLICY "scv_role_weights write ceo"
  ON public.scv_role_weights FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

INSERT INTO public.scv_role_weights (role, official_weight, personal_weight, compliance_weight) VALUES
  ('executive', 70, 30, 0),
  ('team_leader', 60, 20, 20),
  ('kob_manager', 60, 20, 20);

-- 2. Manual ratings table
CREATE TABLE public.scv_manual_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period date NOT NULL,
  personal_score numeric NOT NULL CHECK (personal_score >= 0 AND personal_score <= 100),
  compliance_score numeric CHECK (compliance_score IS NULL OR (compliance_score >= 0 AND compliance_score <= 100)),
  rated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rated_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scv_manual_ratings TO authenticated;
GRANT ALL ON public.scv_manual_ratings TO service_role;
ALTER TABLE public.scv_manual_ratings ENABLE ROW LEVEL SECURITY;

-- Rated person can view own row
CREATE POLICY "scv_manual_ratings self read"
  ON public.scv_manual_ratings FOR SELECT TO authenticated
  USING (user_id = auth.uid());
-- Manager/CEO can view all
CREATE POLICY "scv_manual_ratings mgr read"
  ON public.scv_manual_ratings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'kob_manager'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));
-- Manager/CEO can insert/update/delete
CREATE POLICY "scv_manual_ratings mgr write"
  ON public.scv_manual_ratings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'kob_manager'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'kob_manager'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER trg_scv_manual_ratings_updated
  BEFORE UPDATE ON public.scv_manual_ratings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Composite view
CREATE OR REPLACE VIEW public.v_scv_composite AS
WITH latest_rating AS (
  SELECT DISTINCT ON (user_id)
    user_id, period, personal_score, compliance_score, rated_at, notes
  FROM public.scv_manual_ratings
  ORDER BY user_id, period DESC, rated_at DESC
),
user_role AS (
  SELECT DISTINCT ON (user_id) user_id, role
  FROM public.user_roles
  ORDER BY user_id,
    CASE role WHEN 'super_admin' THEN 1 WHEN 'kob_manager' THEN 2 WHEN 'team_leader' THEN 3 ELSE 4 END
)
SELECT
  p.id AS user_id,
  p.full_name,
  ur.role,
  COALESCE(lb.avg_scv, 0)::numeric AS official_score,
  lr.personal_score,
  lr.compliance_score,
  lr.period AS rating_period,
  lr.rated_at,
  w.official_weight,
  w.personal_weight,
  w.compliance_weight,
  ROUND(
    (COALESCE(lb.avg_scv, 0) * COALESCE(w.official_weight, 0)
     + COALESCE(lr.personal_score, 0) * COALESCE(w.personal_weight, 0)
     + COALESCE(lr.compliance_score, 0) * COALESCE(w.compliance_weight, 0)) / 100.0
  , 2) AS composite_score
FROM public.profiles p
JOIN user_role ur ON ur.user_id = p.id
LEFT JOIN public.scv_role_weights w ON w.role = ur.role
LEFT JOIN public.v_scv_leaderboard lb ON lb.user_id = p.id
LEFT JOIN latest_rating lr ON lr.user_id = p.id;

GRANT SELECT ON public.v_scv_composite TO authenticated;
