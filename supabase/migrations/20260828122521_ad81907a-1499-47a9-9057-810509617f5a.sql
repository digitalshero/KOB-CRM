-- 1) Retime the three EOI_1 retarget senders from 7 days to 24 hours (bodies otherwise unchanged)
DO $mig$
DECLARE f text; d text;
BEGIN
  FOREACH f IN ARRAY ARRAY['send_eoi1_7day_retargeting','send_eoi1_7day_retargeting_telugu','send_eoi1_7day_retargeting_malayalam']
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = f;
    IF d IS NULL THEN CONTINUE; END IF;
    d := replace(d, 'interval ''7 days''', 'interval ''24 hours''');
    EXECUTE d;
  END LOOP;
END
$mig$;

-- 2) Auto-move leads stuck in EOI_1 for 48 continuous hours to NO_RESPONSE
CREATE OR REPLACE FUNCTION public.move_eoi1_48h_to_no_response()
RETURNS TABLE(moved integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_moved int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.kob_leads k
    SET stage = 'NO_RESPONSE'::lead_stage
    WHERE k.stage = 'EOI_1'::lead_stage
      AND k.stage_entered_at < now() - interval '48 hours'
    RETURNING k.id
  )
  SELECT count(*) INTO v_moved FROM upd;
  RETURN QUERY SELECT v_moved;
END;
$$;

SELECT cron.schedule('eoi1-48h-to-no-response', '45 * * * *', $$SELECT public.move_eoi1_48h_to_no_response();$$);
