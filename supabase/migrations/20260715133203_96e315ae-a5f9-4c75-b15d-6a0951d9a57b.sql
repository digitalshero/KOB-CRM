
DROP VIEW IF EXISTS public.v_scv_leaderboard;

CREATE VIEW public.v_scv_leaderboard
WITH (security_invoker = true)
AS
WITH rules AS (
  SELECT weight_conversion, weight_tat, weight_eoi1_webinar,
         weight_eoi2_payment, weight_crm_discipline
  FROM public.scv_rules WHERE id = 1
),
reached AS (
  SELECT lead_id, to_stage AS stage FROM public.lead_stage_history
  UNION
  SELECT id AS lead_id, stage FROM public.kob_leads
),
assigned AS (
  SELECT l.id, l.assigned_to, l.stage, l.stage_entered_at,
         l.brand_id, l.language, l.source_id, l.state_id
  FROM public.kob_leads l
  WHERE l.assigned_to IS NOT NULL
),
-- stages considered "at or beyond" a target milestone
milestones AS (
  SELECT r.lead_id,
    bool_or(r.stage IN ('EOI_1','WEBINAR','EOI_2','FORM_FILLED','FEE_PAID','AGREEMENT_SIGNED','KTN_CS','KTN_LIVE')) AS reached_eoi1,
    bool_or(r.stage IN ('WEBINAR','EOI_2','FORM_FILLED','FEE_PAID','AGREEMENT_SIGNED','KTN_CS','KTN_LIVE')) AS reached_webinar,
    bool_or(r.stage IN ('EOI_2','FORM_FILLED','FEE_PAID','AGREEMENT_SIGNED','KTN_CS','KTN_LIVE')) AS reached_eoi2,
    bool_or(r.stage IN ('FEE_PAID','AGREEMENT_SIGNED','KTN_CS','KTN_LIVE')) AS reached_paid
  FROM reached r
  GROUP BY r.lead_id
),
per_user AS (
  SELECT
    a.assigned_to AS user_id,
    COUNT(*)::numeric AS total,
    COUNT(*) FILTER (WHERE COALESCE(m.reached_paid,false))::numeric AS conv_count,
    COUNT(*) FILTER (WHERE (now() - a.stage_entered_at) <= interval '48 hours')::numeric AS tat_ok,
    COUNT(*) FILTER (WHERE COALESCE(m.reached_eoi1,false))::numeric AS reached_eoi1,
    COUNT(*) FILTER (WHERE COALESCE(m.reached_webinar,false))::numeric AS reached_webinar,
    COUNT(*) FILTER (WHERE COALESCE(m.reached_eoi2,false))::numeric AS reached_eoi2,
    COUNT(*) FILTER (WHERE COALESCE(m.reached_paid,false))::numeric AS reached_paid,
    COUNT(*) FILTER (
      WHERE a.brand_id IS NOT NULL AND a.language IS NOT NULL
        AND a.source_id IS NOT NULL AND a.state_id IS NOT NULL
    )::numeric AS crm_clean
  FROM assigned a
  LEFT JOIN milestones m ON m.lead_id = a.id
  GROUP BY a.assigned_to
)
SELECT
  p.id AS user_id,
  p.full_name,
  COALESCE(pu.total, 0)::integer AS lead_count,
  COALESCE(pu.conv_count, 0)::integer AS conversions,
  COALESCE(pu.conv_count, 0)::integer AS fee_paid,
  CASE WHEN COALESCE(pu.total,0)=0 THEN 0
       ELSE ROUND(100 * pu.conv_count / pu.total) END::integer AS conversion_pct,
  CASE WHEN COALESCE(pu.total,0)=0 THEN 0
       ELSE ROUND(100 * pu.tat_ok / pu.total) END::integer AS tat_pct,
  CASE WHEN COALESCE(pu.reached_eoi1,0)=0 THEN 0
       ELSE ROUND(100 * pu.reached_webinar / pu.reached_eoi1) END::integer AS eoi1_webinar_pct,
  CASE WHEN COALESCE(pu.reached_eoi2,0)=0 THEN 0
       ELSE ROUND(100 * pu.reached_paid / pu.reached_eoi2) END::integer AS eoi2_payment_pct,
  CASE WHEN COALESCE(pu.total,0)=0 THEN 0
       ELSE ROUND(100 * pu.crm_clean / pu.total) END::integer AS crm_pct,
  ROUND(
    (CASE WHEN COALESCE(pu.total,0)=0 THEN 0 ELSE 100.0*pu.conv_count/pu.total END) * r.weight_conversion / 100
  + (CASE WHEN COALESCE(pu.total,0)=0 THEN 0 ELSE 100.0*pu.tat_ok/pu.total END) * r.weight_tat / 100
  + (CASE WHEN COALESCE(pu.reached_eoi1,0)=0 THEN 0 ELSE 100.0*pu.reached_webinar/pu.reached_eoi1 END) * r.weight_eoi1_webinar / 100
  + (CASE WHEN COALESCE(pu.reached_eoi2,0)=0 THEN 0 ELSE 100.0*pu.reached_paid/pu.reached_eoi2 END) * r.weight_eoi2_payment / 100
  + (CASE WHEN COALESCE(pu.total,0)=0 THEN 0 ELSE 100.0*pu.crm_clean/pu.total END) * r.weight_crm_discipline / 100
  )::integer AS avg_scv
FROM public.profiles p
CROSS JOIN rules r
LEFT JOIN per_user pu ON pu.user_id = p.id;

GRANT SELECT ON public.v_scv_leaderboard TO authenticated;
