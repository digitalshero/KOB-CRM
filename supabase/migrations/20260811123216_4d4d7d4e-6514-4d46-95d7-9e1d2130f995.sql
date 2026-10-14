CREATE OR REPLACE FUNCTION public.validate_stage_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from lead_stage := OLD.stage;
  v_to   lead_stage := NEW.stage;
  v_uid uuid := auth.uid();
  v_is_override boolean := false;
  v_from_idx int;
  v_to_idx int;
  v_prior lead_stage;
  seq lead_stage[] := ARRAY[
    'LEAD_INBOX','AUTO_FIRED','EOI_1','WEBINAR','EOI_2',
    'FORM_FILLED','FEE_PAID','KTN_CS','KTN_LIVE'
  ]::lead_stage[];
BEGIN
  IF v_from IN ('KTN_LIVE'::lead_stage,'DEAD_LEAD'::lead_stage,'NON_SERVICEABLE'::lead_stage,'NO_VACANCY'::lead_stage) THEN
    RAISE EXCEPTION 'Stage transition % -> % rejected: % is terminal', v_from, v_to, v_from;
  END IF;

  IF v_to IN ('NON_SERVICEABLE'::lead_stage,'NO_VACANCY'::lead_stage) THEN RETURN NEW; END IF;

  IF v_uid IS NOT NULL THEN
    v_is_override := public.has_role(v_uid,'kob_manager'::app_role)
                  OR public.has_role(v_uid,'super_admin'::app_role);
  END IF;
  IF v_is_override THEN RETURN NEW; END IF;

  IF v_from IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage)
     AND v_to = 'DEAD_LEAD'::lead_stage THEN RETURN NEW; END IF;

  IF v_from IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage)
     AND v_to = 'RETARGETING'::lead_stage THEN RETURN NEW; END IF;

  IF v_to IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage)
     AND (v_from = ANY(seq[1:8]) OR v_from = 'FAILED_FIRE'::lead_stage) THEN RETURN NEW; END IF;

  IF v_from = 'RETARGETING'::lead_stage THEN
    SELECT h.from_stage INTO v_prior
    FROM public.lead_stage_history h
    WHERE h.lead_id = NEW.id AND h.to_stage = 'RETARGETING'::lead_stage
    ORDER BY h.changed_at DESC LIMIT 1;
    IF v_prior IS NOT NULL AND v_to = v_prior THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Stage transition RETARGETING -> % rejected: recovery must return to prior stage (%).', v_to, COALESCE(v_prior::text,'unknown');
  END IF;

  v_from_idx := array_position(seq, v_from);
  v_to_idx   := array_position(seq, v_to);

  IF v_from_idx IS NOT NULL AND v_to_idx IS NOT NULL THEN
    IF abs(v_to_idx - v_from_idx) = 1 THEN RETURN NEW; END IF;
  END IF;

  IF (v_from = 'AUTO_FIRED'::lead_stage AND v_to = 'FAILED_FIRE'::lead_stage)
     OR (v_from = 'FAILED_FIRE'::lead_stage AND v_to = 'AUTO_FIRED'::lead_stage) THEN RETURN NEW; END IF;

  IF v_from = 'FAILED_FIRE'::lead_stage AND v_to = 'EOI_1'::lead_stage THEN RETURN NEW; END IF;
  IF v_from = 'FAILED_FIRE'::lead_stage AND v_to = 'LEAD_INBOX'::lead_stage THEN RETURN NEW; END IF;
  IF v_from = 'LEAD_INBOX'::lead_stage AND v_to = 'FAILED_FIRE'::lead_stage THEN RETURN NEW; END IF;

  RAISE EXCEPTION 'Stage transition % -> % rejected: violates stage order.', v_from, v_to;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lead_has_any_message(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.gallabox_fire_queue q WHERE q.lead_id = _lead_id AND q.status = 'FIRED')
      OR EXISTS (SELECT 1 FROM public.email_fire_queue e WHERE e.lead_id = _lead_id AND e.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.retargeting_attempts r WHERE r.lead_id = _lead_id AND r.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.lead_events ev WHERE ev.lead_id = _lead_id)
      OR EXISTS (SELECT 1 FROM public.lead_inbox_retarget_sends s WHERE s.lead_id = _lead_id AND s.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.lead_eoi1_retarget_sends s WHERE s.lead_id = _lead_id AND s.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.lead_eoi1_retarget_telugu_sends s WHERE s.lead_id = _lead_id AND s.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.lead_eoi1_retarget_malayalam_sends s WHERE s.lead_id = _lead_id AND s.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.lead_webinar_retarget_tamil_sends s WHERE s.lead_id = _lead_id AND s.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.lead_webinar_retarget_telugu_sends s WHERE s.lead_id = _lead_id AND s.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.lead_webinar_retarget_malayalam_sends s WHERE s.lead_id = _lead_id AND s.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.website_form_tamil_sends s WHERE s.lead_id = _lead_id AND s.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.website_form_telugu_sends s WHERE s.lead_id = _lead_id AND s.status = 'SENT')
      OR EXISTS (SELECT 1 FROM public.website_form_malayalam_sends s WHERE s.lead_id = _lead_id AND s.status = 'SENT');
$function$;

REVOKE EXECUTE ON FUNCTION public.lead_has_any_message(uuid) FROM anon;

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
      AND NOT public.lead_has_any_message(k.id)
    ORDER BY k.created_at ASC
    LIMIT 500
  LOOP
    v_processed := v_processed + 1;
    BEGIN
      UPDATE public.kob_leads SET stage = 'FAILED_FIRE'::lead_stage WHERE id = l.id;
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