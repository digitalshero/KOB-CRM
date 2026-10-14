ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS assignment_active boolean NOT NULL DEFAULT true;

UPDATE public.profiles SET assignment_active = false, updated_at = now()
WHERE id IN ('8c4dff0d-cd27-474d-9ea8-9cc15b9a93f5','a6bb9b28-912b-46cc-9489-ec4aa7cdda29');

CREATE OR REPLACE FUNCTION public.auto_assign_lead_inbox()
RETURNS trigger
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
  WHERE COALESCE(p.assignment_active, true) = true
    AND (p.primary_language = NEW.language OR p.secondary_language = NEW.language)
  ORDER BY
    (CASE WHEN p.primary_language = NEW.language THEN 0 ELSE 1 END) ASC,
    (
      SELECT COUNT(*) FROM public.kob_leads kl
      WHERE kl.assigned_to = p.id
        AND kl.stage NOT IN ('KTN_LIVE','DEAD_LEAD','NO')
    ) ASC,
    random()
  LIMIT 1;

  IF picked_exec IS NULL THEN
    SELECT p.id, p.team_leader_id
      INTO picked_exec, picked_tl
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'executive'
    WHERE COALESCE(p.assignment_active, true) = true
    ORDER BY (
      SELECT COUNT(*) FROM public.kob_leads kl
      WHERE kl.assigned_to = p.id
        AND kl.stage NOT IN ('KTN_LIVE','DEAD_LEAD','NO')
    ) ASC, random()
    LIMIT 1;
  END IF;

  IF picked_exec IS NOT NULL THEN
    NEW.assigned_to := picked_exec;
    IF NEW.team_leader_id IS NULL THEN
      NEW.team_leader_id := picked_tl;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;