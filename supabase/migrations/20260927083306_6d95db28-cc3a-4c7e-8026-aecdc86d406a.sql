CREATE INDEX IF NOT EXISTS idx_kob_leads_created_at ON public.kob_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kob_leads_mode_created_at ON public.kob_leads (mode, created_at);
CREATE INDEX IF NOT EXISTS idx_kob_leads_stage_entered ON public.kob_leads (stage, stage_entered_at);
CREATE INDEX IF NOT EXISTS idx_lead_events_event_lead ON public.lead_events (event, (payload->>'lead_id'));