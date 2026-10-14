
CREATE OR REPLACE VIEW public.v_abandoned_leads AS
SELECT
  l.id AS lead_id,
  l.code,
  l.full_name,
  l.stage,
  l.assigned_to,
  l.team_leader_id,
  l.brand_id,
  b.name AS brand_name,
  l.language,
  l.stage_entered_at,
  EXTRACT(EPOCH FROM (now() - COALESCE(l.stage_entered_at, l.created_at))) / 86400.0 AS days_in_stage,
  (EXTRACT(EPOCH FROM (now() - COALESCE(l.stage_entered_at, l.created_at))) / 86400.0) >= 7 AS is_abandoned
FROM public.kob_leads l
LEFT JOIN public.brands b ON b.id = l.brand_id
WHERE l.stage NOT IN (
  'KTN_LIVE'::lead_stage,
  'DEAD_LEAD'::lead_stage,
  'NO'::lead_stage,
  'LATER'::lead_stage,
  'NO_RESPONSE'::lead_stage,
  'RETARGETING'::lead_stage
);

GRANT SELECT ON public.v_abandoned_leads TO authenticated;
