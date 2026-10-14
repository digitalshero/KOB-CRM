
-- 1) Pincode directory
CREATE TABLE public.india_pincodes (
  pincode text PRIMARY KEY,
  taluk text,
  district text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX india_pincodes_state_idx ON public.india_pincodes (state);
CREATE INDEX india_pincodes_district_idx ON public.india_pincodes (district);
CREATE INDEX india_pincodes_state_district_idx ON public.india_pincodes (state, district);

GRANT SELECT ON public.india_pincodes TO authenticated;
GRANT ALL ON public.india_pincodes TO service_role;

ALTER TABLE public.india_pincodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pincodes read auth" ON public.india_pincodes
  FOR SELECT TO authenticated USING (true);

-- 2) City-level alias columns for CSV name mapping
ALTER TABLE public.india_cities
  ADD COLUMN IF NOT EXISTS district_aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS state_aliases    text[] NOT NULL DEFAULT '{}';

-- 3) Recompute function: bulk-updates india_cities.pincode_count from india_pincodes
CREATE OR REPLACE FUNCTION public.recompute_city_pincode_counts(_city_id uuid DEFAULT NULL)
RETURNS TABLE(city_id uuid, city_name text, pincode_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH upd AS (
    UPDATE public.india_cities ic
       SET pincode_count = COALESCE((
         SELECT COUNT(DISTINCT p.pincode)::int
         FROM public.india_pincodes p
         JOIN public.india_states s ON s.id = ic.state_id
         WHERE UPPER(p.state) = ANY (
           CASE
             WHEN COALESCE(array_length(ic.state_aliases, 1), 0) > 0
               THEN ARRAY(SELECT UPPER(x) FROM UNNEST(ic.state_aliases) x)
             ELSE ARRAY[UPPER(s.name)]
           END
         )
         AND LOWER(p.district) = ANY (
           CASE
             WHEN COALESCE(array_length(ic.district_aliases, 1), 0) > 0
               THEN ARRAY(SELECT LOWER(x) FROM UNNEST(ic.district_aliases) x)
             ELSE ARRAY[LOWER(ic.name)]
           END
         )
       ), 0)
     WHERE (_city_id IS NULL OR ic.id = _city_id)
    RETURNING ic.id, ic.name, ic.pincode_count
  )
  SELECT u.id, u.name, u.pincode_count FROM upd u ORDER BY u.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_city_pincode_counts(uuid) TO authenticated;
