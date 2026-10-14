
-- 1. Restrict write to super_admin only on 4 config tables
DROP POLICY IF EXISTS "brands manage manager" ON public.brands;
CREATE POLICY "brands manage super_admin" ON public.brands
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "rt rules manage mgr" ON public.retargeting_rules;
CREATE POLICY "rt rules manage super_admin" ON public.retargeting_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "scv_rules manage by managers" ON public.scv_rules;
CREATE POLICY "scv_rules manage super_admin" ON public.scv_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "incentive_rules manage by managers" ON public.incentive_rules;
CREATE POLICY "incentive_rules manage super_admin" ON public.incentive_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- 2a. Remove team_leader from kob_configuration write
DROP POLICY IF EXISTS "cfg manage mgr" ON public.kob_configuration;
CREATE POLICY "cfg manage mgr" ON public.kob_configuration
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'kob_manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'kob_manager'::app_role));

-- 2b. Column-level guard: kob_manager may only change default_mode / auto_mode_killswitch / updated_at
CREATE OR REPLACE FUNCTION public.enforce_kob_configuration_manager_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(v_uid, 'super_admin'::app_role) THEN RETURN NEW; END IF;
  IF public.has_role(v_uid, 'kob_manager'::app_role) THEN
    IF NEW.native_multiplier IS DISTINCT FROM OLD.native_multiplier
       OR NEW.other_multiplier IS DISTINCT FROM OLD.other_multiplier
       OR NEW.native_brand_multiplier IS DISTINCT FROM OLD.native_brand_multiplier
       OR NEW.other_brand_multiplier IS DISTINCT FROM OLD.other_brand_multiplier
       OR NEW.incentive_slab_a IS DISTINCT FROM OLD.incentive_slab_a
       OR NEW.incentive_slab_b IS DISTINCT FROM OLD.incentive_slab_b
       OR NEW.incentive_slab_c IS DISTINCT FROM OLD.incentive_slab_c
       OR NEW.incentive_slab_d IS DISTINCT FROM OLD.incentive_slab_d
       OR NEW.rt_no_days IS DISTINCT FROM OLD.rt_no_days
       OR NEW.rt_no_attempts IS DISTINCT FROM OLD.rt_no_attempts
       OR NEW.rt_later_first_days IS DISTINCT FROM OLD.rt_later_first_days
       OR NEW.rt_later_first_attempts IS DISTINCT FROM OLD.rt_later_first_attempts
       OR NEW.rt_later_then_days IS DISTINCT FROM OLD.rt_later_then_days
       OR NEW.rt_noresp_first_days IS DISTINCT FROM OLD.rt_noresp_first_days
       OR NEW.rt_noresp_first_attempts IS DISTINCT FROM OLD.rt_noresp_first_attempts
       OR NEW.rt_noresp_second_days IS DISTINCT FROM OLD.rt_noresp_second_days
       OR NEW.rt_noresp_second_attempts IS DISTINCT FROM OLD.rt_noresp_second_attempts
       OR NEW.rt_noresp_final_days IS DISTINCT FROM OLD.rt_noresp_final_days
    THEN
      RAISE EXCEPTION 'kob_manager may only update default_mode and auto_mode_killswitch on kob_configuration';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_kob_configuration_manager_scope ON public.kob_configuration;
CREATE TRIGGER trg_enforce_kob_configuration_manager_scope
  BEFORE UPDATE ON public.kob_configuration
  FOR EACH ROW EXECUTE FUNCTION public.enforce_kob_configuration_manager_scope();
