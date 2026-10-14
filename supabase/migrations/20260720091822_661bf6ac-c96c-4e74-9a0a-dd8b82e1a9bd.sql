DROP POLICY IF EXISTS "mgr write questions" ON public.evaluation_questions;
DROP POLICY IF EXISTS "mgr update questions" ON public.evaluation_questions;
DROP POLICY IF EXISTS "mgr delete questions" ON public.evaluation_questions;

CREATE POLICY "mgr tl write questions" ON public.evaluation_questions FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager') OR has_role(auth.uid(),'team_leader'));
CREATE POLICY "mgr tl update questions" ON public.evaluation_questions FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager') OR has_role(auth.uid(),'team_leader'))
  WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager') OR has_role(auth.uid(),'team_leader'));
CREATE POLICY "mgr tl delete questions" ON public.evaluation_questions FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'kob_manager') OR has_role(auth.uid(),'team_leader'));