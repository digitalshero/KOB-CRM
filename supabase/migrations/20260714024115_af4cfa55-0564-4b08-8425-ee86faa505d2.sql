
CREATE OR REPLACE FUNCTION public.compute_scv_scores()
RETURNS TABLE(executive_id uuid, stage_score numeric, activity_score numeric, source_score numeric, geo_score numeric, tenure_score numeric, final_score int, leads_updated int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_active_cities int;
  r RECORD;
  v_stage numeric;
  v_activity numeric;
  v_source numeric;
  v_geo numeric;
  v_tenure numeric;
  v_final int;
  v_updated int;
BEGIN
  SELECT GREATEST(1, COUNT(*)) INTO v_total_active_cities FROM public.india_cities WHERE active = true;

  FOR r IN
    SELECT p.id, p.created_at
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'executive'
  LOOP
    -- Stage score
    SELECT COALESCE(AVG(
      CASE l.stage::text
        WHEN 'LEAD_INBOX' THEN 0
        WHEN 'AUTO_FIRED' THEN 1
        WHEN 'FAILED_FIRE' THEN 1
        WHEN 'EOI_1' THEN 2
        WHEN 'WEBINAR' THEN 3
        WHEN 'EOI_2' THEN 4
        WHEN 'FORM_FILLED' THEN 5
        WHEN 'FEE_PAID' THEN 6
        WHEN 'AGREEMENT_SIGNED' THEN 7
        WHEN 'KTN_CS' THEN 8
        WHEN 'KTN_LIVE' THEN 10
        WHEN 'NO' THEN 1
        WHEN 'NO_RESPONSE' THEN 1
        WHEN 'LATER' THEN 2
        WHEN 'RETARGETING' THEN 2
        WHEN 'DEAD_LEAD' THEN 0
        ELSE 0
      END
    ) / 10.0 * 100, 0)
    INTO v_stage
    FROM public.kob_leads l WHERE l.assigned_to = r.id;

    -- Activity score: per-lead ratio (actual/expected) capped at 100, averaged
    SELECT COALESCE(AVG(
      LEAST(100,
        (SELECT COUNT(*) FROM public.lead_activities a WHERE a.lead_id = l.id)::numeric
        / GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (now() - l.created_at))/3600.0/48.0))::numeric
        * 100
      )
    ), 0)
    INTO v_activity
    FROM public.kob_leads l WHERE l.assigned_to = r.id;

    -- Source score: % of paid-source leads that reached FEE_PAID+
    SELECT CASE
      WHEN COUNT(*) FILTER (WHERE l.cost_per_lead > 0) = 0 THEN 50
      ELSE COUNT(*) FILTER (WHERE l.cost_per_lead > 0 AND l.stage::text IN ('FEE_PAID','AGREEMENT_SIGNED','KTN_CS','KTN_LIVE'))::numeric
           / COUNT(*) FILTER (WHERE l.cost_per_lead > 0)::numeric * 100
    END
    INTO v_source
    FROM public.kob_leads l WHERE l.assigned_to = r.id;

    -- Geo score: distinct cities among KTN_LIVE leads / total active cities * 100
    SELECT LEAST(100,
      COUNT(DISTINCT l.city_id)::numeric / v_total_active_cities::numeric * 100
    )
    INTO v_geo
    FROM public.kob_leads l WHERE l.assigned_to = r.id AND l.stage::text = 'KTN_LIVE' AND l.city_id IS NOT NULL;

    v_geo := COALESCE(v_geo, 0);

    -- Tenure score
    v_tenure := LEAST(100, EXTRACT(EPOCH FROM (now() - r.created_at))/86400.0 / 90.0 * 100);

    v_final := ROUND((v_stage * 35 + v_activity * 25 + v_source * 15 + v_geo * 15 + v_tenure * 10) / 100.0);

    UPDATE public.kob_leads SET scv_score = v_final WHERE assigned_to = r.id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    executive_id := r.id;
    stage_score := ROUND(v_stage, 2);
    activity_score := ROUND(v_activity, 2);
    source_score := ROUND(v_source, 2);
    geo_score := ROUND(v_geo, 2);
    tenure_score := ROUND(v_tenure, 2);
    final_score := v_final;
    leads_updated := v_updated;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_scv_scores() TO authenticated, service_role;
