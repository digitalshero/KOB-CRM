
-- 1. Update rules to spec format (phases with days + attempts; null attempts = recurring)
UPDATE public.retargeting_rules SET
  cadence = '{"phases":[{"days":30,"attempts":6}]}'::jsonb,
  max_attempts = 6,
  max_period_days = 180
WHERE bucket = 'NO';

UPDATE public.retargeting_rules SET
  cadence = '{"phases":[{"days":10,"attempts":3},{"days":30,"attempts":null}]}'::jsonb,
  max_attempts = 999,
  max_period_days = 180
WHERE bucket = 'LATER';

UPDATE public.retargeting_rules SET
  cadence = '{"phases":[{"days":3,"attempts":3},{"days":10,"attempts":3},{"days":30,"attempts":null}]}'::jsonb,
  max_attempts = 999,
  max_period_days = 180
WHERE bucket = 'NO_RESPONSE';

-- 2. Auto-enroll trigger
CREATE OR REPLACE FUNCTION public.auto_enroll_retargeting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_days int;
BEGIN
  IF NEW.stage NOT IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage) THEN
    RETURN NEW;
  END IF;
  IF OLD.stage IS NOT DISTINCT FROM NEW.stage THEN
    RETURN NEW;
  END IF;
  -- Avoid duplicate active schedule
  IF EXISTS (SELECT 1 FROM public.retargeting_schedule WHERE lead_id = NEW.id AND is_dead = false) THEN
    RETURN NEW;
  END IF;

  SELECT (cadence->'phases'->0->>'days')::int INTO v_first_days
  FROM public.retargeting_rules WHERE bucket = NEW.stage::text;

  IF v_first_days IS NULL THEN v_first_days := 3; END IF;

  INSERT INTO public.retargeting_schedule
    (lead_id, bucket, phase, attempts_done, first_touch_at, next_touch_at, is_dead)
  VALUES
    (NEW.id, NEW.stage, 1, 0, now(), now() + make_interval(days => v_first_days), false);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_enroll_retargeting ON public.kob_leads;
CREATE TRIGGER trg_auto_enroll_retargeting
AFTER UPDATE OF stage ON public.kob_leads
FOR EACH ROW
EXECUTE FUNCTION public.auto_enroll_retargeting();

-- 3. Advancement engine
CREATE OR REPLACE FUNCTION public.advance_retargeting()
RETURNS TABLE(advanced int, killed int, processed int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  rule RECORD;
  v_phases jsonb;
  v_phase_count int;
  v_current jsonb;
  v_current_attempts int;
  v_current_days int;
  v_new_phase int;
  v_new_attempts int;
  v_next_days int;
  v_next jsonb;
  v_processed int := 0;
  v_advanced int := 0;
  v_killed int := 0;
  v_age_days numeric;
BEGIN
  FOR r IN
    SELECT rs.* FROM public.retargeting_schedule rs
    WHERE rs.is_dead = false AND rs.next_touch_at <= now()
  LOOP
    v_processed := v_processed + 1;

    SELECT * INTO rule FROM public.retargeting_rules WHERE bucket = r.bucket::text;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_phases := rule.cadence->'phases';
    v_phase_count := jsonb_array_length(v_phases);
    v_age_days := EXTRACT(EPOCH FROM (now() - r.first_touch_at)) / 86400.0;

    -- Kill check: aged out
    IF v_age_days > rule.max_period_days THEN
      UPDATE public.retargeting_schedule SET is_dead = true, updated_at = now() WHERE id = r.id;
      UPDATE public.kob_leads SET stage = 'DEAD_LEAD'::lead_stage WHERE id = r.lead_id;
      v_killed := v_killed + 1;
      CONTINUE;
    END IF;

    -- Kill check: NO bucket attempt-cap
    IF r.bucket = 'NO'::lead_stage AND (r.attempts_done + 1) >= rule.max_attempts THEN
      UPDATE public.retargeting_schedule
        SET is_dead = true, attempts_done = r.attempts_done + 1, updated_at = now()
        WHERE id = r.id;
      UPDATE public.kob_leads SET stage = 'DEAD_LEAD'::lead_stage WHERE id = r.lead_id;
      v_killed := v_killed + 1;
      CONTINUE;
    END IF;

    -- Determine current phase config
    v_current := v_phases->(LEAST(r.phase, v_phase_count) - 1);
    v_current_attempts := NULLIF(v_current->>'attempts','')::int;
    v_current_days := (v_current->>'days')::int;

    v_new_attempts := r.attempts_done + 1;
    v_new_phase := r.phase;
    v_next_days := v_current_days;

    -- Advance to next phase if current phase's attempt count exhausted
    IF v_current_attempts IS NOT NULL AND v_new_attempts >= v_current_attempts AND r.phase < v_phase_count THEN
      v_new_phase := r.phase + 1;
      v_new_attempts := 0;
      v_next := v_phases->(v_new_phase - 1);
      v_next_days := (v_next->>'days')::int;
    END IF;

    UPDATE public.retargeting_schedule
      SET attempts_done = v_new_attempts,
          phase = v_new_phase,
          next_touch_at = now() + make_interval(days => v_next_days),
          updated_at = now()
      WHERE id = r.id;
    v_advanced := v_advanced + 1;
  END LOOP;

  RETURN QUERY SELECT v_advanced, v_killed, v_processed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_retargeting() TO authenticated, service_role;

-- 4. Schedule hourly
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'advance-retargeting-hourly') THEN
    PERFORM cron.unschedule('advance-retargeting-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'advance-retargeting-hourly',
  '0 * * * *',
  $$ SELECT public.advance_retargeting(); $$
);
