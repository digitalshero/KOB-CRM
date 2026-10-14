
ALTER TABLE public.webinar_attendance ADD COLUMN IF NOT EXISTS defaulter_marked_at timestamptz;

ALTER TABLE public.gallabox_templates DROP CONSTRAINT IF EXISTS gallabox_templates_category_check;
ALTER TABLE public.gallabox_templates ADD CONSTRAINT gallabox_templates_category_check
  CHECK (category = ANY (ARRAY['ONBOARDING'::text, 'RETARGETING'::text, 'WEBINAR_DEFAULTER'::text]));

CREATE OR REPLACE FUNCTION public.mark_webinar_defaulters()
RETURNS TABLE(marked int, skipped_no_template int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_template_id uuid;
  v_lead_lang lead_language;
  v_marked int := 0;
  v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT wa.id AS attendance_id, wa.lead_id
    FROM public.webinar_attendance wa
    JOIN public.webinar_batches wb ON wb.id = wa.batch_id
    WHERE wa.attended = false
      AND wa.defaulter_marked_at IS NULL
      AND wb.scheduled_at <= now()
  LOOP
    UPDATE public.webinar_attendance SET defaulter_marked_at = now() WHERE id = r.attendance_id;
    v_marked := v_marked + 1;

    SELECT language INTO v_lead_lang FROM public.kob_leads WHERE id = r.lead_id;

    SELECT id INTO v_template_id
    FROM public.gallabox_templates
    WHERE category = 'WEBINAR_DEFAULTER'
      AND language = v_lead_lang
      AND active = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_template_id IS NULL THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status)
      VALUES (r.lead_id, v_template_id, 'PENDING');
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_marked, v_skipped;
END;
$$;
