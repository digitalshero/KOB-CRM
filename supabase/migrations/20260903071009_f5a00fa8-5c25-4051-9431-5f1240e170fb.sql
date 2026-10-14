CREATE OR REPLACE FUNCTION public.send_retargeting_first_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.retargeting_schedule%ROWTYPE;
BEGIN
  IF OLD.stage IS DISTINCT FROM 'EOI_1'::lead_stage THEN RETURN NEW; END IF;
  -- NO must never trigger the EOI 1 abandoned sequence.
  IF NEW.stage NOT IN ('LATER'::lead_stage,'NO_RESPONSE'::lead_stage) THEN RETURN NEW; END IF;

  SELECT * INTO r FROM public.retargeting_schedule
   WHERE lead_id = NEW.id AND is_dead = false AND bucket = NEW.stage
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF r.attempts_done > 0 THEN RETURN NEW; END IF;

  -- First touch is 24 hours after entering NO_RESPONSE / LATER (was 7 days).
  UPDATE public.retargeting_schedule
    SET first_touch_source = 'EOI_1',
        next_touch_at = r.first_touch_at + interval '24 hours',
        updated_at = now()
    WHERE id = r.id;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'RETARGETING_FIRST_TOUCH_SCHEDULED', 'kob_leads', NEW.id,
    jsonb_build_object('bucket', NEW.stage::text, 'from', OLD.stage::text,
                       'due_at', (r.first_touch_at + interval '24 hours')));

  RETURN NEW;
END;
$function$;