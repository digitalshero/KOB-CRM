
CREATE TABLE public.gallabox_fire_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.gallabox_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','FIRED','FAILED')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  fired_at timestamptz
);

CREATE INDEX gallabox_fire_queue_status_idx ON public.gallabox_fire_queue(status);
CREATE INDEX gallabox_fire_queue_lead_idx ON public.gallabox_fire_queue(lead_id);

GRANT SELECT ON public.gallabox_fire_queue TO authenticated;
GRANT ALL ON public.gallabox_fire_queue TO service_role;

ALTER TABLE public.gallabox_fire_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gbxq read auth" ON public.gallabox_fire_queue
  FOR SELECT TO authenticated USING (true);

-- writes are restricted to service_role (Make.com); no policy for authenticated writes

CREATE OR REPLACE FUNCTION public.enqueue_gallabox_auto_fire()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template_id uuid;
BEGIN
  -- Prefer active template matching the lead's language
  SELECT id INTO v_template_id
  FROM public.gallabox_templates
  WHERE active = true AND language = NEW.language
  ORDER BY created_at ASC
  LIMIT 1;

  -- Fallback: any active template regardless of language
  IF v_template_id IS NULL THEN
    SELECT id INTO v_template_id
    FROM public.gallabox_templates
    WHERE active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status)
  VALUES (NEW.id, v_template_id, 'PENDING');

  RETURN NEW;
END;
$$;

-- INSERT-only trigger; won't re-fire on stage changes/updates
CREATE TRIGGER trg_lead_auto_fire
AFTER INSERT ON public.kob_leads
FOR EACH ROW
WHEN (NEW.mode = 'AUTO' AND NEW.stage = 'LEAD_INBOX')
EXECUTE FUNCTION public.enqueue_gallabox_auto_fire();
