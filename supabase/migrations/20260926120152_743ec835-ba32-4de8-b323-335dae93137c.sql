CREATE TABLE public.scv_component_weights (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  weight_conversion integer NOT NULL DEFAULT 35 CHECK (weight_conversion BETWEEN 0 AND 100),
  weight_tat integer NOT NULL DEFAULT 25 CHECK (weight_tat BETWEEN 0 AND 100),
  weight_eoi2_payment integer NOT NULL DEFAULT 15 CHECK (weight_eoi2_payment BETWEEN 0 AND 100),
  weight_crm_discipline integer NOT NULL DEFAULT 25 CHECK (weight_crm_discipline BETWEEN 0 AND 100),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scv_component_weights_sum_100 CHECK (weight_conversion + weight_tat + weight_eoi2_payment + weight_crm_discipline = 100)
);
GRANT SELECT, UPDATE ON public.scv_component_weights TO authenticated;
GRANT ALL ON public.scv_component_weights TO service_role;
ALTER TABLE public.scv_component_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scv weights read" ON public.scv_component_weights FOR SELECT TO authenticated USING (true);
CREATE POLICY "scv weights update ceo manager" ON public.scv_component_weights FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager'))
  WITH CHECK (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager'));
INSERT INTO public.scv_component_weights (id) VALUES (1);

CREATE TABLE public.scv_weight_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_by uuid,
  component text NOT NULL,
  previous_weight integer NOT NULL,
  new_weight integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.scv_weight_changes TO authenticated;
GRANT ALL ON public.scv_weight_changes TO service_role;
ALTER TABLE public.scv_weight_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scv weight changes read" ON public.scv_weight_changes FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.log_scv_weight_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  IF NEW.weight_conversion <> OLD.weight_conversion THEN
    INSERT INTO scv_weight_changes(changed_by, component, previous_weight, new_weight) VALUES (auth.uid(),'conversion',OLD.weight_conversion,NEW.weight_conversion); END IF;
  IF NEW.weight_tat <> OLD.weight_tat THEN
    INSERT INTO scv_weight_changes(changed_by, component, previous_weight, new_weight) VALUES (auth.uid(),'tat',OLD.weight_tat,NEW.weight_tat); END IF;
  IF NEW.weight_eoi2_payment <> OLD.weight_eoi2_payment THEN
    INSERT INTO scv_weight_changes(changed_by, component, previous_weight, new_weight) VALUES (auth.uid(),'eoi2_payment',OLD.weight_eoi2_payment,NEW.weight_eoi2_payment); END IF;
  IF NEW.weight_crm_discipline <> OLD.weight_crm_discipline THEN
    INSERT INTO scv_weight_changes(changed_by, component, previous_weight, new_weight) VALUES (auth.uid(),'crm_discipline',OLD.weight_crm_discipline,NEW.weight_crm_discipline); END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.log_scv_weight_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_scv_weight_change BEFORE UPDATE ON public.scv_component_weights
  FOR EACH ROW EXECUTE FUNCTION public.log_scv_weight_change();