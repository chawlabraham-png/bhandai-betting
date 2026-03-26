-- Add fancy_gap column to events (1 or 2 run gap for fancy markets)
-- Gap = 1: line 44.5 → NO ≤ 44, YES ≥ 45 (house wins at nothing — adjacent integers)
-- Gap = 2: line 45.0 → NO ≤ 44, YES ≥ 46 (house wins at 45)

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS fancy_gap SMALLINT DEFAULT 1 CHECK (fancy_gap IN (1, 2));

-- Add line_no_at_bet and line_yes_at_bet to orders (snapshot both sides at bet time)
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS line_no_at_bet NUMERIC,
ADD COLUMN IF NOT EXISTS line_yes_at_bet NUMERIC;
