
-- 1) Auto-fire trigger: add EMAIL row to gallabox_fire_queue
CREATE OR REPLACE FUNCTION public.enqueue_gallabox_auto_fire()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template_id uuid;
  v_kill boolean;
  v_email_subject text;
  v_email_body text;
  v_lead_email text;
  v_lead_name text;
BEGIN
  SELECT auto_mode_killswitch INTO v_kill FROM public.kob_configuration WHERE id = 1;
  IF COALESCE(v_kill, false) THEN RETURN NEW; END IF;

  SELECT id, email_subject, email_body
    INTO v_template_id, v_email_subject, v_email_body
  FROM public.gallabox_templates
  WHERE active = true AND language = NEW.language
  ORDER BY created_at ASC LIMIT 1;

  IF v_template_id IS NULL THEN
    SELECT id, email_subject, email_body
      INTO v_template_id, v_email_subject, v_email_body
    FROM public.gallabox_templates
    WHERE active = true
    ORDER BY created_at ASC LIMIT 1;
  END IF;

  INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status, channel)
  VALUES (NEW.id, v_template_id, 'PENDING', 'WHATSAPP');

  v_lead_email := NEW.email;
  v_lead_name := NEW.full_name;
  IF v_template_id IS NOT NULL
     AND v_email_subject IS NOT NULL AND btrim(v_email_subject) <> ''
     AND v_email_body IS NOT NULL AND btrim(v_email_body) <> ''
     AND v_lead_email IS NOT NULL AND btrim(v_lead_email) <> '' THEN
    INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status, channel)
    VALUES (NEW.id, v_template_id, 'PENDING', 'EMAIL');

    -- keep existing email_fire_queue side-channel in sync (already wired)
    INSERT INTO public.email_fire_queue(lead_id, template_id, to_email, subject, body, status)
    VALUES (
      NEW.id, v_template_id, v_lead_email,
      public.render_email_text(v_email_subject, v_lead_name),
      public.render_email_text(v_email_body, v_lead_name),
      'PENDING'
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Retargeting advance: add EMAIL row to gallabox_fire_queue
CREATE OR REPLACE FUNCTION public.advance_retargeting()
 RETURNS TABLE(advanced integer, killed integer, processed integer, skipped_no_template integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD; rule RECORD;
  v_phases jsonb; v_phase_count int; v_current jsonb;
  v_current_attempts int; v_current_days int;
  v_new_phase int; v_new_attempts int; v_next_days int; v_next jsonb;
  v_processed int := 0; v_advanced int := 0; v_killed int := 0; v_skipped_no_template int := 0;
  v_age_days numeric;
  v_lead_language lead_language; v_lead_email text; v_lead_name text;
  v_template_id uuid; v_email_subject text; v_email_body text;
BEGIN
  FOR r IN SELECT rs.* FROM public.retargeting_schedule rs
           WHERE rs.is_dead = false AND rs.next_touch_at <= now()
  LOOP
    v_processed := v_processed + 1;
    SELECT * INTO rule FROM public.retargeting_rules WHERE bucket = r.bucket::text;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_phases := rule.cadence->'phases';
    v_phase_count := jsonb_array_length(v_phases);
    v_age_days := EXTRACT(EPOCH FROM (now() - r.first_touch_at)) / 86400.0;

    IF v_age_days > rule.max_period_days THEN
      UPDATE public.retargeting_schedule SET is_dead = true, updated_at = now() WHERE id = r.id;
      UPDATE public.kob_leads SET stage = 'DEAD_LEAD'::lead_stage WHERE id = r.lead_id;
      v_killed := v_killed + 1; CONTINUE;
    END IF;

    IF r.bucket = 'NO'::lead_stage AND (r.attempts_done + 1) >= rule.max_attempts THEN
      UPDATE public.retargeting_schedule SET is_dead = true, attempts_done = r.attempts_done + 1, updated_at = now() WHERE id = r.id;
      UPDATE public.kob_leads SET stage = 'DEAD_LEAD'::lead_stage WHERE id = r.lead_id;
      v_killed := v_killed + 1; CONTINUE;
    END IF;

    v_current := v_phases->(LEAST(r.phase, v_phase_count) - 1);
    v_current_attempts := NULLIF(v_current->>'attempts','')::int;
    v_current_days := (v_current->>'days')::int;
    v_new_attempts := r.attempts_done + 1;
    v_new_phase := r.phase;
    v_next_days := v_current_days;

    IF v_current_attempts IS NOT NULL AND v_new_attempts >= v_current_attempts AND r.phase < v_phase_count THEN
      v_new_phase := r.phase + 1; v_new_attempts := 0;
      v_next := v_phases->(v_new_phase - 1);
      v_next_days := (v_next->>'days')::int;
    END IF;

    UPDATE public.retargeting_schedule
      SET attempts_done = v_new_attempts, phase = v_new_phase,
          next_touch_at = now() + make_interval(days => v_next_days), updated_at = now()
      WHERE id = r.id;
    v_advanced := v_advanced + 1;

    SELECT language, email, full_name INTO v_lead_language, v_lead_email, v_lead_name
    FROM public.kob_leads WHERE id = r.lead_id;

    SELECT id, email_subject, email_body INTO v_template_id, v_email_subject, v_email_body
    FROM public.gallabox_templates
    WHERE category = 'RETARGETING' AND bucket = r.bucket::text
      AND language = v_lead_language AND active = true
    ORDER BY created_at ASC LIMIT 1;

    IF v_template_id IS NULL THEN
      v_skipped_no_template := v_skipped_no_template + 1;
    ELSE
      INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status, channel)
      VALUES (r.lead_id, v_template_id, 'PENDING', 'WHATSAPP');

      IF v_email_subject IS NOT NULL AND btrim(v_email_subject) <> ''
         AND v_email_body IS NOT NULL AND btrim(v_email_body) <> ''
         AND v_lead_email IS NOT NULL AND btrim(v_lead_email) <> '' THEN
        INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status, channel)
        VALUES (r.lead_id, v_template_id, 'PENDING', 'EMAIL');

        INSERT INTO public.email_fire_queue(lead_id, template_id, to_email, subject, body, status)
        VALUES (r.lead_id, v_template_id, v_lead_email,
          public.render_email_text(v_email_subject, v_lead_name),
          public.render_email_text(v_email_body, v_lead_name), 'PENDING');
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_advanced, v_killed, v_processed, v_skipped_no_template;
END;
$function$;

