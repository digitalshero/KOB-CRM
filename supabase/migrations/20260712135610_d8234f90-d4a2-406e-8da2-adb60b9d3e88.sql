
-- Drop dependent views + trigger before enum swap
DROP VIEW IF EXISTS v_city_scope CASCADE;
DROP VIEW IF EXISTS v_funnel_by_source CASCADE;
DROP VIEW IF EXISTS v_retargeting_queue CASCADE;
DROP VIEW IF EXISTS v_scv_leaderboard CASCADE;
DROP TRIGGER IF EXISTS trg_lead_stage_change ON kob_leads;

-- Replace lead_stage enum
CREATE TYPE lead_stage_new AS ENUM (
  'LEAD_INBOX','AUTO_FIRED','FAILED_FIRE','EOI_1','WEBINAR','EOI_2',
  'FORM_FILLED','FEE_PAID','AGREEMENT_SIGNED','KTN_CS','KTN_LIVE',
  'NO','LATER','NO_RESPONSE','RETARGETING','DEAD_LEAD'
);

ALTER TABLE kob_leads ALTER COLUMN stage DROP DEFAULT;
ALTER TABLE kob_leads ALTER COLUMN stage TYPE lead_stage_new
  USING (CASE stage::text
    WHEN 'NEW' THEN 'LEAD_INBOX' WHEN 'CONTACTED' THEN 'EOI_1'
    WHEN 'QUALIFIED' THEN 'EOI_2' WHEN 'NEGOTIATION' THEN 'FORM_FILLED'
    WHEN 'ONBOARDING' THEN 'AGREEMENT_SIGNED' WHEN 'CONVERTED' THEN 'KTN_LIVE'
    WHEN 'NO_RESPONSE' THEN 'NO_RESPONSE' WHEN 'LATER' THEN 'LATER'
    WHEN 'NO' THEN 'NO' WHEN 'DEAD' THEN 'DEAD_LEAD' ELSE 'LEAD_INBOX'
  END)::lead_stage_new;
ALTER TABLE kob_leads ALTER COLUMN stage SET DEFAULT 'LEAD_INBOX'::lead_stage_new;

ALTER TABLE retargeting_schedule ALTER COLUMN bucket TYPE lead_stage_new
  USING (CASE bucket::text WHEN 'NO_RESPONSE' THEN 'NO_RESPONSE'
    WHEN 'LATER' THEN 'LATER' WHEN 'NO' THEN 'NO' ELSE 'NO_RESPONSE' END)::lead_stage_new;

ALTER TABLE lead_stage_history ALTER COLUMN from_stage TYPE lead_stage_new
  USING (CASE from_stage::text
    WHEN 'NEW' THEN 'LEAD_INBOX' WHEN 'CONTACTED' THEN 'EOI_1'
    WHEN 'QUALIFIED' THEN 'EOI_2' WHEN 'NEGOTIATION' THEN 'FORM_FILLED'
    WHEN 'ONBOARDING' THEN 'AGREEMENT_SIGNED' WHEN 'CONVERTED' THEN 'KTN_LIVE'
    WHEN 'NO_RESPONSE' THEN 'NO_RESPONSE' WHEN 'LATER' THEN 'LATER'
    WHEN 'NO' THEN 'NO' WHEN 'DEAD' THEN 'DEAD_LEAD' ELSE NULL END)::lead_stage_new;
ALTER TABLE lead_stage_history ALTER COLUMN to_stage TYPE lead_stage_new
  USING (CASE to_stage::text
    WHEN 'NEW' THEN 'LEAD_INBOX' WHEN 'CONTACTED' THEN 'EOI_1'
    WHEN 'QUALIFIED' THEN 'EOI_2' WHEN 'NEGOTIATION' THEN 'FORM_FILLED'
    WHEN 'ONBOARDING' THEN 'AGREEMENT_SIGNED' WHEN 'CONVERTED' THEN 'KTN_LIVE'
    WHEN 'NO_RESPONSE' THEN 'NO_RESPONSE' WHEN 'LATER' THEN 'LATER'
    WHEN 'NO' THEN 'NO' WHEN 'DEAD' THEN 'DEAD_LEAD' ELSE NULL END)::lead_stage_new;

