ALTER TABLE public.kob_leads ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
CREATE INDEX IF NOT EXISTS idx_kob_leads_tags ON public.kob_leads USING GIN (tags);