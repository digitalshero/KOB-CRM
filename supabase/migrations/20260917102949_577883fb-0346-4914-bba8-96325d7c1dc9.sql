
CREATE OR REPLACE FUNCTION public.apply_later_retargeting(_lead_id uuid)
RETURNS TABLE(previous_stage lead_stage, new_stage lead_stage, updated boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev lead_stage;
BEGIN
  SELECT stage INTO v_prev FROM public.kob_leads WHERE id = _lead_id FOR UPDATE;
  IF v_prev IS NULL THEN
    RETURN;
  END IF;
  IF v_prev = 'LATER'::lead_stage THEN
    previous_stage := v_prev; new_stage := v_prev; updated := false;
    RETURN NEXT;
    RETURN;
  END IF;
  PERFORM set_config('app.later_retargeting', 'on', true);
  UPDATE public.kob_leads SET stage = 'LATER'::lead_stage WHERE id = _lead_id;
  previous_stage := v_prev; new_stage := 'LATER'::lead_stage; updated := true;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_later_retargeting(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_later_retargeting(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.apply_later_retargeting(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_later_retargeting(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from lead_stage := OLD.stage;
  v_to   lead_stage := NEW.stage;
  v_uid uuid := auth.uid();
  v_is_override boolean := false;
  v_from_idx int;
  v_to_idx int;
  v_prior lead_stage;
  seq lead_stage[] := ARRAY[
    'LEAD_INBOX','AUTO_FIRED','EOI_1','WEBINAR','EOI2_PENDING','EOI_2',
    'FORM_FILLED','FEE_PAID','KTN_CS','KTN_LIVE'
  ]::lead_stage[];
  parked lead_stage[] := ARRAY[
    'NO','LATER','NO_RESPONSE','RETARGETING','DEAD_LEAD',
    'NON_SERVICEABLE','NO_VACANCY','FAILED_FIRE'
  ]::lead_stage[];
BEGIN
  IF v_from = ANY(parked) AND v_to = ANY(seq) THEN RETURN NEW; END IF;

  IF v_to IN ('NON_SERVICEABLE'::lead_stage,'NO_VACANCY'::lead_stage) THEN RETURN NEW; END IF;

  -- DEAD_LEAD is a terminal drop target: it accepts a lead from ANY stage.
  IF v_to = 'DEAD_LEAD'::lead_stage THEN RETURN NEW; END IF;

  -- Narrow exception: a confirmed later_retargeting webhook event may park a
  -- lead into LATER from ANY current stage. apply_later_retargeting() sets this
  -- transaction-local flag; all other paths keep the existing rules below.
  IF v_to = 'LATER'::lead_stage
     AND current_setting('app.later_retargeting', true) = 'on' THEN RETURN NEW; END IF;

  IF v_uid IS NOT NULL THEN
    v_is_override := public.has_role(v_uid,'kob_manager'::app_role)
                  OR public.has_role(v_uid,'super_admin'::app_role);
  END IF;
  IF v_is_override THEN RETURN NEW; END IF;

  IF v_to = 'FAILED_FIRE'::lead_stage AND v_uid IS NOT NULL THEN
    RAISE EXCEPTION 'Stage transition % -> FAILED_FIRE rejected: FAILED_FIRE is set only by the Gallabox failure webhook.', v_from;
  END IF;

  IF v_from IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage)
     AND v_to = 'RETARGETING'::lead_stage THEN RETURN NEW; END IF;

  -- Any active pipeline stage (including KTN_LIVE) may be parked.
  IF v_to IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage)
     AND (v_from = ANY(seq) OR v_from = 'FAILED_FIRE'::lead_stage) THEN RETURN NEW; END IF;

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

  -- Free movement forward and backward within the active pipeline.
  IF v_from_idx IS NOT NULL AND v_to_idx IS NOT NULL THEN RETURN NEW; END IF;

  IF (v_from = 'AUTO_FIRED'::lead_stage AND v_to = 'FAILED_FIRE'::lead_stage)
     OR (v_from = 'FAILED_FIRE'::lead_stage AND v_to = 'AUTO_FIRED'::lead_stage) THEN RETURN NEW; END IF;

  IF v_from = 'LEAD_INBOX'::lead_stage AND v_to = 'FAILED_FIRE'::lead_stage THEN RETURN NEW; END IF;

  RAISE EXCEPTION 'Stage transition % -> % rejected: violates stage order.', v_from, v_to;
END;
$$;
