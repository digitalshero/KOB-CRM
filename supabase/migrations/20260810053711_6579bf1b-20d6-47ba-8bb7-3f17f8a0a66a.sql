
CREATE TABLE public.lead_webinar_retarget_tamil_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  stage_entered_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  request_id bigint,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, stage_entered_at)
);

GRANT SELECT ON public.lead_webinar_retarget_tamil_sends TO authenticated;
GRANT ALL ON public.lead_webinar_retarget_tamil_sends TO service_role;

ALTER TABLE public.lead_webinar_retarget_tamil_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view tamil webinar retarget sends"
ON public.lead_webinar_retarget_tamil_sends FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_touch_webinar_tamil_sends
BEFORE UPDATE ON public.lead_webinar_retarget_tamil_sends
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.send_webinar_7day_retargeting_tamil()
RETURNS TABLE(processed integer, sent integer, skipped integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  l RECORD;
  v_api_key text; v_api_secret text; v_channel text;
  v_phone text; v_digits text;
  v_row_id uuid; v_request_id bigint;
  v_processed int := 0; v_sent int := 0; v_skipped int := 0;
BEGIN
  SELECT value INTO v_api_key FROM public.integration_settings WHERE key = 'webinar_retarget_tamil_api_key';
  SELECT value INTO v_api_secret FROM public.integration_settings WHERE key = 'webinar_retarget_tamil_api_secret';
  SELECT value INTO v_channel FROM public.integration_settings WHERE key = 'webinar_retarget_tamil_channel_id';

  IF v_api_key IS NULL OR v_api_secret IS NULL OR v_channel IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR l IN
    SELECT k.id, k.full_name, k.phone, k.stage_entered_at
    FROM public.kob_leads k
    WHERE k.stage = 'WEBINAR'::lead_stage
      AND k.language = 'TAMIL'::lead_language
      AND k.stage_entered_at < now() - interval '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_webinar_retarget_tamil_sends s
        WHERE s.lead_id = k.id AND s.stage_entered_at = k.stage_entered_at AND s.status = 'SENT'
      )
    ORDER BY k.stage_entered_at ASC
    LIMIT 200
  LOOP
    v_processed := v_processed + 1;

    v_digits := regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g');
    IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
    ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
    ELSE v_phone := NULL; END IF;

    IF v_phone IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.lead_webinar_retarget_tamil_sends(lead_id, stage_entered_at, status)
    VALUES (l.id, l.stage_entered_at, 'PENDING')
    ON CONFLICT (lead_id, stage_entered_at) DO UPDATE SET status = 'PENDING', error = NULL, updated_at = now()
    RETURNING id INTO v_row_id;

    BEGIN
      SELECT net.http_post(
        url := 'https://server.gallabox.com/devapi/messages/whatsapp',
        headers := jsonb_build_object('Content-Type','application/json','apiKey', v_api_key, 'apiSecret', v_api_secret),
        body := jsonb_build_object(
          'channelId', v_channel,
          'channelType', 'whatsapp',
          'recipient', jsonb_build_object('name', COALESCE(l.full_name, 'Customer'), 'phone', v_phone),
          'whatsapp', jsonb_build_object(
            'type', 'template',
            'template', jsonb_build_object('templateName', 'webinar_retarget_clone')
          )
        )
      ) INTO v_request_id;

      UPDATE public.lead_webinar_retarget_tamil_sends
      SET status = 'SENT', request_id = v_request_id, sent_at = now(), error = NULL, updated_at = now()
      WHERE id = v_row_id;

      INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
      VALUES (NULL, 'WEBINAR_7DAY_RETARGET_TAMIL_SENT', 'kob_leads', l.id,
        jsonb_build_object('template', 'webinar_retarget_clone', 'request_id', v_request_id));

      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.lead_webinar_retarget_tamil_sends
      SET status = 'FAILED', error = SQLERRM, updated_at = now()
      WHERE id = v_row_id;
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_sent, v_skipped;
END;
$fn$;
