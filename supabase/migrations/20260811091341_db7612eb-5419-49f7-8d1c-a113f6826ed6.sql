CREATE OR REPLACE VIEW public.v_kpi_snapshot AS
WITH t AS (
  SELECT DISTINCT ON (kpi_targets.metric) kpi_targets.metric, kpi_targets.target_value
  FROM kpi_targets ORDER BY kpi_targets.metric, kpi_targets.effective_from DESC
), cc AS (
  SELECT 'FEE_PAID'::text AS metric, count(*)::numeric AS achieved FROM kob_leads WHERE stage='FEE_PAID'::lead_stage AND updated_at >= date_trunc('month', now())
  UNION ALL SELECT 'AGREEMENT_SIGNED'::text, count(*) FROM kob_leads WHERE stage='AGREEMENT_SIGNED'::lead_stage AND updated_at >= date_trunc('month', now())
  UNION ALL SELECT 'KTN_CS'::text, count(*) FROM kob_leads WHERE stage='KTN_CS'::lead_stage AND updated_at >= date_trunc('month', now())
  UNION ALL SELECT 'KTN_LIVE'::text, count(*) FROM kob_leads WHERE stage='KTN_LIVE'::lead_stage AND updated_at >= date_trunc('month', now())
  UNION ALL SELECT 'PARKED'::text, count(*) FROM kob_leads WHERE stage = ANY (ARRAY['NO_RESPONSE','LATER','NO','RETARGETING']::lead_stage[]) AND updated_at >= date_trunc('month', now())
  UNION ALL SELECT 'TOTAL_LEADS'::text, count(*) FROM kob_leads WHERE created_at >= date_trunc('month', now())
), pc AS (
  SELECT 'FEE_PAID'::text AS metric, count(*)::numeric AS prev FROM kob_leads WHERE stage='FEE_PAID'::lead_stage AND updated_at >= date_trunc('month', now()) - interval '1 mon' AND updated_at < date_trunc('month', now())
  UNION ALL SELECT 'AGREEMENT_SIGNED'::text, count(*) FROM kob_leads WHERE stage='AGREEMENT_SIGNED'::lead_stage AND updated_at >= date_trunc('month', now()) - interval '1 mon' AND updated_at < date_trunc('month', now())
  UNION ALL SELECT 'KTN_CS'::text, count(*) FROM kob_leads WHERE stage='KTN_CS'::lead_stage AND updated_at >= date_trunc('month', now()) - interval '1 mon' AND updated_at < date_trunc('month', now())
  UNION ALL SELECT 'KTN_LIVE'::text, count(*) FROM kob_leads WHERE stage='KTN_LIVE'::lead_stage AND updated_at >= date_trunc('month', now()) - interval '1 mon' AND updated_at < date_trunc('month', now())
  UNION ALL SELECT 'PARKED'::text, count(*) FROM kob_leads WHERE stage = ANY (ARRAY['NO_RESPONSE','LATER','NO','RETARGETING']::lead_stage[]) AND updated_at >= date_trunc('month', now()) - interval '1 mon' AND updated_at < date_trunc('month', now())
  UNION ALL SELECT 'TOTAL_LEADS'::text, count(*) FROM kob_leads WHERE created_at >= date_trunc('month', now()) - interval '1 mon' AND created_at < date_trunc('month', now())
)
SELECT cc.metric,
  COALESCE(t.target_value, 0::numeric) AS target,
  cc.achieved,
  CASE WHEN EXTRACT(day FROM now()) > 0 THEN round(cc.achieved / EXTRACT(day FROM now()) * EXTRACT(day FROM date_trunc('month', now()) + interval '1 mon' - interval '1 day'), 1) ELSE 0 END AS run_rate,
  CASE WHEN COALESCE(t.target_value, 0::numeric) > 0 THEN round(cc.achieved / t.target_value * 100, 1) ELSE 0 END AS achieved_pct,
  COALESCE(pc.prev, 0::numeric) AS prev_period,
  CASE WHEN COALESCE(pc.prev, 0::numeric) = 0 AND cc.achieved > 0 THEN 'up'
       WHEN cc.achieved > pc.prev THEN 'up'
       WHEN cc.achieved < pc.prev THEN 'down' ELSE 'flat' END AS trend
FROM cc LEFT JOIN t ON t.metric = cc.metric LEFT JOIN pc ON pc.metric = cc.metric;