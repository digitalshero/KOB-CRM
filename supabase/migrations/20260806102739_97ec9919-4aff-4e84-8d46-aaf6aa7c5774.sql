DROP POLICY IF EXISTS "user_roles tl reads team execs" ON public.user_roles;
CREATE POLICY "user_roles tl reads team execs" ON public.user_roles FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'team_leader'::app_role));