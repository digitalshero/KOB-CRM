
CREATE TABLE public.retargeting_rules (
  bucket text PRIMARY KEY CHECK (bucket IN ('NO','LATER','NO_RESPONSE')),
  cadence jsonb NOT NULL,
  max_attempts int NOT NULL,
  max_period_days int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.retargeting_rules TO authenticated;
GRANT ALL ON public.retargeting_rules TO service_role;

ALTER TABLE public.retargeting_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rt rules read auth" ON public.retargeting_rules
  FOR SELECT USING (true);

CREATE POLICY "rt rules manage mgr" ON public.retargeting_rules
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'kob_manager'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'kob_manager'));

CREATE TRIGGER trg_retargeting_rules_updated
  BEFORE UPDATE ON public.retargeting_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.retargeting_rules (bucket, cadence, max_attempts, max_period_days) VALUES
  ('NO',          '{"days":[3,7,14,30]}'::jsonb,        4, 30),
  ('LATER',       '{"days":[7,14,30,60,90]}'::jsonb,    5, 90),
  ('NO_RESPONSE', '{"days":[1,3,7,14,30]}'::jsonb,      5, 45);
