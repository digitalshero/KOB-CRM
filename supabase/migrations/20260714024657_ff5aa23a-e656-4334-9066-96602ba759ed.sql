
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS scv_score integer;

DROP FUNCTION IF EXISTS public.compute_scv_scores();

CREATE OR REPLACE FUNCTION public.compute_scv_scores()
RETURNS TABLE(role text, subject_id uuid, stage_score numeric, activity_score numeric, source_score numeric, geo_score numeric, tenure_score numeric, final_score int, leads_scored int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_active_cities int;
  r RECORD;
  v_stage numeric; v_activity numeric; v_source numeric; v_geo numeric; v_tenure numeric;
  v_final int; v_updated int; v_scope_filter text;
  v_sql text;
BEGIN
  SELECT GREATEST(1, COUNT(*)) INTO v_total_active_cities FROM public.india_cities WHERE active = true;

  FOR r IN
    SELECT ur.role::text AS role_name, p.id, p.created_at
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE ur.role::text IN ('executive','team_leader','kob_manager','super_admin')
  LOOP
    -- Scope filter for this subject
    IF r.role_name = 'executive' THEN
      v_scope_filter := format('l.assigned_to = %L', r.id);
    ELSIF r.role_name = 'team_leader' THEN
      v_scope_filter := format('l.team_leader_id = %L', r.id);
    ELSE
      v_scope_filter := 'true'; -- managers / super_admin: org-wide
    END IF;

    -- Stage
    EXECUTE format($f$
      SELECT COALESCE(AVG(CASE l.stage::text
        WHEN 'LEAD_INBOX' THEN 0 WHEN 'AUTO_FIRED' THEN 1 WHEN 'FAILED_FIRE' THEN 1
        WHEN 'EOI_1' THEN 2 WHEN 'WEBINAR' THEN 3 WHEN 'EOI_2' THEN 4
        WHEN 'FORM_FILLED' THEN 5 WHEN 'FEE_PAID' THEN 6 WHEN 'AGREEMENT_SIGNED' THEN 7
        WHEN 'KTN_CS' THEN 8 WHEN 'KTN_LIVE' THEN 10
        WHEN 'NO' THEN 1 WHEN 'NO_RESPONSE' THEN 1 WHEN 'LATER' THEN 2 WHEN 'RETARGETING' THEN 2
        WHEN 'DEAD_LEAD' THEN 0 ELSE 0 END) / 10.0 * 100, 0)
      FROM public.kob_leads l WHERE %s$f$, v_scope_filter) INTO v_stage;

    -- Activity
    EXECUTE format($f$
      SELECT COALESCE(AVG(LEAST(100,
        (SELECT COUNT(*) FROM public.lead_activities a WHERE a.lead_id = l.id)::numeric
        / GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (now() - l.created_at))/3600.0/48.0))::numeric * 100
      )), 0)
      FROM public.kob_leads l WHERE %s$f$, v_scope_filter) INTO v_activity;

    -- Source
    EXECUTE format($f$
      SELECT CASE
        WHEN COUNT(*) FILTER (WHERE COALESCE(s.cost_per_lead,0) > 0) = 0 THEN 50
        ELSE COUNT(*) FILTER (WHERE COALESCE(s.cost_per_lead,0) > 0 AND l.stage::text IN ('FEE_PAID','AGREEMENT_SIGNED','KTN_CS','KTN_LIVE'))::numeric
             / COUNT(*) FILTER (WHERE COALESCE(s.cost_per_lead,0) > 0)::numeric * 100
      END
      FROM public.kob_leads l LEFT JOIN public.lead_sources s ON s.id = l.source_id
      WHERE %s$f$, v_scope_filter) INTO v_source;

    -- Geo
    EXECUTE format($f$
      SELECT LEAST(100, COUNT(DISTINCT l.city_id)::numeric / %s::numeric * 100)
      FROM public.kob_leads l WHERE %s AND l.stage::text = 'KTN_LIVE' AND l.city_id IS NOT NULL$f$,
      v_total_active_cities, v_scope_filter) INTO v_geo;
    v_geo := COALESCE(v_geo, 0);

    -- Tenure (from this subject's own profile created_at)
    v_tenure := LEAST(100, EXTRACT(EPOCH FROM (now() - r.created_at))/86400.0 / 90.0 * 100);

    v_final := ROUND((v_stage * 35 + v_activity * 25 + v_source * 15 + v_geo * 15 + v_tenure * 10) / 100.0);

    -- Executives: write to every lead they own (keeps kob_leads.scv_score meaningful).
    IF r.role_name = 'executive' THEN
      UPDATE public.kob_leads SET scv_score = v_final WHERE assigned_to = r.id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    ELSE
      v_updated := 0;
    END IF;

    -- Everyone: write final to profiles.scv_score
    UPDATE public.profiles SET scv_score = v_final WHERE id = r.id;

    role := r.role_name;
    subject_id := r.id;
    stage_score := ROUND(v_stage,2);
    activity_score := ROUND(v_activity,2);
    source_score := ROUND(v_source,2);
    geo_score := ROUND(v_geo,2);
    tenure_score := ROUND(v_tenure,2);
    final_score := v_final;
    leads_scored := v_updated;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_scv_scores() TO authenticated, service_role;
