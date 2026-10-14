
-- 1) email_fire_queue table
CREATE TABLE IF NOT EXISTS public.email_fire_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.gallabox_templates(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_fire_queue TO authenticated;
GRANT ALL ON public.email_fire_queue TO service_role;

ALTER TABLE public.email_fire_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_fire_queue managers read"
  ON public.email_fire_queue FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'kob_manager'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_email_fire_queue_status ON public.email_fire_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_email_fire_queue_lead ON public.email_fire_queue(lead_id);

-- Helper: simple {{lead_name}} substitution
CREATE OR REPLACE FUNCTION public.render_email_text(_text text, _lead_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(replace(COALESCE(_text,''), '{{lead_name}}', COALESCE(_lead_name,'')), '{{name}}', COALESCE(_lead_name,''));
$$;

-- 2) Rewrite the 3 queueing functions to insert into email_fire_queue instead of gallabox_fire_queue(channel='EMAIL')

CREATE OR REPLACE FUNCTION public.enqueue_gallabox_auto_fire()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template_id uuid;
  v_kill boolean;
  v_email_subject text;
  v_email_body text;
  v_lead_email text;
  v_lead_name text;
BEGIN
  SELECT auto_mode_killswitch INTO v_kill FROM public.kob_configuration WHERE id = 1;
  IF COALESCE(v_kill, false) THEN
    RETURN NEW;
  END IF;

  SELECT id, email_subject, email_body
    INTO v_template_id, v_email_subject, v_email_body
  FROM public.gallabox_templates
  WHERE active = true AND language = NEW.language
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_template_id IS NULL THEN
    SELECT id, email_subject, email_body
      INTO v_template_id, v_email_subject, v_email_body
    FROM public.gallabox_templates
    WHERE active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status, channel)
  VALUES (NEW.id, v_template_id, 'PENDING', 'WHATSAPP');

  v_lead_email := NEW.email;
  v_lead_name := NEW.full_name;
  IF v_template_id IS NOT NULL
     AND v_email_subject IS NOT NULL AND btrim(v_email_subject) <> ''
     AND v_email_body IS NOT NULL AND btrim(v_email_body) <> ''
     AND v_lead_email IS NOT NULL AND btrim(v_lead_email) <> '' THEN
    INSERT INTO public.email_fire_queue(lead_id, template_id, to_email, subject, body, status)
    VALUES (
      NEW.id, v_template_id, v_lead_email,
      public.render_email_text(v_email_subject, v_lead_name),
      public.render_email_text(v_email_body, v_lead_name),
      'PENDING'
    );
  END IF;

  RETURN NEW;
