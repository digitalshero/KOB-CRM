DO $mig$
DECLARE
  d text;
  old_txt text := 'IF v_age_days > v_max_days THEN v_dead := true; END IF;';
  new_txt text := 'IF r.bucket = ''LATER''::lead_stage THEN
        IF v_age_days > COALESCE(cfg.rt_later_dead_days, v_max_days) THEN v_dead := true; END IF;
      ELSE
        IF v_age_days > COALESCE(cfg.rt_noresp_dead_days, v_max_days) THEN v_dead := true; END IF;
      END IF;';
BEGIN
  d := pg_get_functiondef('public.process_retargeting_sends()'::regprocedure);
  IF position(old_txt in d) = 0 THEN
    RAISE EXCEPTION 'expected Dead Lead check not found in process_retargeting_sends';
  END IF;
  d := replace(d, old_txt, new_txt);
  EXECUTE d;
END
$mig$;