
-- 1. Add primary_language to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_language public.lead_language;

-- 2. Auto-assign trigger for LEAD_INBOX entries
CREATE OR REPLACE FUNCTION public.auto_assign_lead_inbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  picked_exec uuid;
  picked_tl uuid;
BEGIN
  IF NEW.stage <> 'LEAD_INBOX' OR NEW.assigned_to IS NOT NULL OR NEW.language IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.team_leader_id
    INTO picked_exec, picked_tl
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'executive'
  WHERE p.primary_language = NEW.language
  ORDER BY (
    SELECT COUNT(*) FROM public.kob_leads kl
    WHERE kl.assigned_to = p.id
      AND kl.stage NOT IN ('KTN_LIVE','DEAD_LEAD','NO')
  ) ASC, random()
  LIMIT 1;

  IF picked_exec IS NOT NULL THEN
    NEW.assigned_to := picked_exec;
    IF NEW.team_leader_id IS NULL THEN
      NEW.team_leader_id := picked_tl;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_assign_lead_inbox ON public.kob_leads;
CREATE TRIGGER trg_auto_assign_lead_inbox
  BEFORE INSERT ON public.kob_leads
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_lead_inbox();
