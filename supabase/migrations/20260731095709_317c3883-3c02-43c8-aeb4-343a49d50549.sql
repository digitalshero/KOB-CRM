CREATE OR REPLACE FUNCTION public.send_retargeting_first_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  cfg public.kob_configuration%ROWTYPE;
  r public.retargeting_schedule%ROWTYPE;
  v_api_key text; v_api_secret text; v_channel text; v_template text; v_media_url text; v_media_name text;
  v_te_api_key text; v_te_api_secret text; v_te_channel text; v_te_template text;
  v_ml_api_key text; v_ml_api_secret text; v_ml_channel text; v_ml_template text;
  v_use_key text; v_use_secret text; v_use_channel text; v_use_template text;
  v_phone text; v_digits text;
  v_attempt_id uuid; v_request_id bigint; v_next_days int;
BEGIN
  IF OLD.stage IS DISTINCT FROM 'EOI_1'::lead_stage THEN RETURN NEW; END IF;
  IF NEW.stage NOT IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage) THEN RETURN NEW; END IF;

  SELECT * INTO r FROM public.retargeting_schedule
   WHERE lead_id = NEW.id AND is_dead = false AND bucket = NEW.stage
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF r.attempts_done > 0 THEN RETURN NEW; END IF;

  SELECT * INTO cfg FROM public.kob_configuration WHERE id = 1;

  SELECT value INTO v_api_key FROM public.integration_settings WHERE key = 'gallabox_api_key';
  SELECT value INTO v_api_secret FROM public.integration_settings WHERE key = 'gallabox_api_secret';
  SELECT value INTO v_channel FROM public.integration_settings WHERE key = 'gallabox_channel_id';
  SELECT value INTO v_template FROM public.integration_settings WHERE key = 'retargeting_template_name';
  SELECT value INTO v_media_url FROM public.integration_settings WHERE key = 'retargeting_media_url';
  SELECT value INTO v_media_name FROM public.integration_settings WHERE key = 'retargeting_media_name';

  SELECT value INTO v_te_api_key FROM public.integration_settings WHERE key = 'gallabox_api_key_telugu';
  SELECT value INTO v_te_api_secret FROM public.integration_settings WHERE key = 'gallabox_api_secret_telugu';
  SELECT value INTO v_te_channel FROM public.integration_settings WHERE key = 'gallabox_channel_id_telugu';
  SELECT value INTO v_te_template FROM public.integration_settings WHERE key = 'retargeting_template_name_telugu';

  SELECT value INTO v_ml_api_key FROM public.integration_settings WHERE key = 'gallabox_api_key_malayalam';
  SELECT value INTO v_ml_api_secret FROM public.integration_settings WHERE key = 'gallabox_api_secret_malayalam';
  SELECT value INTO v_ml_channel FROM public.integration_settings WHERE key = 'gallabox_channel_id_malayalam';
  SELECT value INTO v_ml_template FROM public.integration_settings WHERE key = 'retargeting_template_name_malayalam';

  IF v_api_key IS NULL OR v_api_secret IS NULL THEN RETURN NEW; END IF;

  IF NEW.language = 'TELUGU'::lead_language AND v_te_template IS NOT NULL THEN
    v_use_template := v_te_template;
    v_use_key := COALESCE(v_te_api_key, v_api_key);
    v_use_secret := COALESCE(v_te_api_secret, v_api_secret);
    v_use_channel := COALESCE(v_te_channel, v_channel);
  ELSIF NEW.language = 'MALAYALAM'::lead_language AND v_ml_template IS NOT NULL THEN
    v_use_template := v_ml_template;
    v_use_key := COALESCE(v_ml_api_key, v_api_key);
    v_use_secret := COALESCE(v_ml_api_secret, v_api_secret);
    v_use_channel := COALESCE(v_ml_channel, v_channel);
  ELSE
    v_use_template := v_template;
    v_use_key := v_api_key;
    v_use_secret := v_api_secret;
    v_use_channel := v_channel;
  END IF;

  v_digits := regexp_replace(COALESCE(NEW.phone,''), '\D', '', 'g');
  IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
  ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
  ELSE v_phone := NULL; END IF;

  INSERT INTO public.retargeting_attempts(lead_id, schedule_id, bucket, attempt_no, template_name, scheduled_for, status)
  VALUES (NEW.id, r.id, r.bucket, 1, v_use_template, now(), 'PENDING')
  RETURNING id INTO v_attempt_id;

  IF v_phone IS NULL THEN
    UPDATE public.retargeting_attempts SET status='FAILED', error='invalid phone', updated_at=now() WHERE id = v_attempt_id;
    INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
    VALUES (auth.uid(), 'RETARGETING_IMMEDIATE_SEND_FAILED', 'kob_leads', NEW.id,
      jsonb_build_object('bucket', NEW.stage::text, 'reason', 'invalid phone', 'from', OLD.stage::text));
  ELSE
    SELECT net.http_post(
      url := 'https://server.gallabox.com/devapi/messages/whatsapp',
      headers := jsonb_build_object('Content-Type','application/json','apiKey', v_use_key, 'apiSecret', v_use_secret),
      body := jsonb_build_object(
        'channelId', v_use_channel,
        'channelType', 'whatsapp',
        'recipient', jsonb_build_object('name', COALESCE(NEW.full_name,'Customer'), 'phone', v_phone),
        'whatsapp', jsonb_build_object(
          'type','template',
          'template', jsonb_build_object(
            'templateName', v_use_template,
            'buttonValues', jsonb_build_array(jsonb_build_object(
              'index', 0, 'sub_type', 'quick_reply',
              'parameters', jsonb_build_object('type','payload','payload','Know More'))),
            'headerValues', jsonb_build_object('mediaUrl', v_media_url, 'mediaName', v_media_name)
          )
        )
      )
    ) INTO v_request_id;

    UPDATE public.retargeting_attempts
      SET status='SENT', sent_at=now(), request_id=v_request_id, updated_at=now()
      WHERE id = v_attempt_id;

    INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
    VALUES (auth.uid(), 'RETARGETING_IMMEDIATE_SENT', 'kob_leads', NEW.id,
      jsonb_build_object('bucket', NEW.stage::text, 'from', OLD.stage::text, 'attempt_no', 1,
                         'template', v_use_template, 'language', NEW.language::text,
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

DROP TRIGGER IF EXISTS trg_retargeting_first_touch ON public.kob_leads;
CREATE TRIGGER trg_retargeting_first_touch
AFTER UPDATE OF stage ON public.kob_leads
FOR EACH ROW
WHEN (OLD.stage = 'EOI_1'::lead_stage AND NEW.stage IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage))
EXECUTE FUNCTION public.send_retargeting_first_touch();