END;
$function$;

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
  v_lead_email text;
  v_lead_name text;
  v_template_id uuid;
  v_email_subject text;
  v_email_body text;
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

    SELECT language, email, full_name INTO v_lead_language, v_lead_email, v_lead_name
    FROM public.kob_leads WHERE id = r.lead_id;

    SELECT id, email_subject, email_body
      INTO v_template_id, v_email_subject, v_email_body
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
      INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status, channel)
      VALUES (r.lead_id, v_template_id, 'PENDING', 'WHATSAPP');

      IF v_email_subject IS NOT NULL AND btrim(v_email_subject) <> ''
         AND v_email_body IS NOT NULL AND btrim(v_email_body) <> ''
         AND v_lead_email IS NOT NULL AND btrim(v_lead_email) <> '' THEN
        INSERT INTO public.email_fire_queue(lead_id, template_id, to_email, subject, body, status)
        VALUES (
          r.lead_id, v_template_id, v_lead_email,
          public.render_email_text(v_email_subject, v_lead_name),
          public.render_email_text(v_email_body, v_lead_name),
          'PENDING'
        );
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_advanced, v_killed, v_processed, v_skipped_no_template;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_webinar_defaulters()
 RETURNS TABLE(marked integer, skipped_no_template integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_template_id uuid;
  v_email_subject text;
  v_email_body text;
  v_lead_lang lead_language;
  v_lead_email text;
  v_lead_name text;
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

    SELECT language, email, full_name INTO v_lead_lang, v_lead_email, v_lead_name
    FROM public.kob_leads WHERE id = r.lead_id;

    SELECT id, email_subject, email_body
      INTO v_template_id, v_email_subject, v_email_body
    FROM public.gallabox_templates
    WHERE category = 'WEBINAR_DEFAULTER'
      AND language = v_lead_lang
      AND active = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_template_id IS NULL THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO public.gallabox_fire_queue(lead_id, template_id, status, channel)
      VALUES (r.lead_id, v_template_id, 'PENDING', 'WHATSAPP');

      IF v_email_subject IS NOT NULL AND btrim(v_email_subject) <> ''
         AND v_email_body IS NOT NULL AND btrim(v_email_body) <> ''
         AND v_lead_email IS NOT NULL AND btrim(v_lead_email) <> '' THEN
        INSERT INTO public.email_fire_queue(lead_id, template_id, to_email, subject, body, status)
        VALUES (
          r.lead_id, v_template_id, v_lead_email,
          public.render_email_text(v_email_subject, v_lead_name),
          public.render_email_text(v_email_body, v_lead_name),
          'PENDING'
        );
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_marked, v_skipped;
END;
$function$;

-- 3) Seed email variants for existing templates that don't have them yet
UPDATE public.gallabox_templates SET
  email_subject = 'Welcome to Kitchens of Bharat',
  email_body = 'Dear {{lead_name}},' || E'\n\n' ||
    'Thank you for expressing interest in Kitchens of Bharat. We are delighted to welcome you.' || E'\n\n' ||
    'Our team will be in touch shortly to walk you through the next steps and answer any questions you may have about our franchise partnership program.' || E'\n\n' ||
    'In the meantime, please feel free to reply to this email with anything you would like to know.' || E'\n\n' ||
    'Warm regards,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'welcome_english' AND (email_subject IS NULL OR btrim(email_subject) = '');

UPDATE public.gallabox_templates SET
  email_subject = 'Kitchens of Bharat mein aapka swagat hai',
  email_body = 'Namaste {{lead_name}},' || E'\n\n' ||
    'Kitchens of Bharat mein ruchi dikhane ke liye dhanyavaad. Hum aapka swagat karte hain.' || E'\n\n' ||
    'Hamari team jald hi aapse sampark karegi aur hamare franchise partnership programme ke baare mein vistaar se batayegi.' || E'\n\n' ||
    'Kisi bhi prashn ke liye is email ka jawab dein.' || E'\n\n' ||
    'Sadar,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'welcome_hindi' AND (email_subject IS NULL OR btrim(email_subject) = '');

UPDATE public.gallabox_templates SET
  email_subject = 'Kitchens of Bharat-il ungalai varaverkirom',
  email_body = 'Vanakkam {{lead_name}},' || E'\n\n' ||
    'Kitchens of Bharat-il aarvam kaatiyathukku nandri. Ungalai anbudan varaverkirom.' || E'\n\n' ||
    'Engal aniyinar viraivil ungalai thodarbu kollum, engal franchise partnership thittam kurithu vilakkuvaargal.' || E'\n\n' ||
    'Edhaavathu kelvi irundhaal, indha email-ku badhil anuppungal.' || E'\n\n' ||
    'Anbudan,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'welcome_tamil' AND (email_subject IS NULL OR btrim(email_subject) = '');

-- Retargeting NO (English/Hindi/Tamil)
UPDATE public.gallabox_templates SET
  email_subject = 'One last check-in from Kitchens of Bharat',
  email_body = 'Dear {{lead_name}},' || E'\n\n' ||
    'We noticed you had considered a partnership with Kitchens of Bharat earlier but decided not to proceed at that time.' || E'\n\n' ||
    'Circumstances change, and we wanted to check in one last time in case a fresh conversation would be useful. Our current programme offers flexible entry options that may suit you better today.' || E'\n\n' ||
    'If you would like to revisit this, simply reply to this email and we will arrange a call.' || E'\n\n' ||
    'Warm regards,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'rt_no_english' AND (email_subject IS NULL OR btrim(email_subject) = '');

