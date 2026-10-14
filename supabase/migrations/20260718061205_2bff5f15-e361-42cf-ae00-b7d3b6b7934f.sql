CREATE POLICY "user_roles manager admin read all"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'kob_manager') OR public.has_role(auth.uid(), 'super_admin'));