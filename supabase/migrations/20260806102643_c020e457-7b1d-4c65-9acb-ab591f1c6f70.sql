DROP POLICY IF EXISTS "leads tl team" ON public.kob_leads;
CREATE POLICY "leads tl team" ON public.kob_leads FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'team_leader'::app_role));
DROP POLICY IF EXISTS "leads tl update team" ON public.kob_leads;
CREATE POLICY "leads tl update team" ON public.kob_leads FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'team_leader'::app_role));