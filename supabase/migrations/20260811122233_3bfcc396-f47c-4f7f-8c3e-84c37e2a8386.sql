CREATE OR REPLACE FUNCTION public.mark_failed_fire_leads(_grace_hours integer DEFAULT 2)
RETURNS TABLE(processed integer, moved integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  l RECORD;
  v_processed int := 0;
  v_moved int := 0;
BEGIN
  FOR l IN
    SELECT k.id, k.stage
    FROM public.kob_leads k
    WHERE k.stage IN ('LEAD_INBOX'::lead_stage, 'AUTO_FIRED'::lead_stage)
      AND k.created_at <= now() - make_interval(hours => GREATEST(_grace_hours, 0))
      AND NOT EXISTS (SELECT 1 FROM public.gallabox_fire_queue q WHERE q.lead_id = k.id AND q.status = 'FIRED')
      AND NOT EXISTS (SELECT 1 FROM public.email_fire_queue e WHERE e.lead_id = k.id AND e.status = 'SENT')
      AND NOT EXISTS (SELECT 1 FROM public.retargeting_attempts r WHERE r.lead_id = k.id AND r.status = 'SENT')
      AND NOT EXISTS (SELECT 1 FROM public.lead_events ev WHERE ev.lead_id = k.id)
    ORDER BY k.created_at ASC
    LIMIT 500
  LOOP
    v_processed := v_processed + 1;
    BEGIN
      UPDATE public.kob_leads
      SET stage = 'FAILED_FIRE'::lead_stage
      WHERE id = l.id;

      INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
      VALUES (NULL, 'AUTO_MARK_FAILED_FIRE', 'kob_leads', l.id,
        jsonb_build_object('from_stage', l.stage, 'reason', 'no outbound message triggered'));

      v_moved := v_moved + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_moved;
END;
$function$;

SELECT cron.schedule('mark-failed-fire-hourly', '45 * * * *', $$SELECT public.mark_failed_fire_leads(2);$$);