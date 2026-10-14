
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
    'LEAD_INBOX','AUTO_FIRED','EOI_1','WEBINAR','EOI_2',
    'FORM_FILLED','FEE_PAID','AGREEMENT_SIGNED','KTN_CS','KTN_LIVE'
  ]::lead_stage[];
BEGIN
  -- Terminal: no exit, ever
  IF v_from IN ('KTN_LIVE'::lead_stage,'DEAD_LEAD'::lead_stage) THEN
    RAISE EXCEPTION 'Stage transition % -> % rejected: % is terminal', v_from, v_to, v_from;
  END IF;

  -- Override role check (Manager / CEO office)
  IF v_uid IS NOT NULL THEN
    v_is_override := public.has_role(v_uid,'kob_manager'::app_role)
                  OR public.has_role(v_uid,'super_admin'::app_role);
  END IF;

  IF v_is_override THEN
    RETURN NEW;
  END IF;

  -- NO / LATER / NO_RESPONSE -> DEAD_LEAD always ok (retargeting engine path)
  IF v_from IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage)
     AND v_to = 'DEAD_LEAD'::lead_stage THEN
    RETURN NEW;
  END IF;

  -- NO / LATER / NO_RESPONSE <-> RETARGETING (system managed)
  IF v_from IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage)
     AND v_to = 'RETARGETING'::lead_stage THEN
    RETURN NEW;
  END IF;

  -- Branch-off: any active main-sequence stage (LEAD_INBOX..KTN_CS) -> NO / LATER / NO_RESPONSE
  IF v_to IN ('NO'::lead_stage,'LATER'::lead_stage,'NO_RESPONSE'::lead_stage)
     AND v_from = ANY(seq[1:9]) THEN
    RETURN NEW;
  END IF;

  -- RETARGETING recovery: back to the stage the lead was in before entering RETARGETING
  IF v_from = 'RETARGETING'::lead_stage THEN
    SELECT h.from_stage INTO v_prior
    FROM public.lead_stage_history h
    WHERE h.lead_id = NEW.id
      AND h.to_stage = 'RETARGETING'::lead_stage
    ORDER BY h.changed_at DESC
    LIMIT 1;
    IF v_prior IS NOT NULL AND v_to = v_prior THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Stage transition RETARGETING -> % rejected: recovery must return to prior stage (%).', v_to, COALESCE(v_prior::text,'unknown');
  END IF;

  -- Main sequence linear forward
  v_from_idx := array_position(seq, v_from);
  v_to_idx   := array_position(seq, v_to);

  IF v_from_idx IS NOT NULL AND v_to_idx IS NOT NULL THEN
    -- AUTO_FIRED <-> FAILED_FIRE handled below; here handle strict +1
    IF v_to_idx = v_from_idx + 1 THEN
      RETURN NEW;
    END IF;
  END IF;

  -- AUTO_FIRED <-> FAILED_FIRE (same tier 1)
  IF (v_from = 'AUTO_FIRED'::lead_stage AND v_to = 'FAILED_FIRE'::lead_stage)
     OR (v_from = 'FAILED_FIRE'::lead_stage AND v_to = 'AUTO_FIRED'::lead_stage) THEN
    RETURN NEW;
  END IF;

  -- FAILED_FIRE forward = same as AUTO_FIRED forward (-> EOI_1)
  IF v_from = 'FAILED_FIRE'::lead_stage AND v_to = 'EOI_1'::lead_stage THEN
    RETURN NEW;
  END IF;

  -- LEAD_INBOX -> FAILED_FIRE also legit (fire attempted, failed)
  IF v_from = 'LEAD_INBOX'::lead_stage AND v_to = 'FAILED_FIRE'::lead_stage THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Stage transition % -> % rejected: violates stage order.', v_from, v_to;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_stage_transition ON public.kob_leads;
CREATE TRIGGER trg_validate_stage_transition
BEFORE UPDATE ON public.kob_leads
FOR EACH ROW
WHEN (NEW.stage IS DISTINCT FROM OLD.stage)
EXECUTE FUNCTION public.validate_stage_transition();
