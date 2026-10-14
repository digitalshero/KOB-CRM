CREATE POLICY "user_roles tl reads team execs"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'team_leader'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = user_roles.user_id
      AND p.team_leader_id = auth.uid()
  )
);