
-- 1) evaluation_questions
CREATE TABLE public.evaluation_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_text text NOT NULL,
  weight numeric NOT NULL DEFAULT 1 CHECK (weight >= 0),
  question_type text NOT NULL CHECK (question_type IN ('SCALE_1_5','YES_NO','TEXT')),
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evaluation_questions TO authenticated;
GRANT ALL ON public.evaluation_questions TO service_role;
ALTER TABLE public.evaluation_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authed read questions" ON public.evaluation_questions FOR SELECT TO authenticated USING (true);
CREATE POLICY "mgr write questions" ON public.evaluation_questions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager'));
CREATE POLICY "mgr update questions" ON public.evaluation_questions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager'))
  WITH CHECK (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager'));
CREATE POLICY "mgr delete questions" ON public.evaluation_questions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager'));
CREATE TRIGGER trg_eval_q_updated BEFORE UPDATE ON public.evaluation_questions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) evaluation_responses
CREATE TABLE public.evaluation_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.kob_leads(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.evaluation_questions(id) ON DELETE CASCADE,
  answer_value numeric,
  answer_text text,
  filled_by uuid,
  filled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, question_id)
);
CREATE INDEX idx_eval_resp_lead ON public.evaluation_responses(lead_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evaluation_responses TO authenticated;
GRANT ALL ON public.evaluation_responses TO service_role;
ALTER TABLE public.evaluation_responses ENABLE ROW LEVEL SECURITY;

-- Read: manager/CEO all; TL sees team's leads; Exec sees own leads
CREATE POLICY "read eval responses scoped" ON public.evaluation_responses FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'super_admin')
  OR public.has_role(auth.uid(),'kob_manager')
  OR EXISTS (
    SELECT 1 FROM public.kob_leads l
    WHERE l.id = evaluation_responses.lead_id
      AND (l.assigned_to = auth.uid() OR l.team_leader_id = auth.uid())
  )
);
-- Insert: anyone authorized to see the lead can submit; filled_by must be self
CREATE POLICY "insert eval responses" ON public.evaluation_responses FOR INSERT TO authenticated
WITH CHECK (
  filled_by = auth.uid()
  AND (
    public.has_role(auth.uid(),'super_admin')
    OR public.has_role(auth.uid(),'kob_manager')
    OR EXISTS (
      SELECT 1 FROM public.kob_leads l
      WHERE l.id = evaluation_responses.lead_id
        AND (l.assigned_to = auth.uid() OR l.team_leader_id = auth.uid())
    )
  )
);
-- Update: own submission, or manager/CEO
CREATE POLICY "update eval responses" ON public.evaluation_responses FOR UPDATE TO authenticated
USING (
  filled_by = auth.uid()
  OR public.has_role(auth.uid(),'super_admin')
  OR public.has_role(auth.uid(),'kob_manager')
)
WITH CHECK (
  filled_by = auth.uid()
  OR public.has_role(auth.uid(),'super_admin')
  OR public.has_role(auth.uid(),'kob_manager')
);
CREATE POLICY "delete eval responses mgr" ON public.evaluation_responses FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'kob_manager'));

-- 3) v_lead_evaluation_score
CREATE OR REPLACE VIEW public.v_lead_evaluation_score AS
WITH scored AS (
  SELECT r.lead_id,
         q.weight,
         CASE
           WHEN q.question_type = 'SCALE_1_5' AND r.answer_value IS NOT NULL
             THEN (r.answer_value / 5.0) * 100.0
           WHEN q.question_type = 'YES_NO' AND r.answer_value IS NOT NULL
             THEN CASE WHEN r.answer_value >= 1 THEN 100.0 ELSE 0.0 END
           ELSE NULL
         END AS pct
  FROM public.evaluation_responses r
  JOIN public.evaluation_questions q ON q.id = r.question_id
  WHERE q.question_type IN ('SCALE_1_5','YES_NO')
    AND q.active = true
),
agg AS (
  SELECT lead_id,
         CASE WHEN SUM(weight) FILTER (WHERE pct IS NOT NULL) > 0
              THEN ROUND((SUM(pct * weight) FILTER (WHERE pct IS NOT NULL)
                          / SUM(weight) FILTER (WHERE pct IS NOT NULL))::numeric, 2)
              ELSE NULL END AS total_score,
         COUNT(*) FILTER (WHERE pct IS NOT NULL) AS scored_answered
  FROM scored
  GROUP BY lead_id
),
counts AS (
  SELECT r.lead_id, COUNT(*) AS answered_total
  FROM public.evaluation_responses r
  JOIN public.evaluation_questions q ON q.id = r.question_id AND q.active = true
  GROUP BY r.lead_id
)
SELECT
  c.lead_id,
  a.total_score,
  COALESCE(c.answered_total, 0) AS answered_count,
  (SELECT COUNT(*) FROM public.evaluation_questions WHERE active = true) AS total_active_questions,
  COALESCE(a.scored_answered, 0) AS scored_answered_count
FROM counts c
LEFT JOIN agg a ON a.lead_id = c.lead_id;

GRANT SELECT ON public.v_lead_evaluation_score TO authenticated;
