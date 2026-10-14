
-- 1. scv_rules (singleton)
CREATE TABLE public.scv_rules (
  id INT PRIMARY KEY CHECK (id = 1),
  weight_conversion INT NOT NULL DEFAULT 35,
  weight_tat INT NOT NULL DEFAULT 25,
  weight_eoi1_webinar INT NOT NULL DEFAULT 15,
  weight_eoi2_payment INT NOT NULL DEFAULT 15,
  weight_crm_discipline INT NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scv_rules_weights_sum_100 CHECK (
    weight_conversion + weight_tat + weight_eoi1_webinar + weight_eoi2_payment + weight_crm_discipline = 100
  )
);
GRANT SELECT ON public.scv_rules TO authenticated;
GRANT ALL ON public.scv_rules TO service_role;
ALTER TABLE public.scv_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scv_rules read all authenticated" ON public.scv_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "scv_rules manage by managers" ON public.scv_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'super_admin'));
INSERT INTO public.scv_rules (id) VALUES (1);

CREATE TRIGGER trg_scv_rules_touch BEFORE UPDATE ON public.scv_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. incentive_rules
CREATE TABLE public.incentive_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  min_score INT NOT NULL,
  max_score INT NOT NULL,
  incentive_pct INT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT incentive_rules_score_range CHECK (min_score <= max_score),
  CONSTRAINT incentive_rules_pct_range  CHECK (incentive_pct >= 0 AND incentive_pct <= 100)
);
GRANT SELECT ON public.incentive_rules TO authenticated;
GRANT ALL ON public.incentive_rules TO service_role;
ALTER TABLE public.incentive_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incentive_rules read all authenticated" ON public.incentive_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "incentive_rules manage by managers" ON public.incentive_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'super_admin'));

CREATE TRIGGER trg_incentive_rules_touch BEFORE UPDATE ON public.incentive_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.incentive_rules (label, min_score, max_score, incentive_pct, sort_order) VALUES
  ('Platinum (90+)',      90, 100, 100, 1),
  ('Gold (80–89)',        80,  89,  80, 2),
  ('Silver (70–79)',      70,  79,  60, 3),
  ('Bronze (60–69)',      60,  69,  40, 4),
  ('Below Threshold',      0,  59,   0, 5);

-- 3. Drop obsolete columns / function
DROP FUNCTION IF EXISTS public.compute_scv_scores();

ALTER TABLE public.kob_configuration
  DROP COLUMN IF EXISTS scv_weight_stage,
  DROP COLUMN IF EXISTS scv_weight_activity,
  DROP COLUMN IF EXISTS scv_weight_source,
  DROP COLUMN IF EXISTS scv_weight_geo,
  DROP COLUMN IF EXISTS scv_weight_tenure;
