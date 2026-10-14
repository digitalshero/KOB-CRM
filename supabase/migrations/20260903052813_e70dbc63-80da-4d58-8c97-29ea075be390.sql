DROP FUNCTION IF EXISTS public.retry_failed_website_form_malayalam_sends();

CREATE OR REPLACE FUNCTION public.retry_failed_website_form_malayalam_sends(_lead_id uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record;
  v_phone text; v_digits text;
  v_request_id bigint;
  v_count integer := 0;
BEGIN
  FOR v_rec IN
    SELECT s.id AS send_id, l.id AS lead_id, l.full_name, l.phone
    FROM public.website_form_malayalam_sends s
    JOIN public.kob_leads l ON l.id = s.lead_id
    LEFT JOIN net._http_response r ON r.id = s.request_id
    WHERE (_lead_id IS NULL OR s.lead_id = _lead_id)
      AND (s.status = 'FAILED'
        OR s.request_id IS NULL
        OR r.error_msg IS NOT NULL
        OR (r.status_code IS NOT NULL AND r.status_code >= 300))
  LOOP
    v_digits := regexp_replace(COALESCE(v_rec.phone,''), '\D', '', 'g');
    IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
    ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
    ELSE CONTINUE; END IF;

    SELECT net.http_post(
      url := 'https://server.gallabox.com/devapi/messages/whatsapp',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'apiKey','6a78a4275e97a5044adf14dc',
        'apiSecret','8ac31b13074f406d9c1942acf0e729ca'
      ),
      body := jsonb_build_object(
        'channelId','660bdabd3a96237ad64ff6d6',
        'channelType','whatsapp',
        'recipient', jsonb_build_object('name', COALESCE(v_rec.full_name,'Customer'), 'phone', v_phone),
        'whatsapp', jsonb_build_object(
          'type','template',
          'template', jsonb_build_object(
            'templateName','malayalam_kob_drip_1_clone',
            'buttonValues', jsonb_build_array(
              jsonb_build_object(
                'index', 1,
                'sub_type','quick_reply',
                'parameters', jsonb_build_object('type','payload','payload','താൽപര്യമുണ്ട്')
              )
            ),
            'headerValues', jsonb_build_object(
              'mediaUrl','https://files.gallabox.com/61adf636b0cc0c00046772c2/039974d7-db95-4b5f-9eaa-7fb67ac3b452-9bb05210626840dfbad81735223ebe73ChatGPTImageJun12026020737PM.png',
              'mediaName','9bb05210-6268-40df-bad8-1735223ebe73-ChatGPTImageJun12026020737PM.png'
            )
          )
        )
      )
    ) INTO v_request_id;

    UPDATE public.website_form_malayalam_sends
       SET status='SENT', request_id=v_request_id, sent_at=now(), error=NULL, updated_at=now()
     WHERE id = v_rec.send_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.retry_failed_website_form_malayalam_sends(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_failed_website_form_malayalam_sends(uuid) TO service_role;