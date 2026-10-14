CREATE OR REPLACE FUNCTION public.send_support_lead_template()
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
  IF NEW.source_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_source FROM public.lead_sources WHERE id = NEW.source_id;
  IF v_source IS NULL OR lower(trim(v_source)) <> 'support' THEN RETURN NEW; END IF;

  v_digits := regexp_replace(COALESCE(NEW.phone,''), '\D', '', 'g');
  IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
  ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
  ELSE v_phone := NULL; END IF;

  INSERT INTO public.support_lead_sends(lead_id, template_name, status)
  VALUES (NEW.id, 'intial_common_drip_clone_clone_clone', 'PENDING')
  ON CONFLICT (lead_id) DO NOTHING
  RETURNING id INTO v_send_id;

  IF v_send_id IS NULL THEN RETURN NEW; END IF;

  IF v_phone IS NULL THEN
    UPDATE public.support_lead_sends
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

  UPDATE public.support_lead_sends
     SET status='SENT', request_id=v_request_id, sent_at=now(), updated_at=now()
   WHERE id = v_send_id;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'SUPPORT_LEAD_TEMPLATE_SENT', 'kob_leads', NEW.id,
          jsonb_build_object('template','intial_common_drip_clone_clone_clone','request_id', v_request_id));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.support_lead_sends
     SET status='FAILED', error=SQLERRM, updated_at=now()
   WHERE lead_id = NEW.id AND status <> 'SENT';
  RETURN NEW;
END;
$function$;