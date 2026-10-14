
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

ALTER TABLE public.retargeting_schedule
  ADD COLUMN IF NOT EXISTS first_touch_at timestamptz NOT NULL DEFAULT now();

UPDATE public.retargeting_schedule
  SET first_touch_at = created_at
  WHERE first_touch_at > created_at;

CREATE OR REPLACE FUNCTION public.advance_retargeting_schedule()
RETURNS TABLE(processed int, advanced int, killed int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        IF v_age_days > 180 THEN
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
        IF v_age_days > 180 THEN
          v_dead := true;
        ELSE
          v_new_attempts := r.attempts_done + 1;
          v_new_next := now() + make_interval(days => cfg.rt_noresp_final_days);
        END IF;
      END IF;

    ELSE
      -- RETARGETING bucket without a specific rule set: skip
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
$$;

GRANT EXECUTE ON FUNCTION public.advance_retargeting_schedule() TO authenticated, service_role;

-- Schedule daily at 21:00 UTC (03:00 IST)
DO $$
BEGIN
  PERFORM cron.unschedule('retargeting-advancer')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retargeting-advancer');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('retargeting-advancer', '0 21 * * *', $$SELECT public.advance_retargeting_schedule();$$);
