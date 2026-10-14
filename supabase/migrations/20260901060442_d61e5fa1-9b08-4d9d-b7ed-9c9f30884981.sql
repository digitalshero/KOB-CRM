
CREATE OR REPLACE FUNCTION public.reconcile_website_form_sends()
RETURNS TABLE(checked integer, failed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tbl text;
  v_checked integer := 0;
  v_failed integer := 0;
  v_n integer;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'website_form_default_sends',
    'website_form_tamil_sends',
    'website_form_telugu_sends',
    'website_form_malayalam_sends'
  ] LOOP
    EXECUTE format($f$
      WITH cand AS (
        SELECT s.id, s.lead_id, s.request_id
        FROM public.%I s
        WHERE s.status = 'SENT'
          AND s.request_id IS NOT NULL
          AND s.created_at > now() - interval '2 days'
      ), resp AS (
        SELECT c.id, c.lead_id, c.request_id,
               r.status_code,
               COALESCE(r.error_msg, left(r.content, 500)) AS msg
        FROM cand c
        JOIN net._http_response r ON r.id = c.request_id
        WHERE r.error_msg IS NOT NULL OR r.status_code IS NULL OR r.status_code >= 300
      ), upd AS (
        UPDATE public.%I s
           SET status = 'FAILED',
               error = COALESCE(resp.msg, 'provider rejected message'),
               updated_at = now()
          FROM resp
         WHERE s.id = resp.id
        RETURNING s.lead_id, resp.status_code, resp.msg, resp.request_id
      ), logged AS (
        INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
        SELECT NULL, 'WEBSITE_FORM_TEMPLATE_SEND_FAILED', 'kob_leads', upd.lead_id,
               jsonb_build_object('table', %L, 'request_id', upd.request_id,
                                  'status_code', upd.status_code, 'error', upd.msg)
        FROM upd
        RETURNING 1
      )
      SELECT count(*)::int FROM logged
    $f$, v_tbl, v_tbl, v_tbl) INTO v_n;

    v_failed := v_failed + COALESCE(v_n, 0);
    v_checked := v_checked + 1;
  END LOOP;

  RETURN QUERY SELECT v_checked, v_failed;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_website_form_sends() FROM public;
GRANT EXECUTE ON FUNCTION public.reconcile_website_form_sends() TO service_role;

SELECT cron.unschedule('reconcile-website-form-sends')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-website-form-sends');

SELECT cron.schedule(
  'reconcile-website-form-sends',
  '15 * * * *',
  $$SELECT public.reconcile_website_form_sends();$$
);
