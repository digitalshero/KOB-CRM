
CREATE TABLE public.website_form_telugu_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING',
  request_id bigint,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.website_form_telugu_sends TO authenticated;
GRANT ALL ON public.website_form_telugu_sends TO service_role;

ALTER TABLE public.website_form_telugu_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view website form telugu sends"
ON public.website_form_telugu_sends FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'kob_manager'));

CREATE OR REPLACE FUNCTION public.send_website_form_telugu_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_source text;
  v_phone text; v_digits text;
  v_request_id bigint;
  v_send_id uuid;
BEGIN
  IF NEW.language IS DISTINCT FROM 'TELUGU'::lead_language THEN RETURN NEW; END IF;
  IF NEW.source_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_source FROM public.lead_sources WHERE id = NEW.source_id;
  IF v_source IS NULL OR lower(trim(v_source)) <> 'website form' THEN RETURN NEW; END IF;

  v_digits := regexp_replace(COALESCE(NEW.phone,''), '\D', '', 'g');
  IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
  ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
  ELSE v_phone := NULL; END IF;

  INSERT INTO public.website_form_telugu_sends(lead_id, status)
  VALUES (NEW.id, 'PENDING')
  ON CONFLICT (lead_id) DO NOTHING
  RETURNING id INTO v_send_id;

  IF v_send_id IS NULL THEN RETURN NEW; END IF;

  IF v_phone IS NULL THEN
    UPDATE public.website_form_telugu_sends
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
          'templateName','telugu_drip1_kob_clone',
          'buttonValues', jsonb_build_array(
            jsonb_build_object(
              'index', 1,
              'sub_type','quick_reply',
              'parameters', jsonb_build_object('type','payload','payload','నాకు ఇష్టం ఉంది')
            )
          ),
          'headerValues', jsonb_build_object(
            'mediaUrl','https://files.gallabox.com/61adf636b0cc0c00046772c2/c65f1c95-701a-40e3-920e-24902cba4980-9bb05210626840dfbad81735223ebe73ChatGPTImageJun12026020737PM.png',
            'mediaName','9bb05210-6268-40df-bad8-1735223ebe73-ChatGPTImageJun12026020737PM.png'
          )
        )
      )
    )
  ) INTO v_request_id;

  UPDATE public.website_form_telugu_sends
     SET status='SENT', request_id=v_request_id, sent_at=now(), updated_at=now()
   WHERE id = v_send_id;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'WEBSITE_FORM_TELUGU_TEMPLATE_SENT', 'kob_leads', NEW.id,
          jsonb_build_object('template','telugu_drip1_kob_clone','request_id', v_request_id));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.website_form_telugu_sends
     SET status='FAILED', error=SQLERRM, updated_at=now()
   WHERE lead_id = NEW.id AND status <> 'SENT';
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.send_website_form_telugu_template() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_send_website_form_telugu_template
AFTER INSERT ON public.kob_leads
FOR EACH ROW EXECUTE FUNCTION public.send_website_form_telugu_template();
