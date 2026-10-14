CREATE TABLE public.website_form_default_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING',
  request_id bigint,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.website_form_default_sends TO authenticated;
GRANT ALL ON public.website_form_default_sends TO service_role;

ALTER TABLE public.website_form_default_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view website form default sends"
ON public.website_form_default_sends FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.send_website_form_default_template()
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
  -- Only non Tamil/Telugu/Malayalam leads: those three already have their own
  -- language-specific Website Form triggers.
  IF NEW.language IN ('TAMIL'::lead_language, 'TELUGU'::lead_language, 'MALAYALAM'::lead_language) THEN
    RETURN NEW;
  END IF;
  IF NEW.source_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_source FROM public.lead_sources WHERE id = NEW.source_id;
  IF v_source IS NULL OR lower(trim(v_source)) <> 'website form' THEN RETURN NEW; END IF;

  v_digits := regexp_replace(COALESCE(NEW.phone,''), '\D', '', 'g');
  IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
  ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
  ELSE v_phone := NULL; END IF;

  INSERT INTO public.website_form_default_sends(lead_id, status)
  VALUES (NEW.id, 'PENDING')
  ON CONFLICT (lead_id) DO NOTHING
  RETURNING id INTO v_send_id;

  IF v_send_id IS NULL THEN RETURN NEW; END IF;

  IF v_phone IS NULL THEN
    UPDATE public.website_form_default_sends
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
          'templateName','initial_common_drip_clone_clone_clone'
        )
      )
    )
  ) INTO v_request_id;

  UPDATE public.website_form_default_sends
     SET status='SENT', request_id=v_request_id, sent_at=now(), updated_at=now()
   WHERE id = v_send_id;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'WEBSITE_FORM_DEFAULT_TEMPLATE_SENT', 'kob_leads', NEW.id,
          jsonb_build_object('template','initial_common_drip_clone_clone_clone','request_id', v_request_id));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.website_form_default_sends
     SET status='FAILED', error=SQLERRM, updated_at=now()
   WHERE lead_id = NEW.id AND status <> 'SENT';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.send_website_form_default_template() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_send_website_form_default_template
AFTER INSERT ON public.kob_leads
FOR EACH ROW EXECUTE FUNCTION public.send_website_form_default_template();

CREATE OR REPLACE FUNCTION public.lead_has_any_message(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.gallabox_fire_queue q WHERE q.lead_id = _lead_id AND q.status = 'FIRED')
      OR EXISTS (SELECT 1 FROM public.email_fire_queue e WHERE e.lead_id = _lead_id AND e.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.retargeting_attempts a WHERE a.lead_id = _lead_id AND a.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.lead_events v WHERE v.lead_id = _lead_id)
      OR EXISTS (SELECT 1 FROM public.website_form_tamil_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.website_form_telugu_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.website_form_malayalam_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.website_form_default_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'));
$$;