-- 3) Webinar defaulter: add EMAIL row to gallabox_fire_queue
CREATE OR REPLACE FUNCTION public.mark_webinar_defaulters()
 RETURNS TABLE(marked integer, skipped_no_template integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_template_id uuid; v_email_subject text; v_email_body text;
  v_lead_lang lead_language; v_lead_email text; v_lead_name text;
  v_marked int := 0; v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT wa.id AS attendance_id, wa.lead_id
    FROM public.webinar_attendance wa
    JOIN public.webinar_batches wb ON wb.id = wa.batch_id
    WHERE wa.attended = false AND wa.defaulter_marked_at IS NULL
      AND wb.scheduled_at <= now()
  LOOP
    UPDATE public.webinar_attendance SET defaulter_marked_at = now() WHERE id = r.attendance_id;
    v_marked := v_marked + 1;

    SELECT language, email, full_name INTO v_lead_lang, v_lead_email, v_lead_name
    FROM public.kob_leads WHERE id = r.lead_id;

    SELECT id, email_subject, email_body INTO v_template_id, v_email_subject, v_email_body
    FROM public.gallabox_templates
    WHERE category = 'WEBINAR_DEFAULTER' AND language = v_lead_lang AND active = true
    ORDER BY created_at ASC LIMIT 1;

    IF v_template_id IS NULL THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status, channel)
      VALUES (r.lead_id, v_template_id, 'PENDING', 'WHATSAPP');

      IF v_email_subject IS NOT NULL AND btrim(v_email_subject) <> ''
         AND v_email_body IS NOT NULL AND btrim(v_email_body) <> ''
         AND v_lead_email IS NOT NULL AND btrim(v_lead_email) <> '' THEN
        INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status, channel)
        VALUES (r.lead_id, v_template_id, 'PENDING', 'EMAIL');

        INSERT INTO public.email_fire_queue(lead_id, template_id, to_email, subject, body, status)
        VALUES (r.lead_id, v_template_id, v_lead_email,
          public.render_email_text(v_email_subject, v_lead_name),
          public.render_email_text(v_email_body, v_lead_name), 'PENDING');
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_marked, v_skipped;
END;
$function$;
