
-- Add stage_entered_at for accurate TAT tracking
ALTER TABLE public.kob_leads
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz NOT NULL DEFAULT now();

-- Backfill from best available signal
UPDATE public.kob_leads
  SET stage_entered_at = COALESCE(last_activity_at, updated_at, created_at)
  WHERE stage_entered_at IS NULL OR stage_entered_at = created_at;

-- Update stage-change trigger to also stamp stage_entered_at
CREATE OR REPLACE FUNCTION public.on_lead_stage_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.lead_stage_history(lead_id, from_stage, to_stage, changed_by)
    VALUES (NEW.id, OLD.stage, NEW.stage, auth.uid());
    NEW.last_activity_at := now();
    NEW.stage_entered_at := now();
    IF NEW.stage = 'KTN_LIVE'::lead_stage AND NEW.converted_at IS NULL THEN
      NEW.converted_at := now();
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- Rewrite v_scv_leaderboard to compute live from real stage / TAT / CRM data
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
  SELECT lead_id, to_stage FROM public.lead_stage_history
  UNION
  SELECT id AS lead_id, stage AS to_stage FROM public.kob_leads
),
assigned AS (
  SELECT l.id, l.assigned_to, l.stage, l.stage_entered_at,
         l.brand_id, l.language, l.source_id, l.state_id
  FROM public.kob_leads l
  WHERE l.assigned_to IS NOT NULL
),
per_user AS (
  SELECT
    a.assigned_to AS user_id,
    COUNT(*)::numeric AS total,
    COUNT(*) FILTER (
      WHERE EXISTS (SELECT 1 FROM reached r
        WHERE r.lead_id = a.id
          AND r.to_stage IN ('FEE_PAID','AGREEMENT_SIGNED','KTN_CS','KTN_LIVE'))
    )::numeric AS conv_count,
    COUNT(*) FILTER (WHERE (now() - a.stage_entered_at) <= interval '48 hours')::numeric AS tat_ok,
    COUNT(*) FILTER (
      WHERE EXISTS (SELECT 1 FROM reached r
        WHERE r.lead_id = a.id AND r.to_stage = 'EOI_1')
    )::numeric AS reached_eoi1,
    COUNT(*) FILTER (
      WHERE EXISTS (SELECT 1 FROM reached r
        WHERE r.lead_id = a.id
          AND r.to_stage IN ('WEBINAR','EOI_2','FORM_FILLED','FEE_PAID','AGREEMENT_SIGNED','KTN_CS','KTN_LIVE'))
    )::numeric AS reached_webinar,
    COUNT(*) FILTER (
      WHERE EXISTS (SELECT 1 FROM reached r
        WHERE r.lead_id = a.id AND r.to_stage = 'EOI_2')
    )::numeric AS reached_eoi2,
    COUNT(*) FILTER (
      WHERE EXISTS (SELECT 1 FROM reached r
        WHERE r.lead_id = a.id
          AND r.to_stage IN ('FEE_PAID','AGREEMENT_SIGNED','KTN_CS','KTN_LIVE'))
    )::numeric AS reached_paid,
    COUNT(*) FILTER (
      WHERE a.brand_id IS NOT NULL AND a.language IS NOT NULL
        AND a.source_id IS NOT NULL AND a.state_id IS NOT NULL
    )::numeric AS crm_clean
  FROM assigned a
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
