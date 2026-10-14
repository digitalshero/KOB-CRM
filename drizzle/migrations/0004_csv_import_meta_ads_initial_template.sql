CREATE TABLE public.csv_import_initial_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  request_id bigint,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.csv_import_initial_sends TO authenticated;
GRANT ALL ON public.csv_import_initial_sends TO service_role;
ALTER TABLE public.csv_import_initial_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view csv import sends" ON public.csv_import_initial_sends FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager') OR public.has_role(auth.uid(),'team_leader'));

-- CSV-import-only: send the existing language-based initial template to a freshly
-- imported Meta Ads lead. Normal Meta Ads leads are untouched (still skipped by
-- send_meta_ads_initial_template). Same language→template mapping as the
-- existing initial-template triggers.
CREATE OR REPLACE FUNCTION public.send_csv_import_meta_ads_initial(_lead_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  l record; v_source text; v_tpl text; v_digits text; v_phone text; v_send_id uuid; v_request_id bigint;
BEGIN
  IF NOT (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager') OR has_role(auth.uid(),'team_leader')) THEN
    RETURN 'forbidden';
  END IF;
  SELECT * INTO l FROM kob_leads WHERE id = _lead_id;
  IF l.id IS NULL OR l.code NOT LIKE 'IMP-%' OR l.created_at < now() - interval '15 minutes' THEN RETURN 'not_csv_import'; END IF;
  IF l.stage = 'DUPLICATE_LEAD' THEN RETURN 'duplicate'; END IF;
  SELECT name INTO v_source FROM lead_sources WHERE id = l.source_id;
  IF v_source IS NULL OR lower(trim(v_source)) <> 'meta ads' THEN RETURN 'not_meta_ads'; END IF;

  v_tpl := CASE l.language
    WHEN 'TAMIL' THEN 'tamil_drip1_kob_clone_clone_clone_clone_new_crm'
    WHEN 'TELUGU' THEN 'telugu_drip1_kob_clone'
    WHEN 'MALAYALAM' THEN 'malayalam_kob_drip_1_clone'
    ELSE 'intial_common_drip_clone_clone_clone' END;

  INSERT INTO csv_import_initial_sends(lead_id, template_name) VALUES (_lead_id, v_tpl)
  ON CONFLICT (lead_id) DO NOTHING RETURNING id INTO v_send_id;
  IF v_send_id IS NULL THEN RETURN 'already_sent'; END IF;

  v_digits := regexp_replace(COALESCE(l.phone,''), '\D', '', 'g');
  IF length(v_digits) = 10 THEN v_phone := '91' || v_digits;
  ELSIF length(v_digits) >= 11 THEN v_phone := v_digits;
  ELSE
    UPDATE csv_import_initial_sends SET status='FAILED', error='invalid phone', updated_at=now() WHERE id=v_send_id;
    RETURN 'invalid_phone';
  END IF;

  SELECT net.http_post(
    url := 'https://server.gallabox.com/devapi/messages/whatsapp',
    headers := jsonb_build_object('Content-Type','application/json','apiKey','6a78a4275e97a5044adf14dc','apiSecret','8ac31b13074f406d9c1942acf0e729ca'),
    body := jsonb_build_object('channelId','660bdabd3a96237ad64ff6d6','channelType','whatsapp',
      'recipient', jsonb_build_object('name', COALESCE(l.full_name,'Customer'), 'phone', v_phone),
      'whatsapp', jsonb_build_object('type','template','template', jsonb_build_object('templateName', v_tpl)))
  ) INTO v_request_id;

  UPDATE csv_import_initial_sends SET status='SENT', request_id=v_request_id, sent_at=now(), updated_at=now() WHERE id=v_send_id;
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), 'CSV_IMPORT_META_ADS_INITIAL_SENT', 'kob_leads', _lead_id, jsonb_build_object('template', v_tpl, 'request_id', v_request_id));
  RETURN 'sent';
EXCEPTION WHEN OTHERS THEN
  UPDATE csv_import_initial_sends SET status='FAILED', error=SQLERRM, updated_at=now() WHERE lead_id=_lead_id AND status<>'SENT';
  RETURN 'failed';
END; $$;
REVOKE ALL ON FUNCTION public.send_csv_import_meta_ads_initial(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_csv_import_meta_ads_initial(uuid) TO authenticated;