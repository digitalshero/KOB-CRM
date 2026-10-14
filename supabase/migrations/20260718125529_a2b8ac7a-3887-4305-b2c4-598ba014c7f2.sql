
CREATE OR REPLACE VIEW public.v_abandoned_leads AS
SELECT l.id AS lead_id,
       l.code,
       l.full_name,
       l.stage,
       l.assigned_to,
       l.team_leader_id,
       l.brand_id,
       b.name AS brand_name,
       l.language,
       l.stage_entered_at,
       EXTRACT(epoch FROM now() - COALESCE(l.stage_entered_at, l.created_at)) / 86400.0 AS days_in_stage,
       (EXTRACT(epoch FROM now() - COALESCE(l.stage_entered_at, l.created_at)) / 86400.0) >= 7::numeric AS is_abandoned
FROM kob_leads l
LEFT JOIN brands b ON b.id = l.brand_id
WHERE l.stage NOT IN ('KTN_LIVE'::lead_stage, 'DEAD_LEAD'::lead_stage);
