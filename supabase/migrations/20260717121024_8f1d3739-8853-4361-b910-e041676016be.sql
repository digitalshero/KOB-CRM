CREATE OR REPLACE VIEW public.v_state_pincode_totals AS
SELECT UPPER(TRIM(state)) AS state, COUNT(DISTINCT pincode)::int AS total_pincodes
FROM public.india_pincodes
WHERE state IS NOT NULL AND TRIM(state) <> ''
GROUP BY UPPER(TRIM(state))
ORDER BY UPPER(TRIM(state));

GRANT SELECT ON public.v_state_pincode_totals TO authenticated;
GRANT SELECT ON public.v_state_pincode_totals TO service_role;