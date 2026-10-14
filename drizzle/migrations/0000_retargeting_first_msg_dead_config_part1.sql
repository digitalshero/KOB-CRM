ALTER TABLE public.kob_configuration
  ADD COLUMN IF NOT EXISTS rt_later_first_msg_days integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rt_later_source_first_msg_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS rt_later_dead_days integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS rt_noresp_first_msg_days integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rt_noresp_dead_days integer NOT NULL DEFAULT 180;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.auto_enroll_retargeting()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.kob_configuration%ROWTYPE;
  v_first_days int;
BEGIN
  IF NEW.stage NOT IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage) THEN
    RETURN NEW;
  END IF;
  IF OLD.stage IS NOT DISTINCT FROM NEW.stage THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.retargeting_schedule
             WHERE lead_id = NEW.id AND is_dead = false AND bucket = NEW.stage) THEN
    RETURN NEW;
  END IF;

  UPDATE public.retargeting_schedule
    SET is_dead = true, updated_at = now()
    WHERE lead_id = NEW.id AND is_dead = false;
  UPDATE public.retargeting_attempts
    SET status = 'CANCELLED', error = 'bucket changed', updated_at = now()
    WHERE lead_id = NEW.id AND status = 'PENDING';

  SELECT * INTO cfg FROM public.kob_configuration WHERE id = 1;

  v_first_days := CASE NEW.stage
    WHEN 'NO'::lead_stage THEN COALESCE(cfg.rt_no_days, 30)
    WHEN 'LATER'::lead_stage THEN COALESCE(cfg.rt_later_first_days, 10)
    ELSE COALESCE(cfg.rt_noresp_first_days, 3)
  END;

  INSERT INTO public.retargeting_schedule
    (lead_id, bucket, phase, attempts_done, first_touch_at, next_touch_at, is_dead)
  VALUES (NEW.id, NEW.stage, 1, 0, now(),
          CASE WHEN NEW.stage = 'NO'::lead_stage
               THEN now() + make_interval(days => GREATEST(COALESCE(cfg.rt_no_days, 30), 1))
               WHEN NEW.stage = 'LATER'::lead_stage THEN now() + make_interval(days => GREATEST(COALESCE(cfg.rt_later_first_msg_days, 1), 1))
               ELSE now() + make_interval(days => GREATEST(COALESCE(cfg.rt_noresp_first_msg_days, 1), 1)) END,
          false);

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'RETARGETING_ENROLLED', 'kob_leads', NEW.id,
    jsonb_build_object('bucket', NEW.stage::text, 'first_interval_days', v_first_days,
                       'first_touch_delay_hours',
                       CASE WHEN NEW.stage = 'NO'::lead_stage
                            THEN GREATEST(COALESCE(cfg.rt_no_days, 30), 1) * 24
                            WHEN NEW.stage = 'LATER'::lead_stage THEN GREATEST(COALESCE(cfg.rt_later_first_msg_days, 1), 1) * 24
                            ELSE GREATEST(COALESCE(cfg.rt_noresp_first_msg_days, 1), 1) * 24 END));

  RETURN NEW;
END;
$function$;
--> statement-breakpoint
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
  cfg public.kob_configuration%ROWTYPE;
BEGIN
  IF NEW.stage NOT IN ('LATER'::lead_stage,'NO_RESPONSE'::lead_stage) THEN RETURN NEW; END IF;

  SELECT * INTO cfg FROM public.kob_configuration WHERE id = 1;
  IF NEW.stage = 'LATER'::lead_stage THEN
    v_delay := make_interval(days => GREATEST(COALESCE(cfg.rt_later_first_msg_days, 1), 1));
  ELSE
    v_delay := make_interval(days => GREATEST(COALESCE(cfg.rt_noresp_first_msg_days, 1), 1));
  END IF;

  IF NEW.stage = 'LATER'::lead_stage AND OLD.stage = 'LEAD_INBOX'::lead_stage THEN
    v_source := 'LEAD_INBOX_LATER_7D';
    v_delay := make_interval(days => GREATEST(COALESCE(cfg.rt_later_source_first_msg_days, 7), 1));
  ELSIF NEW.stage = 'LATER'::lead_stage AND OLD.stage = 'EOI_1'::lead_stage THEN
    v_source := 'EOI1_LATER_7D';
    v_delay := make_interval(days => GREATEST(COALESCE(cfg.rt_later_source_first_msg_days, 7), 1));
  ELSIF NEW.stage = 'LATER'::lead_stage AND OLD.stage = 'WEBINAR'::lead_stage THEN
    v_source := 'WEBINAR_LATER_7D';
    v_delay := make_interval(days => GREATEST(COALESCE(cfg.rt_later_source_first_msg_days, 7), 1));
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.send_webinar_retargeting_first_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.retargeting_schedule%ROWTYPE;
  v_suffix text;
  cfg public.kob_configuration%ROWTYPE;
  v_delay interval;
