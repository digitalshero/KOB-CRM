CREATE TABLE public.lead_inbox_retarget_sends (
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

GRANT SELECT ON public.lead_inbox_retarget_sends TO authenticated;
GRANT ALL ON public.lead_inbox_retarget_sends TO service_role;

ALTER TABLE public.lead_inbox_retarget_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and managers can view lead inbox retarget sends"
ON public.lead_inbox_retarget_sends FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'kob_manager') OR public.has_role(auth.uid(), 'team_leader'));

CREATE TRIGGER trg_lead_inbox_retarget_sends_touch
BEFORE UPDATE ON public.lead_inbox_retarget_sends
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.send_lead_inbox_7day_retargeting()
RETURNS TABLE(processed integer, sent integer, skipped integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l RECORD;
  v_api_key text; v_api_secret text; v_channel text;
  v_phone text; v_digits text;
  v_row_id uuid; v_request_id bigint;
  v_processed int := 0; v_sent int := 0; v_skipped int := 0;
BEGIN
  SELECT value INTO v_api_key FROM public.integration_settings WHERE key = 'lead_inbox_retarget_api_key';
  SELECT value INTO v_api_secret FROM public.integration_settings WHERE key = 'lead_inbox_retarget_api_secret';
  SELECT value INTO v_channel FROM public.integration_settings WHERE key = 'lead_inbox_retarget_channel_id';

  IF v_api_key IS NULL OR v_api_secret IS NULL OR v_channel IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR l IN
    SELECT k.id, k.full_name, k.phone, k.stage_entered_at
    FROM public.kob_leads k
    WHERE k.stage = 'LEAD_INBOX'::lead_stage
      AND k.stage_entered_at <= now() - interval '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_inbox_retarget_sends s
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

    INSERT INTO public.lead_inbox_retarget_sends(lead_id, stage_entered_at, status)
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
            'template', jsonb_build_object(
              'templateName', 'lead_inbox_retargeting',
              'buttonValues', jsonb_build_array(
                jsonb_build_object('index', 0, 'sub_type', 'quick_reply', 'parameters', jsonb_build_object('type','payload','payload','விருப்பம் உள்ளது')),
                jsonb_build_object('index', 1, 'sub_type', 'quick_reply', 'parameters', jsonb_build_object('type','payload','payload','ఆసక్తి ఉంది')),
                jsonb_build_object('index', 2, 'sub_type', 'quick_reply', 'parameters', jsonb_build_object('type','payload','payload','താൽപ്പര്യമുണ്ട്')),
                jsonb_build_object('index', 3, 'sub_type', 'quick_reply', 'parameters', jsonb_build_object('type','payload','payload','Later')),
                jsonb_build_object('index', 4, 'sub_type', 'quick_reply', 'parameters', jsonb_build_object('type','payload','payload','No'))
              )
            )
          )
        )
      ) INTO v_request_id;

      UPDATE public.lead_inbox_retarget_sends
      SET status = 'SENT', request_id = v_request_id, sent_at = now(), error = NULL, updated_at = now()
      WHERE id = v_row_id;

      INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
      VALUES (NULL, 'LEAD_INBOX_7DAY_RETARGET_SENT', 'kob_leads', l.id,
        jsonb_build_object('template', 'lead_inbox_retargeting', 'request_id', v_request_id));

      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.lead_inbox_retarget_sends
      SET status = 'FAILED', error = SQLERRM, updated_at = now()
      WHERE id = v_row_id;
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_sent, v_skipped;
END;
$$;