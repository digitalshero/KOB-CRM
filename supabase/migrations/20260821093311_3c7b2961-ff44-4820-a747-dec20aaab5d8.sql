DO $$
BEGIN
  PERFORM cron.unschedule('mark-failed-fire-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP FUNCTION IF EXISTS public.mark_failed_fire_leads(integer);

CREATE FUNCTION public.mark_failed_fire_leads(_grace_hours integer DEFAULT 2)
RETURNS TABLE(processed integer, moved integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- DISABLED: FAILED_FIRE is now set exclusively by the Gallabox
  -- Message.WA.Status.Failed webhook for template 6a619af9797a751542542897.
  processed := 0;
  moved := 0;
  RETURN NEXT;
END;
$$;