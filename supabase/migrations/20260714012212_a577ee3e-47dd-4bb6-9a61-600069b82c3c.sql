
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS allocation_mode text NOT NULL DEFAULT 'MANUAL'
    CHECK (allocation_mode IN ('MANUAL','ROUND_ROBIN')),
  ADD COLUMN IF NOT EXISTS rr_last_executive_id uuid;

CREATE OR REPLACE FUNCTION public.auto_allocate_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_last uuid;
  v_next uuid;
  v_exec_ids uuid[];
  v_idx int;
BEGIN
  SELECT allocation_mode, rr_last_executive_id
    INTO v_mode, v_last
    FROM public.profiles
    WHERE id = NEW.team_leader_id;

  IF v_mode IS DISTINCT FROM 'ROUND_ROBIN' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_exec_ids
    FROM public.profiles
    WHERE team_leader_id = NEW.team_leader_id;

  IF array_length(v_exec_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  v_idx := NULL;
  IF v_last IS NOT NULL THEN
    v_idx := array_position(v_exec_ids, v_last);
  END IF;

  IF v_idx IS NULL OR v_idx >= array_length(v_exec_ids, 1) THEN
    v_next := v_exec_ids[1];
  ELSE
    v_next := v_exec_ids[v_idx + 1];
  END IF;

  NEW.assigned_to := v_next;

  UPDATE public.profiles
    SET rr_last_executive_id = v_next, updated_at = now()
    WHERE id = NEW.team_leader_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_allocate_lead ON public.kob_leads;
CREATE TRIGGER trg_auto_allocate_lead
  BEFORE INSERT OR UPDATE ON public.kob_leads
  FOR EACH ROW
  WHEN (NEW.team_leader_id IS NOT NULL AND NEW.assigned_to IS NULL)
  EXECUTE FUNCTION public.auto_allocate_lead();
