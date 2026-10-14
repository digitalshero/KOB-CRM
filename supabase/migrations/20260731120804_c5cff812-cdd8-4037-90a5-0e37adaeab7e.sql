CREATE POLICY "leads tl insert team" ON public.kob_leads
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'team_leader'::app_role) AND team_leader_id = auth.uid());