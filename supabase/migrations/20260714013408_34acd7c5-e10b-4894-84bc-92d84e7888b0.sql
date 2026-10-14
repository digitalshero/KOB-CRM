
CREATE OR REPLACE FUNCTION public.log_lead_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.lead_activities (lead_id, actor_id, activity_type, detail)
  VALUES (
    NEW.id,
    COALESCE(auth.uid(), NEW.assigned_to),
    'STAGE_CHANGE',
    OLD.stage::text || ' -> ' || NEW.stage::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_lead_activity ON public.kob_leads;
CREATE TRIGGER trg_log_lead_activity
AFTER UPDATE ON public.kob_leads
FOR EACH ROW
WHEN (NEW.stage IS DISTINCT FROM OLD.stage)
EXECUTE FUNCTION public.log_lead_activity();
