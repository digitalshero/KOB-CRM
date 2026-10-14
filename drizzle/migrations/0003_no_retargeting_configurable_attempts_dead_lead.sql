ALTER TABLE public.kob_configuration
  ADD COLUMN IF NOT EXISTS rt_no_dead_mode text NOT NULL DEFAULT 'DAYS',
  ADD COLUMN IF NOT EXISTS rt_no_dead_days integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS rt_no_dead_attempts integer NOT NULL DEFAULT 1;
ALTER TABLE public.kob_configuration
  ADD CONSTRAINT kob_configuration_rt_no_dead_mode_chk CHECK (rt_no_dead_mode IN ('DAYS','ATTEMPTS'));

DO $mig$
DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.process_retargeting_sends()'::regprocedure);
  o := d;

  d := replace(d,
'      IF r.attempts_done >= COALESCE(cfg.rt_no_attempts, 6) THEN v_dead := true; END IF;',
'      IF COALESCE(cfg.rt_no_dead_mode, ''DAYS'') = ''ATTEMPTS'' THEN
        IF r.attempts_done >= COALESCE(cfg.rt_no_dead_attempts, 1) THEN v_dead := true; END IF;
      ELSE
        IF v_age_days > COALESCE(cfg.rt_no_dead_days, 180) THEN v_dead := true; END IF;
      END IF;');
  IF d = o THEN RAISE EXCEPTION 'NO dead check not found'; END IF;
  o := d;

  d := replace(d,
'      v_killed := v_killed + 1;
      CONTINUE;
    END IF;',
'      v_killed := v_killed + 1;
      CONTINUE;
    END IF;

    -- NO: max successful attempts reached -> stop messaging, keep lead in NO.
    IF r.bucket = ''NO''::lead_stage AND r.attempts_done >= COALESCE(cfg.rt_no_attempts, 1) THEN
      UPDATE public.retargeting_schedule
        SET next_touch_at = now() + make_interval(days => GREATEST(COALESCE(cfg.rt_no_days, 30), 1)),
            updated_at = now()
        WHERE id = r.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;');
  IF d = o THEN RAISE EXCEPTION 'dead block end not found'; END IF;
  o := d;

  d := replace(d,
'    IF r.bucket = ''NO''::lead_stage AND r.attempts_done = 0 THEN',
'    IF r.bucket = ''NO''::lead_stage THEN');
  IF d = o THEN RAISE EXCEPTION 'NO template restriction not found'; END IF;
  o := d;

  d := replace(d,
'''reason'', ''invalid phone'', ''attempt_no'', r.attempts_done + 1));
      v_skipped := v_skipped + 1;',
'''reason'', ''invalid phone'', ''attempt_no'', r.attempts_done + 1));
      v_skipped := v_skipped + 1;
      -- NO: failed sends do not count as an attempt.
      IF r.bucket = ''NO''::lead_stage THEN
        UPDATE public.retargeting_schedule
          SET next_touch_at = now() + make_interval(days => GREATEST(COALESCE(cfg.rt_no_days, 30), 1)),
              updated_at = now()
          WHERE id = r.id;
        CONTINUE;
      END IF;');
  IF d = o THEN RAISE EXCEPTION 'invalid phone branch not found'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.advance_retargeting_schedule()'::regprocedure);
  o := d;
  d := replace(d,
'    IF r.bucket = ''NO''::lead_stage THEN
      IF r.attempts_done + 1 > cfg.rt_no_attempts THEN',
'    IF r.bucket = ''NO''::lead_stage THEN
      -- NO is fully handled by process_retargeting_sends.
      CONTINUE;
      IF r.attempts_done + 1 > cfg.rt_no_attempts THEN');
  IF d = o THEN RAISE EXCEPTION 'advance NO branch not found'; END IF;
  EXECUTE d;
END
$mig$;

COMMENT ON COLUMN public.kob_configuration.rt_no_attempts IS 'NO: maximum successful retargeting sends while lead stays in NO';