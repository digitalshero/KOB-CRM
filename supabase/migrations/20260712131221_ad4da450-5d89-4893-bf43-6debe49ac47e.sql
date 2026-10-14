
-- =========================================================================
-- ROLES
-- =========================================================================
CREATE TYPE public.app_role AS ENUM ('super_admin','kob_manager','team_leader','executive');
CREATE TYPE public.lead_stage AS ENUM (
  'NEW','CONTACTED','QUALIFIED','NEGOTIATION','ONBOARDING','CONVERTED',
  'NO_RESPONSE','NO','LATER','DEAD'
);

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  team_leader_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles read all authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles self read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id
  ORDER BY CASE role WHEN 'super_admin' THEN 1 WHEN 'kob_manager' THEN 2 WHEN 'team_leader' THEN 3 ELSE 4 END
  LIMIT 1;
$$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================================
-- BRANDS
-- =========================================================================
CREATE TABLE public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_shero BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.brands TO authenticated;
GRANT ALL ON public.brands TO service_role;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brands read auth" ON public.brands FOR SELECT TO authenticated USING (true);
CREATE POLICY "brands manage manager" ON public.brands FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));

-- =========================================================================
-- GEOGRAPHY
-- =========================================================================
CREATE TABLE public.india_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.india_districts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_id UUID NOT NULL REFERENCES public.india_states(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(state_id, name)
);
CREATE TABLE public.india_cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id UUID NOT NULL REFERENCES public.india_districts(id) ON DELETE CASCADE,
  state_id UUID NOT NULL REFERENCES public.india_states(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tier SMALLINT NOT NULL CHECK (tier IN (1,2,3)),
  pincode_count INT NOT NULL DEFAULT 0,
  native_brand_id UUID REFERENCES public.brands(id),
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(district_id, name)
);
CREATE TABLE public.brand_state_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  state_id UUID NOT NULL REFERENCES public.india_states(id) ON DELETE CASCADE,
  is_native BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(brand_id, state_id)
);
GRANT SELECT ON public.india_states, public.india_districts, public.india_cities, public.brand_state_availability TO authenticated;
GRANT ALL ON public.india_states, public.india_districts, public.india_cities, public.brand_state_availability TO service_role;
ALTER TABLE public.india_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.india_districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.india_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_state_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "geo read auth" ON public.india_states FOR SELECT TO authenticated USING (true);
CREATE POLICY "geo manage mgr" ON public.india_states FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));
CREATE POLICY "dist read auth" ON public.india_districts FOR SELECT TO authenticated USING (true);
CREATE POLICY "dist manage mgr" ON public.india_districts FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));
CREATE POLICY "city read auth" ON public.india_cities FOR SELECT TO authenticated USING (true);
CREATE POLICY "city manage mgr" ON public.india_cities FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));
CREATE POLICY "bsa read auth" ON public.brand_state_availability FOR SELECT TO authenticated USING (true);
CREATE POLICY "bsa manage mgr" ON public.brand_state_availability FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));

-- =========================================================================
-- LEAD SOURCES
-- =========================================================================
CREATE TABLE public.lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'digital',
  cost_per_lead NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.lead_sources TO authenticated;
GRANT ALL ON public.lead_sources TO service_role;
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "src read auth" ON public.lead_sources FOR SELECT TO authenticated USING (true);
CREATE POLICY "src manage mgr" ON public.lead_sources FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));

-- =========================================================================
-- KOB CONFIGURATION (singleton)
-- =========================================================================
CREATE TABLE public.kob_configuration (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  native_multiplier NUMERIC(6,3) NOT NULL DEFAULT 0.020,
  other_multiplier  NUMERIC(6,3) NOT NULL DEFAULT 0.008,
  scv_weight_stage INT NOT NULL DEFAULT 35,
  scv_weight_activity INT NOT NULL DEFAULT 25,
  scv_weight_source INT NOT NULL DEFAULT 15,
  scv_weight_geo INT NOT NULL DEFAULT 15,
  scv_weight_tenure INT NOT NULL DEFAULT 10,
  incentive_slab_a INT NOT NULL DEFAULT 90,
  incentive_slab_b INT NOT NULL DEFAULT 80,
  incentive_slab_c INT NOT NULL DEFAULT 70,
  incentive_slab_d INT NOT NULL DEFAULT 60,
  rt_no_days INT NOT NULL DEFAULT 30,
  rt_no_attempts INT NOT NULL DEFAULT 6,
  rt_later_first_days INT NOT NULL DEFAULT 10,
  rt_later_first_attempts INT NOT NULL DEFAULT 3,
  rt_later_then_days INT NOT NULL DEFAULT 30,
  rt_noresp_first_days INT NOT NULL DEFAULT 3,
  rt_noresp_first_attempts INT NOT NULL DEFAULT 3,
  rt_noresp_second_days INT NOT NULL DEFAULT 10,
  rt_noresp_second_attempts INT NOT NULL DEFAULT 3,
  rt_noresp_final_days INT NOT NULL DEFAULT 30,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.kob_configuration TO authenticated;
GRANT ALL ON public.kob_configuration TO service_role;
ALTER TABLE public.kob_configuration ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cfg read auth" ON public.kob_configuration FOR SELECT TO authenticated USING (true);
CREATE POLICY "cfg manage mgr" ON public.kob_configuration FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));

