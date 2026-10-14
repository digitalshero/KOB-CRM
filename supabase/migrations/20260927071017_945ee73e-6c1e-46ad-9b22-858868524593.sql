ALTER TABLE public.incentive_rules ADD COLUMN IF NOT EXISTS incentive_amount numeric NOT NULL DEFAULT 0;
UPDATE public.incentive_rules SET incentive_amount = round(10000 * incentive_pct / 100.0);