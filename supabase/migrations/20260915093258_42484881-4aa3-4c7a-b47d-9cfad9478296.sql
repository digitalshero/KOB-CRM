CREATE OR REPLACE FUNCTION public.send_meta_ads_initial_template()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source text;
  v_send_id uuid;
BEGIN
  IF NEW.source_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_source FROM public.lead_sources WHERE id = NEW.source_id;
  IF v_source IS NULL OR lower(trim(v_source)) <> 'meta ads' THEN RETURN NEW; END IF;

  -- CRM must NOT send the initial template for Meta Ads leads; the Meta Ads
  -- integration already sends it. Record a SKIPPED ledger row for idempotency
  -- and audit purposes only.
  INSERT INTO public.meta_ads_initial_sends(lead_id, status, error)
  VALUES (NEW.id, 'SKIPPED', 'handled by Meta Ads integration')
  ON CONFLICT (lead_id) DO NOTHING
  RETURNING id INTO v_send_id;

  IF v_send_id IS NOT NULL THEN
    INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, meta)
    VALUES (auth.uid(), 'META_ADS_INITIAL_TEMPLATE_SKIPPED', 'kob_leads', NEW.id,
            jsonb_build_object('reason', 'handled_by_meta_ads_integration',
                               'template', 'intial_common_drip_clone_clone_clone'));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;