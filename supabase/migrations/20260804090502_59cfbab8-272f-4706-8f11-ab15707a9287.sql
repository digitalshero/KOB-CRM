
INSERT INTO public.integration_settings(key, value) VALUES
  ('webinar_rt_api_key_tamil','6a71a781d60ade13e7d13203'),
  ('webinar_rt_api_secret_tamil','4b0030f3ad9d41719ca3d31d4c940134'),
  ('webinar_rt_channel_id_tamil','660bdabd3a96237ad64ff6d6'),
  ('webinar_rt_template_name_tamil','webinar_abandoned')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

CREATE OR REPLACE FUNCTION public.send_webinar_retargeting_first_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  cfg public.kob_configuration%ROWTYPE;
  r public.retargeting_schedule%ROWTYPE;
  v_key text; v_secret text; v_channel text; v_template text;
  v_media_url text; v_media_name text;
  v_phone text; v_digits text;
  v_attempt_id uuid; v_request_id bigint; v_next_days int;
BEGIN
  IF OLD.stage IS DISTINCT FROM 'WEBINAR'::lead_stage THEN RETURN NEW; END IF;
  IF NEW.stage NOT IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage) THEN RETURN NEW; END IF;
  IF NEW.language IS DISTINCT FROM 'TAMIL'::lead_language THEN RETURN NEW; END IF;

  SELECT * INTO r FROM public.retargeting_schedule
   WHERE lead_id = NEW.id AND is_dead = false AND bucket = NEW.stage
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF r.attempts_done > 0 THEN RETURN NEW; END IF;

  SELECT * INTO cfg FROM public.kob_configuration WHERE id = 1;

  SELECT value INTO v_key FROM public.integration_settings WHERE key = 'webinar_rt_api_key_tamil';
  SELECT value INTO v_secret FROM public.integration_settings WHERE key = 'webinar_rt_api_secret_tamil';
  SELECT value INTO v_channel FROM public.integration_settings WHERE key = 'webinar_rt_channel_id_tamil';
  SELECT value INTO v_template FROM public.integration_settings WHERE key = 'webinar_rt_template_name_tamil';
  SELECT value INTO v_media_url FROM public.integration_settings WHERE key = 'retargeting_media_url';
  SELECT value INTO v_media_name FROM public.integration_settings WHERE key = 'retargeting_media_name';

  IF v_key IS NULL OR v_secret IS NULL OR v_template IS NULL THEN RETURN NEW; END IF;

  v_digits := regexp_replace(COALESCE(NEW.phone,''), '\D', '', 'g');
  IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
  ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
  ELSE v_phone := NULL; END IF;

  INSERT INTO public.retargeting_attempts(lead_id, schedule_id, bucket, attempt_no, template_name, scheduled_for, status)
  VALUES (NEW.id, r.id, r.bucket, 1, v_template, now(), 'PENDING')
  RETURNING id INTO v_attempt_id;

  IF v_phone IS NULL THEN
    UPDATE public.retargeting_attempts SET status='FAILED', error='invalid phone', updated_at=now() WHERE id = v_attempt_id;
    INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
    VALUES (auth.uid(), 'WEBINAR_RETARGETING_IMMEDIATE_SEND_FAILED', 'kob_leads', NEW.id,
      jsonb_build_object('bucket', NEW.stage::text, 'reason', 'invalid phone'));
  ELSE
    SELECT net.http_post(
      url := 'https://server.gallabox.com/devapi/messages/whatsapp',
      headers := jsonb_build_object('Content-Type','application/json','apiKey', v_key, 'apiSecret', v_secret),
      body := jsonb_build_object(
        'channelId', v_channel,
        'channelType', 'whatsapp',
        'recipient', jsonb_build_object('name', COALESCE(NEW.full_name,'Customer'), 'phone', v_phone),
        'whatsapp', jsonb_build_object(
          'type','template',
          'template', jsonb_build_object(
            'templateName', v_template,
            'buttonValues', jsonb_build_array(jsonb_build_object(
              'index', 0, 'sub_type', 'quick_reply',
              'parameters', jsonb_build_object('type','payload','payload','Book Free Webinar'))),
            'headerValues', jsonb_build_object('mediaUrl', v_media_url, 'mediaName', v_media_name)
          )
        )
      )
    ) INTO v_request_id;

    UPDATE public.retargeting_attempts
      SET status='SENT', sent_at=now(), request_id=v_request_id, updated_at=now()
      WHERE id = v_attempt_id;

    INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
    VALUES (auth.uid(), 'WEBINAR_RETARGETING_IMMEDIATE_SENT', 'kob_leads', NEW.id,
      jsonb_build_object('bucket', NEW.stage::text, 'from','WEBINAR', 'attempt_no', 1,
                         'template', v_template, 'language', NEW.language::text,
                         'phone', v_phone, 'request_id', v_request_id));
  END IF;

  v_next_days := CASE r.bucket
    WHEN 'NO'::lead_stage THEN COALESCE(cfg.rt_no_days, 30)
    WHEN 'LATER'::lead_stage THEN COALESCE(cfg.rt_later_first_days, 10)
    ELSE COALESCE(cfg.rt_noresp_first_days, 3)
  END;

  UPDATE public.retargeting_schedule
    SET attempts_done = 1, phase = 1,
        next_touch_at = now() + make_interval(days => GREATEST(v_next_days,1)),
        updated_at = now()
    WHERE id = r.id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_webinar_retargeting_first_touch ON public.kob_leads;
CREATE TRIGGER trg_webinar_retargeting_first_touch
AFTER UPDATE ON public.kob_leads
FOR EACH ROW EXECUTE FUNCTION public.send_webinar_retargeting_first_touch();
