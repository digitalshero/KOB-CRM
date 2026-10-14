
-- 1) BEFORE INSERT: coerce AUTO+LEAD_INBOX to AUTO_FIRED so the stored stage is correct from the start
CREATE OR REPLACE FUNCTION public.coerce_auto_initial_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.mode = 'AUTO'::lead_mode AND NEW.stage = 'LEAD_INBOX'::lead_stage THEN
    NEW.stage := 'AUTO_FIRED'::lead_stage;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coerce_auto_initial_stage ON public.kob_leads;
CREATE TRIGGER trg_coerce_auto_initial_stage
BEFORE INSERT ON public.kob_leads
FOR EACH ROW
EXECUTE FUNCTION public.coerce_auto_initial_stage();

-- 2) Retarget the auto-fire queue trigger to the new stored stage (AUTO_FIRED)
DROP TRIGGER IF EXISTS trg_lead_auto_fire ON public.kob_leads;
CREATE TRIGGER trg_lead_auto_fire
AFTER INSERT ON public.kob_leads
FOR EACH ROW
WHEN (NEW.mode = 'AUTO'::lead_mode AND NEW.stage = 'AUTO_FIRED'::lead_stage)
EXECUTE FUNCTION public.enqueue_gallabox_auto_fire();
