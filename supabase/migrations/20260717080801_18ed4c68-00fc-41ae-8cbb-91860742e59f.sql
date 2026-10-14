DROP POLICY IF EXISTS "cfg manage mgr" ON public.kob_configuration;
CREATE POLICY "cfg manage mgr" ON public.kob_configuration FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager') OR has_role(auth.uid(),'team_leader'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager') OR has_role(auth.uid(),'team_leader'));