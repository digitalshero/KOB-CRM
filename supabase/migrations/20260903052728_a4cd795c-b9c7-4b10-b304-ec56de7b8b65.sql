CREATE OR REPLACE FUNCTION public.send_website_form_malayalam_template()
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
  IF NEW.language IS DISTINCT FROM 'MALAYALAM'::lead_language THEN RETURN NEW; END IF;
  IF NEW.source_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_source FROM public.lead_sources WHERE id = NEW.source_id;
  IF v_source IS NULL OR lower(trim(v_source)) <> 'website form' THEN RETURN NEW; END IF;

  v_digits := regexp_replace(COALESCE(NEW.phone,''), '\D', '', 'g');
  IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
  ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
  ELSE v_phone := NULL; END IF;

  INSERT INTO public.website_form_malayalam_sends(lead_id, status)
  VALUES (NEW.id, 'PENDING')
  ON CONFLICT (lead_id) DO NOTHING
  RETURNING id INTO v_send_id;

  IF v_send_id IS NULL THEN RETURN NEW; END IF;

  IF v_phone IS NULL THEN
    UPDATE public.website_form_malayalam_sends
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
          'templateName','malayalam_kob_drip_1_clone',
          'buttonValues', jsonb_build_array(
            jsonb_build_object(
              'index', 1,
              'sub_type','quick_reply',
              'parameters', jsonb_build_object('type','payload','payload','താൽപര്യമുണ്ട്')
            )
          ),
          'headerValues', jsonb_build_object(
            'mediaUrl','https://files.gallabox.com/61adf636b0cc0c00046772c2/039974d7-db95-4b5f-9eaa-7fb67ac3b452-9bb05210626840dfbad81735223ebe73ChatGPTImageJun12026020737PM.png',
            'mediaName','9bb05210-6268-40df-bad8-1735223ebe73-ChatGPTImageJun12026020737PM.png'
          )
        )
      )
    )
  ) INTO v_request_id;

  UPDATE public.website_form_malayalam_sends
     SET status='SENT', request_id=v_request_id, sent_at=now(), updated_at=now()
   WHERE id = v_send_id;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'WEBSITE_FORM_MALAYALAM_TEMPLATE_SENT', 'kob_leads', NEW.id,
          jsonb_build_object('template','malayalam_kob_drip_1_clone','request_id', v_request_id));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.website_form_malayalam_sends
     SET status='FAILED', error=SQLERRM, updated_at=now()
   WHERE lead_id = NEW.id AND status <> 'SENT';
  RETURN NEW;
END;
$function$;

-- Retry only leads whose Malayalam website-form send never actually succeeded
-- (provider returned an error / non-2xx). Successful sends are never repeated.
CREATE OR REPLACE FUNCTION public.retry_failed_website_form_malayalam_sends()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record;
  v_phone text; v_digits text;
  v_request_id bigint;
  v_count integer := 0;
BEGIN
  FOR v_rec IN
    SELECT s.id AS send_id, l.id AS lead_id, l.full_name, l.phone
    FROM public.website_form_malayalam_sends s
    JOIN public.kob_leads l ON l.id = s.lead_id
    LEFT JOIN net._http_response r ON r.id = s.request_id
    WHERE s.status = 'FAILED'
       OR s.request_id IS NULL
       OR r.error_msg IS NOT NULL
       OR (r.status_code IS NOT NULL AND r.status_code >= 300)
  LOOP
    v_digits := regexp_replace(COALESCE(v_rec.phone,''), '\D', '', 'g');
    IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
    ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
    ELSE CONTINUE; END IF;

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
        'recipient', jsonb_build_object('name', COALESCE(v_rec.full_name,'Customer'), 'phone', v_phone),
        'whatsapp', jsonb_build_object(
          'type','template',
          'template', jsonb_build_object(
            'templateName','malayalam_kob_drip_1_clone',
            'buttonValues', jsonb_build_array(
              jsonb_build_object(
                'index', 1,
                'sub_type','quick_reply',
                'parameters', jsonb_build_object('type','payload','payload','താൽപര്യമുണ്ട്')
              )
            ),
            'headerValues', jsonb_build_object(
              'mediaUrl','https://files.gallabox.com/61adf636b0cc0c00046772c2/039974d7-db95-4b5f-9eaa-7fb67ac3b452-9bb05210626840dfbad81735223ebe73ChatGPTImageJun12026020737PM.png',
              'mediaName','9bb05210-6268-40df-bad8-1735223ebe73-ChatGPTImageJun12026020737PM.png'
            )
          )
        )
      )
    ) INTO v_request_id;

    UPDATE public.website_form_malayalam_sends
       SET status='SENT', request_id=v_request_id, sent_at=now(), error=NULL, updated_at=now()
     WHERE id = v_rec.send_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;