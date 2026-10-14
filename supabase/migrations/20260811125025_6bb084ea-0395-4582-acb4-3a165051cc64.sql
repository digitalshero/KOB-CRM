CREATE OR REPLACE FUNCTION public.lead_has_any_message(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.gallabox_fire_queue q WHERE q.lead_id = _lead_id AND q.status IN ('FIRED', 'SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.email_fire_queue e WHERE e.lead_id = _lead_id AND e.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.retargeting_attempts r WHERE r.lead_id = _lead_id AND r.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.lead_events ev WHERE ev.lead_id = _lead_id)
      OR EXISTS (SELECT 1 FROM public.lead_inbox_retarget_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.lead_eoi1_retarget_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.lead_eoi1_retarget_telugu_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.lead_eoi1_retarget_malayalam_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.lead_webinar_retarget_tamil_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.lead_webinar_retarget_telugu_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.lead_webinar_retarget_malayalam_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.website_form_tamil_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.website_form_telugu_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (SELECT 1 FROM public.website_form_malayalam_sends s WHERE s.lead_id = _lead_id AND s.status IN ('SENT', 'DELIVERED', 'SUCCESS'))
      OR EXISTS (
        SELECT 1
        FROM public.kob_leads k
        JOIN public.audit_logs a
          ON a.action = 'TEMPLATE_STAGE_WEBHOOK'
         AND right(regexp_replace(coalesce(a.meta->>'phone', ''), '\D', '', 'g'), 10)
             = right(regexp_replace(coalesce(k.phone, ''), '\D', '', 'g'), 10)
        WHERE k.id = _lead_id
          AND length(right(regexp_replace(coalesce(k.phone, ''), '\D', '', 'g'), 10)) >= 6
          AND lower(coalesce(a.meta->>'status', '')) IN ('sent', 'delivered', 'delivered_successfully', 'read', 'success')
      );
$function$;

WITH restored AS (
  UPDATE public.kob_leads k
  SET stage = 'AUTO_FIRED'::public.lead_stage
  WHERE k.stage = 'FAILED_FIRE'::public.lead_stage
    AND public.lead_has_any_message(k.id)
  RETURNING k.id
)
INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
SELECT NULL, 'AUTO_RESTORE_MESSAGED_FAILED_FIRE', 'kob_leads', id,
       jsonb_build_object('from_stage', 'FAILED_FIRE', 'to_stage', 'AUTO_FIRED', 'reason', 'message evidence found after failed-fire classification')
FROM restored;