DROP TYPE lead_stage;
ALTER TYPE lead_stage_new RENAME TO lead_stage;

-- Recreate trigger function + trigger
CREATE OR REPLACE FUNCTION public.on_lead_stage_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.lead_stage_history(lead_id, from_stage, to_stage, changed_by)
    VALUES (NEW.id, OLD.stage, NEW.stage, auth.uid());
    NEW.last_activity_at := now();
    IF NEW.stage = 'KTN_LIVE'::lead_stage AND NEW.converted_at IS NULL THEN
      NEW.converted_at := now();
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_lead_stage_change BEFORE UPDATE OF stage ON kob_leads
  FOR EACH ROW EXECUTE FUNCTION on_lead_stage_change();

-- New enums
CREATE TYPE lead_mode AS ENUM ('AUTO','MANUAL');
CREATE TYPE auto_fire_status AS ENUM ('NOT_FIRED','FIRED','FAILED');
CREATE TYPE lead_language AS ENUM (
  'TAMIL','TELUGU','MALAYALAM','HINDI','BENGALI','ENGLISH',
  'KANNADA','MARATHI','GUJARATI','OTHERS'
);

-- Extend kob_leads
ALTER TABLE kob_leads
  ADD COLUMN mode lead_mode NOT NULL DEFAULT 'AUTO',
  ADD COLUMN auto_fired_status auto_fire_status NOT NULL DEFAULT 'NOT_FIRED',
  ADD COLUMN gallabox_template_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN av_link_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN form_link_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN language lead_language NOT NULL DEFAULT 'ENGLISH',
  ADD COLUMN assigned_language_executive uuid REFERENCES auth.users(id);
CREATE INDEX kob_leads_language_idx ON kob_leads(language);
CREATE INDEX kob_leads_mode_idx ON kob_leads(mode);

-- Config integer multipliers
ALTER TABLE kob_configuration
  ADD COLUMN native_brand_multiplier int NOT NULL DEFAULT 4,
  ADD COLUMN other_brand_multiplier  int NOT NULL DEFAULT 2;

-- state_native_brand
CREATE TABLE public.state_native_brand (
  state_id uuid PRIMARY KEY REFERENCES india_states(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.state_native_brand TO authenticated;
GRANT ALL ON public.state_native_brand TO service_role;
ALTER TABLE public.state_native_brand ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snb read auth" ON public.state_native_brand FOR SELECT TO authenticated USING (true);
CREATE POLICY "snb manage mgr" ON public.state_native_brand FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));

-- gallabox_templates
CREATE TABLE public.gallabox_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  body text NOT NULL,
  language lead_language NOT NULL DEFAULT 'ENGLISH',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gallabox_templates TO authenticated;
GRANT ALL ON public.gallabox_templates TO service_role;
ALTER TABLE public.gallabox_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gbx read auth" ON public.gallabox_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "gbx manage mgr" ON public.gallabox_templates FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));
CREATE TRIGGER trg_gbx_updated BEFORE UPDATE ON gallabox_templates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- kpi_targets
CREATE TABLE public.kpi_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric text NOT NULL,
  period text NOT NULL DEFAULT 'monthly',
  target_value numeric NOT NULL DEFAULT 0,
  effective_from date NOT NULL DEFAULT date_trunc('month', now())::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(metric, period, effective_from)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_targets TO authenticated;
GRANT ALL ON public.kpi_targets TO service_role;
ALTER TABLE public.kpi_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kpi read auth" ON public.kpi_targets FOR SELECT TO authenticated USING (true);
CREATE POLICY "kpi manage mgr" ON public.kpi_targets FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager'));

-- VIEWS
CREATE VIEW v_city_scope AS
SELECT
  c.id AS city_id, c.name AS city_name, c.tier, c.pincode_count,
  c.active AS city_active,
  s.id AS state_id, s.name AS state_name, s.active AS state_active,
  d.id AS district_id, d.name AS district_name, d.active AS district_active,
  b_native.id AS native_brand_id, b_native.name AS native_brand_name,
  cfg.native_brand_multiplier, cfg.other_brand_multiplier,
  (c.pincode_count * cfg.native_brand_multiplier) AS native_kitchen_scope,
  (c.pincode_count * cfg.other_brand_multiplier *
     GREATEST(0, (SELECT count(*)::int FROM brands b
       WHERE b.active = true AND (b_native.id IS NULL OR b.id <> b_native.id))))
    AS other_kitchen_scope
