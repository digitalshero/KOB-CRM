GRANT SELECT, UPDATE ON public.gallabox_fire_queue TO service_role;
GRANT SELECT, UPDATE ON public.email_fire_queue TO service_role;
GRANT SELECT ON public.gallabox_fire_queue TO authenticated;
GRANT SELECT ON public.email_fire_queue TO authenticated;