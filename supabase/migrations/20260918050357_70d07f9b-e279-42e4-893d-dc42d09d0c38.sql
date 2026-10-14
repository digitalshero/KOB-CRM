CREATE OR REPLACE FUNCTION public.send_retargeting_first_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.retargeting_schedule%ROWTYPE;
  v_source text;
  v_delay interval;
BEGIN
  -- Only LATER / NO_RESPONSE get a deferred first touch; NO is excluded.
  IF NEW.stage NOT IN ('LATER'::lead_stage,'NO_RESPONSE'::lead_stage) THEN RETURN NEW; END IF;

  v_delay := interval '24 hours';

  IF NEW.stage = 'LATER'::lead_stage AND OLD.stage = 'LEAD_INBOX'::lead_stage THEN
    -- Exact LEAD_INBOX -> LATER entry: 7-day language-specific first template.
    v_source := 'LEAD_INBOX_LATER_7D';
    v_delay := interval '7 days';
  ELSIF NEW.stage = 'LATER'::lead_stage AND OLD.stage = 'EOI_1'::lead_stage THEN
    -- Exact EOI_1 -> LATER entry: 7-day language-specific first template.
    v_source := 'EOI1_LATER_7D';
    v_delay := interval '7 days';
  ELSIF OLD.stage = 'EOI_1'::lead_stage THEN
    v_source := 'EOI_1';
  ELSIF OLD.stage IN ('LEAD_INBOX'::lead_stage,'FAILED_FIRE'::lead_stage) THEN
    v_source := 'LEAD_INBOX';
  ELSE
    RETURN NEW;
  END IF;

  SELECT * INTO r FROM public.retargeting_schedule
   WHERE lead_id = NEW.id AND is_dead = false AND bucket = NEW.stage
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF r.attempts_done > 0 THEN RETURN NEW; END IF;

  UPDATE public.retargeting_schedule
    SET first_touch_source = v_source,
        next_touch_at = r.first_touch_at + v_delay,
        updated_at = now()
    WHERE id = r.id;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'RETARGETING_FIRST_TOUCH_SCHEDULED', 'kob_leads', NEW.id,
    jsonb_build_object('bucket', NEW.stage::text, 'from', OLD.stage::text,
                       'first_touch_source', v_source,
                       'due_at', (r.first_touch_at + v_delay)));

  RETURN NEW;
END;
$function$;

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
  v_button text;
  v_suffix text;
  v_wb_key text; v_wb_secret text; v_wb_channel text; v_wb_template text;
  v_li_template text;
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

  SELECT COALESCE(value, 'leadinbox_stage_retargeting_clone') INTO v_li_template
  FROM public.integration_settings WHERE key = 'leadinbox_rt_template_name';
  IF v_li_template IS NULL THEN v_li_template := 'leadinbox_stage_retargeting_clone'; END IF;

  IF v_api_key IS NULL OR v_api_secret IS NULL THEN
    RETURN QUERY SELECT 0,0,0,0; RETURN;
  END IF;

  FOR r IN
    SELECT rs.*, l.full_name, l.phone, l.stage AS lead_stage, l.language AS lead_language
    FROM public.retargeting_schedule rs
    JOIN public.kob_leads l ON l.id = rs.lead_id
    WHERE rs.is_dead = false
      AND rs.next_touch_at <= now()
      AND (rs.attempts_done > 0 OR rs.first_touch_at + interval '24 hours' <= now())
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

    v_button := 'Know More';

    IF r.lead_language = 'TELUGU'::lead_language AND v_te_template IS NOT NULL THEN
      v_use_template := v_te_template;
      v_use_key := COALESCE(v_te_api_key, v_api_key);
      v_use_secret := COALESCE(v_te_api_secret, v_api_secret);
      v_use_channel := COALESCE(v_te_channel, v_channel);
    ELSIF r.lead_language = 'MALAYALAM'::lead_language AND v_ml_template IS NOT NULL THEN
      v_use_template := v_ml_template;
      v_use_key := v_ml_key_placeholder; -- replaced below
    END IF;
  END LOOP;
END;
$function$;