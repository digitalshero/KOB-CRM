-- Additive, single-row configuration table for the three automatic
-- LEAD_INBOX/EOI_1/WEBINAR -> NO_RESPONSE move thresholds (see
-- backend/src/workers/noResponseAutoMove.ts). Preserves the existing
-- hardcoded defaults (24h / 48h / 48h) as the seeded row so behavior is
-- unchanged until explicitly edited via the No Response Rules UI.
CREATE TABLE IF NOT EXISTS public.no_response_rules (
  id smallint PRIMARY KEY DEFAULT 1,
  lead_inbox_hours integer NOT NULL DEFAULT 24,
  eoi1_hours integer NOT NULL DEFAULT 48,
  webinar_hours integer NOT NULL DEFAULT 48,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_response_rules_single_row CHECK (id = 1)
);

INSERT INTO public.no_response_rules (id, lead_inbox_hours, eoi1_hours, webinar_hours)
VALUES (1, 24, 48, 48)
ON CONFLICT (id) DO NOTHING;
