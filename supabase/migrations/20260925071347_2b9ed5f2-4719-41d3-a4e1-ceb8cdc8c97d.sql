CREATE TABLE public.scv_monthly_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period date NOT NULL,
  ktn_cs_target integer,
  crm_discipline numeric,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period),
  CHECK (ktn_cs_target IS NULL OR ktn_cs_target >= 0),
  CHECK (crm_discipline IS NULL OR (crm_discipline >= 0 AND crm_discipline <= 100))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scv_monthly_inputs TO authenticated;
GRANT ALL ON public.scv_monthly_inputs TO service_role;
ALTER TABLE public.scv_monthly_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read SCV monthly inputs" ON public.scv_monthly_inputs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers insert SCV monthly inputs" ON public.scv_monthly_inputs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Managers update SCV monthly inputs" ON public.scv_monthly_inputs
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Managers delete SCV monthly inputs" ON public.scv_monthly_inputs
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'super_admin'));
CREATE TRIGGER scv_monthly_inputs_touch BEFORE UPDATE ON public.scv_monthly_inputs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();