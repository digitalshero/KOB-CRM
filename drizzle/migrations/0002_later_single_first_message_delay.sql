CREATE OR REPLACE FUNCTION public.send_retargeting_first_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.retargeting_schedule%ROWTYPE;
  v_source text;
  v_delay interval;
  cfg public.kob_configuration%ROWTYPE;
BEGIN
  IF NEW.stage NOT IN ('LATER'::lead_stage,'NO_RESPONSE'::lead_stage) THEN RETURN NEW; END IF;

  SELECT * INTO cfg FROM public.kob_configuration WHERE id = 1;
  IF NEW.stage = 'LATER'::lead_stage THEN
    -- Single LATER first-message delay for every source stage
    v_delay := make_interval(days => GREATEST(COALESCE(cfg.rt_later_first_msg_days, 7), 1));
  ELSE
    v_delay := make_interval(days => GREATEST(COALESCE(cfg.rt_noresp_first_msg_days, 1), 1));
  END IF;

  IF NEW.stage = 'LATER'::lead_stage AND OLD.stage = 'LEAD_INBOX'::lead_stage THEN
    v_source := 'LEAD_INBOX_LATER_7D';
  ELSIF NEW.stage = 'LATER'::lead_stage AND OLD.stage = 'EOI_1'::lead_stage THEN
    v_source := 'EOI1_LATER_7D';
  ELSIF NEW.stage = 'LATER'::lead_stage AND OLD.stage = 'WEBINAR'::lead_stage THEN
    v_source := 'WEBINAR_LATER_7D';
  ELSIF OLD.stage = 'EOI_1'::lead_stage THEN
    v_source := 'EOI_1';
  ELSIF OLD.stage IN ('LEAD_INBOX'::lead_stage,'FAILED_FIRE'::lead_stage) THEN
    v_source := 'LEAD_INBOX';
  ELSE
    RETURN NEW;
  END IF;

  SELECT * INTO r FROM public.retargeting_schedule
   WHERE lead_id = NEW.id AND is_dead = false AND bucket = NEW.stage
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF r.attempts_done > 0 THEN RETURN NEW; END IF;

  UPDATE public.retargeting_schedule
    SET first_touch_source = v_source,
        next_touch_at = r.first_touch_at + v_delay,
        updated_at = now()
    WHERE id = r.id;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'RETARGETING_FIRST_TOUCH_SCHEDULED', 'kob_leads', NEW.id,
    jsonb_build_object('bucket', NEW.stage::text, 'from', OLD.stage::text,
                       'first_touch_source', v_source,
                       'due_at', (r.first_touch_at + v_delay)));

  RETURN NEW;
END;
$$;
COMMENT ON COLUMN public.kob_configuration.rt_later_source_first_msg_days IS 'DEPRECATED: LATER now uses rt_later_first_msg_days for all source stages';