-- =========================================================================
-- LEADS
-- =========================================================================
CREATE TABLE public.kob_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  brand_id UUID REFERENCES public.brands(id),
  state_id UUID REFERENCES public.india_states(id),
  district_id UUID REFERENCES public.india_districts(id),
  city_id UUID REFERENCES public.india_cities(id),
  source_id UUID REFERENCES public.lead_sources(id),
  stage public.lead_stage NOT NULL DEFAULT 'NEW',
  assigned_to UUID REFERENCES auth.users(id),
  team_leader_id UUID REFERENCES auth.users(id),
  scv_score INT NOT NULL DEFAULT 0,
  investment_capacity NUMERIC(12,2),
  notes TEXT,
  converted_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.kob_leads(stage);
CREATE INDEX ON public.kob_leads(assigned_to);
CREATE INDEX ON public.kob_leads(team_leader_id);
CREATE INDEX ON public.kob_leads(state_id);
CREATE INDEX ON public.kob_leads(brand_id);
CREATE INDEX ON public.kob_leads(source_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kob_leads TO authenticated;
GRANT ALL ON public.kob_leads TO service_role;
ALTER TABLE public.kob_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads mgr all" ON public.kob_leads FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));
CREATE POLICY "leads tl team" ON public.kob_leads FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'team_leader') AND team_leader_id = auth.uid());
CREATE POLICY "leads tl update team" ON public.kob_leads FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'team_leader') AND team_leader_id = auth.uid());
CREATE POLICY "leads exec own" ON public.kob_leads FOR SELECT TO authenticated
  USING (assigned_to = auth.uid());
CREATE POLICY "leads exec own update" ON public.kob_leads FOR UPDATE TO authenticated
  USING (assigned_to = auth.uid());

CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON public.kob_leads
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.lead_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  from_stage public.lead_stage,
  to_stage public.lead_stage NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.lead_stage_history(lead_id);
GRANT SELECT, INSERT ON public.lead_stage_history TO authenticated;
GRANT ALL ON public.lead_stage_history TO service_role;
ALTER TABLE public.lead_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lsh read auth" ON public.lead_stage_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "lsh insert auth" ON public.lead_stage_history FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE public.lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id),
  activity_type TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.lead_activities(lead_id);
GRANT SELECT, INSERT ON public.lead_activities TO authenticated;
GRANT ALL ON public.lead_activities TO service_role;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "la read auth" ON public.lead_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "la insert auth" ON public.lead_activities FOR INSERT TO authenticated WITH CHECK (true);

-- Stage change trigger => history + last_activity_at
CREATE OR REPLACE FUNCTION public.on_lead_stage_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.lead_stage_history(lead_id, from_stage, to_stage, changed_by)
    VALUES (NEW.id, OLD.stage, NEW.stage, auth.uid());
    NEW.last_activity_at := now();
    IF NEW.stage = 'CONVERTED' AND NEW.converted_at IS NULL THEN
      NEW.converted_at := now();
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_lead_stage_change BEFORE UPDATE OF stage ON public.kob_leads
FOR EACH ROW EXECUTE FUNCTION public.on_lead_stage_change();

-- =========================================================================
-- RETARGETING
-- =========================================================================
CREATE TABLE public.retargeting_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  bucket public.lead_stage NOT NULL,
  phase INT NOT NULL DEFAULT 1,
  attempts_done INT NOT NULL DEFAULT 0,
  next_touch_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_dead BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.retargeting_schedule(next_touch_at);
CREATE INDEX ON public.retargeting_schedule(lead_id);
GRANT SELECT, INSERT, UPDATE ON public.retargeting_schedule TO authenticated;
GRANT ALL ON public.retargeting_schedule TO service_role;
ALTER TABLE public.retargeting_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rt read auth" ON public.retargeting_schedule FOR SELECT TO authenticated USING (true);
CREATE POLICY "rt manage mgr/tl" ON public.retargeting_schedule FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager') OR has_role(auth.uid(),'team_leader') OR has_role(auth.uid(),'executive'))
  WITH CHECK (true);

