
-- 1. attempts table
CREATE TABLE public.retargeting_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.retargeting_schedule(id) ON DELETE SET NULL,
  bucket lead_stage NOT NULL,
  attempt_no integer NOT NULL DEFAULT 1,
  template_name text NOT NULL,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'PENDING',
  request_id bigint,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rt_attempts_lead ON public.retargeting_attempts(lead_id);
CREATE INDEX idx_rt_attempts_status ON public.retargeting_attempts(status);

GRANT SELECT ON public.retargeting_attempts TO authenticated;
GRANT ALL ON public.retargeting_attempts TO service_role;
ALTER TABLE public.retargeting_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view retargeting attempts"
  ON public.retargeting_attempts FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_rt_attempts_touch BEFORE UPDATE ON public.retargeting_attempts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. integration settings (system only)
CREATE TABLE public.integration_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.integration_settings TO service_role;
ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;

-- 3. enrolment trigger driven by kob_configuration
CREATE OR REPLACE FUNCTION public.auto_enroll_retargeting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- never duplicate: an active schedule already exists
  IF EXISTS (SELECT 1 FROM public.retargeting_schedule
             WHERE lead_id = NEW.id AND is_dead = false AND bucket = NEW.stage) THEN
    RETURN NEW;
  END IF;

  -- bucket changed: retire the old active schedule
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
  VALUES (NEW.id, NEW.stage, 1, 0, now(), now(), false);

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'RETARGETING_ENROLLED', 'kob_leads', NEW.id,
    jsonb_build_object('bucket', NEW.stage::text, 'first_interval_days', v_first_days));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_enroll_retargeting ON public.kob_leads;
CREATE TRIGGER trg_auto_enroll_retargeting
  AFTER UPDATE OF stage ON public.kob_leads
  FOR EACH ROW EXECUTE FUNCTION public.auto_enroll_retargeting();

-- 4. cancel when lead leaves retargeting
CREATE OR REPLACE FUNCTION public.cancel_retargeting_on_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_cancelled int := 0;
BEGIN
  IF OLD.stage IS NOT DISTINCT FROM NEW.stage THEN RETURN NEW; END IF;
  IF OLD.stage NOT IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage,'RETARGETING'::lead_stage) THEN
    RETURN NEW;
  END IF;
  IF NEW.stage IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage,'RETARGETING'::lead_stage) THEN
    RETURN NEW;
  END IF;

  UPDATE public.retargeting_schedule
    SET is_dead = true, updated_at = now()
    WHERE lead_id = NEW.id AND is_dead = false;

  WITH c AS (
    UPDATE public.retargeting_attempts
      SET status = 'CANCELLED',
          error = 'lead left retargeting: ' || OLD.stage::text || ' -> ' || NEW.stage::text,
          updated_at = now()
      WHERE lead_id = NEW.id AND status = 'PENDING'
      RETURNING 1
  ) SELECT count(*) INTO v_cancelled FROM c;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'RETARGETING_CANCELLED', 'kob_leads', NEW.id,
    jsonb_build_object('from', OLD.stage::text, 'to', NEW.stage::text, 'cancelled_pending', v_cancelled));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_retargeting_on_exit ON public.kob_leads;
CREATE TRIGGER trg_cancel_retargeting_on_exit
  AFTER UPDATE OF stage ON public.kob_leads
  FOR EACH ROW EXECUTE FUNCTION public.cancel_retargeting_on_exit();

-- 5. sender / advancer
CREATE OR REPLACE FUNCTION public.process_retargeting_sends()
RETURNS TABLE(processed integer, sent integer, killed integer, skipped integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
DECLARE
  cfg public.kob_configuration%ROWTYPE;
  r RECORD;
  v_api_key text; v_api_secret text; v_channel text; v_template text; v_media_url text; v_media_name text;
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

  IF v_api_key IS NULL OR v_api_secret IS NULL THEN
    RETURN QUERY SELECT 0,0,0,0; RETURN;
  END IF;

  FOR r IN
    SELECT rs.*, l.full_name, l.phone, l.stage AS lead_stage
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

    -- stop conditions
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

    -- phone normalisation
    v_digits := regexp_replace(COALESCE(r.phone,''), '\D', '', 'g');
    IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
    ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
    ELSE v_phone := NULL; END IF;

    INSERT INTO public.retargeting_attempts(lead_id, schedule_id, bucket, attempt_no, template_name, scheduled_for, status)
    VALUES (r.lead_id, r.id, r.bucket, r.attempts_done + 1, v_template, r.next_touch_at, 'PENDING')
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
          'apiKey', v_api_key,
          'apiSecret', v_api_secret
        ),
        body := jsonb_build_object(
          'channelId', v_channel,
          'channelType', 'whatsapp',
          'recipient', jsonb_build_object('name', COALESCE(r.full_name, 'Customer'), 'phone', v_phone),
          'whatsapp', jsonb_build_object(
            'type', 'template',
            'template', jsonb_build_object(
              'templateName', v_template,
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
                           'template', v_template, 'phone', v_phone, 'request_id', v_request_id));
      v_sent := v_sent + 1;
    END IF;

    -- advance schedule using live configuration
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

    ELSE -- NO_RESPONSE / RETARGETING
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
$$;

REVOKE ALL ON FUNCTION public.process_retargeting_sends() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_retargeting_sends() TO service_role;
