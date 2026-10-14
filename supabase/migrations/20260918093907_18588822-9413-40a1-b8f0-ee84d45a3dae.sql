DROP TRIGGER trg_retargeting_first_touch ON public.kob_leads;
CREATE TRIGGER trg_retargeting_first_touch
  AFTER UPDATE OF stage ON public.kob_leads
  FOR EACH ROW
  WHEN ((OLD.stage = ANY (ARRAY['EOI_1'::lead_stage, 'LEAD_INBOX'::lead_stage, 'FAILED_FIRE'::lead_stage, 'WEBINAR'::lead_stage])
         AND NEW.stage = ANY (ARRAY['LATER'::lead_stage, 'NO_RESPONSE'::lead_stage])))
  EXECUTE FUNCTION send_retargeting_first_touch()