-- =========================================================================
-- INCENTIVES
-- =========================================================================
CREATE TABLE public.incentives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  kitchens_converted INT NOT NULL DEFAULT 0,
  slab_pct INT NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, period_month)
);
GRANT SELECT, INSERT, UPDATE ON public.incentives TO authenticated;
GRANT ALL ON public.incentives TO service_role;
ALTER TABLE public.incentives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inc mgr all" ON public.incentives FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));
CREATE POLICY "inc self read" ON public.incentives FOR SELECT TO authenticated USING (user_id = auth.uid());

-- =========================================================================
-- AUDIT
-- =========================================================================
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id UUID,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit read mgr" ON public.audit_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));
CREATE POLICY "audit insert auth" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- =========================================================================
-- VIEWS
-- =========================================================================

-- Kitchen scope per city: native + other-brand potential
CREATE OR REPLACE VIEW public.v_city_scope AS
SELECT
  c.id AS city_id, c.name AS city_name, c.tier, c.pincode_count, c.active AS city_active,
  s.id AS state_id, s.name AS state_name, s.active AS state_active,
  d.id AS district_id, d.name AS district_name, d.active AS district_active,
  b_native.id AS native_brand_id, b_native.name AS native_brand_name,
  cfg.native_multiplier, cfg.other_multiplier,
  (c.pincode_count::numeric * cfg.native_multiplier)::int AS native_kitchen_scope,
  (
    c.pincode_count::numeric * cfg.other_multiplier *
    GREATEST(0, (SELECT COUNT(*) FROM public.brand_state_availability bsa
                 WHERE bsa.state_id = c.state_id AND bsa.active = true AND bsa.is_native = false))
  )::int AS other_kitchen_scope
FROM public.india_cities c
JOIN public.india_districts d ON d.id = c.district_id
JOIN public.india_states s ON s.id = c.state_id
LEFT JOIN public.brands b_native ON b_native.id = c.native_brand_id
CROSS JOIN public.kob_configuration cfg
WHERE cfg.id = 1;
GRANT SELECT ON public.v_city_scope TO authenticated;

-- Funnel by source
CREATE OR REPLACE VIEW public.v_funnel_by_source AS
SELECT
  ls.id AS source_id, ls.name AS source_name, ls.cost_per_lead,
  COUNT(l.*) FILTER (WHERE l.stage = 'NEW') AS new_count,
  COUNT(l.*) FILTER (WHERE l.stage = 'CONTACTED') AS contacted_count,
  COUNT(l.*) FILTER (WHERE l.stage = 'QUALIFIED') AS qualified_count,
  COUNT(l.*) FILTER (WHERE l.stage = 'NEGOTIATION') AS negotiation_count,
  COUNT(l.*) FILTER (WHERE l.stage = 'ONBOARDING') AS onboarding_count,
  COUNT(l.*) FILTER (WHERE l.stage = 'CONVERTED') AS converted_count,
  COUNT(l.*) AS total_leads,
  (COUNT(l.*) * ls.cost_per_lead) AS total_spend,
  CASE WHEN COUNT(l.*) FILTER (WHERE l.stage = 'CONVERTED') > 0
    THEN (COUNT(l.*) * ls.cost_per_lead) / COUNT(l.*) FILTER (WHERE l.stage = 'CONVERTED')
    ELSE NULL END AS cac
FROM public.lead_sources ls
LEFT JOIN public.kob_leads l ON l.source_id = ls.id
GROUP BY ls.id, ls.name, ls.cost_per_lead;
GRANT SELECT ON public.v_funnel_by_source TO authenticated;

-- Retargeting queue view
CREATE OR REPLACE VIEW public.v_retargeting_queue AS
SELECT
  r.id, r.lead_id, r.bucket, r.phase, r.attempts_done, r.next_touch_at, r.is_dead,
  l.code, l.full_name, l.phone, l.assigned_to, l.team_leader_id, l.stage,
  s.name AS state_name, c.name AS city_name, br.name AS brand_name
FROM public.retargeting_schedule r
JOIN public.kob_leads l ON l.id = r.lead_id
LEFT JOIN public.india_states s ON s.id = l.state_id
LEFT JOIN public.india_cities c ON c.id = l.city_id
LEFT JOIN public.brands br ON br.id = l.brand_id
WHERE r.is_dead = false;
GRANT SELECT ON public.v_retargeting_queue TO authenticated;

-- SCV leaderboard
CREATE OR REPLACE VIEW public.v_scv_leaderboard AS
SELECT
  p.id AS user_id, p.full_name,
  COUNT(l.*) AS lead_count,
  COALESCE(AVG(l.scv_score)::int, 0) AS avg_scv,
  COUNT(l.*) FILTER (WHERE l.stage='CONVERTED') AS conversions
FROM public.profiles p
LEFT JOIN public.kob_leads l ON l.assigned_to = p.id
GROUP BY p.id, p.full_name;
GRANT SELECT ON public.v_scv_leaderboard TO authenticated;

-- Seed configuration row
INSERT INTO public.kob_configuration(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
