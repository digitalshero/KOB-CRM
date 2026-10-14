-- Team leaders may maintain the monthly KTN CS target (CRM Discipline stays manager-only)
CREATE POLICY "Team leaders can set monthly targets"
  ON public.scv_monthly_inputs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'team_leader'));

CREATE POLICY "Team leaders can update monthly targets"
  ON public.scv_monthly_inputs
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'team_leader'))
  WITH CHECK (public.has_role(auth.uid(), 'team_leader'));
