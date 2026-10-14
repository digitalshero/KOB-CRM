CREATE TABLE IF NOT EXISTS public.whatsapp_broadcast_initial_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING',
  request_id bigint,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_broadcast_initial_sends TO authenticated;
GRANT ALL ON public.whatsapp_broadcast_initial_sends TO service_role;
ALTER TABLE public.whatsapp_broadcast_initial_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_broadcast_initial_sends_read" ON public.whatsapp_broadcast_initial_sends
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager'));

CREATE OR REPLACE FUNCTION public.send_whatsapp_broadcast_initial_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
  v_phone text; v_digits text;
  v_request_id bigint;
  v_send_id uuid;
BEGIN
  IF NEW.source_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_source FROM public.lead_sources WHERE id = NEW.source_id;
  IF v_source IS NULL OR lower(trim(v_source)) <> 'whatsapp broadcast' THEN RETURN NEW; END IF;

  v_digits := regexp_replace(COALESCE(NEW.phone,''), '\D', '', 'g');
  IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
  ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
  ELSE v_phone := NULL; END IF;

  INSERT INTO public.whatsapp_broadcast_initial_sends(lead_id, status)
  VALUES (NEW.id, 'PENDING')
  ON CONFLICT (lead_id) DO NOTHING
  RETURNING id INTO v_send_id;

  IF v_send_id IS NULL THEN RETURN NEW; END IF;

  IF v_phone IS NULL THEN
    UPDATE public.whatsapp_broadcast_initial_sends
       SET status='FAILED', error='invalid phone', updated_at=now()
     WHERE id = v_send_id;
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := 'https://server.gallabox.com/devapi/messages/whatsapp',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apiKey','6a78a4275e97a5044adf14dc',
      'apiSecret','8ac31b13074f406d9c1942acf0e729ca'
    ),
    body := jsonb_build_object(
      'channelId','660bdabd3a96237ad64ff6d6',
      'channelType','whatsapp',
      'recipient', jsonb_build_object('name', COALESCE(NEW.full_name,'Customer'), 'phone', v_phone),
      'whatsapp', jsonb_build_object(
        'type','template',
        'template', jsonb_build_object(
          'templateName','intial_common_drip_clone_clone_clone'
        )
      )
    )
  ) INTO v_request_id;

  UPDATE public.whatsapp_broadcast_initial_sends
     SET status='SENT', request_id=v_request_id, sent_at=now(), updated_at=now()
   WHERE id = v_send_id;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'WHATSAPP_BROADCAST_INITIAL_TEMPLATE_SENT', 'kob_leads', NEW.id,
          jsonb_build_object('template','intial_common_drip_clone_clone_clone','request_id', v_request_id));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.whatsapp_broadcast_initial_sends
     SET status='FAILED', error=SQLERRM, updated_at=now()
   WHERE lead_id = NEW.id AND status <> 'SENT';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_send_whatsapp_broadcast_initial_template ON public.kob_leads;
CREATE TRIGGER trg_send_whatsapp_broadcast_initial_template
AFTER INSERT ON public.kob_leads
FOR EACH ROW EXECUTE FUNCTION public.send_whatsapp_broadcast_initial_template();

INSERT INTO public.whatsapp_broadcast_initial_sends(lead_id, status, error)
SELECT l.id, 'SKIPPED', 'pre-existing lead at trigger creation'
FROM public.kob_leads l
JOIN public.lead_sources s ON s.id = l.source_id
WHERE lower(trim(s.name)) = 'whatsapp broadcast'
ON CONFLICT (lead_id) DO NOTHING;