BEGIN
  IF OLD.stage IS DISTINCT FROM 'WEBINAR'::lead_stage THEN RETURN NEW; END IF;
  IF NEW.stage IS DISTINCT FROM 'NO_RESPONSE'::lead_stage THEN RETURN NEW; END IF;

  v_suffix := CASE NEW.language
    WHEN 'TAMIL'::lead_language THEN 'tamil'
    WHEN 'TELUGU'::lead_language THEN 'telugu'
    WHEN 'MALAYALAM'::lead_language THEN 'malayalam'
    ELSE NULL
  END;
  IF v_suffix IS NULL THEN
    INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
    VALUES (auth.uid(), 'WEBINAR_RETARGETING_IMMEDIATE_SKIPPED', 'kob_leads', NEW.id,
      jsonb_build_object('reason','unsupported language','to_stage', NEW.stage::text));
    RETURN NEW;
  END IF;

  SELECT * INTO cfg FROM public.kob_configuration WHERE id = 1;
  v_delay := make_interval(days => GREATEST(COALESCE(cfg.rt_noresp_first_msg_days, 1), 1));

  SELECT * INTO r FROM public.retargeting_schedule
   WHERE lead_id = NEW.id AND is_dead = false AND bucket = NEW.stage
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF r.attempts_done > 0 THEN RETURN NEW; END IF;

  UPDATE public.retargeting_schedule
    SET first_touch_source = 'WEBINAR',
        next_touch_at = r.first_touch_at + v_delay,
        updated_at = now()
    WHERE id = r.id;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'WEBINAR_RETARGETING_FIRST_TOUCH_SCHEDULED', 'kob_leads', NEW.id,
    jsonb_build_object('bucket', NEW.stage::text, 'from', OLD.stage::text,
                       'language', NEW.language::text,
                       'due_at', (r.first_touch_at + v_delay)));

  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.advance_retargeting_schedule()
 RETURNS TABLE(processed integer, advanced integer, killed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.kob_configuration%ROWTYPE;
  r RECORD;
  v_lead_stage lead_stage;
  v_processed int := 0;
  v_advanced int := 0;
  v_killed int := 0;
  v_age_days int;
  v_new_attempts int;
  v_new_phase int;
  v_new_next timestamptz;
  v_dead boolean;
BEGIN
  SELECT * INTO cfg FROM public.kob_configuration WHERE id = 1;

  FOR r IN
    SELECT rs.*, l.stage AS lead_stage
    FROM public.retargeting_schedule rs
    JOIN public.kob_leads l ON l.id = rs.lead_id
    WHERE rs.is_dead = false
      AND rs.next_touch_at::date <= current_date
      AND l.stage IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage,'RETARGETING'::lead_stage)
  LOOP
    v_processed := v_processed + 1;
    v_dead := false;
    v_new_attempts := r.attempts_done;
    v_new_phase := r.phase;
    v_new_next := r.next_touch_at;
    v_age_days := GREATEST(0, (current_date - r.first_touch_at::date));

    IF r.bucket = 'NO'::lead_stage THEN
      IF r.attempts_done + 1 > cfg.rt_no_attempts THEN
        v_dead := true;
      ELSE
        v_new_attempts := r.attempts_done + 1;
        v_new_next := now() + make_interval(days => cfg.rt_no_days);
      END IF;

    ELSIF r.bucket = 'LATER'::lead_stage THEN
      IF r.phase <= 1 THEN
        IF r.attempts_done + 1 <= cfg.rt_later_first_attempts THEN
          v_new_attempts := r.attempts_done + 1;
          v_new_phase := 1;
          v_new_next := now() + make_interval(days => cfg.rt_later_first_days);
        ELSE
          v_new_phase := 2;
          v_new_attempts := 0;
          v_new_next := now() + make_interval(days => cfg.rt_later_then_days);
        END IF;
      ELSE
        IF v_age_days > COALESCE(cfg.rt_later_dead_days, 180) THEN
          v_dead := true;
        ELSE
          v_new_attempts := r.attempts_done + 1;
          v_new_next := now() + make_interval(days => cfg.rt_later_then_days);
        END IF;
      END IF;

    ELSIF r.bucket = 'NO_RESPONSE'::lead_stage THEN
      IF r.phase <= 1 THEN
        IF r.attempts_done + 1 <= cfg.rt_noresp_first_attempts THEN
          v_new_attempts := r.attempts_done + 1;
          v_new_phase := 1;
          v_new_next := now() + make_interval(days => cfg.rt_noresp_first_days);
        ELSE
          v_new_phase := 2;
          v_new_attempts := 0;
          v_new_next := now() + make_interval(days => cfg.rt_noresp_second_days);
        END IF;
      ELSIF r.phase = 2 THEN
        IF r.attempts_done + 1 <= cfg.rt_noresp_second_attempts THEN
          v_new_attempts := r.attempts_done + 1;
          v_new_next := now() + make_interval(days => cfg.rt_noresp_second_days);
        ELSE
          v_new_phase := 3;
          v_new_attempts := 0;
          v_new_next := now() + make_interval(days => cfg.rt_noresp_final_days);
        END IF;
      ELSE
        IF v_age_days > COALESCE(cfg.rt_noresp_dead_days, 180) THEN
          v_dead := true;
        ELSE
          v_new_attempts := r.attempts_done + 1;
          v_new_next := now() + make_interval(days => cfg.rt_noresp_final_days);
        END IF;
      END IF;

    ELSE
      CONTINUE;
    END IF;

    IF v_dead THEN
      UPDATE public.kob_leads SET stage = 'DEAD_LEAD'::lead_stage WHERE id = r.lead_id;
      UPDATE public.retargeting_schedule
        SET is_dead = true, updated_at = now()
        WHERE id = r.id;
      v_killed := v_killed + 1;
    ELSE
      UPDATE public.retargeting_schedule
        SET attempts_done = v_new_attempts,
            phase = v_new_phase,
            next_touch_at = v_new_next,
            updated_at = now()
        WHERE id = r.id;
      v_advanced := v_advanced + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_advanced, v_killed;
END;
$function$;