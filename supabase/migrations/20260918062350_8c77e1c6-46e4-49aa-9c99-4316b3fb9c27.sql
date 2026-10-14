
-- 1) Duplicate detection at insert time (runs before all other insert triggers)
CREATE OR REPLACE FUNCTION public.mark_duplicate_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tail text;
  v_exists boolean;
BEGIN
  v_tail := right(regexp_replace(COALESCE(NEW.phone,''), '\D', '', 'g'), 10);
  IF length(v_tail) < 10 THEN RETURN NEW; END IF;
  IF NEW.stage = 'DUPLICATE_LEAD'::lead_stage THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.kob_leads kl
    WHERE kl.id <> NEW.id
      AND right(regexp_replace(COALESCE(kl.phone,''), '\D', '', 'g'), 10) = v_tail
  ) INTO v_exists;

  IF v_exists THEN
    NEW.stage := 'DUPLICATE_LEAD'::lead_stage;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_a_mark_duplicate_lead ON public.kob_leads;
CREATE TRIGGER trg_a_mark_duplicate_lead
  BEFORE INSERT ON public.kob_leads
  FOR EACH ROW EXECUTE FUNCTION public.mark_duplicate_lead();

-- 2) Keep duplicates out of every initial-template trigger (function bodies unchanged)
DROP TRIGGER IF EXISTS trg_send_meta_ads_initial_template ON public.kob_leads;
CREATE TRIGGER trg_send_meta_ads_initial_template AFTER INSERT ON public.kob_leads
  FOR EACH ROW WHEN (new.stage <> 'DUPLICATE_LEAD'::lead_stage)
  EXECUTE FUNCTION public.send_meta_ads_initial_template();

DROP TRIGGER IF EXISTS trg_send_support_lead_template ON public.kob_leads;
CREATE TRIGGER trg_send_support_lead_template AFTER INSERT ON public.kob_leads
  FOR EACH ROW WHEN (new.stage <> 'DUPLICATE_LEAD'::lead_stage)
  EXECUTE FUNCTION public.send_support_lead_template();

DROP TRIGGER IF EXISTS trg_send_whatsapp_broadcast_initial_template ON public.kob_leads;
CREATE TRIGGER trg_send_whatsapp_broadcast_initial_template AFTER INSERT ON public.kob_leads
  FOR EACH ROW WHEN (new.stage <> 'DUPLICATE_LEAD'::lead_stage)
  EXECUTE FUNCTION public.send_whatsapp_broadcast_initial_template();

DROP TRIGGER IF EXISTS trg_send_website_form_default_template ON public.kob_leads;
CREATE TRIGGER trg_send_website_form_default_template AFTER INSERT ON public.kob_leads
  FOR EACH ROW WHEN (new.stage <> 'DUPLICATE_LEAD'::lead_stage)
  EXECUTE FUNCTION public.send_website_form_default_template();

DROP TRIGGER IF EXISTS trg_send_website_form_tamil_template ON public.kob_leads;
CREATE TRIGGER trg_send_website_form_tamil_template AFTER INSERT ON public.kob_leads
  FOR EACH ROW WHEN (new.stage <> 'DUPLICATE_LEAD'::lead_stage)
  EXECUTE FUNCTION public.send_website_form_tamil_template();

DROP TRIGGER IF EXISTS trg_send_website_form_telugu_template ON public.kob_leads;
CREATE TRIGGER trg_send_website_form_telugu_template AFTER INSERT ON public.kob_leads
  FOR EACH ROW WHEN (new.stage <> 'DUPLICATE_LEAD'::lead_stage)
  EXECUTE FUNCTION public.send_website_form_telugu_template();

DROP TRIGGER IF EXISTS trg_send_website_form_malayalam_template ON public.kob_leads;
CREATE TRIGGER trg_send_website_form_malayalam_template AFTER INSERT ON public.kob_leads
  FOR EACH ROW WHEN (new.stage <> 'DUPLICATE_LEAD'::lead_stage)
  EXECUTE FUNCTION public.send_website_form_malayalam_template();

-- 3) Stage-order validation: allow moving OUT of DUPLICATE_LEAD, never INTO it by update
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
  -- DUPLICATE_LEAD is set only at lead creation; it can be left, never entered.
  IF v_to = 'DUPLICATE_LEAD'::lead_stage THEN
    RAISE EXCEPTION 'Stage transition % -> DUPLICATE_LEAD rejected: the duplicate stage is set only when a lead is created.', v_from;
  END IF;
  IF v_from = 'DUPLICATE_LEAD'::lead_stage THEN RETURN NEW; END IF;

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
