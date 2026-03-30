-- Migration 007: Add parent_event_id to events table
-- Links FANCY markets to their parent MATCH event.
-- Nullable so all existing rows are unaffected.

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS parent_event_id UUID REFERENCES public.events(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.events.parent_event_id IS
  'Optional FK to a MATCH event. Set on FANCY rows to group session bets under their parent match.';