FROM india_cities c
JOIN india_districts d ON d.id = c.district_id
JOIN india_states s ON s.id = c.state_id
LEFT JOIN state_native_brand snb ON snb.state_id = s.id
LEFT JOIN brands b_native ON b_native.id = COALESCE(c.native_brand_id, snb.brand_id)
CROSS JOIN kob_configuration cfg
WHERE cfg.id = 1;
GRANT SELECT ON v_city_scope TO authenticated;

CREATE VIEW v_funnel_by_source AS
SELECT ls.id AS source_id, ls.name AS source_name, ls.cost_per_lead,
  count(l.*) AS total_leads,
  count(l.*) FILTER (WHERE l.stage='LEAD_INBOX') AS inbox_count,
  count(l.*) FILTER (WHERE l.stage='EOI_1') AS eoi1_count,
  count(l.*) FILTER (WHERE l.stage='WEBINAR') AS webinar_count,
  count(l.*) FILTER (WHERE l.stage='EOI_2') AS eoi2_count,
  count(l.*) FILTER (WHERE l.stage='FORM_FILLED') AS form_filled_count,
  count(l.*) FILTER (WHERE l.stage='FEE_PAID') AS fee_paid_count,
  count(l.*) FILTER (WHERE l.stage='AGREEMENT_SIGNED') AS agreement_count,
  count(l.*) FILTER (WHERE l.stage='KTN_CS') AS ktn_cs_count,
  count(l.*) FILTER (WHERE l.stage='KTN_LIVE') AS ktn_live_count,
  count(l.*)::numeric * ls.cost_per_lead AS total_spend
FROM lead_sources ls LEFT JOIN kob_leads l ON l.source_id = ls.id
GROUP BY ls.id, ls.name, ls.cost_per_lead;
GRANT SELECT ON v_funnel_by_source TO authenticated;

CREATE VIEW v_funnel_by_language AS
SELECT language,
  count(*) AS total_leads,
  count(*) FILTER (WHERE stage='FEE_PAID') AS fee_paid,
  count(*) FILTER (WHERE stage='AGREEMENT_SIGNED') AS agreement,
  count(*) FILTER (WHERE stage='KTN_CS') AS ktn_cs,
  count(*) FILTER (WHERE stage='KTN_LIVE') AS ktn_live
FROM kob_leads GROUP BY language;
GRANT SELECT ON v_funnel_by_language TO authenticated;

CREATE VIEW v_funnel_by_brand AS
SELECT b.id AS brand_id, b.name AS brand_name, b.code AS brand_code,
  count(l.*) AS total_leads,
  count(l.*) FILTER (WHERE l.stage='FEE_PAID') AS fee_paid,
  count(l.*) FILTER (WHERE l.stage='AGREEMENT_SIGNED') AS agreement,
  count(l.*) FILTER (WHERE l.stage='KTN_CS') AS ktn_cs,
  count(l.*) FILTER (WHERE l.stage='KTN_LIVE') AS ktn_live
FROM brands b LEFT JOIN kob_leads l ON l.brand_id = b.id
GROUP BY b.id, b.name, b.code;
GRANT SELECT ON v_funnel_by_brand TO authenticated;

CREATE VIEW v_retargeting_queue AS
SELECT r.id, r.lead_id, r.bucket, r.phase, r.attempts_done, r.next_touch_at, r.is_dead,
  l.code, l.full_name, l.phone, l.assigned_to, l.team_leader_id, l.stage,
  l.language, l.mode,
  s.name AS state_name, c.name AS city_name, br.name AS brand_name
FROM retargeting_schedule r
JOIN kob_leads l ON l.id = r.lead_id
LEFT JOIN india_states s ON s.id = l.state_id
LEFT JOIN india_cities c ON c.id = l.city_id
LEFT JOIN brands br ON br.id = l.brand_id
WHERE r.is_dead = false;
GRANT SELECT ON v_retargeting_queue TO authenticated;

