CREATE OR REPLACE FUNCTION public.send_webinar_retargeting_first_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.retargeting_schedule%ROWTYPE;
  v_suffix text;
BEGIN
  IF OLD.stage IS DISTINCT FROM 'WEBINAR'::lead_stage THEN RETURN NEW; END IF;
  -- Only LATER / NO_RESPONSE get the webinar-abandoned first touch; NO is excluded.
  IF NEW.stage NOT IN ('LATER'::lead_stage,'NO_RESPONSE'::lead_stage) THEN RETURN NEW; END IF;

  v_suffix := CASE NEW.language
    WHEN 'TAMIL'::lead_language THEN 'tamil'
    WHEN 'TELUGU'::lead_language THEN 'telugu'
    WHEN 'MALAYALAM'::lead_language THEN 'malayalam'
    ELSE NULL
  END;
  IF v_suffix IS NULL THEN
    INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
    VALUES (auth.uid(), 'WEBINAR_RETARGETING_IMMEDIATE_SKIPPED', 'kob_leads', NEW.id,
      jsonb_build_object('reason','unsupported language','to_stage', NEW.stage::text));
    RETURN NEW;
  END IF;

  SELECT * INTO r FROM public.retargeting_schedule
   WHERE lead_id = NEW.id AND is_dead = false AND bucket = NEW.stage
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF r.attempts_done > 0 THEN RETURN NEW; END IF;

  UPDATE public.retargeting_schedule
    SET first_touch_source = 'WEBINAR',
        next_touch_at = r.first_touch_at + interval '24 hours',
        updated_at = now()
    WHERE id = r.id;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'WEBINAR_RETARGETING_FIRST_TOUCH_SCHEDULED', 'kob_leads', NEW.id,
    jsonb_build_object('bucket', NEW.stage::text, 'from', OLD.stage::text,
                       'language', NEW.language::text,
                       'due_at', (r.first_touch_at + interval '24 hours')));

  RETURN NEW;
END;
$function$;