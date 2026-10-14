CREATE OR REPLACE FUNCTION public.move_webinar_48h_to_no_response()
 RETURNS TABLE(moved integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_moved int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.kob_leads k
    SET stage = 'NO_RESPONSE'::lead_stage
    WHERE k.stage = 'WEBINAR'::lead_stage
      AND EXISTS (
        SELECT 1 FROM public.lead_webinar_retarget_tamil_sends s
        WHERE s.lead_id = k.id AND s.stage_entered_at = k.stage_entered_at
          AND s.status = 'SENT' AND s.sent_at IS NOT NULL
          AND s.sent_at < now() - interval '24 hours'
        UNION ALL
        SELECT 1 FROM public.lead_webinar_retarget_telugu_sends s
        WHERE s.lead_id = k.id AND s.stage_entered_at = k.stage_entered_at
          AND s.status = 'SENT' AND s.sent_at IS NOT NULL
          AND s.sent_at < now() - interval '24 hours'
        UNION ALL
        SELECT 1 FROM public.lead_webinar_retarget_malayalam_sends s
        WHERE s.lead_id = k.id AND s.stage_entered_at = k.stage_entered_at
          AND s.status = 'SENT' AND s.sent_at IS NOT NULL
          AND s.sent_at < now() - interval '24 hours'
      )
    RETURNING k.id
  )
  SELECT count(*) INTO v_moved FROM upd;
  RETURN QUERY SELECT v_moved;
END;
$function$;