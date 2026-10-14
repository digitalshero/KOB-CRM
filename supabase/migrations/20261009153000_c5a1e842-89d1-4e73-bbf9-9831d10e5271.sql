-- Table to store campaign selections for KOB Dashboard CPL calculation
CREATE TABLE IF NOT EXISTS public.meta_campaign_selections (
  campaign_id text PRIMARY KEY,
  campaign_name text,
  is_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.meta_campaign_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meta_campaign_selections read all authenticated"
  ON public.meta_campaign_selections
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "meta_campaign_selections write admin manager"
  ON public.meta_campaign_selections
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role) OR
    public.has_role(auth.uid(), 'kob_manager'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role) OR
    public.has_role(auth.uid(), 'kob_manager'::app_role)
  );
