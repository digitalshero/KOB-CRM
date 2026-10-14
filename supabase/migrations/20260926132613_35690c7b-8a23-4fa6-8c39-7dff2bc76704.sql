CREATE TABLE public.scv_mode_config (
  mode text PRIMARY KEY CHECK (mode IN ('AUTO','MANUAL')),
  components jsonb NOT NULL,
  tat_movements jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.scv_mode_config TO authenticated;
GRANT ALL ON public.scv_mode_config TO service_role;
ALTER TABLE public.scv_mode_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in can read SCV mode config" ON public.scv_mode_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "CEO/Manager update SCV mode config" ON public.scv_mode_config FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager'))
  WITH CHECK (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager'));

INSERT INTO public.scv_mode_config (mode, components, tat_movements) VALUES
('MANUAL',
 '[{"key":"conversion","label":"Conversion","type":"conversion","weight":35,"enabled":true},
   {"key":"tat","label":"TAT Compliance","type":"tat","weight":25,"enabled":true},
   {"key":"eoi1Webinar","label":"EOI 1 → Webinar","type":"eoi1Webinar","weight":15,"enabled":true},
   {"key":"eoi2Payment","label":"EOI 2 → Payment","type":"eoi2Payment","weight":15,"enabled":true},
   {"key":"discipline","label":"Personal Discipline","type":"discipline","weight":10,"enabled":true}]',
 '[{"key":"lead_eoi1","label":"Lead → EOI 1","days":1,"enabled":true},
   {"key":"eoi1_webinar","label":"EOI 1 → Webinar","days":2,"enabled":true},
   {"key":"webinar_eoi2","label":"Webinar → EOI 2","days":2,"enabled":true},
   {"key":"eoi2_payment","label":"EOI 2 → Payment","days":3,"enabled":true},
   {"key":"payment_contract","label":"Payment → Contract Signed","days":4,"enabled":true}]'),
('AUTO',
 '[{"key":"conversion","label":"Conversion","type":"conversion","weight":90,"enabled":true},
   {"key":"tat","label":"TAT Compliance","type":"tat","weight":0,"enabled":false},
   {"key":"eoi2Payment","label":"EOI 2 → Payment","type":"eoi2Payment","weight":0,"enabled":false},
   {"key":"discipline","label":"Personal Discipline","type":"discipline","weight":10,"enabled":true}]',
 '[{"key":"lead_eoi1","label":"Lead → EOI 1","days":1,"enabled":true},
   {"key":"eoi1_webinar","label":"EOI 1 → Webinar","days":2,"enabled":true},
   {"key":"webinar_eoi2","label":"Webinar → EOI 2","days":2,"enabled":true},
   {"key":"eoi2_payment","label":"EOI 2 → Payment","days":3,"enabled":true},
   {"key":"payment_contract","label":"Payment → Contract Signed","days":4,"enabled":true}]');

CREATE TABLE public.scv_mode_config_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL,
  changed_by uuid,
  component text NOT NULL,
  previous_value text,
  new_value text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.scv_mode_config_changes TO authenticated;
GRANT ALL ON public.scv_mode_config_changes TO service_role;
ALTER TABLE public.scv_mode_config_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read SCV config changes" ON public.scv_mode_config_changes FOR SELECT TO authenticated USING (true);
CREATE POLICY "CEO/Manager log SCV config changes" ON public.scv_mode_config_changes FOR INSERT TO authenticated
  WITH CHECK (changed_by = auth.uid() AND (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager')));

CREATE TABLE public.scv_mode_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period date NOT NULL,
  mode text NOT NULL CHECK (mode IN ('AUTO','MANUAL')),
  ktn_cs_target integer,
  discipline numeric,
  marks jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period, mode)
);
GRANT SELECT, INSERT, UPDATE ON public.scv_mode_inputs TO authenticated;
GRANT ALL ON public.scv_mode_inputs TO service_role;
ALTER TABLE public.scv_mode_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read SCV mode inputs" ON public.scv_mode_inputs FOR SELECT TO authenticated USING (true);
CREATE POLICY "CEO/Manager/TL insert SCV mode inputs" ON public.scv_mode_inputs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'team_leader'));
CREATE POLICY "CEO/Manager/TL update SCV mode inputs" ON public.scv_mode_inputs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'team_leader'))
  WITH CHECK (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'team_leader'));
CREATE TRIGGER scv_mode_inputs_touch BEFORE UPDATE ON public.scv_mode_inputs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.scv_mode_inputs (user_id, period, mode, ktn_cs_target, discipline)
SELECT user_id, period, m, ktn_cs_target, crm_discipline FROM public.scv_monthly_inputs, (VALUES ('AUTO'),('MANUAL')) v(m);