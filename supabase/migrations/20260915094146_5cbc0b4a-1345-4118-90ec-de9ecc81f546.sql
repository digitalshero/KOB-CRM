CREATE OR REPLACE FUNCTION public.auto_assign_lead_inbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  picked_exec uuid;
  picked_tl uuid;
  v_tamil_ids uuid[];
  v_last uuid;
  v_idx int;
BEGIN
  IF NEW.stage <> 'LEAD_INBOX' OR NEW.assigned_to IS NOT NULL OR NEW.language IS NULL THEN
    RETURN NEW;
  END IF;

  -- Tamil leads: strict alternating (round-robin) split between the active
  -- Tamil-primary executives. All other languages keep the existing logic.
  IF NEW.language = 'TAMIL' THEN
    SELECT COALESCE(array_agg(p.id ORDER BY p.id), ARRAY[]::uuid[])
      INTO v_tamil_ids
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'executive'
    WHERE COALESCE(p.assignment_active, true) = true
      AND p.primary_language = 'TAMIL';

    IF array_length(v_tamil_ids, 1) IS NOT NULL THEN
      SELECT kl.assigned_to INTO v_last
      FROM public.kob_leads kl
      WHERE kl.language = 'TAMIL'
        AND kl.assigned_to = ANY(v_tamil_ids)
      ORDER BY kl.created_at DESC
      LIMIT 1;

      v_idx := NULL;
      IF v_last IS NOT NULL THEN
        v_idx := array_position(v_tamil_ids, v_last);
      END IF;

      IF v_idx IS NULL OR v_idx >= array_length(v_tamil_ids, 1) THEN
        picked_exec := v_tamil_ids[1];
      ELSE
        picked_exec := v_tamil_ids[v_idx + 1];
      END IF;

      SELECT p.team_leader_id INTO picked_tl FROM public.profiles p WHERE p.id = picked_exec;

      NEW.assigned_to := picked_exec;
      IF NEW.team_leader_id IS NULL THEN
        NEW.team_leader_id := picked_tl;
      END IF;
      RETURN NEW;
    END IF;
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