-- 1) Tamil / English / default webinar 24h abandoned sender
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
      AND k.language NOT IN ('TELUGU'::lead_language, 'MALAYALAM'::lead_language)
      AND k.stage_entered_at < now() - interval '24 hours'
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
            'template', jsonb_build_object('templateName', 'webinar_abandoned_clone')
          )
        )
      ) INTO v_request_id;

      UPDATE public.lead_webinar_retarget_tamil_sends
      SET status = 'SENT', request_id = v_request_id, sent_at = now(), error = NULL, updated_at = now()
      WHERE id = v_row_id;

      INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
      VALUES (NULL, 'WEBINAR_24H_ABANDONED_SENT', 'kob_leads', l.id,
        jsonb_build_object('template', 'webinar_abandoned_clone', 'request_id', v_request_id));

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

-- 2) Telugu webinar 24h abandoned sender
CREATE OR REPLACE FUNCTION public.send_webinar_7day_retargeting_telugu()
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
  SELECT value INTO v_api_key FROM public.integration_settings WHERE key = 'webinar_retarget_telugu_api_key';
  SELECT value INTO v_api_secret FROM public.integration_settings WHERE key = 'webinar_retarget_telugu_api_secret';
  SELECT value INTO v_channel FROM public.integration_settings WHERE key = 'webinar_retarget_telugu_channel_id';

  IF v_api_key IS NULL OR v_api_secret IS NULL OR v_channel IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR l IN
    SELECT k.id, k.full_name, k.phone, k.stage_entered_at
    FROM public.kob_leads k
    WHERE k.stage = 'WEBINAR'::lead_stage
      AND k.language = 'TELUGU'::lead_language
      AND k.stage_entered_at < now() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_webinar_retarget_telugu_sends s
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

    INSERT INTO public.lead_webinar_retarget_telugu_sends(lead_id, stage_entered_at, status)
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
            'template', jsonb_build_object('templateName', 'webinar_abandoned_telugu')
          )
        )
      ) INTO v_request_id;

      UPDATE public.lead_webinar_retarget_telugu_sends
      SET status = 'SENT', request_id = v_request_id, sent_at = now(), error = NULL, updated_at = now()
      WHERE id = v_row_id;

      INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
      VALUES (NULL, 'WEBINAR_24H_ABANDONED_TELUGU_SENT', 'kob_leads', l.id,
        jsonb_build_object('template', 'webinar_abandoned_telugu', 'request_id', v_request_id));

      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.lead_webinar_retarget_telugu_sends
      SET status = 'FAILED', error = SQLERRM, updated_at = now()
      WHERE id = v_row_id;
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_sent, v_skipped;
END;
$fn$;

-- 3) Malayalam webinar 24h abandoned sender
CREATE OR REPLACE FUNCTION public.send_webinar_7day_retargeting_malayalam()
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
  SELECT value INTO v_api_key FROM public.integration_settings WHERE key = 'webinar_retarget_malayalam_api_key';
  SELECT value INTO v_api_secret FROM public.integration_settings WHERE key = 'webinar_retarget_malayalam_api_secret';
  SELECT value INTO v_channel FROM public.integration_settings WHERE key = 'webinar_retarget_malayalam_channel_id';

  IF v_api_key IS NULL OR v_api_secret IS NULL OR v_channel IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR l IN
    SELECT k.id, k.full_name, k.phone, k.stage_entered_at
    FROM public.kob_leads k
    WHERE k.stage = 'WEBINAR'::lead_stage
      AND k.language = 'MALAYALAM'::lead_language
      AND k.stage_entered_at < now() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_webinar_retarget_malayalam_sends s
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

    INSERT INTO public.lead_webinar_retarget_malayalam_sends(lead_id, stage_entered_at, status)
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
            'template', jsonb_build_object('templateName', 'webinar_abandoned_malayalam')
          )
        )
      ) INTO v_request_id;

      UPDATE public.lead_webinar_retarget_malayalam_sends
      SET status = 'SENT', request_id = v_request_id, sent_at = now(), error = NULL, updated_at = now()
      WHERE id = v_row_id;

      INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
      VALUES (NULL, 'WEBINAR_24H_ABANDONED_MALAYALAM_SENT', 'kob_leads', l.id,
        jsonb_build_object('template', 'webinar_abandoned_malayalam', 'request_id', v_request_id));

      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.lead_webinar_retarget_malayalam_sends
      SET status = 'FAILED', error = SQLERRM, updated_at = now()
      WHERE id = v_row_id;
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_sent, v_skipped;
END;
$fn$;

-- 4) Auto-move leads stuck in WEBINAR for 48 continuous hours to NO_RESPONSE
CREATE OR REPLACE FUNCTION public.move_webinar_48h_to_no_response()
RETURNS TABLE(moved integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_moved int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.kob_leads k
    SET stage = 'NO_RESPONSE'::lead_stage
    WHERE k.stage = 'WEBINAR'::lead_stage
      AND k.stage_entered_at < now() - interval '48 hours'
    RETURNING k.id
  )
  SELECT count(*) INTO v_moved FROM upd;
  RETURN QUERY SELECT v_moved;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.move_webinar_48h_to_no_response() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_webinar_48h_to_no_response() TO service_role;

SELECT cron.unschedule('webinar-48h-to-no-response')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'webinar-48h-to-no-response');

SELECT cron.schedule('webinar-48h-to-no-response', '50 * * * *', $$SELECT public.move_webinar_48h_to_no_response();$$);