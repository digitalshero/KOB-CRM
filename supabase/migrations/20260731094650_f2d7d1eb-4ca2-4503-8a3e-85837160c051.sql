CREATE OR REPLACE FUNCTION public.process_retargeting_sends()
 RETURNS TABLE(processed integer, sent integer, killed integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  cfg public.kob_configuration%ROWTYPE;
  r RECORD;
  v_api_key text; v_api_secret text; v_channel text; v_template text; v_media_url text; v_media_name text;
  v_te_api_key text; v_te_api_secret text; v_te_channel text; v_te_template text;
  v_ml_api_key text; v_ml_api_secret text; v_ml_channel text; v_ml_template text;
  v_use_key text; v_use_secret text; v_use_channel text; v_use_template text;
  v_phone text; v_digits text;
  v_processed int := 0; v_sent int := 0; v_killed int := 0; v_skipped int := 0;
  v_age_days numeric;
  v_dead boolean;
  v_new_phase int; v_new_attempts int; v_next_days int;
  v_attempt_id uuid; v_request_id bigint;
  v_max_days constant int := 180;
BEGIN
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

  IF v_api_key IS NULL OR v_api_secret IS NULL THEN
    RETURN QUERY SELECT 0,0,0,0; RETURN;
  END IF;

  FOR r IN
    SELECT rs.*, l.full_name, l.phone, l.stage AS lead_stage, l.language AS lead_language
    FROM public.retargeting_schedule rs
    JOIN public.kob_leads l ON l.id = rs.lead_id
    WHERE rs.is_dead = false
      AND rs.next_touch_at <= now()
      AND l.stage IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage,'RETARGETING'::lead_stage)
    ORDER BY rs.next_touch_at
    LIMIT 200
  LOOP
    v_processed := v_processed + 1;
    v_dead := false;
    v_age_days := EXTRACT(EPOCH FROM (now() - r.first_touch_at)) / 86400.0;

    IF r.bucket = 'NO'::lead_stage THEN
      IF r.attempts_done >= COALESCE(cfg.rt_no_attempts, 6) THEN v_dead := true; END IF;
    ELSE
      IF v_age_days > v_max_days THEN v_dead := true; END IF;
    END IF;

    IF v_dead THEN
      UPDATE public.retargeting_schedule SET is_dead = true, updated_at = now() WHERE id = r.id;
      UPDATE public.kob_leads SET stage = 'DEAD_LEAD'::lead_stage WHERE id = r.lead_id;
      INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
      VALUES (NULL, 'RETARGETING_COMPLETED', 'kob_leads', r.lead_id,
        jsonb_build_object('bucket', r.bucket::text, 'attempts_done', r.attempts_done, 'age_days', round(v_age_days)));
      v_killed := v_killed + 1;
      CONTINUE;
    END IF;

    -- language-based Gallabox config selection (Tamil/default unchanged)
    IF r.lead_language = 'TELUGU'::lead_language AND v_te_template IS NOT NULL THEN
      v_use_template := v_te_template;
      v_use_key := COALESCE(v_te_api_key, v_api_key);
      v_use_secret := COALESCE(v_te_api_secret, v_api_secret);
      v_use_channel := COALESCE(v_te_channel, v_channel);
    ELSIF r.lead_language = 'MALAYALAM'::lead_language AND v_ml_template IS NOT NULL THEN
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

    v_digits := regexp_replace(COALESCE(r.phone,''), '\D', '', 'g');
    IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
    ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
    ELSE v_phone := NULL; END IF;

    INSERT INTO public.retargeting_attempts(lead_id, schedule_id, bucket, attempt_no, template_name, scheduled_for, status)
    VALUES (r.lead_id, r.id, r.bucket, r.attempts_done + 1, v_use_template, r.next_touch_at, 'PENDING')
    RETURNING id INTO v_attempt_id;

    IF v_phone IS NULL THEN
      UPDATE public.retargeting_attempts SET status = 'FAILED', error = 'invalid phone', updated_at = now() WHERE id = v_attempt_id;
      INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
      VALUES (NULL, 'RETARGETING_SEND_FAILED', 'kob_leads', r.lead_id,
        jsonb_build_object('bucket', r.bucket::text, 'reason', 'invalid phone', 'attempt_no', r.attempts_done + 1));
      v_skipped := v_skipped + 1;
    ELSE
      SELECT net.http_post(
        url := 'https://server.gallabox.com/devapi/messages/whatsapp',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apiKey', v_use_key,
          'apiSecret', v_use_secret
        ),
        body := jsonb_build_object(
          'channelId', v_use_channel,
          'channelType', 'whatsapp',
          'recipient', jsonb_build_object('name', COALESCE(r.full_name, 'Customer'), 'phone', v_phone),
          'whatsapp', jsonb_build_object(
            'type', 'template',
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
        SET status = 'SENT', sent_at = now(), request_id = v_request_id, updated_at = now()
        WHERE id = v_attempt_id;

      INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
      VALUES (NULL, 'RETARGETING_SENT', 'kob_leads', r.lead_id,
        jsonb_build_object('bucket', r.bucket::text, 'attempt_no', r.attempts_done + 1,
                           'template', v_use_template, 'language', r.lead_language::text,
                           'phone', v_phone, 'request_id', v_request_id));
      v_sent := v_sent + 1;
    END IF;

    v_new_attempts := r.attempts_done + 1;
    v_new_phase := r.phase;

    IF r.bucket = 'NO'::lead_stage THEN
      v_next_days := COALESCE(cfg.rt_no_days, 30);

    ELSIF r.bucket = 'LATER'::lead_stage THEN
      IF r.phase <= 1 THEN
        IF v_new_attempts >= COALESCE(cfg.rt_later_first_attempts, 3) THEN
          v_new_phase := 2; v_new_attempts := 0;
          v_next_days := COALESCE(cfg.rt_later_then_days, 30);
        ELSE
          v_next_days := COALESCE(cfg.rt_later_first_days, 10);
        END IF;
      ELSE
        v_next_days := COALESCE(cfg.rt_later_then_days, 30);
      END IF;

    ELSE
      IF r.phase <= 1 THEN
        IF v_new_attempts >= COALESCE(cfg.rt_noresp_first_attempts, 3) THEN
          v_new_phase := 2; v_new_attempts := 0;
          v_next_days := COALESCE(cfg.rt_noresp_second_days, 10);
        ELSE
          v_next_days := COALESCE(cfg.rt_noresp_first_days, 3);
        END IF;
      ELSIF r.phase = 2 THEN
        IF v_new_attempts >= COALESCE(cfg.rt_noresp_second_attempts, 3) THEN
          v_new_phase := 3; v_new_attempts := 0;
          v_next_days := COALESCE(cfg.rt_noresp_final_days, 30);
        ELSE
          v_next_days := COALESCE(cfg.rt_noresp_second_days, 10);
        END IF;
      ELSE
        v_next_days := COALESCE(cfg.rt_noresp_final_days, 30);
      END IF;
    END IF;

    UPDATE public.retargeting_schedule
      SET attempts_done = v_new_attempts,
          phase = v_new_phase,
          next_touch_at = now() + make_interval(days => GREATEST(v_next_days, 1)),
          updated_at = now()
      WHERE id = r.id;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_sent, v_killed, v_skipped;
END;
$function$;