
ALTER TABLE public.kob_configuration
  ADD COLUMN IF NOT EXISTS default_mode text NOT NULL DEFAULT 'AUTO' CHECK (default_mode IN ('AUTO','MANUAL')),
  ADD COLUMN IF NOT EXISTS auto_mode_killswitch boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.enqueue_gallabox_auto_fire()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template_id uuid;
  v_kill boolean;
BEGIN
  SELECT auto_mode_killswitch INTO v_kill FROM public.kob_configuration WHERE id = 1;
  IF COALESCE(v_kill, false) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_template_id
  FROM public.gallabox_templates
  WHERE active = true AND language = NEW.language
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_template_id IS NULL THEN
    SELECT id INTO v_template_id
    FROM public.gallabox_templates
    WHERE active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status)
  VALUES (NEW.id, v_template_id, 'PENDING');

  RETURN NEW;
END;
$function$;
