CREATE TABLE public.lead_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES public.kob_leads(id) ON DELETE SET NULL,
  phone text NOT NULL,
  event text NOT NULL,
  template text,
  status text,
  event_at timestamp with time zone,
  payload jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX lead_events_lead_id_idx ON public.lead_events(lead_id);
CREATE INDEX lead_events_phone_idx ON public.lead_events(phone);
CREATE INDEX lead_events_created_at_idx ON public.lead_events(created_at DESC);

GRANT SELECT ON public.lead_events TO authenticated;
GRANT ALL ON public.lead_events TO service_role;

ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers and admins can view lead events"
  ON public.lead_events FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'kob_manager'::app_role)
    OR public.has_role(auth.uid(), 'team_leader'::app_role)
  );