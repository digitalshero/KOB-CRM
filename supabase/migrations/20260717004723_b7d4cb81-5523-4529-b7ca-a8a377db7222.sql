INSERT INTO public.kpi_targets (metric, period, target_value, effective_from)
VALUES
  ('EOI_1', 'monthly', 500, date_trunc('month', now())::date),
  ('WEBINAR', 'monthly', 300, date_trunc('month', now())::date),
  ('EOI_2', 'monthly', 150, date_trunc('month', now())::date),
  ('FORM_FILLED', 'monthly', 75, date_trunc('month', now())::date)
ON CONFLICT (metric, period, effective_from) DO NOTHING;