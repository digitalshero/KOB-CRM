
CREATE TABLE public.webinar_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  language text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webinar_batches TO authenticated;
GRANT ALL ON public.webinar_batches TO service_role;
ALTER TABLE public.webinar_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read webinar_batches" ON public.webinar_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write webinar_batches" ON public.webinar_batches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update webinar_batches" ON public.webinar_batches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete webinar_batches" ON public.webinar_batches FOR DELETE TO authenticated USING (true);
CREATE TRIGGER trg_webinar_batches_updated BEFORE UPDATE ON public.webinar_batches FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.webinar_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.webinar_batches(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  attended boolean NOT NULL DEFAULT false,
  marked_at timestamptz,
  marked_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, lead_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webinar_attendance TO authenticated;
GRANT ALL ON public.webinar_attendance TO service_role;
ALTER TABLE public.webinar_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read webinar_attendance" ON public.webinar_attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write webinar_attendance" ON public.webinar_attendance FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update webinar_attendance" ON public.webinar_attendance FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete webinar_attendance" ON public.webinar_attendance FOR DELETE TO authenticated USING (true);
CREATE TRIGGER trg_webinar_attendance_updated BEFORE UPDATE ON public.webinar_attendance FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_webinar_batches_scheduled_at ON public.webinar_batches(scheduled_at DESC);
CREATE INDEX idx_webinar_attendance_batch ON public.webinar_attendance(batch_id);
CREATE INDEX idx_webinar_attendance_lead ON public.webinar_attendance(lead_id);
