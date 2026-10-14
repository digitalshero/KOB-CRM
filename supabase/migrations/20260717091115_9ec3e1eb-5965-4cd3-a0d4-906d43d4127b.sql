
ALTER TABLE public.gallabox_templates
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'ONBOARDING',
  ADD COLUMN IF NOT EXISTS bucket text NULL;

ALTER TABLE public.gallabox_templates
  DROP CONSTRAINT IF EXISTS gallabox_templates_bucket_check;
ALTER TABLE public.gallabox_templates
  ADD CONSTRAINT gallabox_templates_bucket_check
  CHECK (bucket IS NULL OR bucket IN ('NO','LATER','NO_RESPONSE'));

ALTER TABLE public.gallabox_templates
  DROP CONSTRAINT IF EXISTS gallabox_templates_category_check;
ALTER TABLE public.gallabox_templates
  ADD CONSTRAINT gallabox_templates_category_check
  CHECK (category IN ('ONBOARDING','RETARGETING'));

INSERT INTO public.gallabox_templates (name, body, language, active, category, bucket) VALUES
('rt_no_english', 'Hi {{1}}, thanks for hearing us out on the Shero KOB opportunity. We understand it''s not the right fit for now. If anything changes down the road, we''re just a message away. Wishing you the best. — Team Shero', 'ENGLISH', true, 'RETARGETING', 'NO'),
('rt_no_hindi', 'Namaste {{1}}, Shero KOB ke baare mein sunne ke liye dhanyavaad. Samajh sakte hain ki abhi sahi samay nahi hai. Aage kabhi vichaar badle to hum yahin hain. Shubhkaamnayein! — Team Shero', 'HINDI', true, 'RETARGETING', 'NO'),
('rt_no_tamil', 'Vanakkam {{1}}, Shero KOB pathi kekka time eduthadhukku nandri. Ippo sari illainu purinjuthu. Munnadi yaen manasu maarina, naanga ingaye irukkom. Vazhthukkal! — Team Shero', 'TAMIL', true, 'RETARGETING', 'NO'),
('rt_later_english', 'Hi {{1}}, following up as promised on the Shero KOB. Whenever you''re ready to take the next step, just reply here and we''ll pick up right where we left off. — Team Shero', 'ENGLISH', true, 'RETARGETING', 'LATER'),
('rt_later_hindi', 'Namaste {{1}}, jaisa kaha tha waise follow-up kar rahe hain Shero KOB ke liye. Jab bhi aap taiyaar ho, yahaan reply kariye — hum wahin se aage badhenge. — Team Shero', 'HINDI', true, 'RETARGETING', 'LATER'),
('rt_later_tamil', 'Vanakkam {{1}}, sonna maadhiri Shero KOB pathi follow-up pandren. Neenga ready-aana udane, inge reply pannunga — naama vitta idathula irundhu thodarlaam. — Team Shero', 'TAMIL', true, 'RETARGETING', 'LATER'),
('rt_noresp_english', 'Hi {{1}}, haven''t heard back from you on the Shero KOB. It''s a genuine chance to run your own kitchen brand with our full support. Reply YES if you''d like to know more. — Team Shero', 'ENGLISH', true, 'RETARGETING', 'NO_RESPONSE'),
('rt_noresp_hindi', 'Namaste {{1}}, aapki taraf se koi reply nahi mila Shero KOB ke baare mein. Apni kitchen brand chalane ka asli mauka hai, poori support ke saath. Aur jaanne ke liye YES bhejiye. — Team Shero', 'HINDI', true, 'RETARGETING', 'NO_RESPONSE'),
('rt_noresp_tamil', 'Vanakkam {{1}}, Shero KOB pathi ungalidhamirundhu badhil varala. Ungalodu sondha kitchen brand nadatha oru nalla vaaippu — full support kudukkurom. Innum theriya YES-nu reply pannunga. — Team Shero', 'TAMIL', true, 'RETARGETING', 'NO_RESPONSE')
ON CONFLICT (name) DO NOTHING;

DROP FUNCTION IF EXISTS public.advance_retargeting();

CREATE OR REPLACE FUNCTION public.advance_retargeting()
 RETURNS TABLE(advanced integer, killed integer, processed integer, skipped_no_template integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  rule RECORD;
  v_phases jsonb;
  v_phase_count int;
  v_current jsonb;
  v_current_attempts int;
  v_current_days int;
  v_new_phase int;
  v_new_attempts int;
  v_next_days int;
  v_next jsonb;
  v_processed int := 0;
  v_advanced int := 0;
  v_killed int := 0;
  v_skipped_no_template int := 0;
  v_age_days numeric;
  v_lead_language lead_language;
  v_template_id uuid;
BEGIN
  FOR r IN
    SELECT rs.* FROM public.retargeting_schedule rs
    WHERE rs.is_dead = false AND rs.next_touch_at <= now()
  LOOP
    v_processed := v_processed + 1;

    SELECT * INTO rule FROM public.retargeting_rules WHERE bucket = r.bucket::text;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_phases := rule.cadence->'phases';
    v_phase_count := jsonb_array_length(v_phases);
    v_age_days := EXTRACT(EPOCH FROM (now() - r.first_touch_at)) / 86400.0;

    IF v_age_days > rule.max_period_days THEN
      UPDATE public.retargeting_schedule SET is_dead = true, updated_at = now() WHERE id = r.id;
      UPDATE public.kob_leads SET stage = 'DEAD_LEAD'::lead_stage WHERE id = r.lead_id;
      v_killed := v_killed + 1;
      CONTINUE;
    END IF;

    IF r.bucket = 'NO'::lead_stage AND (r.attempts_done + 1) >= rule.max_attempts THEN
      UPDATE public.retargeting_schedule
        SET is_dead = true, attempts_done = r.attempts_done + 1, updated_at = now()
        WHERE id = r.id;
      UPDATE public.kob_leads SET stage = 'DEAD_LEAD'::lead_stage WHERE id = r.lead_id;
      v_killed := v_killed + 1;
      CONTINUE;
    END IF;

    v_current := v_phases->(LEAST(r.phase, v_phase_count) - 1);
    v_current_attempts := NULLIF(v_current->>'attempts','')::int;
    v_current_days := (v_current->>'days')::int;

    v_new_attempts := r.attempts_done + 1;
    v_new_phase := r.phase;
    v_next_days := v_current_days;

    IF v_current_attempts IS NOT NULL AND v_new_attempts >= v_current_attempts AND r.phase < v_phase_count THEN
      v_new_phase := r.phase + 1;
      v_new_attempts := 0;
      v_next := v_phases->(v_new_phase - 1);
      v_next_days := (v_next->>'days')::int;
    END IF;

    UPDATE public.retargeting_schedule
      SET attempts_done = v_new_attempts,
          phase = v_new_phase,
          next_touch_at = now() + make_interval(days => v_next_days),
          updated_at = now()
      WHERE id = r.id;
    v_advanced := v_advanced + 1;

    SELECT language INTO v_lead_language FROM public.kob_leads WHERE id = r.lead_id;

    SELECT id INTO v_template_id
    FROM public.gallabox_templates
    WHERE category = 'RETARGETING'
      AND bucket = r.bucket::text
      AND language = v_lead_language
      AND active = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_template_id IS NULL THEN
      v_skipped_no_template := v_skipped_no_template + 1;
    ELSE
      INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status)
      VALUES (r.lead_id, v_template_id, 'PENDING');
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_advanced, v_killed, v_processed, v_skipped_no_template;
END;
$function$;