UPDATE public.gallabox_templates SET
  email_subject = 'Kitchens of Bharat: ek antim sampark',
  email_body = 'Namaste {{lead_name}},' || E'\n\n' ||
    'Aapne pehle Kitchens of Bharat ke saath partnership par vichaar kiya tha lekin us samay aage nahi badhne ka faisla liya tha.' || E'\n\n' ||
    'Paristhithiyan badalti hain, isliye hum ek baar aur sampark karna chahte the. Hamare naye programme mein flexible options hain jo aaj aapke liye behtar ho sakte hain.' || E'\n\n' ||
    'Yadi aap dobara baat karna chahen, is email ka jawab dein.' || E'\n\n' ||
    'Sadar,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'rt_no_hindi' AND (email_subject IS NULL OR btrim(email_subject) = '');

UPDATE public.gallabox_templates SET
  email_subject = 'Kitchens of Bharat: kadaisi thodarbu',
  email_body = 'Vanakkam {{lead_name}},' || E'\n\n' ||
    'Neengal munbu Kitchens of Bharat partnership pathri yosithathai naangal kavanithom, aanaal antha samayathil thodara mudivu seyyavillai.' || E'\n\n' ||
    'Sooznilaigal maarum, athanaal kadaisiyaaga oru murai thodarbu kolla virumbinom. Engal thatpodhaya thittathil pudhiya nedhiyaana vazhigal ullana.' || E'\n\n' ||
    'Meendum pesa virumbinaal, indha email-ku badhil anuppungal.' || E'\n\n' ||
    'Anbudan,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'rt_no_tamil' AND (email_subject IS NULL OR btrim(email_subject) = '');

-- Retargeting LATER
UPDATE public.gallabox_templates SET
  email_subject = 'Kitchens of Bharat: ready to continue?',
  email_body = 'Dear {{lead_name}},' || E'\n\n' ||
    'You had earlier indicated that you wanted to explore a Kitchens of Bharat partnership later. We wanted to check in and see if the timing is better now.' || E'\n\n' ||
    'If you are ready to pick up the conversation, please reply to this email and we will schedule a convenient time.' || E'\n\n' ||
    'Warm regards,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'rt_later_english' AND (email_subject IS NULL OR btrim(email_subject) = '');

UPDATE public.gallabox_templates SET
  email_subject = 'Kitchens of Bharat: kya ab baat karein?',
  email_body = 'Namaste {{lead_name}},' || E'\n\n' ||
    'Aapne pehle bataya tha ki Kitchens of Bharat partnership ke baare mein baad mein baat karenge. Hum jaanna chahte the ki kya ab sahi samay hai.' || E'\n\n' ||
    'Yadi aap taiyar hain, is email ka jawab dein aur hum ek suvidhajanak samay tay karenge.' || E'\n\n' ||
    'Sadar,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'rt_later_hindi' AND (email_subject IS NULL OR btrim(email_subject) = '');

UPDATE public.gallabox_templates SET
  email_subject = 'Kitchens of Bharat: ippo pesalaama?',
  email_body = 'Vanakkam {{lead_name}},' || E'\n\n' ||
    'Neengal munbu Kitchens of Bharat partnership pathri piragu pesalaam endru sonneergal. Ippo sariyaana samayamaa endru arinja virumbinom.' || E'\n\n' ||
    'Neengal thayaaraaga irundhaal, indha email-ku badhil anuppungal, naangal vasadhiyaana neram amaipom.' || E'\n\n' ||
    'Anbudan,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'rt_later_tamil' AND (email_subject IS NULL OR btrim(email_subject) = '');

