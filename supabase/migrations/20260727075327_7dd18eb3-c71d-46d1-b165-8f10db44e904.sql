ALTER TABLE public.kob_leads
  ADD COLUMN IF NOT EXISTS last_message text,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS unread_message_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_unread_messages boolean NOT NULL DEFAULT false;