
ALTER TABLE public.evaluation_responses
  DROP CONSTRAINT IF EXISTS evaluation_responses_lead_id_question_id_key;

ALTER TABLE public.evaluation_responses
  ADD COLUMN IF NOT EXISTS evaluation_id uuid,
  ADD COLUMN IF NOT EXISTS weight_at_time numeric;

UPDATE public.evaluation_responses r
  SET evaluation_id = md5(r.lead_id::text || date_trunc('second', r.filled_at)::text)::uuid
  WHERE evaluation_id IS NULL;

UPDATE public.evaluation_responses r
  SET weight_at_time = q.weight
  FROM public.evaluation_questions q
  WHERE r.question_id = q.id AND r.weight_at_time IS NULL;

ALTER TABLE public.evaluation_responses
  ALTER COLUMN evaluation_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eval_responses_eval_id ON public.evaluation_responses(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_eval_responses_lead_filled ON public.evaluation_responses(lead_id, filled_at DESC);

DROP VIEW IF EXISTS public.v_lead_evaluation_score CASCADE;
DROP VIEW IF EXISTS public.v_lead_evaluation_history CASCADE;

CREATE VIEW public.v_lead_evaluation_history AS
WITH scored AS (
  SELECT
    r.evaluation_id,
    r.lead_id,
    r.filled_by,
    r.filled_at,
    COALESCE(r.weight_at_time, q.weight) AS w,
    CASE
      WHEN q.question_type = 'SCALE_1_5' AND r.answer_value IS NOT NULL
        THEN r.answer_value / 5.0 * 100.0
      WHEN q.question_type = 'YES_NO' AND r.answer_value IS NOT NULL
        THEN CASE WHEN r.answer_value >= 1 THEN 100.0 ELSE 0.0 END
      ELSE NULL
    END AS pct
  FROM public.evaluation_responses r
  JOIN public.evaluation_questions q ON q.id = r.question_id
), agg AS (
  SELECT
    s.evaluation_id,
    s.lead_id,
    CASE
      WHEN SUM(s.w) FILTER (WHERE s.pct IS NOT NULL) > 0
        THEN ROUND(SUM(s.pct * s.w) FILTER (WHERE s.pct IS NOT NULL)
                   / SUM(s.w) FILTER (WHERE s.pct IS NOT NULL), 2)
      ELSE NULL
    END AS total_score,
    COUNT(*) FILTER (WHERE s.pct IS NOT NULL) AS scored_answered_count,
    COUNT(*) AS answered_count,
    MAX(s.filled_at) AS filled_at
  FROM scored s
  GROUP BY s.evaluation_id, s.lead_id
)
SELECT
  a.evaluation_id,
  a.lead_id,
  a.total_score,
  a.answered_count,
  a.scored_answered_count,
  a.filled_at,
  (SELECT r.filled_by FROM public.evaluation_responses r
     WHERE r.evaluation_id = a.evaluation_id LIMIT 1) AS filled_by
FROM agg a;

GRANT SELECT ON public.v_lead_evaluation_history TO authenticated;

CREATE VIEW public.v_lead_evaluation_score AS
SELECT DISTINCT ON (h.lead_id)
  h.lead_id,
  h.total_score,
  h.answered_count,
  h.scored_answered_count,
  h.filled_at,
  h.evaluation_id
FROM public.v_lead_evaluation_history h
ORDER BY h.lead_id, h.filled_at DESC;

GRANT SELECT ON public.v_lead_evaluation_score TO authenticated;