-- Retargeting NO_RESPONSE
UPDATE public.gallabox_templates SET
  email_subject = 'We tried to reach you — Kitchens of Bharat',
  email_body = 'Dear {{lead_name}},' || E'\n\n' ||
    'We have tried to reach you a few times about your interest in Kitchens of Bharat but have not been able to connect.' || E'\n\n' ||
    'If you are still interested, please reply to this email with a time that suits you and our team will call you back.' || E'\n\n' ||
    'Warm regards,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'rt_noresp_english' AND (email_subject IS NULL OR btrim(email_subject) = '');

UPDATE public.gallabox_templates SET
  email_subject = 'Kitchens of Bharat: aapse sampark ki koshish',
  email_body = 'Namaste {{lead_name}},' || E'\n\n' ||
    'Humne aapse Kitchens of Bharat ke baare mein kuch baar sampark karne ki koshish ki, lekin baat nahi ho paayi.' || E'\n\n' ||
    'Yadi aap abhi bhi ruchi rakhte hain, kripya is email ka jawab dein aur apna suvidhajanak samay batayein — hamari team aapko call karegi.' || E'\n\n' ||
    'Sadar,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'rt_noresp_hindi' AND (email_subject IS NULL OR btrim(email_subject) = '');

UPDATE public.gallabox_templates SET
  email_subject = 'Kitchens of Bharat: ungalai thodarbu kolla mudiyavillai',
  email_body = 'Vanakkam {{lead_name}},' || E'\n\n' ||
    'Kitchens of Bharat pathri ungalai sila muraigal thodarbu kolla muyandrom, aanaal pesa mudiyavillai.' || E'\n\n' ||
    'Neengal innum aarvamaaga irundhaal, indha email-ku badhil anuppi ungal vasadhiyaana neram theriyapaduthungal — engal ani ungalai azhaikkum.' || E'\n\n' ||
    'Anbudan,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'rt_noresp_tamil' AND (email_subject IS NULL OR btrim(email_subject) = '');

-- Webinar Defaulter
UPDATE public.gallabox_templates SET
  email_subject = 'Sorry we missed you — Kitchens of Bharat webinar',
  email_body = 'Dear {{lead_name}},' || E'\n\n' ||
    'We noticed you were unable to join the Kitchens of Bharat webinar you had registered for.' || E'\n\n' ||
    'The session covers our partnership model, unit economics, and the support you can expect from us. We would love to have you at the next one — please reply to this email and we will share the schedule.' || E'\n\n' ||
    'Warm regards,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'wd_english' AND (email_subject IS NULL OR btrim(email_subject) = '');

UPDATE public.gallabox_templates SET
  email_subject = 'Kitchens of Bharat webinar mein aap chook gaye',
  email_body = 'Namaste {{lead_name}},' || E'\n\n' ||
    'Humne dekha ki aap Kitchens of Bharat webinar mein shaamil nahi ho paaye jiske liye aapne panjeekaran karvaaya tha.' || E'\n\n' ||
    'Yeh session hamare partnership model, unit economics aur support ke baare mein hai. Agli webinar mein aapka swagat hai — is email ka jawab dein aur hum schedule saajha karenge.' || E'\n\n' ||
    'Sadar,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'wd_hindi' AND (email_subject IS NULL OR btrim(email_subject) = '');

UPDATE public.gallabox_templates SET
  email_subject = 'Kitchens of Bharat webinar-il neengal illai',
  email_body = 'Vanakkam {{lead_name}},' || E'\n\n' ||
    'Neengal pathivu seyyapatta Kitchens of Bharat webinar-il kalandhu kolla mudiyavillai endru kavaninthom.' || E'\n\n' ||
    'Indha session engal partnership model, unit economics, matrum ungalukku kidaikkum aadharavu pathri irukkum. Adutha webinar-il ungalai kaanavendum — indha email-ku badhil anuppungal, naangal schedule anuppuvom.' || E'\n\n' ||
    'Anbudan,' || E'\n' ||
    'Kitchens of Bharat Team'
WHERE name = 'wd_tamil' AND (email_subject IS NULL OR btrim(email_subject) = '');