CREATE VIEW v_scv_leaderboard AS
SELECT p.id AS user_id, p.full_name,
  count(l.*) AS lead_count,
  COALESCE(avg(l.scv_score)::int, 0) AS avg_scv,
  count(l.*) FILTER (WHERE l.stage='KTN_LIVE') AS conversions,
  count(l.*) FILTER (WHERE l.stage='FEE_PAID') AS fee_paid,
  count(l.*) FILTER (WHERE l.stage='AGREEMENT_SIGNED') AS agreement
FROM profiles p LEFT JOIN kob_leads l ON l.assigned_to = p.id
GROUP BY p.id, p.full_name;
GRANT SELECT ON v_scv_leaderboard TO authenticated;

CREATE VIEW v_kpi_snapshot AS
WITH t AS (
  SELECT DISTINCT ON (metric) metric, target_value
  FROM kpi_targets ORDER BY metric, effective_from DESC
), cc AS (
  SELECT 'FEE_PAID'::text AS metric, count(*)::numeric AS achieved
    FROM kob_leads WHERE stage='FEE_PAID' AND updated_at >= date_trunc('month', now())
  UNION ALL SELECT 'AGREEMENT_SIGNED', count(*) FROM kob_leads
    WHERE stage='AGREEMENT_SIGNED' AND updated_at >= date_trunc('month', now())
  UNION ALL SELECT 'KTN_CS', count(*) FROM kob_leads
    WHERE stage='KTN_CS' AND updated_at >= date_trunc('month', now())
  UNION ALL SELECT 'KTN_LIVE', count(*) FROM kob_leads
    WHERE stage='KTN_LIVE' AND updated_at >= date_trunc('month', now())
  UNION ALL SELECT 'TOTAL_LEADS', count(*) FROM kob_leads
    WHERE created_at >= date_trunc('month', now())
), pc AS (
  SELECT 'FEE_PAID'::text AS metric, count(*)::numeric AS prev
    FROM kob_leads WHERE stage='FEE_PAID'
      AND updated_at >= date_trunc('month', now()) - interval '1 month'
      AND updated_at <  date_trunc('month', now())
  UNION ALL SELECT 'AGREEMENT_SIGNED', count(*) FROM kob_leads WHERE stage='AGREEMENT_SIGNED'
      AND updated_at >= date_trunc('month', now()) - interval '1 month'
      AND updated_at <  date_trunc('month', now())
  UNION ALL SELECT 'KTN_CS', count(*) FROM kob_leads WHERE stage='KTN_CS'
      AND updated_at >= date_trunc('month', now()) - interval '1 month'
      AND updated_at <  date_trunc('month', now())
  UNION ALL SELECT 'KTN_LIVE', count(*) FROM kob_leads WHERE stage='KTN_LIVE'
      AND updated_at >= date_trunc('month', now()) - interval '1 month'
      AND updated_at <  date_trunc('month', now())
  UNION ALL SELECT 'TOTAL_LEADS', count(*) FROM kob_leads
      WHERE created_at >= date_trunc('month', now()) - interval '1 month'
        AND created_at <  date_trunc('month', now())
)
SELECT cc.metric, COALESCE(t.target_value, 0) AS target, cc.achieved,
  CASE WHEN EXTRACT(day FROM now()) > 0
    THEN round((cc.achieved / EXTRACT(day FROM now())) *
      EXTRACT(day FROM (date_trunc('month', now()) + interval '1 month' - interval '1 day')), 1)
    ELSE 0 END AS run_rate,
  CASE WHEN COALESCE(t.target_value,0) > 0
    THEN round((cc.achieved / t.target_value) * 100, 1) ELSE 0 END AS achieved_pct,
  COALESCE(pc.prev, 0) AS prev_period,
  CASE
    WHEN COALESCE(pc.prev,0) = 0 AND cc.achieved > 0 THEN 'up'
    WHEN cc.achieved > pc.prev THEN 'up'
    WHEN cc.achieved < pc.prev THEN 'down'
    ELSE 'flat'
  END AS trend
FROM cc LEFT JOIN t ON t.metric = cc.metric
LEFT JOIN pc ON pc.metric = cc.metric;
GRANT SELECT ON v_kpi_snapshot TO authenticated;
