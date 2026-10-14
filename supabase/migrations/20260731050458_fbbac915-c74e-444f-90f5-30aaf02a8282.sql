ALTER TABLE public.kob_leads REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.kob_leads;