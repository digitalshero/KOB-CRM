
CREATE TABLE public.marketing_kpi_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  metric TEXT NOT NULL CHECK (metric IN ('SPEND','LEADS','CPL','CAC')),
  target_value NUMERIC NOT NULL DEFAULT 0,
  period DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (metric, period)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_kpi_targets TO authenticated;
GRANT ALL ON public.marketing_kpi_targets TO service_role;

ALTER TABLE public.marketing_kpi_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "marketing_kpi_targets read all authenticated"
  ON public.marketing_kpi_targets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "marketing_kpi_targets write mgr ceo"
  ON public.marketing_kpi_targets FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'kob_manager'::app_role) OR public.has_role(auth.uid(),'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'kob_manager'::app_role) OR public.has_role(auth.uid(),'super_admin'::app_role));

CREATE TRIGGER trg_marketing_kpi_targets_touch
  BEFORE UPDATE ON public.marketing_kpi_targets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.marketing_kpi_targets(metric, target_value, period) VALUES
  ('SPEND', 50000, date_trunc('month', now())::date),
  ('LEADS', 500,   date_trunc('month', now())::date),
  ('CPL',   150,   date_trunc('month', now())::date),
  ('CAC',   5000,  date_trunc('month', now())::date)
ON CONFLICT (metric, period) DO NOTHING;
